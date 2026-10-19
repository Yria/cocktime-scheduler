#!/bin/zsh
# 회차 총액 변경 재발행 마이그레이션 리허설 (프로덕션, begin…rollback — 흔적 남지 않음).
# 사용: scripts/rehearse-session-fee-reissue.sh <session_id> <총액|null>
#   예) scripts/rehearse-session-fee-reissue.sh 395 66000
set -e
cd "${0:A:h}/.."
TOKEN=$(<~/.supabase/access-token)
M=supabase/migrations/20261019000000_session_fee_reissue.sql
SID=${1:?session_id}
AMT=${2:?총액 또는 null}

run() {
	jq -n --arg q "$1" '{query:$q}' |
		curl -s -X POST "https://api.supabase.com/v1/projects/sfxbrheavypjsjgbzjom/database/query" \
			-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- | jq .
}

# 운영진 한 명으로 행세(is_admin/current_member_id 가 auth.uid() 를 읽는다)
AS_ADMIN="select set_config('request.jwt.claims', json_build_object('sub',(select m.auth_user_id from public.members m
  join public.user_roles ur on ur.member_id=m.id where ur.role='admin' and m.auth_user_id is not null limit 1),'role','authenticated')::text, true);"

STATE="select c.state, count(*) n, sum(c.amount) amount,
  sum((select coalesce(sum(a.amount-a.reversed),0) from public.dues_allocations a where a.charge_id=c.id)) paid
  from public.dues_charges c join public.dues_groups g on g.id=c.group_id where g.source_key='court:$SID' group by c.state"

echo "== 리허설: 회차 $SID 총액 $AMT (전부 롤백)"
run "begin; $(cat "$M") $AS_ADMIN
  create temp table _r on commit drop as select
    public.dues_session_fee_preview($SID,$AMT) as preview,
    public.dues_set_session_fee($SID,$AMT) as result;
  select public.dues_assert();
  create temp table _s on commit drop as select jsonb_agg(to_jsonb(x)) as after_state from ($STATE) x;
  select r.preview, r.result, s.after_state, (r.preview - 'preview') = r.result as preview_matches from _r r, _s s;
  rollback;"
echo "== 확인: 운영 장부가 그대로인지 (revision·회차 총액·부과 상태)"
run "select (select revision from public.dues_control) revision,
  (select court_fee from public.sessions where id=$SID) court_fee,
  (select jsonb_agg(to_jsonb(x)) from ($STATE) x) state,
  position('reissuable' in pg_get_functiondef('public.dues_issue(jsonb)'::regprocedure))>0 as leaked_patch"
