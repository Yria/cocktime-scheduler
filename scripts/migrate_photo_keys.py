#!/usr/bin/env python3
"""
프로필 사진 파일명 규약 이관: md5(이름).jpg → {members.id}.jpg

앱이 사진 키를 이름 해시(md5(name)[:12].jpg)에서 회원 id(members.id) 기반으로
바꾸면서, Storage 에 이미 올라간 기존 사진을 새 파일명으로 복사한다.

- 동명이인(같은 name 회원이 2명 이상): 기존 파일 1장이 누구 것인지 자동 판별 불가 →
  복사하지 않고 목록으로 보고한다(운영진이 회원관리에서 각자 사진을 다시 지정/업로드).
- 기존 md5 파일은 삭제하지 않고 그대로 둔다(안전). 새 {id}.jpg 로 복사만 한다.
- 이미 {id}.jpg 가 있으면 건너뛴다(재실행 안전). --overwrite 로 강제 재복사.

기본은 미리보기(dry-run). 실제 복사는 --apply 를 붙여야 수행한다.
표준 라이브러리만 사용하므로 별도 의존성 설치 없이 실행된다.

    python3 scripts/migrate_photo_keys.py             # 미리보기
    python3 scripts/migrate_photo_keys.py --apply      # 실제 복사
    python3 scripts/migrate_photo_keys.py --apply --overwrite
"""
from __future__ import annotations

import argparse
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env.local"
STORAGE_BUCKET = "player-photos"


def load_env() -> dict[str, str]:
    """Parse .env.local file into a dict."""
    env: dict[str, str] = {}
    if not ENV_FILE.exists():
        print(f"[WARN] {ENV_FILE} not found")
        return env
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip()
    return env


def http(method: str, url: str, service_key: str, body=None) -> tuple[int, str]:
    """service-role 헤더로 HTTP 요청. (status, text) 반환."""
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def md5_name(name: str) -> str:
    """구 규약 파일명: md5(이름) 앞 12자 + .jpg."""
    return f"{hashlib.md5(name.encode()).hexdigest()[:12]}.jpg"


def fetch_members(supabase_url: str, service_key: str) -> list[dict]:
    """members 테이블에서 id·name 조회(service-role: RLS 우회)."""
    q = urllib.parse.urlencode({"select": "id,name"})
    status, text = http("GET", f"{supabase_url}/rest/v1/members?{q}", service_key)
    if status != 200:
        raise RuntimeError(f"members 조회 실패 HTTP {status}: {text[:200]}")
    return json.loads(text)


def list_storage_files(supabase_url: str, service_key: str) -> set[str]:
    """버킷의 기존 파일명 집합."""
    status, text = http(
        "POST",
        f"{supabase_url}/storage/v1/object/list/{STORAGE_BUCKET}",
        service_key,
        {"prefix": "", "limit": 10000},
    )
    if status != 200:
        raise RuntimeError(f"Storage 목록 조회 실패 HTTP {status}: {text[:200]}")
    return {item["name"] for item in json.loads(text) if item.get("name")}


def copy_object(
    supabase_url: str, service_key: str, src: str, dest: str
) -> tuple[bool, str]:
    """Storage 객체 복사(src → dest). (성공여부, 메시지)."""
    status, text = http(
        "POST",
        f"{supabase_url}/storage/v1/object/copy",
        service_key,
        {"bucketId": STORAGE_BUCKET, "sourceKey": src, "destinationKey": dest},
    )
    if status in (200, 201):
        return True, "ok"
    return False, f"HTTP {status}: {text[:160]}"


def main() -> None:
    parser = argparse.ArgumentParser(description="프로필 사진 키 이관(md5 → members.id)")
    parser.add_argument(
        "--apply", action="store_true", help="실제 복사 수행(미지정 시 미리보기만)"
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="대상 {id}.jpg 가 이미 있어도 다시 복사",
    )
    args = parser.parse_args()

    env = load_env()
    supabase_url = env.get("VITE_SUPABASE_URL", "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not supabase_url or not service_key:
        print("[ERROR] VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 .env.local 에서 찾지 못했습니다.")
        return

    print(f"[INFO] {'APPLY' if args.apply else 'DRY-RUN'} · bucket={STORAGE_BUCKET}")

    members = fetch_members(supabase_url, service_key)
    existing = list_storage_files(supabase_url, service_key)
    print(f"[INFO] 회원 {len(members)}명 · Storage 파일 {len(existing)}개")

    # 이름 → id 목록(동명이인 판정용)
    name_to_ids: dict[str, list[str]] = {}
    for m in members:
        name = (m.get("name") or "").strip()
        if not name:
            continue
        name_to_ids.setdefault(name, []).append(m["id"])

    copied: list[str] = []
    skipped_no_photo: list[str] = []
    skipped_exists: list[str] = []
    dup_names: list[tuple[str, list[str]]] = []
    failed: list[str] = []

    for name, ids in sorted(name_to_ids.items()):
        src = md5_name(name)
        if src not in existing:
            skipped_no_photo.append(name)
            continue
        if len(ids) > 1:
            # 동명이인 — 기존 파일 1장을 누구에게 줄지 자동 판단 불가.
            dup_names.append((name, ids))
            continue
        member_id = ids[0]
        dest = f"{member_id}.jpg"
        if dest in existing and not args.overwrite:
            skipped_exists.append(name)
            continue
        if not args.apply:
            copied.append(f"{name}: {src} → {dest}")
            continue
        ok, msg = copy_object(supabase_url, service_key, src, dest)
        if ok:
            copied.append(f"{name}: {src} → {dest}")
        else:
            failed.append(f"{name} ({src} → {dest}): {msg}")

    # ── 요약 ─────────────────────────────────────────────
    print("\n===== 요약 =====")
    print(f"복사 {'예정' if not args.apply else '완료'}: {len(copied)}건")
    for line in copied:
        print(f"  ✓ {line}")
    if skipped_exists:
        print(f"\n이미 이관됨(건너뜀): {len(skipped_exists)}명")
    if skipped_no_photo:
        print(f"기존 사진 없음(건너뜀): {len(skipped_no_photo)}명")
    if dup_names:
        print(f"\n⚠️ 동명이인 — 수동 처리 필요: {len(dup_names)}건")
        print("   (기존 파일 1장이 누구 것인지 알 수 없어 자동 복사하지 않았습니다.")
        print("    회원관리에서 각 회원의 사진을 다시 지정/업로드하세요.)")
        for name, ids in dup_names:
            print(f"  • {name} (src={md5_name(name)}) → 회원 {len(ids)}명: {', '.join(ids)}")
    if failed:
        print(f"\n❌ 복사 실패: {len(failed)}건")
        for line in failed:
            print(f"  ✗ {line}")

    if not args.apply:
        print("\n[DRY-RUN] 실제로 복사하려면 --apply 를 붙여 다시 실행하세요.")


if __name__ == "__main__":
    main()
