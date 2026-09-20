"""Read-only: find the most recent session with exactly 30 actual players."""
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("audit_fetch", ROOT / "scripts/team-audit/fetch.py")
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)


def main():
    now = dt.datetime.now(dt.timezone.utc)
    sessions = fetch.rows("sessions", {
        "select": "id,scheduled_at,ends_at,status,court_count",
        "scheduled_at": "lte." + now.isoformat(),
        "order": "scheduled_at.desc,id.desc", "limit": 1000,
    })
    checked = []
    for session in sessions:
        matches = fetch.rows("matches", {
            "select": "id,started_at,ended_at,team_a_p1,team_a_p2,team_b_p1,team_b_p2,player_snapshot",
            "session_id": "eq." + str(session["id"]), "status": "eq.completed",
            "order": "ended_at.asc,id.asc",
        })
        roster = {}
        keys = ["team_a_p1", "team_a_p2", "team_b_p1", "team_b_p2"]
        for match in matches:
            snapshots = match.get("player_snapshot") or []
            for index, key in enumerate(keys):
                snapshot = snapshots[index] if index < len(snapshots) else {}
                pid = match[key] or snapshot.get("id")
                if pid and pid not in roster:
                    roster[pid] = snapshot
        checked.append({"id": session["id"], "date": session["scheduled_at"], "players": len(roster)})
        if len(roster) != 30:
            continue
        rows = fetch.rows("session_players", {
            "select": "id,name,gender,skills,allow_mixed_single",
            "session_id": "eq." + str(session["id"]),
        })
        by_id = {row["id"]: row for row in rows}
        players = []
        for pid, snapshot in sorted(roster.items()):
            row = by_id.get(pid, {})
            values = {**row, **snapshot}
            grade = values.get("skills", {}).get("grade")
            if not isinstance(grade, (int, float)) or not 1 <= grade <= 10:
                raise ValueError("Missing valid grade: " + pid)
            players.append({"id": pid, "name": values["name"], "gender": values["gender"],
                            "grade": grade, "allowMixedSingle": bool(row.get("allow_mixed_single")),
                            "gradeSource": "firstCompletedMatchSnapshot" if snapshot.get("skills") else "sessionPlayerFallback"})
        result = {"fetchedAt": now.isoformat(), "session": session, "checkedNewerSessions": checked,
                  "participantBasis": "distinct players in completed matches; not registration count",
                  "players": players, "actualCompletedGames": len(matches),
                  "gradeBasis": "first completed match snapshot, current session row as fallback"}
        result["rosterSha256"] = hashlib.sha256(json.dumps(players, sort_keys=True).encode()).hexdigest()
        (OUT / "input.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps({"session": session, "players": len(players), "games": len(matches),
                          "checked": len(checked), "gradeFallbacks": sum(p["gradeSource"] != "firstCompletedMatchSnapshot" for p in players)}, ensure_ascii=False))
        return
    raise RuntimeError("No completed session with exactly 30 distinct players")


if __name__ == "__main__":
    main()
