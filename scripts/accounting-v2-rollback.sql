-- Emergency application-independent rollback. Run as the database owner only.
-- Review/export first with docs/ACCOUNTING_ROLLOUT.md. This cancels ALL V2 decisions
-- in the active epoch; real bank rows and original legacy facts remain untouched.
begin;
set local lock_timeout='5s';
do $$
declare ctl public.dues_v2_control; checkpoint jsonb;
begin
  select * into strict ctl from public.dues_v2_control where id=1 for update;
  if not ctl.enabled then raise notice 'Already using the legacy workflow'; return; end if;
  checkpoint:=public.dues_v2_snapshot();
  update public.dues_v2_operations set reverted_at=now() where epoch=ctl.epoch and reverted_at is null
    and action not in ('activate','pause','resume','undo','rollback');
  update public.dues_v2_control set enabled=false,paused=false,revision=revision+1 where id=1;
  insert into public.dues_v2_operations(epoch,request_id,action,payload,actor_id,before_state,after_state,result)
    values(ctl.epoch,gen_random_uuid(),'rollback','{"reason":"Database owner emergency rollback"}',null,
      checkpoint,checkpoint,jsonb_build_object('enabled',false,'revision',ctl.revision+1));
end $$;
commit;
