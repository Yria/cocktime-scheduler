-- ============================================================
-- 발행 뒤 회차 총액 변경 = 그 회차 대관비 취소 후 재발행 (2026-10-19 운영 결정)
--
-- 사고: 세션 395(10/18 19:00 에이트민턴, 일회성)는 총액 미입력으로 종료돼 정액 6,000원 × 13명이
--   자동 발행됐다. 정산 사정으로 총액을 나중에 알게 됐는데, v2 승격(20260911010000)의
--   dues_set_session_fee 는 "발행 이력이 있는 회차" 면 무조건 거부해 입력할 길이 없었다.
--
-- 결정: 총액을 바꾸면 그 회차의 유효(live) 대관비를 **전부 취소하고 새 총액으로 재발행**한다.
--   v1(20260823080000)처럼 배분·부과 행을 지우지 않는다 — v2 는 되돌리기 기록이 없어 지우면 복구 불가.
--   대신 v2 의 `replace` 명령을 쓴다:
--     ① 원부과의 납부 배분을 모두 해제(dues_reversals 기록, 돈은 낸 사람의 member_pending 으로)
--     ② 원부과를 cancelled 로
--     ③ 아직 대상인 회원은 previous_id 로 이어진 새 부과를 만들고, 해제된 그 돈을 **같은 회원의 새 부과에
--        자동으로 다시 배분**한다. 새 금액보다 많이 낸 돈은 회원 잔액으로 남고, 모자라면 차액이 미납.
--   대상에서 빠진 회원(총액 0 · 정액→엔빵 반대 방향의 운영진)은 취소만 되고 낸 돈은 잔액으로 남는다.
--   새로 대상이 된 회원(정액→엔빵이면 운영진)은 종료 회차에서 바로 발행한다.
--
-- 재발행 표식 `reissuable`: 생성기(dues_candidates_internal)와 dues_issue 는 "그룹에 부과가 한 번이라도
--   있던 회원"을 대상에서 뺀다(사람이 취소한 회원을 되살리지 않는 불변식). 총액 변경으로 취소된 부과까지
--   막히면 "0원으로 바꿨다가 다시 금액 입력" 에서 아무도 발행되지 않는다. 그래서 이 경로로 취소한 부과에만
--   basis.reissuable=true 를 달고, 선납 되돌림(prepayment_reversed)과 같은 예외로 취급한다.
--   사람이 취소·면제한 부과는 여전히 되살리지 않는다.
-- ============================================================
set local lock_timeout = '5s';

-- 생성기·발행 가드에 reissuable 예외 추가. 정확한 등장 횟수가 아니면 실패한다(20260914010000 관례).
do $patch$
declare definition text; old text; replacement text;
begin
  definition:=pg_get_functiondef('public.dues_candidates_internal(text,text,bigint)'::regprocedure);
  old:=$old$and not (c.state='cancelled' and c.basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb));$old$;
  replacement:=$new$and not (c.state='cancelled' and (c.basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb
          or c.basis @> '{"reissuable":true}'::jsonb)));$new$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>2 then raise exception 'Unexpected charge candidate implementation'; end if;
  execute replace(definition,old,replacement);

  definition:=pg_get_functiondef('public.dues_issue(jsonb)'::regprocedure);
  old:=$old$and not (state='cancelled' and basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb))$old$;
  replacement:=$new$and not (state='cancelled' and (basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb
        or basis @> '{"reissuable":true}'::jsonb)))$new$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Unexpected issuance guard'; end if;
  definition:=replace(definition,old,replacement);
  old:=$old$and state='cancelled' and basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb$old$;
  replacement:=$new$and state='cancelled' and (basis @> '{"prepayment":true,"prepayment_reversed":true}'::jsonb
            or basis @> '{"reissuable":true}'::jsonb)$new$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Unexpected issuance predecessor'; end if;
  execute replace(definition,old,replacement);
end $patch$;

create or replace function public.dues_set_session_fee(p_session_id bigint, p_amount integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctl public.dues_control; s public.sessions; g public.dues_groups; k text:='court:'||p_session_id;
  ym text; rule_total integer; old_total integer; total integer; cand jsonb; per_head integer; head integer;
  targets jsonb:='{}'; snap jsonb; pre boolean; ids jsonb; lines jsonb; r jsonb;
  n_cancelled integer:=0; n_paid integer:=0; released bigint:=0; reused bigint:=0;
  n_reissued integer:=0; n_new integer:=0; n_held integer:=0;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  if p_amount<0 then raise exception '금액을 확인하세요'; end if;
  -- 장부 → 회차 순서(dues_execute 경로와 같은 순서)로 잡는다.
  select * into strict ctl from public.dues_control where id=1 for update;
  select * into s from public.sessions where id=p_session_id for update;
  if not found then raise exception '회차가 없습니다'; end if;
  ym:=to_char(s.scheduled_at at time zone 'Asia/Seoul','YYYY-MM');
  select r.court_fee into rule_total from public.recurring_schedules r where r.id=s.recurring_schedule_id;
  old_total:=coalesce(s.court_fee,rule_total);
  total:=coalesce(p_amount,rule_total);
  select * into g from public.dues_groups where source_key=k;

  if g.id is not null and ((g.basis->>'legacy'='true' and g.basis->>'closed'='true')
      or ym<to_char(ctl.activated_at at time zone 'Asia/Seoul','YYYY-MM'))
    then raise exception '이전 장부에서 정산된 회차는 총액을 바꿀 수 없습니다'; end if;

  update public.sessions set court_fee=p_amount where id=p_session_id;

  if g.id is not null and exists(select 1 from public.dues_charges where group_id=g.id and state='live') then
    if total is null or total>0 then
      cand:=public.dues_candidates_internal('court',ym,p_session_id);
      per_head:=(cand#>>'{payload,basis,per_head}')::integer;
      head:=(cand#>>'{payload,basis,head}')::integer;
      if cand->>'hold_reason'='amount_out_of_range' then
        raise exception '인당 %원(%명)은 정상 범위를 벗어납니다. 총액을 확인하거나 회비 관리에서 직접 변경하세요',
          per_head,head; end if;
      select coalesce(jsonb_object_agg(t.member_id::text,jsonb_build_object('member_id',t.member_id,'amount',per_head,
          'due_ym',ym,'payer_hint',t.payer_hint,'is_day_cancel',t.is_day_cancel)),'{}') into targets
        from public.dues_court_targets(p_session_id,total is not null) t;
    end if;

    -- 같은 값을 다시 저장해도 전원 취소·재발행되지 않게 한다.
    if not exists(select 1 from public.dues_charges c where c.group_id=g.id and c.state='live'
          and (c.amount is distinct from per_head or not targets ? c.member_id::text))
       and (s.status<>'closed' or jsonb_array_length(cand#>'{payload,lines}')=0) then
      update public.dues_control set revision=revision+1 where id=1;
      return jsonb_build_object('court_fee',p_amount,'unchanged',true,'per_head',per_head,'head',head,
        'cancelled',0,'paid_cancelled',0,'released_amount',0,'reused_amount',0,'left_as_balance',0,
        'reissued',0,'issued_new',0,'held',0,'freed',0,'removed',0,'issued',0);
    end if;

    -- 감사용 원본. dues_operations.payload 에 함께 남는다.
    select jsonb_agg(jsonb_build_object('id',c.id,'member_id',c.member_id,'amount',c.amount,
        'paid',(select coalesce(sum(a.amount-a.reversed),0) from public.dues_allocations a where a.charge_id=c.id),
        'prepayment',coalesce(c.basis->'prepayment','false'::jsonb)) order by c.member_id) into snap
      from public.dues_charges c where c.group_id=g.id and c.state='live';

    -- replace 의 basis 는 한 호출의 모든 줄에 붙으므로 선납/일반을 나눠 부른다(선납 표식 유지).
    foreach pre in array array[true,false] loop
      select jsonb_agg(c.id order by c.member_id),
          coalesce(jsonb_agg(jsonb_build_object('member_id',c.member_id,'amount',per_head,'due_ym',ym,'previous_id',c.id)
            order by c.member_id) filter (where targets ? c.member_id::text),'[]')
        into ids,lines
        from public.dues_charges c where c.group_id=g.id and c.state='live'
         and coalesce(c.basis->'prepayment','false'::jsonb)=to_jsonb(pre);
      continue when ids is null;
      r:=public.dues_execute(jsonb_build_object('action','replace',
          'reason',format('대관 총액 변경 재발행 (%s → %s)',coalesce(old_total::text,'정액'),coalesce(total::text,'정액')),
          'session_id',p_session_id,'snapshot',snap,'charge_ids',ids,'lines',lines,
          'basis',jsonb_build_object('rule','court','total',total,'head',head,'per_head',per_head,
              'rounding',case when total is null then null else 10 end,'fee_reset',true)
            ||case when pre then '{"prepayment":true}'::jsonb else '{}'::jsonb end),
        gen_random_uuid(),(select revision from public.dues_control where id=1));
      -- replace 는 basis.line 을 버린다. 화면의 당일취소 표시가 line.is_day_cancel 을 읽으므로 되살린다.
      update public.dues_charges c set basis=c.basis||jsonb_build_object('line',targets->(c.member_id::text))
        where c.id in (select (x#>>'{}')::uuid from jsonb_array_elements(r->'charges') x);
      update public.dues_charges c set basis=c.basis||jsonb_build_object('reissuable',true,'fee_reset_at',now())
        where c.id in (select (x#>>'{}')::uuid from jsonb_array_elements(ids) x);
      n_cancelled:=n_cancelled+jsonb_array_length(ids);
      n_reissued:=n_reissued+jsonb_array_length(r->'charges');
      reused:=reused+coalesce((r->>'reused')::bigint,0);
    end loop;
    select count(*) filter (where (x->>'paid')::integer>0),coalesce(sum((x->>'paid')::integer),0)
      into n_paid,released from jsonb_array_elements(snap) x;
    update public.dues_groups set basis=basis||jsonb_build_object('total',total,'head',head,'per_head',per_head,
      'previous_total',old_total,'fee_reset_at',now()) where id=g.id;
  end if;

  -- 새로 대상이 된 회원 발행 — 종료 회차만. 진행 전·진행 중이면 종료 트리거가 발행한다.
  delete from public.dues_drafts where source_key=k;
  if s.status='closed' and (total is null or total>0) then
    -- 확인창·토스트가 인당 금액을 보여줄 수 있게 발행 전 기준을 채운다(유효 부과가 없던 회차).
    if per_head is null then
      cand:=public.dues_candidates_internal('court',ym,p_session_id);
      per_head:=(cand#>>'{payload,basis,per_head}')::integer;
      head:=(cand#>>'{payload,basis,head}')::integer;
    end if;
    if g.id is null then
      -- 처음 발행: 자동 발행과 같은 게이트(경기 기록 없으면 0, 이상 금액은 발행 대기).
      n_new:=public.dues_auto_issue('court',ym,p_session_id,true);
    else
      cand:=public.dues_candidates_internal('court',ym,p_session_id);
      if jsonb_array_length(cand#>'{payload,lines}')>0 then
        if cand->>'hold_reason'='amount_out_of_range' then
          raise exception '인당 %원(%명)은 정상 범위를 벗어납니다. 총액을 확인하거나 회비 관리에서 직접 변경하세요',
            cand#>>'{payload,basis,per_head}',cand#>>'{payload,basis,head}'; end if;
        r:=public.dues_execute((cand->'payload')||jsonb_build_object('reason','대관 총액 변경 재발행 (신규 대상)'),
          gen_random_uuid(),(select revision from public.dues_control where id=1));
        n_new:=jsonb_array_length(r->'charges');
      end if;
    end if;
  end if;
  select count(*) into n_held from public.dues_drafts where source_key=k;

  update public.dues_control set revision=revision+1 where id=1;
  return jsonb_build_object('court_fee',p_amount,'per_head',per_head,'head',head,
    'cancelled',n_cancelled,'paid_cancelled',n_paid,'released_amount',released,'reused_amount',reused,
    'left_as_balance',released-reused,'reissued',n_reissued,'issued_new',n_new,'held',n_held,
    -- 이전 클라이언트 호환 키
    'freed',n_paid,'removed',n_cancelled,'issued',n_reissued+n_new);
end $$;

-- 확인창 미리보기: 실제로 실행한 뒤 결과만 들고 롤백한다(dues_preview 와 같은 P0V02 방식).
create or replace function public.dues_session_fee_preview(p_session_id bigint, p_amount integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; detail text;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  begin
    v:=public.dues_set_session_fee(p_session_id,p_amount);
    raise exception using errcode='P0V02',message='preview',detail=v::text;
  exception when sqlstate 'P0V02' then
    get stacked diagnostics detail=pg_exception_detail;
    return detail::jsonb||'{"preview":true}'::jsonb;
  end;
end $$;

revoke all on function public.dues_set_session_fee(bigint,integer) from public,anon,authenticated;
revoke all on function public.dues_session_fee_preview(bigint,integer) from public,anon,authenticated;
grant execute on function public.dues_set_session_fee(bigint,integer) to authenticated;
grant execute on function public.dues_session_fee_preview(bigint,integer) to authenticated;

comment on function public.dues_set_session_fee(bigint,integer) is
  '회차 대관 총액 변경. 발행분이 있으면 replace 로 전부 취소(납부 해제)하고 같은 회원에게 새 금액으로 재발행하며 '
  '해제된 돈을 자동 재배분한다. 남는 돈은 회원 잔액. 종료 회차는 새 대상도 발행. 2026-10-19(세션 395).';
