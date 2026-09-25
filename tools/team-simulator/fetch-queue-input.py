"""Read-only: build the prepared-queue simulation input from one recorded session.

Usage: python3 tools/team-simulator/fetch-queue-input.py <session_id>
Writes reports/team-simulator-queue-<date>-s<id>/input.json (reports/ is not committed).
"""
import datetime as dt
import hashlib
import importlib.util
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("audit_fetch", ROOT / "scripts/team-audit/fetch.py")
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)

KEYS = ["team_a_p1", "team_a_p2", "team_b_p1", "team_b_p2"]
MISSTART_MINUTES = 3    # Started and cancelled at once; not a game.
UNCLOSED_MINUTES = 30   # Left open until the session auto-close; true length unknown.
LATE_AFTER_MINUTES = 20  # The first two waves cover everyone present at the start.


def minutes(a, b):
    return (dt.datetime.fromisoformat(b) - dt.datetime.fromisoformat(a)).total_seconds() / 60


def main(session_id):
    session = fetch.rows("sessions", {"select": "id,scheduled_at,ends_at,status,court_count,cock_check_enabled",
                                      "id": "eq." + str(session_id)})[0]
    matches = fetch.rows("matches", {"select": "id,court_id,started_at,ended_at,player_snapshot," + ",".join(KEYS),
                                     "session_id": "eq." + str(session_id), "status": "eq.completed",
                                     "order": "started_at.asc,id.asc"})
    rows = {row["id"]: row for row in fetch.rows("session_players", {
        "select": "id,name,gender,skills,allow_mixed_single", "session_id": "eq." + str(session_id)})}
    start = matches[0]["started_at"]
    lengths = [minutes(m["started_at"], m["ended_at"]) for m in matches]
    games = [(m, n) for m, n in zip(matches, lengths) if n >= MISSTART_MINUTES]
    clean = [n for _, n in games if n <= UNCLOSED_MINUTES]
    median = statistics.median(clean)
    first, snapshots, last, stayed = {}, {}, {}, set()
    for match, length in games:
        for index, key in enumerate(KEYS):
            snapshot = (match.get("player_snapshot") or [{}] * 4)[index] or {}
            pid = match[key] or snapshot.get("id")
            if pid and pid not in first:
                first[pid] = minutes(start, match["started_at"])
                snapshots[pid] = snapshot
            if pid:
                last[pid] = minutes(start, match["ended_at"])
                if length > UNCLOSED_MINUTES:
                    stayed.add(pid)
    roster = []
    for pid in sorted(first, key=lambda p: (first[p], p)):
        values = {**rows.get(pid, {}), **snapshots[pid]}
        grade = (values.get("skills") or {}).get("grade")
        if not isinstance(grade, (int, float)) or not 1 <= grade <= 10:
            raise ValueError("Missing valid grade: " + pid)
        arrival = round(first[pid], 1) if first[pid] > LATE_AFTER_MINUTES else 0
        roster.append({"id": pid, "name": values["name"], "gender": values["gender"], "grade": grade,
                       "allowMixedSingle": bool(rows.get(pid, {}).get("allow_mixed_single")), "arrivalMinutes": arrival,
                       **({} if pid in stayed else {"departureMinutes": round(last[pid], 1)})})
    result = {
        "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "session": session,
        "courts": session["court_count"], "games": len(games), "recordedMatches": len(matches),
        "replayMinutes": [n if n <= UNCLOSED_MINUTES else median for _, n in games],
        "durationPoolMinutes": clean, "roster": roster,
        "basis": {
            "games": f"completed matches of at least {MISSTART_MINUTES} min",
            "replay": f"recorded lengths in start order; over {UNCLOSED_MINUTES} min (left open) replaced by the median {median:.1f}",
            "arrival": f"0 unless the first game started more than {LATE_AFTER_MINUTES} min after the first match, then that start",
            "grade": "first completed match snapshot, session row as fallback",
            "departures": "end of the last recorded game, except players of games left open until the auto-close",
        },
    }
    result["rosterSha256"] = hashlib.sha256(json.dumps(roster, sort_keys=True).encode()).hexdigest()
    out = ROOT / f"reports/team-simulator-queue-{session['scheduled_at'][:10].replace('-', '')}-s{session_id}"
    out.mkdir(parents=True, exist_ok=True)
    (out / "input.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({"out": str(out / "input.json"), "players": len(roster), "games": len(games),
                      "late": [p["arrivalMinutes"] for p in roster if p["arrivalMinutes"]],
                      "departures": sorted(p["departureMinutes"] for p in roster if "departureMinutes" in p),
                      "medianMinutes": round(median, 1)}, ensure_ascii=False))


if __name__ == "__main__":
    main(int(sys.argv[1]))
