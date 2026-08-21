#!/usr/bin/env python3
"""
선수 사진 at-rest 축소 백필.

배경 — 왜 이 스크립트가 필요한가
    Storage 의 cacheControl 과 픽셀 크기는 **업로드 시점에 객체 메타데이터로 굳는다.**
    playerPhotoUpload.ts 의 기본값을 512px/max-age=600 에서 192px/1년으로 바꿔도
    그건 앞으로 올라올 사진에만 적용되고, 이미 올라간 객체는 옛 바이트·옛 헤더를 계속 서빙한다.
    2026-08-21 측정에서 사진 egress 는 393 MB/일(= 11.79 GB/30일)이었고 그 대부분이
    512px 원본(평균 66 kB)이었다. 이 스크립트가 기존 객체를 같은 규약으로 맞춘다.

무엇을 하는가
    1. members.photo_updated_at 이 찍힌 회원(= 사진 있는 회원)의 {id}.jpg 를 받는다.
    2. 원본을 `_originals/{id}.jpg` 로 백업한다(앱이 절대 요청하지 않는 접두사, no-cache).
       축소는 비가역이므로 백업 없이 덮어쓰지 않는다. 이미 백업이 있으면 건너뛴다.
    3. min(가로,세로) > TARGET 이면 정사각 중앙크롭 후 TARGET 으로 축소해 JPEG 재인코딩.
       그렇지 않으면(이미 작은 레거시 128px 등) 원본 바이트를 그대로 쓴다 — 확대는 용량만 늘린다.
       재인코딩 결과가 원본보다 크면 역시 원본을 쓴다.
    4. {id}.jpg 를 upsert 하면서 `cache-control: public, max-age=31536000` 으로 교정한다.

photo_updated_at 을 건드리지 않는 이유
    URL 은 `{id}.jpg?v={photo_updated_at}` 이다. 도장을 새로 찍으면 ?v= 가 바뀌어 전 클라이언트가
    한 번 더 받는다(69장 x 활성 파티션). 그럴 필요가 없다 — Supabase Smart CDN 은 객체 재업로드를
    자동 무효화하는 것이 실측으로 확인됐고(max-age=31536000 상태에서 재업로드 직후 MISS 후 새 바이트),
    브라우저에 남은 옛 사본은 현재 헤더(max-age=600 / no-cache)라 10분 안에 만료돼 새 파일로 재검증된다.
    즉 URL 을 그대로 두는 편이 전파는 즉시이고 비용은 0 이다.

사용법
    scripts/.venv/bin/python scripts/backfill_photo_sizes.py            # dry-run (기본)
    scripts/.venv/bin/python scripts/backfill_photo_sizes.py --apply
    ... --target 256 --quality 85                                       # 크기/품질 조정
    ... --restore                                                       # _originals/ 에서 원복
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.request

from PIL import Image

BUCKET = "player-photos"
BACKUP_PREFIX = "_originals"
CACHE_CONTROL = "public, max-age=31536000"
# 표시 크기는 최대 96px(보드 자석 64) — 192 는 DPR 2 를 덮는다.
# 회원관리 사진 모달만 전체화면급이라 여기서 부드러워진다(운영진 전용·저트래픽).
DEFAULT_TARGET = 192
DEFAULT_QUALITY = 80
ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env.local")


def load_env() -> tuple[str, str]:
    url = key = None
    with open(ENV_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("VITE_SUPABASE_URL="):
                url = line.split("=", 1)[1]
            elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                key = line.split("=", 1)[1]
    if not url or not key:
        sys.exit("VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 .env.local 에서 찾지 못했습니다.")
    return url.rstrip("/"), key


def req(url: str, key: str, method="GET", data=None, headers=None) -> bytes:
    h = {"Authorization": f"Bearer {key}", "apikey": key}
    h.update(headers or {})
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=60) as resp:
        return resp.read()


def live_member_ids(base: str, key: str) -> list[str]:
    """사진이 있는 회원 = photo_updated_at 이 찍힌 회원. 앱이 URL 을 만드는 유일한 근거."""
    raw = req(
        f"{base}/rest/v1/members?select=id&photo_updated_at=not.is.null",
        key,
        headers={"Accept": "application/json"},
    )
    return [row["id"] for row in json.loads(raw)]


def obj_url(base: str, name: str) -> str:
    return f"{base}/storage/v1/object/{BUCKET}/{name}"


def download(base: str, key: str, name: str) -> bytes | None:
    """없으면 None. Storage 는 없는 키에 HTTP 400 + 본문 `"code":"NoSuchKey"` 를 돌려준다
    (404 가 아니다) — 상태코드만 보면 진짜 오류와 구분되지 않는다."""
    try:
        return req(obj_url(base, name), key)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if "NoSuchKey" in body or '"statusCode":"404"' in body:
            return None
        raise RuntimeError(f"{name}: HTTP {e.code} {body[:200]}") from e


def upload(base: str, key: str, name: str, blob: bytes, cache_control: str) -> None:
    req(
        obj_url(base, name),
        key,
        method="POST",
        data=blob,
        headers={
            "Content-Type": "image/jpeg",
            "x-upsert": "true",
            "cache-control": cache_control,
        },
    )


def shrink(blob: bytes, target: int, quality: int) -> tuple[bytes, bool, str]:
    """(바이트, 바뀌었나, 사유). 확대·용량증가는 하지 않는다."""
    im = Image.open(io.BytesIO(blob))
    w, h = im.size
    if min(w, h) <= target:
        return blob, False, f"원본유지({w}x{h} <= {target})"
    side = min(w, h)
    im = im.crop(
        ((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)
    ).resize((target, target), Image.LANCZOS)
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    out = buf.getvalue()
    if len(out) >= len(blob):
        return blob, False, f"원본유지(재인코딩이 더 큼 {len(out)} >= {len(blob)})"
    return out, True, f"{w}x{h} -> {target}x{target}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="실제로 업로드한다(기본은 dry-run)")
    ap.add_argument("--target", type=int, default=DEFAULT_TARGET)
    ap.add_argument("--quality", type=int, default=DEFAULT_QUALITY)
    ap.add_argument("--restore", action="store_true", help="_originals/ 백업으로 원복")
    args = ap.parse_args()

    base, key = load_env()
    ids = live_member_ids(base, key)
    mode = "RESTORE" if args.restore else f"{args.target}px q{args.quality}"
    print(f"대상 {len(ids)}명 / {mode} / {'APPLY' if args.apply else 'DRY-RUN'}\n")

    before = after = 0
    changed = kept = missing = failed = 0

    for i, mid in enumerate(ids, 1):
        name = f"{mid}.jpg"
        backup = f"{BACKUP_PREFIX}/{name}"

        if args.restore:
            orig = download(base, key, backup)
            if orig is None:
                print(f"[{i:>3}] {mid[:8]} 백업없음 — 건너뜀")
                missing += 1
                continue
            if args.apply:
                upload(base, key, name, orig, CACHE_CONTROL)
            print(f"[{i:>3}] {mid[:8]} 원복 {len(orig):,} B")
            changed += 1
            continue

        cur = download(base, key, name)
        if cur is None:
            # photo_updated_at 은 찍혀 있는데 객체가 없다 = 앱이 404 를 반복하는 상태.
            print(f"[{i:>3}] {mid[:8]} 객체없음(photo_updated_at 은 있음) — 확인 필요")
            missing += 1
            continue
        before += len(cur)

        try:
            new, did_shrink, why = shrink(cur, args.target, args.quality)
        except Exception as exc:  # 손상된 이미지는 건드리지 않는다
            print(f"[{i:>3}] {mid[:8]} 디코드 실패({exc}) — 건너뜀")
            failed += 1
            after += len(cur)
            continue
        after += len(new)

        # 백업은 바이트가 바뀌는 경우에만 필요하다. 이미 있으면 덮지 않는다(1차 원본 보존).
        need_backup = did_shrink
        if need_backup and download(base, key, backup) is None:
            if args.apply:
                upload(base, key, backup, cur, "no-cache")
            tag = "백업+"
        else:
            tag = "백업有 " if need_backup else "      "

        if not did_shrink:
            # 바이트는 그대로여도 헤더 교정을 위해 재업로드한다(레거시 다수가 no-cache 였다).
            if args.apply:
                upload(base, key, name, cur, CACHE_CONTROL)
            kept += 1
            print(f"[{i:>3}] {mid[:8]} {tag}{len(cur):>7,} B  헤더만 교정  {why}")
        else:
            if args.apply:
                upload(base, key, name, new, CACHE_CONTROL)
            changed += 1
            pct = (1 - len(new) / len(cur)) * 100
            print(
                f"[{i:>3}] {mid[:8]} {tag}{len(cur):>7,} -> {len(new):>6,} B  -{pct:4.1f}%  {why}"
            )

    print(
        f"\n축소 {changed} / 헤더만 {kept} / 객체없음 {missing} / 디코드실패 {failed}"
        f"\n총 바이트 {before:,} -> {after:,}"
        + (f" ({(1 - after / before) * 100:.1f}% 감소)" if before else "")
    )
    if not args.apply:
        print("\ndry-run 이었습니다. 실제 반영은 --apply")


if __name__ == "__main__":
    main()
