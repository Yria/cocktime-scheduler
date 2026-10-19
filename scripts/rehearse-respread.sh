#!/bin/zsh
# 엔빵 재분배 마이그레이션 리허설 (프로덕션, begin…rollback — 흔적 남지 않음).
# 회차 382(엔빵 78,000원 · 13명)에서 한 명 부과를 취소한 뒤 재분배를 실행해 결과를 본다.
# 395 보정 결과도 함께 확인한다.
set -e
cd "${0:A:h}/.."
TOKEN=$(<~/.supabase/access-token)
M=supabase/migrations/20261019010000_dues_respread_court_group.sql
run() {
	jq -n --arg q "$1" '{query:$q}' |
		curl -s -X POST "https://api.supabase.com/v1/projects/sfxbrheavypjsjgbzjom/database/query" \
			-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- | jq .
}
AS_ADMIN="select set_config('request.jwt.claims', json_build_object('sub',(select m.auth_user_id from public.members m
  join public.user_roles ur on ur.member_id=m.id where ur.role='admin' and m.auth_user_id is not null order by m.name limit 1),'role','authenticated')::text, true);"
STATE="select c.amount, count(*) n, count(*) filter (where c.basis ? 'line') with_line,
  count(*) filter (where c.basis->>'rule'='court') with_rule,
  sum((select coalesce(sum(a.amount-a.reversed),0) from public.dues_allocations a where a.charge_id=c.id)) paid,
  sum((select coalesce(sum(d.remaining),0) from public.dues_due d where d.charge_id=c.id)) remaining
  from public.dues_charges c join public.dues_groups g on g.id=c.group_id where g.source_key=\$1 and c.state='live' group by c.amount"
run "begin; $(cat "$M") $AS_ADMIN
  create temp table _x on commit drop as select public.dues_execute(jsonb_build_object('action','replace','reason','리허설 취소',
    'charge_ids',jsonb_build_array((select c.id from public.dues_charges c join public.dues_groups g on g.id=c.group_id
      where g.source_key='court:382' and c.state='live' order by c.member_id limit 1)),'lines','[]'::jsonb),
    gen_random_uuid(),(select revision from public.dues_control where id=1)) r;
  create temp table _r on commit drop as select public.dues_respread_court_group(
    (select id from public.dues_groups where source_key='court:382'),(select revision from public.dues_control where id=1)) r;
  select public.dues_assert();
  create or replace function pg_temp.st(k text) returns jsonb language sql as \$f\$ select jsonb_agg(to_jsonb(x)) from ($STATE) x \$f\$;
  select (select r from _r) respread, pg_temp.st('court:382') s382, pg_temp.st('court:395') s395,
    (select basis from public.dues_groups where source_key='court:395') g395;
  rollback;"
echo "== 확인: 운영 장부 그대로"
run "select revision, to_regprocedure('public.dues_respread_court_group(uuid,bigint)') fn from public.dues_control"
