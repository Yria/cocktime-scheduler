#!/bin/zsh
# 프로덕션 읽기 전용 SQL 조회 (진단용). Management API + CLI 로그인 토큰(~/.supabase/access-token).
# 세션 기본 트랜잭션을 read only 로 강제하므로 쓰기 문장은 서버에서 거부된다.
# 사용: scripts/prod-ro-sql.sh "select ..."
set -e
TOKEN=$(<~/.supabase/access-token)
jq -n --arg q "set default_transaction_read_only = on; $1" '{query:$q}' |
	curl -s -X POST "https://api.supabase.com/v1/projects/sfxbrheavypjsjgbzjom/database/query" \
		-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @-
