#!/bin/zsh
# 운영진 동시 편집 마이그레이션 리허설 (프로덕션, begin…rollback — 흔적 남지 않음).
# A: guards + flag 적용 후 상태 확인 / B: guards + flag + down 적용 후 원복 확인.
# 사용: scripts/rehearse-multi-editor.sh
set -e
cd "${0:A:h}/.."
TOKEN=$(<~/.supabase/access-token)
G=supabase/migrations/20261012000000_board_match_guards.sql
F=supabase/migrations/20261012010000_board_multi_editor_flag.sql
D=supabase/rollback/20261012010000_board_multi_editor_flag_down.sql
# down 파일의 자체 begin/commit 은 바깥 rollback 을 깨므로 제거
DOWN=$(sed -E '/^[[:space:]]*(begin|commit)[[:space:]]*;[[:space:]]*$/Id' $D)

run() {
	jq -n --arg q "$1" '{query:$q}' |
		curl -s -X POST "https://api.supabase.com/v1/projects/sfxbrheavypjsjgbzjom/database/query" \
			-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- | jq .
}

CHECK_UP="select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sessions' and column_name='board_multi_editor') as col_exists,
  to_regprocedure('public.admin_set_board_multi_editor(bigint,boolean)') is not null as toggle_rpc,
  to_regprocedure('public.board_multi_editor_enabled(bigint)') is not null as helper,
  position('players already playing' in pg_get_functiondef('public.assign_match(uuid,bigint,integer,text,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure)) > 0 as assign_guard,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('assign_match','board_save_drafts','board_assert_editor')) as fn_count"

CHECK_DOWN="select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sessions' and column_name='board_multi_editor') as col_exists_after_down,
  to_regprocedure('public.admin_set_board_multi_editor(bigint,boolean)') is not null as toggle_rpc_after_down,
  position('players already playing' in pg_get_functiondef('public.assign_match(uuid,bigint,integer,text,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure)) > 0 as assign_guard_kept,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and pg_get_functiondef(p.oid) ilike '%multi_editor%') as multi_refs_left"

echo "== A: up (기대: col_exists/toggle_rpc/helper/assign_guard=true, fn_count=3)"
run "begin; $(cat "$G") $(cat "$F") create temp table _r on commit drop as $CHECK_UP; select * from _r; rollback;"
echo "== B: up+down (기대: col/rpc=false, assign_guard_kept=true, multi_refs_left=0)"
run "begin; $(cat "$G") $(cat "$F") $DOWN create temp table _r on commit drop as $CHECK_DOWN; select * from _r; rollback;"
echo "== 확인: 실제로 아무것도 남지 않았는지 (기대: false)"
run "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='sessions' and column_name='board_multi_editor') as leaked"
