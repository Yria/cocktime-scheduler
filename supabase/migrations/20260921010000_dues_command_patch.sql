-- Return only committed changes so confirmation does not reload the entire ledger.
-- Capture is transaction-local and inactive for previews, cron and other writers.
begin;
set local lock_timeout = '5s';

create function public.dues_capture_command_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare rows jsonb; row_value jsonb; table_key text; row_key text; key_column text;
begin
  if current_setting('dues.capture_changes',true) is distinct from 'on' then return null; end if;
  if tg_op='UPDATE' and old is not distinct from new then return null; end if;
  table_key:=substr(tg_table_name,6);
  key_column:=case table_key when 'drafts' then 'source_key' when 'refunds' then 'out_tx_id'
    when 'expenses' then 'bank_tx_id' else 'id' end;
  row_value:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  row_key:=row_value->>key_column;
  if tg_op='DELETE' then row_value:='null'::jsonb;
  elsif table_key='groups' and row_value->>'kind'='court' and row_value->>'session_id' is not null then
    row_value:=row_value||jsonb_build_object('label',public.dues_session_label((row_value->>'session_id')::bigint));
  end if;
  rows:=coalesce(nullif(current_setting('dues.command_changes',true),''),'{}')::jsonb;
  rows:=jsonb_set(rows,array[table_key],coalesce(rows->table_key,'{}')||jsonb_build_object(row_key,row_value));
  perform set_config('dues.command_changes',rows::text,true);
  return null;
end $$;
revoke all on function public.dues_capture_command_change() from public,anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['groups','charges','due','positions','allocations','refunds','expenses','drafts'] loop
    execute format('create trigger dues_command_change after insert or update or delete on public.dues_%I
      for each row execute function public.dues_capture_command_change()',t);
  end loop;
end $$;

create or replace function public.dues_command(p_payload jsonb,p_request_id uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctl public.dues_control; existed boolean; v_result jsonb; changes jsonb; patch jsonb;
begin
  if public.is_admin() is not true then raise exception 'forbidden' using errcode='42501'; end if;
  select * into strict ctl from public.dues_control where id=1 for update;
  existed:=exists(select 1 from public.dues_operations where epoch=ctl.epoch and request_id=p_request_id);
  perform set_config('dues.command_changes','{}',true);
  perform set_config('dues.capture_changes','on',true);
  v_result:=public.dues_execute(p_payload,p_request_id,p_revision);
  changes:=current_setting('dues.command_changes')::jsonb;
  perform set_config('dues.capture_changes','off',true);
  perform set_config('dues.command_changes','{}',true);
  -- Reuse the exact original result, even if later commands have already committed.
  if existed then return v_result; end if;
  patch:=jsonb_build_object('version',1,'epoch',ctl.epoch,'base_revision',ctl.revision,'tables',changes,
    'operation',(select jsonb_build_object('id',id,'action',action,'reason',payload->>'reason',
      'created_at',created_at,'reverted_at',reverted_at) from public.dues_operations
      where id=(v_result->>'operation_id')::bigint));
  -- Issuance/reversal can add or remove upcoming court candidates.
  if changes ? 'charges' or changes ? 'groups' then
    patch:=patch||jsonb_build_object('prepayments',public.dues_prepayment_candidates());
  end if;
  v_result:=v_result||jsonb_build_object('patch',patch);
  update public.dues_operations set result=v_result where id=(v_result->>'operation_id')::bigint;
  return v_result;
end $$;

-- Retries keep the patch in the request journal, but ordinary history reads do
-- not repeatedly transfer all those changed rows or expose them to members.
do $patch$
declare definition text; old text;
begin
  definition:=pg_get_functiondef('public.dues_read()'::regprocedure);
  old:='select id,action,payload->>''reason'' as reason,created_at,reverted_at,result from public.dues_operations';
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
    raise exception 'Unexpected accounting history implementation';
  end if;
  execute replace(definition,old,'select id,action,payload->>''reason'' as reason,created_at,reverted_at,result-''patch'' as result from public.dues_operations');
end $patch$;
notify pgrst, 'reload schema';
commit;
