-- 부과 탭 [사람 추가]: 사람이 취소한 회원도 운영진이 직접 고르면 다시 부과할 수 있게 한다(2026-11-08).
-- 이전엔 같은 묶음에 '사람이 취소한' 부과가 있으면 어떤 발행이든 거부했다(자동 발행이 취소를 되살리지 않게).
-- 이제 rule 없음 + group_id 지정 + reissue_cancelled=true 인 명시적 추가만 예외로, 새 부과를 취소된 옛 부과에
-- previous_id 로 이어 붙인다(한 사람 이력은 한 줄). 자동·규칙 발행과 면제(waived)는 그대로 막는다.
-- 본문은 프로덕션 현재 정의(이름 변경·reissuable 패치 반영본)에서 출발했다.

create or replace function public.dues_issue(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g uuid; c uuid; line jsonb; part jsonb; schedule jsonb; result jsonb:='[]'; day date; k text; source text;
  -- 운영진이 기존 묶음에 사람을 직접 고른 경우([사람 추가])만 사람이 취소한 부과를 다시 발행할 수 있다.
  -- 자동·규칙 발행(rule 있음)은 취소를 '걷지 않는다'는 결정으로 보고 계속 되살리지 않는다. 면제는 항상 막는다.
  again boolean:=p->>'rule' is null and p->>'group_id' is not null and coalesce((p->>'reissue_cancelled')::boolean,false);
begin
  if p->>'group_id' is not null then
    select id into strict g from public.dues_groups where id=(p->>'group_id')::uuid;
    if p->>'rule' in ('monthly','court') and not exists(select 1 from public.dues_groups bg where bg.id=g
      and bg.source_key=case p->>'rule' when 'monthly' then 'monthly:'||(p->>'ym') else 'court:'||(p->>'session_id') end)
      then raise exception '부과 묶음과 계산 기준이 다릅니다'; end if;
  else
    day:=(p->>'date')::date; k:=p->>'kind';
    source:=case k when 'monthly' then 'monthly:'||to_char(day,'YYYY-MM')
      when 'court' then 'court:'||(p->>'session_id') else 'manual:'||gen_random_uuid() end;
    insert into public.dues_groups(source_key,kind,label,occurred_on,session_id,basis)
      values(source,k,btrim(p->>'label'),day,(p->>'session_id')::bigint,coalesce(p->'basis','{}')) returning id into g;
  end if;
  for line in select value from jsonb_array_elements(coalesce(p->'lines','[]')) loop
    -- Rule-generated drafts must be checked again at confirmation time.
    if p->>'rule'='monthly' and (not exists(select 1 from public.dues_monthly_targets(p->>'ym') t where t.member_id=(line->>'member_id')::uuid)
      or (line->>'amount')::integer<>(select monthly_fee from public.dues_settings where id=1))
      then raise exception '회비 대상 또는 금액이 변경됐습니다. 다시 계산하세요'; end if;
    if exists(select 1 from public.dues_charges where group_id=g and member_id=(line->>'member_id')::uuid
      and not (state='cancelled' and (again or basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb
        or basis @> '{"reissuable":true}'::jsonb)))
      then raise exception '이미 발행·취소한 회원입니다. 취소 후 발행에서 처리하세요'; end if;
    insert into public.dues_charges(group_id,member_id,amount,previous_id,payer_hint,basis)
      values(g,(line->>'member_id')::uuid,(line->>'amount')::integer,
        (select predecessor.id from public.dues_charges predecessor where group_id=g and member_id=(line->>'member_id')::uuid
          and state='cancelled' and (again or basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb
            or basis @> '{"reissuable":true}'::jsonb)
          and not exists(select 1 from public.dues_charges successor where successor.previous_id=predecessor.id)
          order by issued_at desc,predecessor.id desc limit 1),(line->>'payer_hint')::uuid,
        (coalesce(p->'basis','{}')-'members')||jsonb_build_object('rule',p->>'rule','line',line)) returning id into c;
    schedule:=coalesce(line->'due_schedule',jsonb_build_array(jsonb_build_object('due_ym',coalesce(line->>'due_ym',p->>'ym',to_char(day,'YYYY-MM')),'amount',line->'amount')));
    if (select coalesce(sum((x->>'amount')::integer),0) from jsonb_array_elements(schedule) x)<>(line->>'amount')::integer
      then raise exception '납기별 금액 합이 부과액과 다릅니다'; end if;
    for part in select value from jsonb_array_elements(schedule) loop
      if (part->>'amount')::integer is null or (part->>'amount')::integer<0 then raise exception '납기별 금액을 확인하세요'; end if;
      if (part->>'amount')::integer>0 then
        insert into public.dues_due(charge_id,due_ym,remaining) values(c,part->>'due_ym',(part->>'amount')::integer);
      end if;
    end loop;
    result:=result||jsonb_build_array(c);
  end loop;
  return jsonb_build_object('group_id',g,'charges',result);
end $function$;
