"""Read-only snapshot for the session-level team audit. Never prints credentials."""
import concurrent.futures
import datetime as dt
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/team-audit-20260916"
env = {}
for line in (ROOT / ".env.local").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip("\"'")
base = env["VITE_SUPABASE_URL"].rstrip("/") + "/rest/v1/"
headers = {"apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
           "Authorization": "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"]}

def get(path, params=None):
    url = base + path + ("?" + urllib.parse.urlencode(params) if params else "")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{path}: HTTP {exc.code}: {exc.read().decode()[:350]}") from None

def rows(table, params):
    result = []
    offset = 0
    while True:
        page = get(table, {**params, "limit": 1000, "offset": offset})
        result.extend(page)
        if not page:
            return result
        offset += len(page)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    schema = get("")
    definitions = schema.get("definitions", {})
    log_schema = {name: list(spec.get("properties", {})) for name, spec in definitions.items()
                  if any(token in name for token in ("match", "board", "event", "log", "audit", "role"))}
    fetched = dt.datetime.now(dt.timezone.utc).isoformat()
    sessions = rows("sessions", {
        "select": "id,title,scheduled_at,starts_at:started_at,ends_at,ended_at,status,court_count,occurrence_date,board_drafts,cock_check_enabled",
        "scheduled_at": "gte.2026-08-22T15:00:00Z",
        "and": "(scheduled_at.lt.2026-09-16T15:00:00Z)",
        "order": "scheduled_at.asc,id.asc",
    })
    ids = "in.(" + ",".join(str(s["id"]) for s in sessions) + ")"
    queries = {
        "matches": ("matches", {"select": "*", "session_id": ids, "order": "started_at.asc,id.asc"}),
        "players": ("session_players", {"select": "*", "session_id": ids, "order": "session_id.asc,id.asc"}),
        "admins": ("user_roles", {"select": "member_id,role,granted_at,members(id,name,gender)", "role": "eq.admin", "order": "member_id.asc"}),
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pending = {name: pool.submit(rows, table, params) for name, (table, params) in queries.items()}
        data = {name: future.result() for name, future in pending.items()}
    snapshot = {"fetchedAt": fetched, "cutoverDate": "2026-09-07", "fromDate": "2026-08-23", "throughDate": "2026-09-16",
                "schema": log_schema, "sessions": sessions, **data}
    (OUT / "source.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
    print(json.dumps({"fetchedAt": fetched, "counts": {key: len(snapshot[key]) for key in ["sessions", "matches", "players", "admins"]},
                      "logSchema": log_schema,
                      "admins": [{"name": a["members"]["name"], "grantedAt": a["granted_at"]} for a in data["admins"]],
                      "sessions": [{"id": s["id"], "date": s["scheduled_at"], "status": s["status"],
                                    "matches": sum(m["session_id"] == s["id"] for m in data["matches"])} for s in sessions]}, ensure_ascii=False))

if __name__ == "__main__":
    main()
