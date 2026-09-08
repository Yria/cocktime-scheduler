-- Additive rollout. Disabled on installation; legacy rows are never rewritten by V2.
-- All money mutations serialize on the control row. Operations retain before/after
-- checkpoints for an explicit undo / rollback; bank transactions are never restored/deleted.
create table public.dues_v2_control (
  id integer primary key check (id = 1), enabled boolean not null default false,
  paused boolean not null default false, epoch uuid not null default gen_random_uuid(),
  revision bigint not null default 0, activated_at timestamptz, baseline jsonb
);
insert into public.dues_v2_control(id) values (1);
create table public.dues_v2_groups (
  id uuid primary key default gen_random_uuid(), source_key text not null unique,
  kind text not null check(kind in ('monthly','court','manual')),
  label text not null check(length(btrim(label)) > 0), occurred_on date not null,
  session_id bigint references public.sessions(id) on delete restrict,
  basis jsonb not null default '{}'
);
create table public.dues_v2_charges (
  id uuid primary key default gen_random_uuid(), legacy_id bigint unique,
  group_id uuid not null references public.dues_v2_groups(id),
  member_id uuid not null references public.members(id) on delete restrict,
  amount integer not null check(amount > 0),
  state text not null default 'live' check(state in ('live','cancelled','waived')),
  previous_id uuid references public.dues_v2_charges(id),
  payer_hint uuid references public.members(id) on delete restrict,
  issued_at timestamptz not null default now(), basis jsonb not null default '{}'
);
create unique index dues_v2_live_charge on public.dues_v2_charges(group_id,member_id) where state='live';
create table public.dues_v2_due (
  id uuid primary key default gen_random_uuid(), charge_id uuid not null references public.dues_v2_charges(id),
  due_ym text not null check(due_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  remaining integer not null check(remaining >= 0)
);
create table public.dues_v2_positions (
  id uuid primary key default gen_random_uuid(), bank_tx_id bigint not null references public.bank_transactions(id) on delete restrict,
  owner_id uuid references public.members(id) on delete restrict,
  amount integer not null check(amount >= 0),
  purpose text not null check(purpose in ('unassigned','member_pending','carry','refund_pending','club')),
  available_ym text check(available_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  group_id uuid references public.dues_v2_groups(id),
  check(purpose <> 'carry' or (available_ym is not null and owner_id is not null)),
  check((purpose = 'club') = (group_id is not null)),
  check(purpose not in ('member_pending','carry') or owner_id is not null)
);
create index dues_v2_position_source on public.dues_v2_positions(bank_tx_id);
create table public.dues_v2_allocations (
  id uuid primary key default gen_random_uuid(), legacy_id bigint unique,
  bank_tx_id bigint not null references public.bank_transactions(id) on delete restrict,
  owner_id uuid not null references public.members(id) on delete restrict,
  charge_id uuid not null references public.dues_v2_charges(id),
  due_id uuid not null references public.dues_v2_due(id),
  amount integer not null check(amount > 0), reversed integer not null default 0 check(reversed >= 0 and reversed <= amount),
  created_at timestamptz not null default now()
);
create index dues_v2_alloc_source on public.dues_v2_allocations(bank_tx_id);
create index dues_v2_alloc_charge on public.dues_v2_allocations(charge_id);
create table public.dues_v2_reversals (
  id uuid primary key default gen_random_uuid(), allocation_id uuid not null references public.dues_v2_allocations(id),
  amount integer not null check(amount > 0), created_at timestamptz not null default now()
);
create table public.dues_v2_refunds (
  out_tx_id bigint primary key references public.bank_transactions(id) on delete restrict,
  in_tx_id bigint not null references public.bank_transactions(id) on delete restrict,
  owner_id uuid references public.members(id) on delete restrict,
  amount integer not null check(amount > 0), created_at timestamptz not null default now()
);
create table public.dues_v2_expenses (
  bank_tx_id bigint primary key references public.bank_transactions(id) on delete restrict,
  group_id uuid references public.dues_v2_groups(id)
);
create index dues_v2_due_charge on public.dues_v2_due(charge_id);
create index dues_v2_refund_source on public.dues_v2_refunds(in_tx_id);
create index dues_v2_position_owner on public.dues_v2_positions(owner_id);
create table public.dues_v2_operations (
  id bigint generated always as identity primary key, epoch uuid not null,
  request_id uuid not null, action text not null, payload jsonb not null,
  actor_id uuid references public.members(id) on delete restrict,
  before_state jsonb not null, after_state jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), reverted_at timestamptz,
  unique(epoch,request_id)
);
create table public.dues_v2_drafts (
  source_key text primary key, payload jsonb not null, hold_reason text not null,
  updated_at timestamptz not null default now()
);

-- No direct client reads/writes; narrowly scoped SECURITY DEFINER RPCs below.
do $$ declare t text; begin
  foreach t in array array['control','groups','charges','due','positions','allocations','reversals','refunds','expenses','operations','drafts'] loop
    execute format('alter table public.dues_v2_%I enable row level security',t);
    execute format('revoke all on public.dues_v2_%I from public, anon, authenticated',t);
  end loop;
end $$;

create function public.dues_v2_mode() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('enabled',enabled,'paused',paused,'revision',revision,'epoch',epoch)
  from public.dues_v2_control where id=1 and public.current_member_id() is not null
$$;

create function public.dues_v2_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t text; v jsonb := '{}'; rows jsonb;
begin
  foreach t in array array['groups','charges','due','positions','allocations','reversals','refunds','expenses','drafts'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by coalesce(to_jsonb(x)->>''id'',to_jsonb(x)->>''source_key'',to_jsonb(x)->>''out_tx_id'',to_jsonb(x)->>''bank_tx_id'')),''[]''::jsonb) from public.dues_v2_%I x',t) into rows;
    v := v || jsonb_build_object(t,rows);
  end loop;
  return v;
end $$;

-- Keep changed rows rather than two complete copies of every account for every payment.
-- Activation/rollback checkpoints remain complete; ordinary operations are reversible deltas.
create function public.dues_v2_delta(p_before jsonb,p_after jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select coalesce(jsonb_object_agg(t.key,coalesce((select jsonb_agg(old_row) from jsonb_array_elements(t.value) old_row
    where not coalesce(p_after->t.key,'[]') @> jsonb_build_array(old_row)),'[]')),'{}') from jsonb_each(p_before) t
$$;

create function public.dues_v2_restore_delta(p_before jsonb,p_after jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare t text; key_col text; columns_sql text;
begin
  foreach t in array array['drafts','reversals','allocations','refunds','expenses','positions','due','charges','groups'] loop
    key_col:=case t when 'drafts' then 'source_key' when 'refunds' then 'out_tx_id' when 'expenses' then 'bank_tx_id' else 'id' end;
    execute format('delete from public.dues_v2_%I r where r.%I::text in (select x->>$3 from jsonb_array_elements($1) x where not exists(select 1 from jsonb_array_elements($2) y where y->>$3=x->>$3))',t,key_col)
      using coalesce(p_after->t,'[]'),coalesce(p_before->t,'[]'),key_col;
  end loop;
  foreach t in array array['groups','charges','due','positions','allocations','reversals','refunds','expenses','drafts'] loop
    key_col:=case t when 'drafts' then 'source_key' when 'refunds' then 'out_tx_id' when 'expenses' then 'bank_tx_id' else 'id' end;
    select string_agg(format('%I=excluded.%I',attname,attname),',') into columns_sql
      from pg_attribute where attrelid=('public.dues_v2_'||t)::regclass and attnum>0 and not attisdropped and attname<>key_col;
    execute format('insert into public.dues_v2_%I select * from jsonb_populate_recordset(null::public.dues_v2_%I,$1) on conflict(%I) do update set %s',t,t,key_col,columns_sql)
      using coalesce(p_before->t,'[]');
  end loop;
end $$;

create function public.dues_v2_restore(p_state jsonb) returns void language plpgsql security definer set search_path='' as $$
declare t text;
begin
  delete from public.dues_v2_drafts;
  delete from public.dues_v2_reversals;
  delete from public.dues_v2_allocations;
  delete from public.dues_v2_refunds;
  delete from public.dues_v2_expenses;
  delete from public.dues_v2_positions;
  delete from public.dues_v2_due;
  -- Self-reference is checked at statement end.
  delete from public.dues_v2_charges;
  delete from public.dues_v2_groups;
  foreach t in array array['groups','charges','due','positions','allocations','reversals','refunds','expenses','drafts'] loop
    execute format('insert into public.dues_v2_%I select * from jsonb_populate_recordset(null::public.dues_v2_%I,$1)',t,t)
      using coalesce(p_state->t,'[]'::jsonb);
  end loop;
end $$;

create function public.dues_v2_assert() returns void language plpgsql security definer set search_path='' as $$
begin
  if exists (
    select 1 from public.bank_transactions t where t.direction='in' and t.amount <>
      coalesce((select sum(amount-reversed) from public.dues_v2_allocations where bank_tx_id=t.id),0)
      + coalesce((select sum(amount) from public.dues_v2_refunds where in_tx_id=t.id),0)
      + coalesce((select sum(amount) from public.dues_v2_positions where bank_tx_id=t.id),0)
  ) then raise exception '원입금 사용액과 잔액이 맞지 않습니다'; end if;
  if exists(select 1 from (
    select bank_tx_id,owner_id from public.dues_v2_positions
    union all select bank_tx_id,owner_id from public.dues_v2_allocations
    union all select in_tx_id,owner_id from public.dues_v2_refunds
  ) owners where owner_id is not null group by bank_tx_id having count(distinct owner_id)>1)
    then raise exception '한 원입금의 돈 소유자는 같아야 합니다. 대납은 납부 대상에서 선택하세요'; end if;
  if exists (
    select 1 from public.dues_v2_charges c where
      (case when c.state='live' then c.amount else 0 end) <>
      coalesce((select sum(remaining) from public.dues_v2_due where charge_id=c.id),0)
      + case when c.state='live' then coalesce((select sum(amount-reversed) from public.dues_v2_allocations where charge_id=c.id),0) else 0 end
  ) then raise exception '부과의 납기별 잔액이 맞지 않습니다'; end if;
  if exists(select 1 from public.dues_v2_allocations a join public.dues_v2_charges c on c.id=a.charge_id
    join public.bank_transactions t on t.id=a.bank_tx_id join public.dues_v2_due d on d.id=a.due_id
    where t.direction<>'in' or d.charge_id<>a.charge_id or (c.state='cancelled' and a.amount<>a.reversed)
      or a.reversed<>coalesce((select sum(r.amount) from public.dues_v2_reversals r where r.allocation_id=a.id),0))
    then raise exception '납부 연결 또는 해제 이력이 맞지 않습니다'; end if;
  if exists(select 1 from public.dues_v2_positions p join public.bank_transactions t on t.id=p.bank_tx_id where t.direction<>'in')
    then raise exception '출금은 입금 잔액이 될 수 없습니다'; end if;
  if exists(select 1 from public.dues_v2_refunds r
    join public.bank_transactions i on i.id=r.in_tx_id join public.bank_transactions o on o.id=r.out_tx_id
    where i.direction<>'in' or o.direction<>'out' or r.amount<>o.amount)
    then raise exception '환불과 실제 출금이 맞지 않습니다'; end if;
end $$;

-- Bring in bank receipts that arrived after the last snapshot/undo. Reads never call this.
create function public.dues_v2_sync_bank() returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.dues_v2_positions(bank_tx_id,amount,purpose)
    select t.id,t.amount,'unassigned' from public.bank_transactions t where t.direction='in'
      and not exists(select 1 from public.dues_v2_positions p where p.bank_tx_id=t.id)
      and not exists(select 1 from public.dues_v2_allocations a where a.bank_tx_id=t.id)
      and not exists(select 1 from public.dues_v2_refunds r where r.in_tx_id=t.id);
  insert into public.dues_v2_expenses(bank_tx_id)
    select id from public.bank_transactions where direction='out' on conflict do nothing;
end $$;

create function public.dues_v2_import() returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.dues_allocations where kind<>'payment' or bank_tx_id is null or charge_id is null)
    or exists(select 1 from public.dues_charges where amount_due<=0 or amount_paid>amount_due or (status in ('void','waived') and amount_paid>0))
    or exists(select 1 from public.dues_charges c where amount_paid <> coalesce((select sum(amount) from public.dues_allocations a where a.charge_id=c.id),0))
    or exists(select 1 from public.dues_allocations a join public.bank_transactions t on t.id=a.bank_tx_id
      where t.direction<>'in' or (t.paid_by is not null and t.paid_by<>a.member_id))
    or exists(select 1 from public.dues_allocations group by bank_tx_id having count(distinct member_id)>1)
    then raise exception '기존 부과·배분에 자동 이관할 수 없는 내역이 있습니다. 조사 SQL을 확인하세요'; end if;
  perform public.dues_v2_restore('{}');
  insert into public.dues_v2_groups(source_key,kind,label,occurred_on,session_id,basis)
    select b.key,b.kind,b.label,coalesce(b.occurred_on,(s.scheduled_at at time zone 'Asia/Seoul')::date,current_date),b.session_id,
      jsonb_build_object('legacy_id',b.id,'legacy',true,'closed',coalesce(s.status='closed',true),'total',b.total_amount)
    from public.dues_batches b left join public.sessions s on s.id=b.session_id;
  insert into public.dues_v2_groups(source_key,kind,label,occurred_on,basis)
    select 'category:'||id,'manual',name,'2026-07-01','{"legacy":true}' from public.txn_categories;
  -- Old session tags may predate charge batches.
  insert into public.dues_v2_groups(source_key,kind,label,occurred_on,session_id,basis)
    select 'court:'||s.id,'court',coalesce(s.title,'대관')||' #'||s.id,
      coalesce((s.scheduled_at at time zone 'Asia/Seoul')::date,current_date),s.id,
      jsonb_build_object('legacy',true,'closed',s.status='closed')
    from public.sessions s where exists(select 1 from public.bank_transactions t where t.session_id=s.id)
    on conflict(source_key) do nothing;
  insert into public.dues_v2_charges(legacy_id,group_id,member_id,amount,state,payer_hint,issued_at,basis)
    select c.id,g.id,c.member_id,c.amount_due,
      case c.status when 'void' then 'cancelled' when 'waived' then 'waived' else 'live' end,
      c.payer_hint,c.created_at,jsonb_build_object('legacy',true,'status',c.status,'is_day_cancel',c.is_day_cancel)
    from public.dues_charges c join public.dues_batches b on b.id=c.batch_id join public.dues_v2_groups g on g.source_key=b.key;
  if (select count(*) from public.dues_v2_charges)<>(select count(*) from public.dues_charges)
    then raise exception '묶음이 없는 기존 부과가 있습니다'; end if;
  insert into public.dues_v2_due(charge_id,due_ym,remaining)
    select c.id,coalesce(l.deferred_to,l.period_ym,to_char(g.occurred_on,'YYYY-MM')),
      case when c.state='live' then l.amount_due-l.amount_paid else 0 end
    from public.dues_v2_charges c join public.dues_charges l on l.id=c.legacy_id join public.dues_v2_groups g on g.id=c.group_id;
  insert into public.dues_v2_allocations(legacy_id,bank_tx_id,owner_id,charge_id,due_id,amount,created_at)
    select a.id,a.bank_tx_id,a.member_id,c.id,d.id,a.amount,a.created_at
    from public.dues_allocations a join public.dues_v2_charges c on c.legacy_id=a.charge_id join public.dues_v2_due d on d.charge_id=c.id;
  insert into public.dues_v2_refunds(out_tx_id,in_tx_id,owner_id,amount,created_at)
    select o.id,i.id,i.paid_by,o.amount,o.created_at from public.bank_transactions o
    join public.bank_transactions i on i.id=o.refund_of_tx_id where o.direction='out';
  insert into public.dues_v2_positions(bank_tx_id,owner_id,amount,purpose,group_id)
    select t.id,coalesce(t.paid_by,(select a.member_id from public.dues_allocations a where a.bank_tx_id=t.id limit 1)),
      t.amount-coalesce((select sum(amount) from public.dues_v2_allocations where bank_tx_id=t.id),0)
        -coalesce((select sum(amount) from public.dues_v2_refunds where in_tx_id=t.id),0),
      case when g.id is not null then 'club'
        when t.paid_by is not null or exists(select 1 from public.dues_allocations a where a.bank_tx_id=t.id) then 'member_pending'
        else 'unassigned' end,g.id
    from public.bank_transactions t
    left join public.dues_batches b on b.id=t.batch_id
    left join public.dues_v2_groups g on g.source_key=case when t.session_id is not null then 'court:'||t.session_id
      when b.id is not null then b.key when t.category_id is not null then 'category:'||t.category_id end
    where t.direction='in';
  insert into public.dues_v2_expenses(bank_tx_id,group_id)
    select t.id,g.id from public.bank_transactions t left join public.dues_batches b on b.id=t.batch_id
    left join public.dues_v2_groups g on g.source_key=case when t.session_id is not null then 'court:'||t.session_id
      when b.id is not null then b.key when t.category_id is not null then 'category:'||t.category_id end
    where t.direction='out';
  insert into public.dues_v2_drafts(source_key,payload,hold_reason)
    select d.draft_group,jsonb_build_object('action','issue','reason','기존 발행 대기 검토',
      'rule',case min(d.kind) when 'monthly_fee' then 'monthly' else 'court' end,
      'kind',case min(d.kind) when 'monthly_fee' then 'monthly' else 'court' end,
      'label',coalesce(min(d.label),d.draft_group),'ym',coalesce(min(d.period_ym),to_char(min(d.charged_on),'YYYY-MM')),
      'date',coalesce(min(d.charged_on),(min(d.period_ym)||'-01')::date),'session_id',min(d.session_id),
      'lines',jsonb_agg(jsonb_build_object('member_id',d.member_id,'amount',d.amount_due,'payer_hint',d.payer_hint,
        'due_ym',coalesce(d.period_ym,to_char(d.charged_on,'YYYY-MM'))))),min(d.hold_reason)
    from public.dues_charge_drafts d group by d.draft_group;
  perform public.dues_v2_assert();
end $$;

create function public.dues_v2_allocate(p_position uuid,p_due uuid,p_amount integer,p_proxy boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.dues_v2_positions; d public.dues_v2_due; c public.dues_v2_charges; v uuid;
begin
  select * into strict p from public.dues_v2_positions where id=p_position;
  select * into strict d from public.dues_v2_due where id=p_due;
  select * into strict c from public.dues_v2_charges where id=d.charge_id;
  if p_amount is null or p_amount<=0 or p_amount>p.amount or p_amount>d.remaining or c.state<>'live'
    or p.owner_id is null or p.purpose not in ('member_pending','carry')
    or (p.purpose='carry' and p.available_ym>to_char(now() at time zone 'Asia/Seoul','YYYY-MM'))
    or (p.owner_id<>c.member_id and not p_proxy)
    then raise exception '납부할 금액·소유자·납기·잔액을 다시 확인하세요'; end if;
  update public.dues_v2_positions set amount=amount-p_amount where id=p.id;
  update public.dues_v2_due set remaining=remaining-p_amount where id=d.id;
  insert into public.dues_v2_allocations(bank_tx_id,owner_id,charge_id,due_id,amount)
    values(p.bank_tx_id,p.owner_id,c.id,d.id,p_amount) returning id into v;
  return v;
end $$;

create function public.dues_v2_release(p_allocation uuid,p_amount integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.dues_v2_allocations; v uuid;
begin
  select * into strict a from public.dues_v2_allocations where id=p_allocation;
  if p_amount is null or p_amount<=0 or p_amount>a.amount-a.reversed then raise exception '해제할 납부 금액이 맞지 않습니다'; end if;
  insert into public.dues_v2_reversals(allocation_id,amount) values(a.id,p_amount);
  update public.dues_v2_allocations set reversed=reversed+p_amount where id=a.id;
  update public.dues_v2_due set remaining=remaining+p_amount where id=a.due_id;
  insert into public.dues_v2_positions(bank_tx_id,owner_id,amount,purpose)
    values(a.bank_tx_id,a.owner_id,p_amount,'member_pending') returning id into v;
  return v;
end $$;

create function public.dues_v2_apply() returns integer language plpgsql security definer set search_path='' as $$
declare p record; d record; n integer; left_amount integer; total integer:=0;
begin
  for p in select pp.* from public.dues_v2_positions pp join public.bank_transactions t on t.id=pp.bank_tx_id
    where pp.purpose='carry' and pp.amount>0 and pp.available_ym<=to_char(now() at time zone 'Asia/Seoul','YYYY-MM')
    order by t.occurred_at,t.id,pp.id loop
    left_amount:=p.amount;
    for d in select dd.* from public.dues_v2_due dd join public.dues_v2_charges c on c.id=dd.charge_id
      where c.state='live' and c.member_id=p.owner_id and dd.remaining>0
        and dd.due_ym<=to_char(now() at time zone 'Asia/Seoul','YYYY-MM') order by dd.due_ym,c.issued_at,c.id,dd.id loop
      n:=least(left_amount,d.remaining);
      exit when n=0;
      perform public.dues_v2_allocate(p.id,d.id,n);
      left_amount:=left_amount-n; total:=total+n;
    end loop;
  end loop;
  return total;
end $$;

create function public.dues_v2_issue(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare g uuid; c uuid; line jsonb; part jsonb; schedule jsonb; result jsonb:='[]'; day date; k text; source text;
begin
  if p->>'group_id' is not null then
    select id into strict g from public.dues_v2_groups where id=(p->>'group_id')::uuid;
    if p->>'rule' in ('monthly','court') and not exists(select 1 from public.dues_v2_groups bg where bg.id=g
      and bg.source_key=case p->>'rule' when 'monthly' then 'monthly:'||(p->>'ym') else 'court:'||(p->>'session_id') end)
      then raise exception '부과 묶음과 계산 기준이 다릅니다'; end if;
  else
    day:=(p->>'date')::date; k:=p->>'kind';
    source:=case k when 'monthly' then 'monthly:'||to_char(day,'YYYY-MM')
      when 'court' then 'court:'||(p->>'session_id') else 'manual:'||gen_random_uuid() end;
    insert into public.dues_v2_groups(source_key,kind,label,occurred_on,session_id,basis)
      values(source,k,btrim(p->>'label'),day,(p->>'session_id')::bigint,coalesce(p->'basis','{}')) returning id into g;
  end if;
  for line in select value from jsonb_array_elements(coalesce(p->'lines','[]')) loop
    -- Rule-generated drafts must be checked again at confirmation time.
    if p->>'rule'='monthly' and (not exists(select 1 from public.dues_monthly_targets(p->>'ym') t where t.member_id=(line->>'member_id')::uuid)
      or (line->>'amount')::integer<>(select monthly_fee from public.dues_settings where id=1))
      then raise exception '회비 대상 또는 금액이 변경됐습니다. 다시 계산하세요'; end if;
    if exists(select 1 from public.dues_v2_charges where group_id=g and member_id=(line->>'member_id')::uuid)
      then raise exception '이미 발행·취소한 회원입니다. 취소 후 발행에서 처리하세요'; end if;
    insert into public.dues_v2_charges(group_id,member_id,amount,payer_hint,basis)
      values(g,(line->>'member_id')::uuid,(line->>'amount')::integer,(line->>'payer_hint')::uuid,
        (coalesce(p->'basis','{}')-'members')||jsonb_build_object('rule',p->>'rule','line',line)) returning id into c;
    schedule:=coalesce(line->'due_schedule',jsonb_build_array(jsonb_build_object('due_ym',coalesce(line->>'due_ym',p->>'ym',to_char(day,'YYYY-MM')),'amount',line->'amount')));
    if (select coalesce(sum((x->>'amount')::integer),0) from jsonb_array_elements(schedule) x)<>(line->>'amount')::integer
      then raise exception '납기별 금액 합이 부과액과 다릅니다'; end if;
    for part in select value from jsonb_array_elements(schedule) loop
      if (part->>'amount')::integer is null or (part->>'amount')::integer<0 then raise exception '납기별 금액을 확인하세요'; end if;
      if (part->>'amount')::integer>0 then
        insert into public.dues_v2_due(charge_id,due_ym,remaining) values(c,part->>'due_ym',(part->>'amount')::integer);
      end if;
    end loop;
    result:=result||jsonb_build_array(c);
  end loop;
  return jsonb_build_object('group_id',g,'charges',result);
end $$;

create function public.dues_v2_execute(p jsonb,p_request uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
<<mutation>>
declare ctl public.dues_v2_control; prior public.dues_v2_operations; before_data jsonb; after_data jsonb;
  result jsonb:='{}'; action text:=p->>'action'; line jsonb; item jsonb; part jsonb; schedule jsonb; slice record;
  pos public.dues_v2_positions; due public.dues_v2_due; old public.dues_v2_charges; a record;
  out_tx public.bank_transactions; refund public.dues_v2_refunds;
  amount integer; used integer; remaining integer; total integer:=0; applied integer:=0;
  new_id uuid; position_id uuid; due_id uuid; source_id bigint; owner uuid; purpose text; target text;
  released jsonb:='[]'; created jsonb:='[]'; op_id bigint;
begin
  select * into strict ctl from public.dues_v2_control where id=1 for update;
  if not ctl.enabled then raise exception '새 부과 기능이 꺼져 있습니다'; end if;
  if ctl.paused then raise exception '회계 처리가 일시 중지되었습니다'; end if;
  if p_request is null then raise exception '요청 ID가 필요합니다'; end if;
  select * into prior from public.dues_v2_operations where epoch=ctl.epoch and request_id=p_request;
  if found then
    if prior.payload<>p or prior.reverted_at is not null then raise exception '이미 사용하거나 되돌린 요청 ID입니다'; end if;
    return prior.result;
  end if;
  if p_revision is null or ctl.revision<>p_revision then raise exception '다른 처리가 반영되었습니다. 새로고침 후 다시 확인하세요' using errcode='40001'; end if;
  if nullif(btrim(p->>'reason'),'') is null then raise exception '처리 사유를 입력하세요'; end if;
  perform public.dues_v2_sync_bank();
  before_data:=public.dues_v2_snapshot();

  if action='issue' then
    if p->>'rule'='court' then
      item:=public.dues_v2_candidates_internal('court',p->>'ym',(p->>'session_id')::bigint);
      for line in select value from jsonb_array_elements(p->'lines') loop
        if not exists(select 1 from jsonb_array_elements(item->'payload'->'lines') fresh
          where fresh->>'member_id'=line->>'member_id' and fresh->>'amount'=line->>'amount'
            and (fresh->>'payer_hint') is not distinct from (line->>'payer_hint'))
          then raise exception '대관 대상 또는 금액이 변경됐습니다. 다시 계산하세요'; end if;
      end loop;
    end if;
    result:=public.dues_v2_issue(p);
    delete from public.dues_v2_drafts where source_key=(select source_key from public.dues_v2_groups where id=(result->>'group_id')::uuid);
  elsif action='draft' then
    insert into public.dues_v2_drafts(source_key,payload,hold_reason) values(p->>'source_key',p->'draft',p->>'hold_reason')
      on conflict(source_key) do update set payload=excluded.payload,hold_reason=excluded.hold_reason,updated_at=now();
  elsif action='replace' then
    if jsonb_array_length(coalesce(p->'charge_ids','[]'))=0 then raise exception '취소할 부과를 선택하세요'; end if;
    for item in select value from jsonb_array_elements(p->'charge_ids') loop
      select * into strict old from public.dues_v2_charges where id=(item#>>'{}')::uuid;
      if old.state<>'live' then raise exception '유효한 부과만 취소할 수 있습니다'; end if;
      for a in select * from public.dues_v2_allocations where charge_id=old.id and amount>reversed order by created_at,id loop
        position_id:=public.dues_v2_release(a.id,a.amount-a.reversed);
        released:=released||jsonb_build_array(jsonb_build_object('id',position_id,'previous_id',old.id));
      end loop;
      update public.dues_v2_due set remaining=0 where charge_id=old.id;
      update public.dues_v2_charges set state='cancelled' where id=old.id;
    end loop;
    for line in select value from jsonb_array_elements(coalesce(p->'lines','[]')) loop
      if not (p->'charge_ids' @> jsonb_build_array(line->>'previous_id')) then raise exception '선택하지 않은 원부과입니다'; end if;
      select * into strict old from public.dues_v2_charges where id=(line->>'previous_id')::uuid;
      insert into public.dues_v2_charges(group_id,member_id,amount,previous_id,payer_hint,basis)
        values(old.group_id,(line->>'member_id')::uuid,(line->>'amount')::integer,old.id,
          case when old.member_id=(line->>'member_id')::uuid then old.payer_hint else (line->>'payer_hint')::uuid end,
          (coalesce(p->'basis','{}')-'members')||jsonb_build_object('reason',p->>'reason','previous_basis',old.basis)) returning id into new_id;
      schedule:=coalesce(line->'due_schedule',jsonb_build_array(jsonb_build_object('due_ym',line->>'due_ym','amount',line->'amount')));
      if (select coalesce(sum((x->>'amount')::integer),0) from jsonb_array_elements(schedule) x)<>(line->>'amount')::integer
        then raise exception '납기별 금액 합이 새 부과액과 다릅니다'; end if;
      for part in select value from jsonb_array_elements(schedule) loop
        if (part->>'amount')::integer is null or (part->>'amount')::integer<0 then raise exception '납기별 금액을 확인하세요'; end if;
        if (part->>'amount')::integer>0 then
          insert into public.dues_v2_due(charge_id,due_ym,remaining) values(new_id,part->>'due_ym',(part->>'amount')::integer);
        end if;
      end loop;
      -- Only reuse funds released from the selected predecessor, with explicit proxy consent.
      for item in select value from jsonb_array_elements(released) where value->>'previous_id'=line->>'previous_id' loop
        for slice in select d.* from public.dues_v2_due d where d.charge_id=new_id and d.remaining>0 order by d.due_ym,d.id loop
          select * into strict pos from public.dues_v2_positions where id=(item->>'id')::uuid;
          amount:=least(pos.amount,slice.remaining);
          if amount>0 and (pos.owner_id=(line->>'member_id')::uuid or old.member_id=(line->>'member_id')::uuid or coalesce((p->>'proxy')::boolean,false)) then
            perform public.dues_v2_allocate(pos.id,slice.id,amount,old.member_id=(line->>'member_id')::uuid or coalesce((p->>'proxy')::boolean,false));
            total:=total+amount;
          end if;
        end loop;
      end loop;
      created:=created||jsonb_build_array(new_id);
    end loop;
    result:=jsonb_build_object('charges',created,'reused',total,'released_positions',released);
  elsif action='carry' then
    owner:=(p->>'member_id')::uuid; target:=p->>'target_ym';
    if jsonb_array_length(coalesce(p->'debts','[]'))+jsonb_array_length(coalesce(p->'money','[]'))=0 then raise exception '이월할 내역이 없습니다'; end if;
    if owner is null or target is null or target !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception '회원과 이월 월을 확인하세요'; end if;
    for line in select value from jsonb_array_elements(coalesce(p->'debts','[]')) loop
      select * into strict due from public.dues_v2_due where id=(line->>'due_id')::uuid;
      select * into strict old from public.dues_v2_charges where id=due.charge_id;
      amount:=(line->>'amount')::integer;
      if old.member_id<>owner or old.state<>'live' or amount is null or amount<=0 or amount>due.remaining
        or (target<=due.due_ym and not coalesce((p->>'change_month')::boolean,false)) then raise exception '이월할 미납 금액과 납기를 확인하세요'; end if;
      update public.dues_v2_due set remaining=remaining-amount where id=due.id;
      insert into public.dues_v2_due(charge_id,due_ym,remaining) values(due.charge_id,target,amount);
    end loop;
    for line in select value from jsonb_array_elements(coalesce(p->'money','[]')) loop
      select * into strict pos from public.dues_v2_positions where id=(line->>'position_id')::uuid;
      amount:=(line->>'amount')::integer;
      if pos.owner_id is distinct from owner or pos.purpose not in ('member_pending','carry')
        or amount is null or amount<=0 or amount>pos.amount then raise exception '이월할 입금 소유자와 잔액을 확인하세요'; end if;
      update public.dues_v2_positions set amount=pos.amount-(line->>'amount')::integer where id=pos.id;
      insert into public.dues_v2_positions(bank_tx_id,owner_id,amount,purpose,available_ym)
        values(pos.bank_tx_id,owner,amount,'carry',target);
    end loop;
  elsif action='position' then
    select * into strict pos from public.dues_v2_positions where id=(p->>'position_id')::uuid;
    amount:=(p->>'amount')::integer; purpose:=p->>'purpose'; owner:=coalesce(pos.owner_id,(p->>'owner_id')::uuid);
    if amount is null or amount<=0 or amount>pos.amount or purpose not in ('member_pending','refund_pending','club','unassigned')
      or (pos.owner_id is not null and p->>'owner_id' is not null and pos.owner_id<>(p->>'owner_id')::uuid)
      then raise exception '변경할 금액·소유자·용도를 확인하세요'; end if;
    update public.dues_v2_positions set amount=pos.amount-(p->>'amount')::integer where id=pos.id;
    insert into public.dues_v2_positions(bank_tx_id,owner_id,amount,purpose,group_id)
      values(pos.bank_tx_id,owner,amount,purpose,case when purpose='club' then (p->>'group_id')::uuid end);
  elsif action='pay' then
    if jsonb_array_length(coalesce(p->'lines','[]'))=0 then raise exception '납부할 내역이 없습니다'; end if;
    for line in select value from jsonb_array_elements(p->'lines') loop
      perform public.dues_v2_allocate((line->>'position_id')::uuid,(line->>'due_id')::uuid,(line->>'amount')::integer,coalesce((p->>'proxy')::boolean,false));
      total:=total+(line->>'amount')::integer;
    end loop;
    result:=jsonb_build_object('paid',total);
  elsif action='reverse_payment' then
    position_id:=public.dues_v2_release((p->>'allocation_id')::uuid,(p->>'amount')::integer);
    result:=jsonb_build_object('position_id',position_id);
  elsif action='refund' then
    select * into strict out_tx from public.bank_transactions where id=(p->>'out_tx_id')::bigint;
    if out_tx.direction<>'out' or exists(select 1 from public.dues_v2_refunds where out_tx_id=out_tx.id)
      or exists(select 1 from public.dues_v2_expenses where bank_tx_id=out_tx.id and group_id is not null)
      then raise exception '이미 처리했거나 환불 출금이 아닌 거래입니다'; end if;
    for line in select value from jsonb_array_elements(p->'lines') loop
      select * into strict pos from public.dues_v2_positions where id=(line->>'position_id')::uuid;
      amount:=(line->>'amount')::integer;
      if pos.purpose='club' or amount is null or amount<=0 or amount>pos.amount
        or (source_id is not null and source_id<>pos.bank_tx_id) then raise exception '한 원입금의 환불 가능한 잔액만 선택하세요'; end if;
      source_id:=pos.bank_tx_id; owner:=pos.owner_id;
      update public.dues_v2_positions set amount=pos.amount-(line->>'amount')::integer where id=pos.id;
      total:=total+amount;
    end loop;
    if total<>out_tx.amount then raise exception '선택한 환불액이 실제 출금액과 다릅니다'; end if;
    insert into public.dues_v2_refunds(out_tx_id,in_tx_id,owner_id,amount) values(out_tx.id,source_id,owner,total);
    result:=jsonb_build_object('refunded',total);
  elsif action='reverse_refund' then
    delete from public.dues_v2_refunds where out_tx_id=(p->>'out_tx_id')::bigint returning * into refund;
    if not found then raise exception '연결된 환불이 없습니다'; end if;
    insert into public.dues_v2_positions(bank_tx_id,owner_id,amount,purpose)
      values(refund.in_tx_id,refund.owner_id,refund.amount,'refund_pending');
    result:=jsonb_build_object('reserved',refund.amount);
  elsif action='expense' then
    select * into strict out_tx from public.bank_transactions where id=(p->>'out_tx_id')::bigint;
    if out_tx.direction<>'out' or exists(select 1 from public.dues_v2_refunds where out_tx_id=out_tx.id)
      then raise exception '환불을 제외한 출금만 지출로 지정할 수 있습니다'; end if;
    insert into public.dues_v2_expenses(bank_tx_id,group_id) values(out_tx.id,(p->>'group_id')::uuid)
      on conflict(bank_tx_id) do update set group_id=excluded.group_id;
  elsif action='waive' then
    select * into strict old from public.dues_v2_charges where id=(p->>'charge_id')::uuid;
    if old.state<>'live' or exists(select 1 from public.dues_v2_allocations where charge_id=old.id and amount>reversed)
      then raise exception '납부가 있는 부과는 취소 후 발행으로 처리하세요'; end if;
    update public.dues_v2_charges set state='waived' where id=old.id;
    update public.dues_v2_due set remaining=0 where charge_id=old.id;
  elsif action<>'apply' then raise exception '알 수 없는 회계 작업입니다';
  end if;
  if action in ('issue','replace','carry','apply') then applied:=public.dues_v2_apply(); end if;
  perform public.dues_v2_assert();
  after_data:=public.dues_v2_snapshot();
  result:=result||jsonb_build_object('auto_applied',applied,
    'outstanding_before',(select coalesce(sum((x->>'remaining')::bigint),0) from jsonb_array_elements(before_data->'due') x),
    'outstanding_after',(select coalesce(sum(remaining),0) from public.dues_v2_due),
    'member_balance_before',(select coalesce(sum((x->>'amount')::bigint),0) from jsonb_array_elements(before_data->'positions') x where x->>'purpose' in ('member_pending','carry')),
    'member_balance_after',(select coalesce(sum(amount),0) from public.dues_v2_positions where purpose in ('member_pending','carry')),
    'revision',ctl.revision+1);
  insert into public.dues_v2_operations(epoch,request_id,action,payload,actor_id,before_state,after_state,result)
    values(ctl.epoch,p_request,action,p,public.current_member_id(),public.dues_v2_delta(before_data,after_data),public.dues_v2_delta(after_data,before_data),result) returning id into op_id;
  result:=result||jsonb_build_object('operation_id',op_id);
  update public.dues_v2_operations o set result=mutation.result where o.id=op_id;
  update public.dues_v2_control set revision=revision+1 where id=1;
  return result;
end $$;

create function public.dues_v2_manage(p_action text,p_revision bigint,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctl public.dues_v2_control; op public.dues_v2_operations; before_data jsonb; v jsonb; request jsonb;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  if p_action='activate' then
    lock table public.bank_transactions,public.dues_charges,public.dues_allocations,public.dues_batches,public.dues_charge_drafts in share mode;
  end if;
  select * into strict ctl from public.dues_v2_control where id=1 for update;
  request:=jsonb_build_object('action',p_action,'reason',p_reason,'revision',p_revision);
  if p_request_id is null or nullif(btrim(p_reason),'') is null then raise exception '요청 ID와 사유가 필요합니다'; end if;
  select * into op from public.dues_v2_operations where request_id=p_request_id order by id desc limit 1;
  if found then
    if op.payload<>request then raise exception '요청 ID를 재사용할 수 없습니다'; end if;
    return op.result;
  end if;
  if p_revision is null or ctl.revision<>p_revision then raise exception '상태가 변경되었습니다. 다시 확인하세요' using errcode='40001'; end if;
  before_data:=public.dues_v2_snapshot();
  if p_action='activate' then
    if ctl.enabled then raise exception '이미 새 기능을 사용하고 있습니다'; end if;
    perform public.dues_v2_import();
    update public.dues_v2_control set enabled=true,paused=false,epoch=gen_random_uuid(),activated_at=now(),baseline=public.dues_v2_snapshot() where id=1;
  elsif p_action='pause' then
    if not ctl.enabled then raise exception '새 기능이 꺼져 있습니다'; end if;
    update public.dues_v2_control set paused=true where id=1;
  elsif p_action='resume' then
    if not ctl.enabled then raise exception '새 기능이 꺼져 있습니다'; end if;
    perform public.dues_v2_sync_bank(); perform public.dues_v2_assert();
    update public.dues_v2_control set paused=false where id=1;
  elsif p_action='undo' then
    if not ctl.enabled then raise exception '새 기능이 꺼져 있습니다'; end if;
    select * into op from public.dues_v2_operations where epoch=ctl.epoch and reverted_at is null
      and action not in ('activate','pause','resume','undo','rollback') order by id desc limit 1;
    if not found then raise exception '되돌릴 처리가 없습니다'; end if;
    perform public.dues_v2_restore_delta(op.before_state,op.after_state);
    perform public.dues_v2_sync_bank(); perform public.dues_v2_assert();
    update public.dues_v2_operations set reverted_at=now() where id=op.id;
  elsif p_action='rollback' then
    if not ctl.enabled then raise exception '이미 기존 기능을 사용하고 있습니다'; end if;
    -- All V2 decisions are retained in the immutable operation journal, including
    -- this full checkpoint. No legacy allocations or real bank rows were edited.
    update public.dues_v2_operations set reverted_at=now() where epoch=ctl.epoch and reverted_at is null
      and action not in ('activate','pause','resume','undo','rollback');
    update public.dues_v2_control set enabled=false,paused=false where id=1;
  else raise exception '알 수 없는 전환 작업입니다'; end if;
  update public.dues_v2_control set revision=revision+1 where id=1;
  v:=public.dues_v2_mode();
  insert into public.dues_v2_operations(epoch,request_id,action,payload,actor_id,before_state,after_state,result)
    select epoch,p_request_id,p_action,request,public.current_member_id(),before_data,public.dues_v2_snapshot(),v
    from public.dues_v2_control where id=1;
  return v;
end $$;

create function public.dues_v2_export() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object('exported_at',now(),'control',(select to_jsonb(c) from public.dues_v2_control c where id=1),
    'state',public.dues_v2_snapshot(),'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]') from public.dues_v2_operations o),
    'legacy',jsonb_build_object(
      'bank_transactions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.bank_transactions t),
      'dues_charges',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_charges t),
      'dues_allocations',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_allocations t),
      'dues_batches',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.dues_batches t),
      'dues_charge_drafts',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.dues_charge_drafts t),
      'dues_settings',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.dues_settings t)));
end $$;

create function public.dues_v2_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.current_member_id(); admin boolean:=public.is_admin(); v jsonb;
begin
  if me is null then raise exception 'forbidden' using errcode='42501'; end if;
  if not (select enabled from public.dues_v2_control where id=1) then return jsonb_build_object('mode',public.dues_v2_mode()); end if;
  select jsonb_build_object(
    'mode',public.dues_v2_mode(),
    'groups',(select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('basis',case when admin then g.basis else '{}'::jsonb end)),'[]') from public.dues_v2_groups g),
    'charges',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.dues_v2_charges c
      where admin or c.member_id=me or c.payer_hint=me or exists(select 1 from public.dues_v2_allocations a where a.charge_id=c.id and a.owner_id=me)),
    'due',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.dues_v2_due d join public.dues_v2_charges c on c.id=d.charge_id
      where admin or c.member_id=me or c.payer_hint=me or exists(select 1 from public.dues_v2_allocations a where a.charge_id=c.id and a.owner_id=me)),
    'positions',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.dues_v2_positions p where p.amount>0 and (admin or p.owner_id=me)),
    'allocations',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.dues_v2_allocations a join public.dues_v2_charges c on c.id=a.charge_id
      where admin or a.owner_id=me or c.member_id=me or c.payer_hint=me),
    'refunds',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.dues_v2_refunds r where admin or r.owner_id=me),
    'expenses',case when admin then (select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.dues_v2_expenses e) else '[]'::jsonb end,
    'bank',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'amount',t.amount,'direction',t.direction,
      'occurred_at',t.occurred_at,'name',case when admin then t.counterparty_name else null end)),'[]')
      from public.bank_transactions t where admin or exists(select 1 from public.dues_v2_positions p where p.bank_tx_id=t.id and p.owner_id=me)
      or exists(select 1 from public.dues_v2_allocations a where a.bank_tx_id=t.id and a.owner_id=me)
      or exists(select 1 from public.dues_v2_refunds r where r.out_tx_id=t.id and r.owner_id=me)),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'guest',m.is_guest,
      'active',m.is_active,'gender',case when admin then m.gender else null end,'birth_year',case when admin then m.birth_year else null end)),'[]')
      from public.members m where admin or m.id=me or exists(select 1 from public.dues_v2_charges c
        where c.member_id=m.id and (c.payer_hint=me or exists(select 1 from public.dues_v2_allocations a where a.charge_id=c.id and a.owner_id=me)))),
    'operations',case when admin then (select coalesce(jsonb_agg(to_jsonb(x) order by id desc),'[]') from
      (select id,action,payload->>'reason' as reason,created_at,reverted_at,result from public.dues_v2_operations
        where epoch=(select epoch from public.dues_v2_control where id=1) order by id desc limit 100) x) else '[]'::jsonb end,
    'active_operations',case when admin then (select count(*) from public.dues_v2_operations where epoch=(select epoch from public.dues_v2_control where id=1)
      and reverted_at is null and action not in ('activate','pause','resume','undo','rollback')) else 0 end,
    'drafts',case when admin then (select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.dues_v2_drafts d) else '[]'::jsonb end
  ) into v;
  return v;
end $$;

create function public.dues_v2_ledger(p_ym text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb; start_at timestamptz; end_at timestamptz;
begin
  if public.current_member_id() is null then raise exception 'forbidden' using errcode='42501'; end if;
  if not (select enabled from public.dues_v2_control where id=1) then raise exception '새 부과 기능이 꺼져 있습니다'; end if;
  if p_ym is null or p_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception '월을 확인하세요'; end if;
  start_at:=(p_ym||'-01T00:00:00+09')::timestamptz;
  end_at:=(((p_ym||'-01')::date+interval '1 month')::date||'T00:00:00+09')::timestamptz;
  with tx as (select * from public.bank_transactions where occurred_at>=start_at and occurred_at<end_at),
  lines as (
    select c.group_id,'부과 납부'::text as fallback,sum(a.amount-a.reversed)::bigint as income,0::bigint as expense
      from public.dues_v2_allocations a join tx t on t.id=a.bank_tx_id join public.dues_v2_charges c on c.id=a.charge_id group by c.group_id
    union all select p.group_id,case p.purpose when 'club' then '직접 수입' when 'carry' then '이월 입금'
      when 'refund_pending' then '환불 대기' when 'member_pending' then '회원 잔액' else '미분류' end,sum(p.amount)::bigint,0::bigint
      from public.dues_v2_positions p join tx t on t.id=p.bank_tx_id group by p.group_id,p.purpose
    union all select null,'환불 원입금',sum(r.amount)::bigint,0::bigint from public.dues_v2_refunds r join tx t on t.id=r.in_tx_id
    union all select null,'환불',0::bigint,sum(r.amount)::bigint from public.dues_v2_refunds r join tx t on t.id=r.out_tx_id
    union all select e.group_id,'미분류',0::bigint,sum(t.amount)::bigint from public.dues_v2_expenses e join tx t on t.id=e.bank_tx_id
      where not exists(select 1 from public.dues_v2_refunds r where r.out_tx_id=t.id) group by e.group_id
  ), grouped as (
    select l.group_id,coalesce(g.label,l.fallback) as label,sum(coalesce(l.income,0)) as income,sum(coalesce(l.expense,0)) as expense
    from lines l left join public.dues_v2_groups g on g.id=l.group_id group by l.group_id,coalesce(g.label,l.fallback)
  ) select jsonb_build_object('ym',p_ym,
    'income',(select coalesce(sum(amount),0) from tx where direction='in'),
    'expense',(select coalesce(sum(amount),0) from tx where direction='out'),
    'lines',(select coalesce(jsonb_agg(to_jsonb(g) order by label),'[]') from grouped g where income<>0 or expense<>0)) into v;
  return v;
end $$;

-- Every legacy write participates in the same lock. Off = original behavior.
create function public.dues_v2_legacy_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare active boolean;
begin
  select enabled into active from public.dues_v2_control where id=1 for share;
  if active then raise exception '새 부과 기능을 사용 중입니다. 회비 관리 화면에서 처리하세요'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
do $$ declare t text; begin
  foreach t in array array['dues_charges','dues_allocations','dues_batches','dues_charge_drafts'] loop
    execute format('create trigger z_dues_v2_legacy_guard before insert or update or delete on public.%I for each row execute function public.dues_v2_legacy_guard()',t);
  end loop;
end $$;
create trigger z_dues_v2_bank_guard before update or delete on public.bank_transactions
  for each row execute function public.dues_v2_legacy_guard();

create function public.dues_v2_bank_inserted() returns trigger language plpgsql security definer set search_path='' as $$
declare ctl public.dues_v2_control;
begin
  select * into ctl from public.dues_v2_control where id=1 for update;
  if ctl.enabled then
    if new.direction='in' then
      insert into public.dues_v2_positions(bank_tx_id,amount,purpose) values(new.id,new.amount,'unassigned');
    else insert into public.dues_v2_expenses(bank_tx_id) values(new.id); end if;
    update public.dues_v2_control set revision=revision+1 where id=1;
  end if;
  return new;
end $$;
create trigger dues_v2_bank_inserted after insert on public.bank_transactions for each row execute function public.dues_v2_bank_inserted();

-- Membership changes affect future eligibility without deleting historical debt.
alter function public.members_uncharge_dues_on_deactivate() rename to members_uncharge_dues_on_deactivate_legacy;
-- A trigger's function OID survives rename, so replace the trigger itself.
create function public.members_uncharge_dues_on_deactivate() returns trigger language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
  if (select enabled from public.dues_v2_control where id=1) then return null; end if;
  with gone as (delete from public.dues_charges where kind='monthly_fee' and member_id=new.id
    and status='unpaid' and amount_paid=0 and deferred_to is null returning id,period_ym,amount_due)
    select jsonb_agg(jsonb_build_object('charge',id,'ym',period_ym,'due',amount_due)) into items from gone;
  if items is not null then
    insert into public.dues_audit_log(actor_member_id,action,detail) values(public.current_member_id(),'uncharge_dues_on_deactivate',
      jsonb_build_object('member',new.id,'count',jsonb_array_length(items),'items',items,'why','비활성 회원은 회비 부과 대상이 아니다(미부과). 면제가 아니라 부과 자체를 지운다.'));
  end if;
  return null;
end $$;
drop trigger trg_members_uncharge_dues_on_deactivate on public.members;
create trigger trg_members_uncharge_dues_on_deactivate after update of is_active on public.members
  for each row when (old.is_active and not new.is_active) execute function public.members_uncharge_dues_on_deactivate();
alter function public.dues_set_honorary(uuid,boolean,text) rename to dues_set_honorary_legacy;
create function public.dues_set_honorary(p_member_id uuid,p_honorary boolean,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden'; end if;
  if not (select enabled from public.dues_v2_control where id=1) then
    return public.dues_set_honorary_legacy(p_member_id,p_honorary,p_reason);
  end if;
  update public.members set is_honorary=coalesce(p_honorary,false),updated_at=now() where id=p_member_id;
  if not found then raise exception '회원이 없습니다'; end if;
  if p_honorary then
    insert into public.member_honorary(member_id,reason) values(p_member_id,p_reason)
      on conflict(member_id) do update set reason=excluded.reason,updated_at=now();
  else delete from public.member_honorary where member_id=p_member_id; end if;
  return jsonb_build_object('ok',true,'honorary',coalesce(p_honorary,false),'cleared_unpaid',0);
end $$;

-- Old page-read/bulk endpoints must not generate V2 charges without its review flow.
alter function public.dues_ensure_monthly(text) rename to dues_ensure_monthly_legacy;
create function public.dues_ensure_monthly(p_ym text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden'; end if;
  if (select enabled from public.dues_v2_control where id=1) then raise exception '새 부과 화면에서 발행 대상을 확인해 주세요'; end if;
  return public.dues_ensure_monthly_legacy(p_ym);
end $$;
alter function public.generate_dues_charges(text) rename to generate_dues_charges_legacy;
create function public.generate_dues_charges(p_ym text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden'; end if;
  if (select enabled from public.dues_v2_control where id=1) then raise exception '새 부과 화면에서 발행 대상을 확인해 주세요'; end if;
  return public.generate_dues_charges_legacy(p_ym);
end $$;

alter function public.dues_set_session_fee(bigint,integer) rename to dues_set_session_fee_legacy;
create function public.dues_set_session_fee(p_session_id bigint,p_amount integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden'; end if;
  if not (select enabled from public.dues_v2_control where id=1) then return public.dues_set_session_fee_legacy(p_session_id,p_amount); end if;
  if exists(select 1 from public.dues_v2_charges c join public.dues_v2_groups g on g.id=c.group_id where g.session_id=p_session_id)
    then raise exception '이미 발행한 부과는 회비 관리에서 취소 후 발행해 주세요'; end if;
  if p_amount<0 then raise exception '금액을 확인하세요'; end if;
  update public.sessions set court_fee=p_amount where id=p_session_id;
  if not found then raise exception '회차가 없습니다'; end if;
  return jsonb_build_object('court_fee',p_amount,'freed',0,'removed',0,'issued',0,'held',0);
end $$;
-- dues_notify_unpaid(text) was removed by 20260714050000; do not recreate or rename it.
alter function public.dues_notify_selected(uuid[],text) rename to dues_notify_selected_legacy;
create function public.dues_notify_selected(p_member_ids uuid[],p_msg text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden'; end if;
  if (select enabled from public.dues_v2_control where id=1) then raise exception '새 부과의 현재 미납을 확인해 주세요. 이전 화면에서는 미납 알림을 보낼 수 없습니다'; end if;
  return public.dues_notify_selected_legacy(p_member_ids,p_msg);
end $$;

create function public.dues_v2_candidates_internal(p_kind text,p_ym text,p_session_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g public.dues_v2_groups; k text; label text; day date; total integer; flat integer; per_head integer;
  head integer; previous_head integer; eligible boolean; lines jsonb; hold text; payload jsonb;
begin
  if p_ym is null or p_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception '월을 확인하세요'; end if;
  if p_kind='monthly' then
    k:='monthly:'||p_ym; day:=(p_ym||'-01')::date; label:=p_ym||' 회비';
    select monthly_fee into per_head from public.dues_settings where id=1;
    select count(*) into head from public.dues_monthly_targets(p_ym);
    select count(*) into previous_head from public.dues_v2_charges c join public.dues_v2_groups bg on bg.id=c.group_id
      where bg.source_key='monthly:'||to_char(day-interval '1 month','YYYY-MM') and c.state='live';
    if previous_head>=10 and (head<previous_head*0.6 or head>previous_head*1.4) then hold:='headcount_jump'; end if;
    select * into g from public.dues_v2_groups where source_key=k;
    select coalesce(jsonb_agg(jsonb_build_object('member_id',t.member_id,'amount',per_head,'due_ym',p_ym) order by t.member_id),'[]')
      into lines from public.dues_monthly_targets(p_ym) t
      where not exists(select 1 from public.dues_v2_charges c where c.group_id=g.id and c.member_id=t.member_id);
  elsif p_kind='court' then
    k:='court:'||p_session_id;
    select (s.scheduled_at at time zone 'Asia/Seoul')::date,
      to_char(s.scheduled_at at time zone 'Asia/Seoul','MM/DD HH24:MI')||' '||coalesce(pl.name,s.title,'대관')||' #'||s.id,
      coalesce(s.court_fee,r.court_fee),pl.charges_court_fee and s.scheduled_at is not null
      and s.status in ('open','active','closed')
      into day,label,total,eligible from public.sessions s left join public.places pl on pl.id=s.place_id
      left join public.recurring_schedules r on r.id=s.recurring_schedule_id where s.id=p_session_id;
    if eligible is not true or total<=0 then raise exception '대관비 발행 대상 회차가 아닙니다'; end if;
    select court_fee_default into flat from public.dues_settings where id=1;
    select count(*) into head from public.dues_court_targets(p_session_id,total is not null);
    per_head:=case when total is null then flat when head>0 then ceil(total::numeric/head/10)::int*10 else 0 end;
    if total is not null and per_head>=flat and per_head<flat+200 then per_head:=flat; end if;
    if per_head*2<flat or per_head>flat*5/2 then hold:='amount_out_of_range'; end if;
    select * into g from public.dues_v2_groups where source_key=k;
    select coalesce(jsonb_agg(jsonb_build_object('member_id',t.member_id,'amount',per_head,'due_ym',to_char(day,'YYYY-MM'),
      'payer_hint',t.payer_hint,'is_day_cancel',t.is_day_cancel) order by t.member_id),'[]') into lines
      from public.dues_court_targets(p_session_id,total is not null) t
      where not exists(select 1 from public.dues_v2_charges c where c.group_id=g.id and c.member_id=t.member_id);
  else raise exception '부과 종류를 확인하세요'; end if;
  payload:=jsonb_build_object('action','issue','reason','부과 대상 확인','rule',p_kind,'kind',p_kind,
    'label',label,'date',day,'ym',to_char(day,'YYYY-MM'),'session_id',p_session_id,'lines',lines,
    'basis',jsonb_build_object('rule',p_kind,'total',total,'head',head,'per_head',per_head,'rounding',case when total is null then null else 10 end));
  if g.id is not null then payload:=payload||jsonb_build_object('group_id',g.id); end if;
  return jsonb_build_object('payload',payload,'source_key',k,'hold_reason',hold);
end $$;

create function public.dues_v2_candidates(p_kind text,p_ym text,p_session_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  return public.dues_v2_candidates_internal(p_kind,p_ym,p_session_id);
end $$;
create function public.dues_v2_sessions() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'scheduled_at',s.scheduled_at,'ends_at',s.ends_at,'place',p.name)
    order by s.scheduled_at desc,s.id),'[]') from public.sessions s left join public.places p on p.id=s.place_id
    where s.scheduled_at is not null and p.charges_court_fee and s.status in ('open','active','closed'));
end $$;

create function public.dues_v2_auto_issue(p_kind text,p_ym text,p_session_id bigint default null,p_initial boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
<<generation>>
declare ctl public.dues_v2_control; g public.dues_v2_groups; candidate jsonb; payload jsonb; hold text; n int; result jsonb;
begin
  select * into strict ctl from public.dues_v2_control where id=1 for update;
  if not ctl.enabled or ctl.paused then return 0; end if;
  select * into g from public.dues_v2_groups where source_key=case when p_kind='monthly' then 'monthly:'||p_ym else 'court:'||p_session_id end;
  -- Imported months and already closed historical sessions never get rebuilt.
  if p_ym<to_char(ctl.activated_at at time zone 'Asia/Seoul','YYYY-MM')
    or (p_kind='monthly' and g.id is not null)
    or (p_kind='court' and g.basis->>'legacy'='true' and g.basis->>'closed'='true') then return 0; end if;
  if p_kind='court' and not exists(select 1 from public.sessions s join public.places pl on pl.id=s.place_id
    left join public.recurring_schedules r on r.id=s.recurring_schedule_id
    where s.id=p_session_id and pl.charges_court_fee and s.status in ('active','closed')
      and (coalesce(s.court_fee,r.court_fee) is null or coalesce(s.court_fee,r.court_fee)>0)
      and exists(select 1 from public.matches m where m.session_id=s.id)) then return 0; end if;
  candidate:=public.dues_v2_candidates_internal(p_kind,p_ym,p_session_id); payload:=candidate->'payload';
  n:=jsonb_array_length(payload->'lines'); if n=0 then return 0; end if;
  hold:=candidate->>'hold_reason';
  if g.id is not null and not p_initial then hold:=coalesce(hold,'new_members'); end if;
  if hold is not null then
    if exists(select 1 from public.dues_v2_drafts where source_key=candidate->>'source_key' and public.dues_v2_drafts.payload=generation.payload and hold_reason=hold)
      then return 0; end if;
    perform public.dues_v2_execute(jsonb_build_object('action','draft','reason','자동 발행 검토 대기','source_key',candidate->>'source_key','draft',payload,'hold_reason',hold),gen_random_uuid(),ctl.revision);
    return 0;
  end if;
  result:=public.dues_v2_execute(payload||jsonb_build_object('reason','자동 부과 발행'),gen_random_uuid(),ctl.revision);
  return jsonb_array_length(result->'charges');
end $$;

alter function public.dues_generate_monthly(text) rename to dues_generate_monthly_legacy;
create function public.dues_generate_monthly(p_ym text) returns integer language plpgsql security definer set search_path='' as $$
begin
  if (select enabled from public.dues_v2_control where id=1) then return public.dues_v2_auto_issue('monthly',p_ym); end if;
  return public.dues_generate_monthly_legacy(p_ym);
end $$;
alter function public.dues_generate_session_court(bigint,boolean) rename to dues_generate_session_court_legacy;
create function public.dues_generate_session_court(p_session_id bigint,p_initial boolean) returns integer language plpgsql security definer set search_path='' as $$
begin
  if (select enabled from public.dues_v2_control where id=1) then
    return public.dues_v2_auto_issue('court',(select to_char(scheduled_at at time zone 'Asia/Seoul','YYYY-MM') from public.sessions where id=p_session_id),p_session_id,p_initial);
  end if;
  return public.dues_generate_session_court_legacy(p_session_id,p_initial);
end $$;
create or replace function public.dues_generate_session_court(p_session_id bigint) returns integer language sql security definer set search_path='' as $$
  select public.dues_generate_session_court(p_session_id,false)
$$;

create function public.dues_v2_run_scheduled() returns void language plpgsql security definer set search_path='' as $$
declare ctl public.dues_v2_control;
begin
  select * into strict ctl from public.dues_v2_control where id=1 for update;
  if not ctl.enabled or ctl.paused then return; end if;
  perform public.dues_v2_auto_issue('monthly',to_char(now() at time zone 'Asia/Seoul','YYYY-MM'));
  if exists(select 1 from public.dues_v2_positions p join public.dues_v2_charges c on c.member_id=p.owner_id and c.state='live'
    join public.dues_v2_due d on d.charge_id=c.id where p.purpose='carry' and p.amount>0 and d.remaining>0
    and p.available_ym<=to_char(now() at time zone 'Asia/Seoul','YYYY-MM') and d.due_ym<=to_char(now() at time zone 'Asia/Seoul','YYYY-MM')) then
    perform public.dues_v2_execute('{"action":"apply","reason":"납기 도래 이월금 적용"}',gen_random_uuid(),(select revision from public.dues_v2_control where id=1));
  end if;
end $$;

create function public.dues_v2_command(p_payload jsonb,p_request_id uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  return public.dues_v2_execute(p_payload,p_request_id,p_revision);
end $$;

-- The exact command runs inside a rolled-back subtransaction, including all checks,
-- auto application and locks. Preview cannot commit an allocation or notification.
create function public.dues_v2_preview(p_payload jsonb,p_request_id uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; detail text;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  begin
    v:=public.dues_v2_execute(p_payload,p_request_id,p_revision);
    raise exception using errcode='P0V02',message='preview',detail=v::text;
  exception when sqlstate 'P0V02' then
    get stacked diagnostics detail=pg_exception_detail;
    return detail::jsonb;
  end;
end $$;

-- Seal private helpers and renamed legacy implementations, including implicit PUBLIC execute.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'dues_v2_%' or p.proname in
      ('dues_generate_monthly','dues_generate_monthly_legacy','dues_generate_session_court','dues_generate_session_court_legacy','dues_set_honorary_legacy','members_uncharge_dues_on_deactivate_legacy',
      'dues_set_session_fee_legacy','dues_notify_selected_legacy','dues_set_session_fee','dues_notify_selected',
      'dues_ensure_monthly','dues_ensure_monthly_legacy','generate_dues_charges','generate_dues_charges_legacy')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  end loop;
end $$;
grant execute on function public.dues_v2_mode(),public.dues_v2_read(),public.dues_v2_ledger(text),public.dues_v2_export(),
  public.dues_v2_candidates(text,text,bigint),public.dues_v2_sessions(),
  public.dues_v2_command(jsonb,uuid,bigint),public.dues_v2_preview(jsonb,uuid,bigint),
  public.dues_v2_manage(text,bigint,text,uuid),public.dues_set_honorary(uuid,boolean,text),
  public.dues_set_session_fee(bigint,integer),
  public.dues_ensure_monthly(text) to authenticated;
revoke all on function public.dues_set_honorary(uuid,boolean,text),public.members_uncharge_dues_on_deactivate() from public,anon;

-- Supabase supports pg_cron. A local test database without this extension still
-- exercises the same scheduled entry point explicitly.
do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.schedule('dues-v2-month-and-carry','*/5 * * * *','select public.dues_v2_run_scheduled()');
  end if;
end $$;
