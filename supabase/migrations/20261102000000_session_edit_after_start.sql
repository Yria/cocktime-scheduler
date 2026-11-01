-- ============================================================
-- 진행·종료 회차 수정 + 부과 연동 (2026-11-02 운영 결정)
--
-- 이전: 회차 에디터는 draft/open 만 열렸고, 진행(active)·종료(closed) 회차는 정보 보기 + 총액 정정뿐이었다.
--   서버엔 상태 가드가 없어(RLS 는 is_admin 만) 막힌 건 클라이언트뿐이었다.
--
-- 결정: 진행·종료 회차도 에디터 전체 필드를 고칠 수 있다. 부과(대관비)에 닿는 변경은 같은 트랜잭션에서
--   부과를 맞춘다. 기존 회차 저장은 상태와 무관하게 전부 session_edit 한 경로로 간다 — 경로를 클라이언트가
--   (시트를 연 시점의 상태로) 고르면, 시트를 연 뒤 경기가 시작된 회차가 옛 경로를 탄다.
--   예정(open) 회차의 선납 대관비도 장소를 비대관으로 바꾸면 같은 규칙으로 정리된다(이전엔 그대로 남았다).
--   필드별 부과 영향(조사 결과):
--     · court_fee         → dues_set_session_fee 로 취소 후 재발행(20261019000000 그대로).
--     · place_id          → 대관장소 여부(charges_court_fee)가 바뀌면 부과 대상 자체가 바뀐다.
--                           대관→비대관: 유효 대관비 전부 취소(낸 돈은 잔액). 비대관→대관: 종료 회차면 지금 발행,
--                           진행 회차면 종료 트리거가 발행. 대관→대관(다른 곳)은 금액 불변, 그룹 라벨만 갱신.
--     · scheduled_at      → 당일취소 판정·부과 월(due_ym)·그룹 날짜가 KST 날짜에 걸려 있다.
--                           날짜 이동을 정합하게 옮기는 경로가 없으므로 **날짜는 바꿀 수 없다**(시간만).
--                           시간만 바꾸면 부과 불변, 그룹 라벨(MM/DD HH24:MI)만 갱신.
--     · capacity          → set_session_capacity 그대로(진행=빈자리 승격만, 종료=카운터 동기화만).
--     · 그 외(카풀·정모·식사·공지) → 부과 무관.
--   대기 포인트는 종료 때 1회 정산되며 장소·시간과 무관하므로 건드리지 않는다.
--
-- dues_set_session_fee 보강: 장소가 대관장소가 아니면 "대상 없음"으로 보고 유효 대관비를 전부 취소한다.
--   (이전엔 dues_candidates_internal 이 '대관비 발행 대상 회차가 아닙니다' 로 거부해 정리할 길이 없었다.)
--   총액 0원과 같은 경로라 reissuable 표식이 붙고, 대관장소로 되돌리면 다시 발행된다.
-- ============================================================
set local lock_timeout = '5s';

create or replace function public.dues_set_session_fee(p_session_id bigint, p_amount integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctl public.dues_control; s public.sessions; g public.dues_groups; k text:='court:'||p_session_id;
  ym text; rule_total integer; old_total integer; total integer; cand jsonb; per_head integer; head integer;
  targets jsonb:='{}'; snap jsonb; pre boolean; ids jsonb; lines jsonb; r jsonb;
  n_cancelled integer:=0; n_paid integer:=0; released bigint:=0; reused bigint:=0;
  n_reissued integer:=0; n_new integer:=0; n_held integer:=0;
  rental boolean; eligible boolean; why text;
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
  -- 대관장소가 아니면 총액과 무관하게 걷을 대상이 없다(장소를 비대관으로 바꾼 진행·종료 회차).
  select coalesce(pl.charges_court_fee,false) into rental from public.places pl where pl.id=s.place_id;
  rental:=coalesce(rental,false);
  eligible:=rental and (total is null or total>0);
  why:=case when not rental then '대관장소 아님 — 대관비 취소'
    else format('대관 총액 변경 재발행 (%s → %s)',coalesce(old_total::text,'정액'),coalesce(total::text,'정액')) end;
  select * into g from public.dues_groups where source_key=k;

  if g.id is not null and ((g.basis->>'legacy'='true' and g.basis->>'closed'='true')
      or ym<to_char(ctl.activated_at at time zone 'Asia/Seoul','YYYY-MM'))
    then raise exception '이전 장부에서 정산된 회차는 총액을 바꿀 수 없습니다'; end if;

  update public.sessions set court_fee=p_amount where id=p_session_id;

  if g.id is not null and exists(select 1 from public.dues_charges where group_id=g.id and state='live') then
    if eligible then
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
          'reason',why,
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
  if s.status='closed' and eligible then
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

-- 회차 수정 본체. p_patch 는 sessions 컬럼명 키(있는 키만 바꾼다). 취소 회차는 되살리기 경로만.
-- p_preview 면 알림이 나가는 정원 변경은 건너뛴다(어차피 롤백되지만 부작용 경로를 타지 않게).
create or replace function public.session_edit_internal(p_session_id bigint, p_patch jsonb, p_preview boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.sessions; n public.sessions; g public.dues_groups; ctl public.dues_control;
  was_rental boolean; is_rental boolean; new_fee integer; recharge boolean; fee jsonb:='{}'; cap jsonb;
  new_cap integer;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  -- 장부 → 회차 순서(dues_set_session_fee 와 같은 순서)로 잡는다.
  select * into strict ctl from public.dues_control where id=1 for update;
  select * into s from public.sessions where id=p_session_id for update;
  if not found then raise exception '회차가 없습니다'; end if;
  if s.status='cancelled' then raise exception '취소된 회차는 되살린 뒤 수정하세요'; end if;

  update public.sessions set
    scheduled_at=case when p_patch ? 'scheduled_at' then (p_patch->>'scheduled_at')::timestamptz else scheduled_at end,
    ends_at=case when p_patch ? 'ends_at' then (p_patch->>'ends_at')::timestamptz else ends_at end,
    carpool_enabled=case when p_patch ? 'carpool_enabled' then (p_patch->>'carpool_enabled')::boolean else carpool_enabled end,
    place_id=case when p_patch ? 'place_id' then (p_patch->>'place_id')::bigint else place_id end,
    is_regular=case when p_patch ? 'is_regular' then (p_patch->>'is_regular')::boolean else is_regular end,
    notice_md=case when p_patch ? 'notice_md' then p_patch->>'notice_md' else notice_md end,
    meal_enabled=case when p_patch ? 'meal_enabled' then (p_patch->>'meal_enabled')::boolean else meal_enabled end,
    meal_place=case when p_patch ? 'meal_place' then p_patch->>'meal_place' else meal_place end,
    meal_place_lat=case when p_patch ? 'meal_place_lat' then (p_patch->>'meal_place_lat')::double precision else meal_place_lat end,
    meal_place_lng=case when p_patch ? 'meal_place_lng' then (p_patch->>'meal_place_lng')::double precision else meal_place_lng end,
    is_overridden=true
  where id=p_session_id returning * into n;

  if s.status in ('active','closed') and (n.scheduled_at is null or (n.scheduled_at at time zone 'Asia/Seoul')::date
      <> (s.scheduled_at at time zone 'Asia/Seoul')::date) then
    raise exception '진행 중이거나 종료된 회차는 날짜를 바꿀 수 없습니다(시간만 바꿀 수 있어요)'; end if;

  -- 부과 재계산: 총액이 바뀌었거나 대관장소 여부가 바뀐 경우, 또는 비대관인데 유효 대관비가 남은 경우
  -- (이 경로가 생기기 전에 장소만 바꿔 남은 선납분). 나머지는 부과 불변.
  select coalesce(bool_or(pl.charges_court_fee),false) into was_rental from public.places pl where pl.id=s.place_id;
  select coalesce(bool_or(pl.charges_court_fee),false) into is_rental from public.places pl where pl.id=n.place_id;
  new_fee:=case when p_patch ? 'court_fee' then (p_patch->>'court_fee')::integer else s.court_fee end;
  recharge:=new_fee is distinct from s.court_fee or was_rental<>is_rental
    or (not is_rental and exists(select 1 from public.dues_charges c join public.dues_groups dg on dg.id=c.group_id
          where dg.source_key='court:'||p_session_id and c.state='live'));
  if recharge then
    fee:=public.dues_set_session_fee(p_session_id,new_fee);
  end if;

  -- 장부 라벨은 첫 발행 때 'MM/DD HH24:MI 장소 #id' 로 굳는다. 시간·장소를 고쳤으면 따라 고친다.
  select * into g from public.dues_groups where source_key='court:'||p_session_id;
  if g.id is not null and (n.scheduled_at is distinct from s.scheduled_at or n.place_id is distinct from s.place_id) then
    update public.dues_groups set label=
        to_char(n.scheduled_at at time zone 'Asia/Seoul','MM/DD HH24:MI')||' '
        ||coalesce((select pl.name from public.places pl where pl.id=n.place_id),n.title,'대관')||' #'||n.id
      where id=g.id;
  end if;

  if p_patch ? 'capacity' then
    new_cap:=(p_patch->>'capacity')::integer;
    if new_cap is distinct from s.capacity and not p_preview then
      cap:=public.set_session_capacity(p_session_id,new_cap);
    elsif new_cap is distinct from s.capacity then
      update public.sessions set capacity=new_cap where id=p_session_id;
    end if;
  end if;

  return fee||jsonb_build_object('recharged',recharge,'was_rental',was_rental,'is_rental',is_rental,
    'promoted',coalesce((cap->>'promoted')::integer,0),'demoted',coalesce((cap->>'demoted')::integer,0));
end $$;

create or replace function public.session_edit(p_session_id bigint, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  return public.session_edit_internal(p_session_id,p_patch,false);
end $$;

-- 확인창 미리보기: 실제로 실행한 뒤 결과만 들고 롤백한다(dues_session_fee_preview 와 같은 P0V02 방식).
create or replace function public.session_edit_preview(p_session_id bigint, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; detail text;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  begin
    v:=public.session_edit_internal(p_session_id,p_patch,true);
    raise exception using errcode='P0V02',message='preview',detail=v::text;
  exception when sqlstate 'P0V02' then
    get stacked diagnostics detail=pg_exception_detail;
    return detail::jsonb||'{"preview":true}'::jsonb;
  end;
end $$;

revoke all on function public.session_edit_internal(bigint,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.session_edit(bigint,jsonb) from public,anon,authenticated;
revoke all on function public.session_edit_preview(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.session_edit(bigint,jsonb) to authenticated;
grant execute on function public.session_edit_preview(bigint,jsonb) to authenticated;

comment on function public.session_edit(bigint,jsonb) is
  '회차 수정(취소 회차 제외). 진행·종료 회차는 날짜 고정(시간만). 총액 변경·대관장소 여부 변경이면 dues_set_session_fee 로 부과를 '
  '같은 트랜잭션에서 취소·재발행하고, 장부 라벨을 시간·장소에 맞춘다. 정원은 set_session_capacity. 2026-11-02.';
