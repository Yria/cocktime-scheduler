-- 일정 신청과 보드 추가는 같은 게스트 회원을 사용한다.
-- guest-*는 저장 전 임시 키일 뿐이다. 경기에서 참조하는 보드 행/키는 보존한다.
begin;
set local lock_timeout = '5s';

create or replace function public._register_guest_member(
  p_name text, p_gender text, p_skills jsonb, p_session_id bigint
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_guest uuid;
begin
  if public.name_match_key(p_name) = '' then raise exception 'guest name required'; end if;
  if p_gender is null or p_gender not in ('M','F') then raise exception 'guest gender required'; end if;

  -- 서로 다른 일정/보드의 동시 등록도 같은 이름·성별에 대해 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended('guest:' || public.name_match_key(p_name) || ':' || p_gender, 0));
  if exists (select 1 from public.members where not is_guest and is_active
    and public.name_match_key(name) = public.name_match_key(p_name)) then
    raise exception 'name_is_member';
  end if;

  select m.id into v_guest from public.members m
  where m.is_guest and m.auth_user_id is null
    and public.name_match_key(m.name) = public.name_match_key(p_name)
    and m.gender = p_gender
  -- 과거 중복 회원 행이 있어도 해당 회차에서 이미 쓰는 회원을 우선한다.
  order by (exists (select 1 from public.attendances a
                    where a.session_id=p_session_id and a.member_id=m.id)
         or exists (select 1 from public.session_players sp
                    where sp.session_id=p_session_id and sp.member_id=m.id)) desc,
    m.created_at desc, m.id
  limit 1;
  if found then
    update public.members set is_active=true,
      skills=coalesce(skills,'{}'::jsonb) || coalesce(p_skills,'{}'::jsonb), updated_at=now()
    where id=v_guest;
  else
    insert into public.members(name,gender,skills,is_guest)
    values(btrim(p_name),p_gender,coalesce(p_skills,'{}'::jsonb),true)
    returning id into v_guest;
  end if;
  return v_guest;
end;
$$;
revoke all on function public._register_guest_member(text,text,jsonb,bigint) from public,anon,authenticated;

create or replace function public.add_guest_attendance(
  p_session_id bigint, p_name text, p_gender text, p_skills jsonb
) returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
  v_inviter uuid := public.current_member_id();
  v_inviter_status text;
  v_guest uuid;
  v_capacity int;
  v_status text;
  v_ends_at timestamptz;
  v_count int;
  v_gcount int;
  v_gcap int := public.session_guest_cap(p_session_id);
  v_new text;
  v_pos bigint;
  v_result public.attendances%rowtype;
  v_prev public.attendances%rowtype;
begin
  if v_inviter is null then raise exception 'not authenticated'; end if;
  -- 보드 추가와 동일한 잠금 순서: 회차 → 카운터 → 게스트 회원.
  select capacity,status,ends_at into v_capacity,v_status,v_ends_at
  from public.sessions where id=p_session_id for update;
  if not found then raise exception 'session not found'; end if;
  if v_status <> 'open' then raise exception 'session not open'; end if;
  if v_ends_at is not null and v_ends_at <= now() then raise exception 'session ended'; end if;

  select status into v_inviter_status from public.attendances
  where session_id=p_session_id and member_id=v_inviter
    and status in ('confirmed','waitlisted','late_pool');
  if not found then raise exception 'must join first'; end if;
  insert into public.session_counters(session_id) values(p_session_id) on conflict do nothing;
  select confirmed_count into v_count from public.session_counters where session_id=p_session_id for update;

  v_guest := public._register_guest_member(p_name,p_gender,p_skills,p_session_id);
  select * into v_prev from public.attendances
  where session_id=p_session_id and member_id=v_guest for update;
  if v_prev.session_id is not null and v_prev.status <> 'cancelled' then
    if v_prev.invited_by is not distinct from v_inviter then raise exception 'guest_already_joined';
    else raise exception 'guest_taken_by_other'; end if;
  end if;

  select count(*) into v_gcount from public.attendances
  where session_id=p_session_id and status='confirmed' and invited_by is not null;
  if v_inviter_status='late_pool' then v_new:='late_pool';
  elsif (v_capacity is null or v_count<v_capacity) and (v_gcap is null or v_gcount<v_gcap) then
    v_new:='confirmed';
    update public.session_counters set confirmed_count=confirmed_count+1 where session_id=p_session_id;
  else v_new:='waitlisted'; end if;

  v_pos:=nextval('public.attendance_position_seq');
  if v_prev.session_id is not null then
    update public.attendances set status=v_new,position=v_pos,requested_at=now(),
      confirmed_at=case when v_new='confirmed' then now() else null end,
      cancelled_at=null,invited_by=v_inviter,updated_at=now()
    where session_id=p_session_id and member_id=v_guest returning * into v_result;
  else
    insert into public.attendances(session_id,member_id,status,position,confirmed_at,invited_by)
    values(p_session_id,v_guest,v_new,v_pos,case when v_new='confirmed' then now() else null end,v_inviter)
    returning * into v_result;
  end if;
  return v_result;
end;
$$;
revoke all on function public.add_guest_attendance(bigint,text,text,jsonb) from public,anon;
grant execute on function public.add_guest_attendance(bigint,text,text,jsonb) to authenticated;

create or replace function public.session_players_register_member()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_existing uuid;
begin
  perform 1 from public.sessions where id=new.session_id for update;
  if not found then raise exception 'session not found'; end if;
  -- 구버전 클라이언트의 재시도/UPSERT도 저장된 회원 연결을 재사용한다.
  select member_id into v_existing from public.session_players
  where session_id=new.session_id and player_id=new.player_id;
  if v_existing is not null then
    if new.member_id is not null and new.member_id <> v_existing then
      raise exception 'board_member_changed';
    end if;
    new.member_id:=v_existing;
  elsif new.member_id is null then
    if new.player_id like 'guest-%' then
      new.member_id:=public._register_guest_member(new.name,new.gender,new.skills,new.session_id);
    else
      select id into new.member_id from public.members where id::text=new.player_id;
    end if;
  end if;
  if new.member_id is null then raise exception 'board_member_required'; end if;
  return new;
end;
$$;
revoke all on function public.session_players_register_member() from public,anon,authenticated;
drop trigger if exists trg_sp_register_member on public.session_players;
create trigger trg_sp_register_member before insert on public.session_players
for each row execute function public.session_players_register_member();

-- 같은 게스트를 일정 UUID와 임시 guest-* 키로 두 번 보드에 올리지 못한다.
-- 기존 Sheets 시절의 미연결 이력은 그대로 보존한다.
create unique index if not exists uq_session_member on public.session_players(session_id,member_id)
where member_id is not null;

-- 확인된 9/13 누락 건만 복구한다. 경기/참석 신청/부과/납부 사실은 변경하지 않는다.
do $$
declare v_row public.session_players%rowtype; v_member uuid;
begin
  select * into v_row from public.session_players
  where id='3eea6adf-750a-40f5-a1c5-33d61050a015' for update;
  if found and v_row.member_id is null then
    if v_row.session_id<>191 or v_row.player_id<>'guest-1789279778067-1'
      or v_row.name<>'강원식' or v_row.gender<>'M' then
      raise exception '9/13 게스트 복구 대상이 변경되었습니다';
    end if;
    v_member:=public._register_guest_member(v_row.name,v_row.gender,v_row.skills,v_row.session_id);
    update public.session_players set member_id=v_member where id=v_row.id;
  end if;
end;
$$;
commit;
