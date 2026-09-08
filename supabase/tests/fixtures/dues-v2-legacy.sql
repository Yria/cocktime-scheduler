-- Minimal legacy schema for isolated PostgreSQL transition tests.
    create role anon; create role authenticated;
    create table members(id uuid primary key,name text,is_active boolean default true,is_guest boolean default false,is_honorary boolean default false,gender text,birth_year int,updated_at timestamptz default now());
    create function current_member_id() returns uuid language sql as $$ select nullif(current_setting('test.member',true),'')::uuid $$;
    create function is_admin() returns boolean language sql as $$ select coalesce(current_setting('test.admin',true),'false')='true' $$;
    create table sessions(id bigint primary key,title text,status text,scheduled_at timestamptz,ends_at timestamptz,place_id bigint,recurring_schedule_id bigint,court_fee int,is_regular boolean not null default false,meal_enabled boolean not null default false);
    create table places(id bigint primary key,name text,charges_court_fee boolean);
    create table recurring_schedules(id bigint primary key,court_fee int);
    create table matches(id bigint primary key,session_id bigint);
    create table txn_categories(id bigint primary key,name text);
    create table dues_settings(id int primary key,monthly_fee int,court_fee_default int);
    create table dues_batches(id bigint primary key,key text,kind text,label text,occurred_on date,session_id bigint,period_ym text,total_amount int);
    create table bank_transactions(id bigint primary key,direction text,amount int,occurred_at timestamptz,created_at timestamptz default now(),paid_by uuid,session_id bigint,batch_id bigint,category_id bigint,refund_of_tx_id bigint,counterparty_name text);
    create table dues_charges(id bigint primary key,kind text,member_id uuid,amount_due int,amount_paid int,status text,batch_id bigint,payer_hint uuid,period_ym text,deferred_to text,is_day_cancel boolean default false,created_at timestamptz default now());
    create table dues_allocations(id bigint primary key,bank_tx_id bigint,charge_id bigint,member_id uuid,amount int,kind text default 'payment',created_at timestamptz default now());
    create table dues_charge_drafts(id bigint primary key,draft_group text,kind text,label text,period_ym text,charged_on date,session_id bigint,member_id uuid,amount_due int,payer_hint uuid,hold_reason text);
    create table dues_audit_log(actor_member_id uuid,action text,detail jsonb);
    create table member_honorary(member_id uuid primary key,reason text,updated_at timestamptz default now());
    create function dues_monthly_targets(text) returns table(member_id uuid) language sql as $$select id from public.members where is_active and not is_guest and not is_honorary$$;
    create function dues_court_targets(bigint,boolean) returns table(member_id uuid,is_day_cancel boolean,payer_hint uuid) language sql as $$select id,false,null::uuid from public.members where is_active$$;
    create function dues_generate_monthly(text) returns int language sql as $$select 0$$;
    create function dues_ensure_monthly(text) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function generate_dues_charges(text) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function dues_generate_session_court(bigint,boolean) returns int language sql as $$select 0$$;
    create function dues_set_session_fee(bigint,integer) returns jsonb language sql as $$select '{}'::jsonb$$;
    -- dues_notify_unpaid(text) is absent in the actual deployed schema (removed 2026-07-14).
    create function dues_notify_selected(uuid[],text) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function members_uncharge_dues_on_deactivate() returns trigger language plpgsql as $$begin return null; end$$;
    create trigger trg_members_uncharge_dues_on_deactivate after update of is_active on members for each row execute function members_uncharge_dues_on_deactivate();
    create function dues_set_honorary(uuid,boolean,text default null) returns jsonb language sql as $$select '{}'::jsonb$$;

create table attendances(session_id bigint,member_id uuid,status text,meal_joining boolean);
create table session_players(session_id bigint,member_id uuid);
