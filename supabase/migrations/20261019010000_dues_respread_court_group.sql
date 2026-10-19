-- ============================================================
-- 엔빵 재분배 (2026-10-19 운영 결정)
--
-- 사고: 세션 395 는 총액 104,000원 엔빵으로 17명(당일취소 1명 포함)에게 6,000원씩 재발행된 뒤,
--   운영진이 당일취소자 부과를 취소했다. 남은 16명은 6,000원 그대로라 8,000원이 덜 걷히는데도
--   '완납'으로 보였다. 엔빵은 "총액 ÷ 실제 부과 인원" 이어야 한다.
--
-- 결정: 엔빵 회차에서 부과를 취소·변경해 인원이 바뀌면 화면이 재분배 여부를 묻고, 확인하면 이 함수가
--   남은 유효 부과를 같은 엔빵 규칙(10원 절상 → 정액 근처 스냅)으로 다시 나눠 재발행한다.
--   클라이언트가 replace 를 직접 만들면 basis 가 한 호출의 모든 줄에 붙어 선납 표식·당일취소 표시(line)·
--   rule 이 사라진다. 그래서 총액 변경 재발행(dues_set_session_fee)과 같은 방식으로 서버에서 처리한다:
--     · 선납/일반을 나눠 replace (선납 표식 유지)
--     · 새 부과에 원부과의 basis.line 을 되살림
--     · 납부 배분은 replace 가 해제 후 같은 회원 새 부과에 자동 재배분(모자라면 미납, 남으면 잔액)
--   가드: 화면이 본 장부 revision 고정(그 사이 다른 변경이 있으면 거부) · 종료 회차만 · 정상 범위
--   (정액의 0.5~2.5배, 생성기 amount_out_of_range 와 같은 기준) 밖이면 거부.
-- ============================================================
set local lock_timeout = '5s';

create or replace function public.dues_respread_court_group(p_group_id uuid, p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctl public.dues_control; g public.dues_groups; s public.sessions; ym text;
  total integer; flat integer; n integer; raw integer; per_head integer;
  snap jsonb; pre boolean; ids jsonb; lines jsonb; r jsonb; n_reissued integer:=0; reused bigint:=0;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  select * into strict ctl from public.dues_control where id=1 for update;
  if ctl.revision<>p_revision then
    raise exception '다른 변경이 먼저 반영됐습니다. 새로 고친 뒤 다시 확인하세요' using errcode='40001'; end if;
  select * into g from public.dues_groups where id=p_group_id for update;
  if not found or g.kind<>'court' or g.session_id is null then raise exception '대관 회차 부과가 아닙니다'; end if;
  total:=(g.basis->>'total')::integer;
  if total is null or total<=0 then raise exception '엔빵(총액) 회차가 아닙니다'; end if;
  select * into s from public.sessions where id=g.session_id;
  if s.status is distinct from 'closed' then raise exception '종료된 회차만 재분배할 수 있습니다'; end if;
  ym:=to_char(s.scheduled_at at time zone 'Asia/Seoul','YYYY-MM');

  select count(*) into n from public.dues_charges where group_id=g.id and state='live';
  if n=0 then raise exception '남은 부과가 없습니다'; end if;
  select court_fee_default into flat from public.dues_settings where id=1;
  raw:=(ceil(total::numeric/n/10)*10)::integer;
  per_head:=case when raw>=flat and raw<flat+200 then flat else raw end;
  if per_head*2<flat or per_head*2>flat*5 then
    raise exception '인당 %원(%명)은 정상 범위를 벗어납니다. 회비 관리에서 직접 변경하세요',per_head,n; end if;
  if not exists(select 1 from public.dues_charges where group_id=g.id and state='live' and amount<>per_head) then
    return jsonb_build_object('unchanged',true,'per_head',per_head,'head',n);
  end if;

  select jsonb_agg(jsonb_build_object('id',c.id,'member_id',c.member_id,'amount',c.amount,
      'paid',(select coalesce(sum(a.amount-a.reversed),0) from public.dues_allocations a where a.charge_id=c.id),
      'prepayment',coalesce(c.basis->'prepayment','false'::jsonb)) order by c.member_id) into snap
    from public.dues_charges c where c.group_id=g.id and c.state='live';

  foreach pre in array array[true,false] loop
    -- 납기: 값이 남은(미납이거나 납부된) 가장 이른 납기월. 이월로 비워진 행은 건너뛴다.
    select jsonb_agg(c.id order by c.member_id),
        jsonb_agg(jsonb_build_object('member_id',c.member_id,'amount',per_head,'previous_id',c.id,
          'payer_hint',c.payer_hint,
          'due_ym',coalesce((select min(d.due_ym) from public.dues_due d where d.charge_id=c.id
              and (d.remaining>0 or exists(select 1 from public.dues_allocations a
                where a.due_id=d.id and a.amount>a.reversed))),ym)) order by c.member_id)
      into ids,lines
      from public.dues_charges c where c.group_id=g.id and c.state='live'
       and coalesce(c.basis->'prepayment','false'::jsonb)=to_jsonb(pre);
    continue when ids is null;
    r:=public.dues_execute(jsonb_build_object('action','replace',
        'reason',format('엔빵 재분배 (%s명 → %s명, 대관 %s원 ÷ %s명)',coalesce(g.basis->>'head','?'),n,total,n),
        'session_id',g.session_id,'snapshot',snap,'charge_ids',ids,'lines',lines,
        'basis',jsonb_build_object('rule','court','total',total,'head',n,'per_head',per_head,'rounding',10,'respread',true)
          ||case when pre then '{"prepayment":true}'::jsonb else '{}'::jsonb end),
      gen_random_uuid(),(select revision from public.dues_control where id=1));
    -- replace 는 basis.line 을 버린다. 원부과의 line(당일취소 표시 등)을 되살린다.
    update public.dues_charges c set basis=c.basis||jsonb_build_object('line',c.basis#>'{previous_basis,line}')
      where c.id in (select (x#>>'{}')::uuid from jsonb_array_elements(r->'charges') x)
        and c.basis#>'{previous_basis,line}' is not null;
    n_reissued:=n_reissued+jsonb_array_length(r->'charges');
    reused:=reused+coalesce((r->>'reused')::bigint,0);
  end loop;
  update public.dues_groups set basis=basis||jsonb_build_object('head',n,'per_head',per_head,'respread_at',now())
    where id=g.id;
  update public.dues_control set revision=revision+1 where id=1;
  return jsonb_build_object('per_head',per_head,'head',n,'reissued',n_reissued,'reused_amount',reused);
end $$;

revoke all on function public.dues_respread_court_group(uuid,bigint) from public,anon,authenticated;
grant execute on function public.dues_respread_court_group(uuid,bigint) to authenticated;
comment on function public.dues_respread_court_group(uuid,bigint) is
  '엔빵 회차 재분배: 남은 유효 대관비를 총액 ÷ 현재 인원(10원 절상·정액 스냅)으로 replace 재발행. '
  '선납/일반 분리, basis.line 복원, 납부 자동 재배분. 2026-10-19(세션 395).';

-- 세션 395 보정: 이 함수 전에 스크립트(op 534)로 클라이언트식 replace 를 해 line·rule 이 빠졌고
-- 그룹 기준이 17명/6,000원으로 남아 있다. 원부과 line 을 되살리고 기준을 16명/6,500원으로 맞춘다.
update public.dues_charges c
  set basis=c.basis||jsonb_build_object('rule','court','head',16,'per_head',6500)
    ||case when c.basis#>'{previous_basis,line}' is not null
      then jsonb_build_object('line',c.basis#>'{previous_basis,line}') else '{}'::jsonb end
  from public.dues_groups g
  where g.id=c.group_id and g.source_key='court:395' and c.state='live' and c.amount=6500
    and not c.basis ? 'line';
update public.dues_groups set basis=basis||jsonb_build_object('head',16,'per_head',6500,'respread_at',now())
  where source_key='court:395' and (basis->>'head')::integer=17;
