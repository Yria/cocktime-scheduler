#!/bin/zsh
# 일요일 18:00 KST 일정 공개 순간 진단 수집 (전부 읽기 전용).
#
# 왜: 서버 지표(메모리·스왑·디스크·PostgREST 풀)는 이력이 없고 약 60초마다 현재값만 보여 준다.
#     2026-11-08 공개 때 1.86~4.39초 동안 REST 응답이 0건이었고(엣지 로그), 같은 시기 Auth 도 수 초씩 멈췄다.
#     락·리로드·재시작·풀 타임아웃은 로그로 반증됐고, 남은 유력 원인은 Nano VM(431MB)의 상시 스왑이다.
#     이 스크립트는 그 순간의 스왑인·메이저폴트·디스크 지연과 풀 상태를 같이 떠서 그 가설을 확정/기각한다.
#     (로그 API 는 문서상 보존 1일이지만 실제로는 며칠 전 것도 조회됐다. 그래도 그날 받아 두는 편이 안전하다.)
#
# 사용: caffeinate -i scripts/sunday-open-capture.sh [YYYY-MM-DD]   # KST 일요일. 생략하면 다음 공개일
#       17:54 KST 전에 띄워 두면 시각에 맞춰 돈다(그 전까지는 잠만 잔다). 18:08 KST 쯤 끝난다.
#       TEST=1 이면 지금 시각 기준으로 각 수집기를 한 번씩만 돌려 형식을 확인한다.
# 결과: reports/sunday-open/<날짜>/ (gitignored — 회원 식별자가 들어 있다)
#
# 프로덕션 부하(모두 읽기): 지표 10초 간격(17:55~18:06), REST·auth 탐침 0.5초 간격(17:59:30~18:01:30),
#   DB 상태 조회 1초 간격(17:59:50~18:00:40, 한 번에 1개만), pg_stat_statements 스냅샷 3회, 로그 조회 ~25회.
# 주의: 일요일 오후에는 마이그레이션을 배포하지 말 것(DDL → 스키마 캐시 리로드 → 풀 재초기화가 섞인다).
set -u
zmodload zsh/datetime
cd "${0:A:h}/.."

REF=sfxbrheavypjsjgbzjom
TOKEN=$(<~/.supabase/access-token)
URL=$(grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d "\"'")
SVC=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2- | tr -d "\"'")
[[ -n $TOKEN && -n $URL && -n $SVC ]] || { print -u2 "액세스 토큰(~/.supabase/access-token) 또는 .env.local 의 URL·서비스 키를 읽지 못했습니다."; exit 1; }

# ── 대상 시각 T0 = 일요일 09:00:00Z(18:00 KST) ────────────────────────────────
TEST=${TEST:-0}
if (( TEST )); then
	DAY=test-$(date +%Y%m%d-%H%M%S)
	T0=$(( ${EPOCHSECONDS} + 15 ))
else
	if (( $# )); then
		DAY=$1
	else
		dow=$(TZ=Asia/Seoul date +%u) hm=$(TZ=Asia/Seoul date +%H%M)
		if (( dow == 7 && 10#$hm < 1810 )); then add=0; else add=$(( 7 - dow % 7 )); fi
		DAY=$(TZ=Asia/Seoul date -v+${add}d +%F)
	fi
	T0=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "${DAY}T09:00:00Z" +%s) || exit 1
fi
OUT=reports/sunday-open/$DAY
mkdir -p $OUT
print "대상: $DAY 18:00 KST (T0=$T0) → $OUT"

iso() { date -u -r $1 +%Y-%m-%dT%H:%M:%SZ }
sleep_until() {
	local d=$(( $1 - EPOCHREALTIME ))
	(( d > 0 )) && sleep $d
	return 0
}
# 읽기 전용 SQL(scripts/prod-ro-sql.sh 와 같지만 응답 대기 상한을 둔다 — DB 가 멈춘 순간에 쌓이지 않게).
sql() {
	jq -n --arg q "set default_transaction_read_only = on; $1" '{query:$q}' |
		curl -s -m ${2:-15} -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
			-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @-
}
# 로그(최근 24h 만 남는다). ClickHouse 방언, 컬럼은 source.
logs() {
	curl -s -m 60 -G "https://api.supabase.com/v1/projects/$REF/analytics/endpoints/logs" \
		-H "Authorization: Bearer $TOKEN" --data-urlencode "sql=$1" \
		--data-urlencode "iso_timestamp_start=$(iso $2)" --data-urlencode "iso_timestamp_end=$(iso $3)"
}

# ── 1) 서버 지표: 메모리·스왑·디스크·PostgREST 풀 (10초 간격, 값은 ~60초마다 갱신) ─────────
METRIC_RE='^(node_vmstat_(pswpin|pswpout|pgmajfault|pgpgin|pgpgout)\{|node_disk_(reads_completed|read_time_seconds|writes_completed|write_time_seconds|io_time_seconds|io_time_weighted_seconds)_total\{|node_memory_(MemFree|MemAvailable|SwapFree|SwapCached|Shmem|AnonPages|Active_file|Inactive_file)_bytes\{|node_cpu_seconds_total\{|node_load1\{|pgrst_|go_gc_duration_seconds\{|connection_stats_connection_count\{|realtime_postgres_changes)'
scrape_metrics() {
	local f=$OUT/metrics.tsv t
	local from=$(( T0 - 300 )) to=$(( T0 + 360 ))
	(( TEST )) && { from=$EPOCHSECONDS; to=$(( EPOCHSECONDS + 1 )); }
	sleep_until $from
	while (( EPOCHREALTIME < to )); do
		t=$EPOCHREALTIME
		curl -s -m 8 -u "service_role:$SVC" "$URL/customer/v1/privileged/metrics" |
			grep -E "$METRIC_RE" | sed -E 's/supabase_(identifier|project_ref)="[^"]*",?//g' |
			awk -v t=$t '{print t "\t" $0}' >> $f
		sleep_until $(( t + 10 ))
	done
}

# ── 2) 외부 탐침: REST 와 auth 를 0.5초마다 (REST 만 멈추면 PostgREST 층, 둘 다면 호스트·게이트웨이) ──
probe() {
	local f=$OUT/probe.tsv t
	local from=$(( T0 - 30 )) to=$(( T0 + 90 ))
	(( TEST )) && { from=$EPOCHSECONDS; to=$(( EPOCHSECONDS + 1 )); }
	print -r -- $'sent_epoch\tkind\thttp\tttfb_s\ttotal_s\tupstream_ms' > $f
	sleep_until $from
	while (( EPOCHREALTIME < to )); do
		t=$EPOCHREALTIME
		{
			local r
			r=$(curl -s -o /dev/null -m 30 -w $'%{http_code}\t%{time_starttransfer}\t%{time_total}\t%header{x-envoy-upstream-service-time}' \
				-H "apikey: $SVC" -H "Authorization: Bearer $SVC" "$URL/rest/v1/places?select=id&limit=1")
			print -r -- "$t"$'\trest\t'"$r" >> $f
		} &
		{
			local a
			a=$(curl -s -o /dev/null -m 30 -w $'%{http_code}\t%{time_starttransfer}\t%{time_total}\t' \
				-H "apikey: $SVC" "$URL/auth/v1/health")
			print -r -- "$t"$'\tauth\t'"$a" >> $f
		} &
		sleep_until $(( t + 0.5 ))
	done
	wait
}

# ── 3) DB 연결 상태: PostgREST 풀이 무엇을 하고 있었나 (1초 간격, 한 번에 하나만) ─────────────
ACT_SQL="select to_char(clock_timestamp() at time zone 'UTC','HH24:MI:SS.MS') t, pid, usename u, application_name app,
 state, wait_event_type wt, wait_event we,
 round(extract(epoch from clock_timestamp()-backend_start)::numeric,1) conn_s,
 round(extract(epoch from clock_timestamp()-xact_start)::numeric,3) xact_s,
 round(extract(epoch from clock_timestamp()-query_start)::numeric,3) query_s,
 round(extract(epoch from clock_timestamp()-state_change)::numeric,3) state_s,
 pg_blocking_pids(pid) blocked_by, left(regexp_replace(query,'\s+',' ','g'),140) q
 from pg_stat_activity
 where backend_type='client backend' and pid <> pg_backend_pid() and coalesce(application_name,'') <> 'mgmt-api'"
sample_activity() {
	local f=$OUT/activity.jsonl t r
	local from=$(( T0 - 10 )) to=$(( T0 + 40 ))
	(( TEST )) && { from=$EPOCHSECONDS; to=$(( EPOCHSECONDS + 1 )); }
	sleep_until $from
	while (( EPOCHREALTIME < to )); do
		t=$EPOCHREALTIME
		r=$(sql "$ACT_SQL" 5)
		jq -c --arg sent $t --arg done $EPOCHREALTIME '{sent:$sent, done:$done, rows:.}' <<< "$r" >> $f 2>/dev/null ||
			print -r -- "{\"sent\":\"$t\",\"error\":true}" >> $f
		sleep_until $(( t + 1 ))
	done
}

# ── 4) 누적 통계 스냅샷: 18:00 창에 어떤 쿼리가 몇 번, 얼마나 돌았나(차분으로 계산) ────────────
PSS_SQL="select queryid, r.rolname, calls, round(total_exec_time::numeric,1) total_ms, round(max_exec_time::numeric,1) max_ms,
 rows, shared_blks_hit hit, shared_blks_read rd, left(regexp_replace(query,'\s+',' ','g'),200) q
 from pg_stat_statements s join pg_roles r on r.oid=s.userid order by calls desc limit 500"
DB_SQL="select clock_timestamp() t, xact_commit, xact_rollback, blks_read, blks_hit, sessions, sessions_abandoned,
 sessions_fatal, sessions_killed, deadlocks, txid_current_snapshot()::text snap
 from pg_stat_database where datname=current_database()"
snapshot() {
	local tag=$1 at=$2
	(( TEST )) || sleep_until $at
	sql "$PSS_SQL" 30 > $OUT/pss_$tag.json
	sql "$DB_SQL" 15 > $OUT/db_$tag.json
}

# ── 5) 로그: 24시간 안에만 받을 수 있다 ───────────────────────────────────────────────
pull_logs() {
	# 로그는 수집 지연이 있어 18:05 에 받는다(창 끝에서 1분 이상 지난 뒤).
	local s=$(( T0 - 60 )) e=$(( T0 + 240 )) w
	(( TEST )) && { s=$(( EPOCHSECONDS - 120 )); e=$(( EPOCHSECONDS - 90 )); } || sleep_until $(( T0 + 300 ))
	# edge_logs 는 15초 창으로 잘라 1000행 한도를 피한다. origin_time=엣지에서 본 처리 시간, up=PostgREST 처리 시간(ms).
	for (( w = s; w < e; w += 15 )); do
		logs "select timestamp, log_attributes['request.method'] m, log_attributes['request.path'] p,
			log_attributes['response.status_code'] st, log_attributes['response.origin_time'] ot,
			log_attributes['response.headers.x_envoy_upstream_service_time'] up, log_attributes['request.sb.auth_user'] u
			from logs where source='edge_logs' order by timestamp limit 1000" $w $(( w + 15 )) > $OUT/edge_$w.json
		sleep 4
	done
	for src in postgrest_logs postgres_logs realtime_logs function_edge_logs function_logs auth_logs; do
		logs "select timestamp, event_message from logs where source='$src' order by timestamp limit 1000" \
			$(( s - 60 )) $(( e + 120 )) > $OUT/$src.json
		sleep 4
	done
}

# ── 6) DB 사후 기록: 초별 신청·감사 트랜잭션(나중에도 볼 수 있지만 같이 떠 둔다) ─────────────
db_forensics() {
	(( TEST )) || sleep_until $(( T0 + 240 ))
	local a=$(iso $(( T0 - 5 ))) b=$(iso $(( T0 + 60 )))
	sql "select floor(extract(epoch from requested_at - '$(iso $T0)'::timestamptz))::int s, count(*) n, count(distinct member_id) m
		from public.attendances where requested_at >= '$a' and requested_at < '$b' group by 1 order by 1" 30 > $OUT/joins_per_second.json
	sql "select round(extract(epoch from at - '$(iso $T0)'::timestamptz)*1000)::int ms, txid, kind, session_id, req_path
		from public.ops_audit where at >= '$a' and at < '$b' order by at" 30 > $OUT/ops_audit.json
	sql "select j.jobname, d.start_time, d.end_time, d.status from cron.job_run_details d join cron.job j using(jobid)
		where d.start_time >= '$(iso $(( T0 - 120 )))' and d.start_time < '$b' order by d.start_time" 30 > $OUT/cron.json
}

print "수집기 시작(백그라운드). 끝나면 요약을 출력한다."
scrape_metrics & p1=$!
probe & p2=$!
sample_activity & p3=$!
{ snapshot before $(( T0 - 60 )); snapshot after30 $(( T0 + 30 )); snapshot after120 $(( T0 + 120 )); } & p4=$!
pull_logs & p5=$!
db_forensics & p6=$!
wait $p1 $p2 $p3 $p4 $p5 $p6

# ── 요약 ─────────────────────────────────────────────────────────────────────────────
print "\n== REST/auth 탐침: 1초 넘게 걸린 것 (보낸 시각은 T0 기준 초)"
awk -F'\t' -v t0=$T0 'NR>1 && $5+0 > 1 { printf "  %+7.2fs %-4s http=%s total=%ss upstream=%sms\n", $1-t0, $2, $3, $5, $6 }' $OUT/probe.tsv | head -40
print "\n== 지표 갱신 구간별 증분 (엔드포인트 값은 ~60초마다 한꺼번에 바뀐다. 줄 순서는 스크랩마다 달라 스크랩 단위로 묶는다)"
python3 -I - $OUT/metrics.tsv $T0 <<'PY'
import sys, collections
path, t0 = sys.argv[1], float(sys.argv[2])
scr = collections.defaultdict(dict)
try:
    for line in open(path):
        t, m = line.rstrip("\n").split("\t", 1)
        name, _, val = m.rpartition(" ")
        try:
            scr[float(t)][name] = float(val)
        except ValueError:
            pass
except FileNotFoundError:
    sys.exit("  (metrics.tsv 없음)")
def pick(d, prefix, must=""):
    return sum(v for k, v in d.items() if k.startswith(prefix) and must in k)
rows = []
for t in sorted(scr):
    d = scr[t]
    rows.append((t, dict(
        pswpin=pick(d, "node_vmstat_pswpin"), pswpout=pick(d, "node_vmstat_pswpout"),
        majflt=pick(d, "node_vmstat_pgmajfault"),
        reads=pick(d, "node_disk_reads_completed_total", "nvme0n1"),
        rtime=pick(d, "node_disk_read_time_seconds_total", "nvme0n1"),
        iowait=pick(d, "node_cpu_seconds_total", 'mode="iowait"'),
        idle=pick(d, "node_cpu_seconds_total", 'mode="idle"'),
        pool_wait=pick(d, "pgrst_db_pool_waiting"), pool_avail=pick(d, "pgrst_db_pool_available"),
        pool_to=pick(d, "pgrst_db_pool_timeouts_total"), swapfree=pick(d, "node_memory_SwapFree_bytes"))))
prev = None
for t, v in rows:
    if prev and v["pswpin"] == prev[1]["pswpin"] and v["reads"] == prev[1]["reads"]:
        continue  # 아직 갱신 안 된 스크랩
    if prev:
        dt = t - prev[0]
        dr = v["reads"] - prev[1]["reads"]
        lat = (v["rtime"] - prev[1]["rtime"]) * 1000 / dr if dr > 0 else 0
        busy = v["iowait"] - prev[1]["iowait"]
        print(f"  {prev[0]-t0:+6.0f}s~{t-t0:+5.0f}s  swapin {(v['pswpin']-prev[1]['pswpin'])/dt:7.1f}/s"
              f"  swapout {(v['pswpout']-prev[1]['pswpout'])/dt:6.1f}/s  majflt {(v['majflt']-prev[1]['majflt'])/dt:6.1f}/s"
              f"  rootreads {dr/dt:6.1f}/s  readlat {lat:5.2f}ms  iowait {busy/dt*100:5.1f}%"
              f"  pool avail={v['pool_avail']:.0f} wait={v['pool_wait']:.0f} timeouts+{v['pool_to']-prev[1]['pool_to']:.0f}"
              f"  swapfree={v['swapfree']/2**20:.0f}MB")
    prev = (t, v)
PY
print "\n== 초별 신청 수"
jq -r '.[]? | "  \(.s)s n=\(.n) m=\(.m)"' $OUT/joins_per_second.json | head -30
print "\n결과 폴더: $OUT  (pss_* 는 before/after30/after120 차분, activity.jsonl 은 1초 간격 풀 상태, edge_*.json 은 요청별 지연)"
