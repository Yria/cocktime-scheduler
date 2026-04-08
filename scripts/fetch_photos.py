#!/usr/bin/env python3
"""
Player Photo Picker for Cocktime Scheduler.

Mac Photos (osxphotos) + 소모임 프로필에서 선수 얼굴 사진을 수집하고,
로컬 웹 UI로 선택한 뒤 Supabase Storage 업로드 + Google Sheets 기록.

Usage:
    python scripts/fetch_photos.py
    python scripts/fetch_photos.py --skip-photos
    python scripts/fetch_photos.py --player "홍길동"
    python scripts/fetch_photos.py --dry-run
"""

import argparse
import concurrent.futures
import http.server
import io
import json
import os
import re
import sys
import tempfile
import threading
import unicodedata
import urllib.parse
import webbrowser
from pathlib import Path

import requests
from PIL import Image

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

# Ensure print output is unbuffered
sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]

# ---------------------------------------------------------------------------
# osxphotos optional import
# ---------------------------------------------------------------------------
try:
    import osxphotos

    HAS_OSXPHOTOS = True
except ImportError:
    HAS_OSXPHOTOS = False

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env.local"

SOMOIM_GROUP_ID = "86aedfbc-72c9-4039-afa9-ffa3d60a54111"
SOMOIM_GROUP_URL = f"https://www.somoim.co.kr/{SOMOIM_GROUP_ID}"
SOMOIM_PROFILE_CDN = "https://d3vo2hyhx9t76k.cloudfront.net"

STORAGE_BUCKET = "player-photos"
FACE_CROP_SIZE = 128
FACE_PADDING = 0.4  # 40% padding around face region
FACE_MIN_SIZE = 0.06  # skip faces smaller than 6% of image width (too far away)
JPEG_QUALITY = 60
MAX_PHOTOS_PER_SOURCE = 5  # max candidates per source per player


def parse_gender(val: str) -> str:
    """Normalize gender value to M/F."""
    v = val.strip()
    if v in ("F", "여", "여자"):
        return "F"
    return "M"


def strip_decorations(name: str) -> str:
    """Remove emoji/special markers from names (e.g. '임동규Ⓔ' -> '임동규')."""
    # Remove circled letters, emoji, and other symbol characters
    return "".join(
        ch for ch in name
        if unicodedata.category(ch)[0] not in ("S", "C")  # Symbol, Control
    ).strip()


def load_env() -> dict[str, str]:
    """Parse .env.local file into a dict."""
    env = {}
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


# ---------------------------------------------------------------------------
# Step 1: Fetch player list from Google Sheets via Supabase edge function
# ---------------------------------------------------------------------------
def fetch_players(supabase_url: str, anon_key: str) -> list[dict]:
    """Fetch player list from Sheets edge function."""
    url = f"{supabase_url}/functions/v1/sheets"
    headers = {
        "Authorization": f"Bearer {anon_key}",
        "apikey": anon_key,
    }
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    rows = data.get("values", [])
    if len(rows) < 2:
        return []

    players = []
    for idx, row in enumerate(rows[1:], start=1):
        name = (row[0] if row else "").strip()
        if not name:
            continue
        # Check if photo URL already exists in column J (index 9)
        photo_url = row[9].strip() if len(row) > 9 else ""
        players.append({
            "name": name,
            "gender": parse_gender(row[1] if len(row) > 1 else "M"),
            "row_index": idx,
            "has_photo": bool(photo_url),
        })
    return players


# ---------------------------------------------------------------------------
# Step 2: Mac Photos source (osxphotos)
# ---------------------------------------------------------------------------
def gather_from_photos(player_names: list[str], tmp_dir: Path) -> dict[str, list[dict]]:
    """Gather face crops from Mac Photos using osxphotos."""
    if not HAS_OSXPHOTOS:
        print("[INFO] osxphotos not available, skipping Mac Photos source")
        return {}

    print("[INFO] Opening Mac Photos database...")
    try:
        photosdb = osxphotos.PhotosDB()
    except Exception as e:
        print(f"[WARN] Failed to open Photos DB: {e}")
        return {}

    # Build name mapping: sheet name -> Photos person name (exact match only)
    all_persons = photosdb.persons
    person_lookup: dict[str, str] = {}  # sheet_name -> photos_person_name
    for pname in all_persons:
        for sheet_name in player_names:
            if pname == sheet_name:
                person_lookup[sheet_name] = pname

    print(f"[INFO] Matched {len(person_lookup)} players in Photos")

    results: dict[str, list[dict]] = {}

    for name in player_names:
        person_name = person_lookup.get(name)
        if not person_name:
            continue

        photos = photosdb.photos(persons=[person_name])
        if not photos:
            continue

        candidates = []
        for photo in photos[:MAX_PHOTOS_PER_SOURCE * 2]:
            if not photo.path or not Path(photo.path).exists():
                continue

            face_info_list = [
                f for f in (photo.face_info or [])
                if f.name == person_name and f.size >= FACE_MIN_SIZE
            ]
            if not face_info_list:
                continue

            for face in face_info_list[:1]:
                try:
                    cropped = crop_face_from_photo(photo.path, face)
                    if cropped is None:
                        continue

                    fname = f"{name}_photos_{len(candidates)}.jpg"
                    save_path = tmp_dir / fname
                    cropped.save(str(save_path), "JPEG", quality=JPEG_QUALITY)
                    candidates.append({
                        "path": str(save_path),
                        "source": "photos",
                        "label": "Mac Photos",
                    })
                except Exception as e:
                    print(f"[WARN] Face crop failed for {name}: {e}")

            if len(candidates) >= MAX_PHOTOS_PER_SOURCE:
                break

        if candidates:
            results[name] = candidates
            print(f"  [Photos] {name}: {len(candidates)} candidates")

    return results


def crop_face_from_photo(photo_path: str, face) -> Image.Image | None:
    """Crop and resize a face region from a photo."""
    try:
        img = Image.open(photo_path)
        img_w, img_h = img.size

        # face coordinates are normalized (0-1)
        # osxphotos uses Core Image coordinates: origin bottom-left, Y goes UP
        # Pillow uses origin top-left, Y goes DOWN → flip Y
        cx = face.center_x
        cy = 1.0 - face.center_y  # flip Y axis
        size = face.size  # width of face as fraction of image width

        # Calculate crop box with padding (square)
        face_w = size * img_w
        face_h = size * img_w  # approximate square
        pad = max(face_w, face_h) * FACE_PADDING

        left = max(0, cx * img_w - face_w / 2 - pad)
        top = max(0, cy * img_h - face_h / 2 - pad)
        right = min(img_w, cx * img_w + face_w / 2 + pad)
        bottom = min(img_h, cy * img_h + face_h / 2 + pad)

        cropped = img.crop((int(left), int(top), int(right), int(bottom)))
        cropped = cropped.resize((FACE_CROP_SIZE, FACE_CROP_SIZE), Image.LANCZOS)

        # Convert to RGB if needed (HEIC/PNG might be RGBA)
        if cropped.mode != "RGB":
            cropped = cropped.convert("RGB")

        return cropped
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Step 3: Somoim profile photo source
# ---------------------------------------------------------------------------
SOMOIM_API_ARTICLES = "https://www.somoim.co.kr/api/articles"
SOMOIM_API_HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://www.somoim.co.kr",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
}
SOMOIM_API_COOKIES = {"loc": "160000", "loc2": "161200"}


def parse_somoim_members(html: str) -> dict[str, str]:
    """Parse member data from somoim Next.js HTML. Returns {name: member_id}."""
    members: dict[str, str] = {}

    # Next.js RSC data is in self.__next_f.push([1,"..."]) calls
    for match in re.finditer(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.DOTALL):
        chunk = match.group(1)
        # Unescape JSON string encoding
        chunk = chunk.replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")

        # Find member objects with "mid" and "mn" fields
        for obj_match in re.finditer(r'"mid"\s*:\s*"([^"]+)"', chunk):
            mid = obj_match.group(1)
            start = obj_match.start()
            window = chunk[start:start + 500]
            mn_match = re.search(r'"mn"\s*:\s*"([^"]+)"', window)
            if mn_match:
                mn = mn_match.group(1)
                members[mn] = mid

    return members


SOMOIM_ARTICLE_IMG_CDN = "https://d3vo2hyhx9t76k.cloudfront.net"


def _fetch_all_articles(group_id: str) -> list[dict]:
    """Fetch all articles with s_t pagination."""
    all_articles: list[dict] = []
    s_t = None
    for _ in range(30):
        params: dict = {"gid": group_id, "wql": 50}
        if s_t:
            params["s_t"] = s_t
        try:
            resp = requests.post(
                SOMOIM_API_ARTICLES,
                json=params,
                headers=SOMOIM_API_HEADERS,
                cookies=SOMOIM_API_COOKIES,
                timeout=10,
            )
            data = resp.json()
        except Exception:
            break
        articles = data.get("cs", [])
        s_t = data.get("s_t")
        if not articles:
            break
        all_articles.extend(articles)
        if not s_t or len(articles) < 10:
            break
    return all_articles


def fetch_intro_data(group_id: str) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Fetch all articles and return:
    1. name_to_wids: {real_name: [wid, ...]} from '이름 :' pattern
    2. name_to_article_imgs: {real_name: [img_url, ...]} from posts with ic > 0

    Article image URL pattern: {CDN}/{article_id}{index}.png
      index 0 = thumbnail, 1+ = original images
    """
    print("[INFO] Fetching introduction posts...")
    all_articles = _fetch_all_articles(group_id)
    print(f"[INFO] Fetched {len(all_articles)} articles total")

    name_to_wids: dict[str, list[str]] = {}
    name_to_article_imgs: dict[str, list[str]] = {}

    for art in all_articles:
        content = art.get("c", "")
        name_match = re.search(r"이름\s*[:：]\s*(.+)", content)
        if not name_match:
            continue
        raw = name_match.group(1).strip().split("\n")[0].strip()
        raw = raw.replace(" ", "")
        if not raw or len(raw) < 2 or len(raw) > 10 or "(" in raw or "양식" in raw:
            continue

        # Extract birth year (2-digit) from "나이(생년월일)" field
        birth_yy = ""
        birth_match = re.search(r"나이.*?[:：]\s*(.+)", content)
        if birth_match:
            birth_raw = birth_match.group(1).strip().split("\n")[0].strip()
            # Try patterns: "920321", "1997.07.16", "29살(1997.07.16)", "97년생"
            yy_match = (
                re.search(r"\((\d{4})\.", birth_raw)       # (1997.xx.xx)
                or re.search(r"^(\d{4})\.", birth_raw)     # 1997.xx.xx
                or re.search(r"^(\d{2})\d{4}$", birth_raw) # 920321
                or re.search(r"(\d{2})년", birth_raw)       # 97년생
            )
            if yy_match:
                val = yy_match.group(1)
                birth_yy = val[-2:]  # last 2 digits

        # Build name keys: "김영주" and optionally "김영주97"
        name_keys = [raw]
        if birth_yy:
            name_with_year = f"{raw}{birth_yy}"
            name_keys.append(name_with_year)

        wid = art["wid"]
        wn = art.get("wn", "")
        if raw != wn:
            print(f"  [Mapping] {wn} -> {raw}" + (f" ({birth_yy})" if birth_yy else ""))

        for key in name_keys:
            # Name -> wid mapping
            if key not in name_to_wids:
                name_to_wids[key] = []
            if wid not in name_to_wids[key]:
                name_to_wids[key].append(wid)

            # Name -> article image URLs (ic > 0 means has images)
            ic = art.get("ic", 0)
            if ic > 0:
                art_id = art["id"]
                img_urls = [
                    f"{SOMOIM_ARTICLE_IMG_CDN}/{art_id}{i * 2 + 1}.png"
                    for i in range(ic)
                ]
                if key not in name_to_article_imgs:
                    name_to_article_imgs[key] = []
                name_to_article_imgs[key].extend(img_urls)

    print(f"[INFO] Found {len(name_to_wids)} name entries, "
          f"{len(name_to_article_imgs)} with intro photos")
    return name_to_wids, name_to_article_imgs


def gather_from_somoim(player_names: list[str], tmp_dir: Path) -> dict[str, list[dict]]:
    """Gather profile photos from somoim."""
    print(f"[INFO] Fetching somoim members from {SOMOIM_GROUP_URL}...")

    try:
        resp = requests.get(SOMOIM_GROUP_URL, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        })
        resp.raise_for_status()
    except Exception as e:
        print(f"[WARN] Failed to fetch somoim page: {e}")
        return {}

    members = parse_somoim_members(resp.text)
    print(f"[INFO] Found {len(members)} somoim members")

    if not members:
        print("[WARN] No members parsed from somoim page. Page structure may have changed.")
        return {}

    # Build intro name mappings + article image URLs
    intro_mappings, intro_images = fetch_intro_data(SOMOIM_GROUP_ID)

    # Build wid -> mid lookup (all known member IDs)
    all_mids: set[str] = set(members.values())

    # Build lookup tables for flexible name matching
    stripped_members: dict[str, str] = {}  # stripped_name -> mid
    for mn, mid in members.items():
        stripped = strip_decorations(mn)
        stripped_members[stripped] = mid

    def _resolve_mid(name: str) -> str | None:
        """Try multiple strategies to find a somoim member ID for a player name."""
        # 1. Exact match on somoim member name
        if name in members:
            return members[name]

        # 2. Stripped decoration match
        if name in stripped_members:
            return stripped_members[name]

        # 3. Name from introduction post -> wid is the member ID
        if name in intro_mappings:
            for wid in intro_mappings[name]:
                if wid in all_mids:
                    return wid

        # 4. Strip trailing numbers (e.g. "김영주97" -> "김영주")
        name_no_num = re.sub(r"\d+$", "", name)
        if name_no_num != name:
            result = _resolve_mid(name_no_num)
            if result:
                return result

        return None

    def _download_image(url: str, save_path: Path) -> bool:
        """Download, center-crop to square, and resize an image."""
        try:
            resp = requests.get(url, timeout=10)
            if resp.status_code != 200:
                return False
            img = Image.open(io.BytesIO(resp.content))
            if img.mode != "RGB":
                img = img.convert("RGB")
            # Center crop to square
            w, h = img.size
            side = min(w, h)
            left = (w - side) // 2
            top = (h - side) // 2
            img = img.crop((left, top, left + side, top + side))
            img = img.resize((FACE_CROP_SIZE, FACE_CROP_SIZE), Image.LANCZOS)
            img.save(str(save_path), "JPEG", quality=JPEG_QUALITY)
            return True
        except Exception:
            return False

    def _process_player(name: str) -> tuple[str, list[dict]]:
        """Download all candidate photos for one player."""
        mid = _resolve_mid(name)
        candidates: list[dict] = []

        # Source A: Introduction post images (higher priority)
        for idx, img_url in enumerate(intro_images.get(name, [])[:3]):
            save_path = tmp_dir / f"{name}_somoim_intro_{idx}.jpg"
            if _download_image(img_url, save_path):
                candidates.append({
                    "path": str(save_path),
                    "source": "somoim_intro",
                    "label": "somoim intro",
                })

        # Source B: Profile photo from CDN (lower priority)
        if mid:
            save_path = tmp_dir / f"{name}_somoim_profile.jpg"
            if _download_image(f"{SOMOIM_PROFILE_CDN}/{mid}.png", save_path):
                candidates.append({
                    "path": str(save_path),
                    "source": "somoim",
                    "label": "somoim profile",
                })

        return name, candidates

    # Parallel download with thread pool
    results: dict[str, list[dict]] = {}
    unmatched_names: list[str] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(_process_player, name): name for name in player_names}
        for future in concurrent.futures.as_completed(futures):
            name, candidates = future.result()
            if candidates:
                results[name] = candidates
                labels = [c["label"] for c in candidates]
                print(f"  [Somoim] {name}: {', '.join(labels)}")
            elif not _resolve_mid(name):
                unmatched_names.append(name)

    return results


# ---------------------------------------------------------------------------
# Step 4: Web Picker UI
# ---------------------------------------------------------------------------
PICKER_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>선수 사진 선택</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0a0a0a; color: #e0e0e0;
    max-width: 800px; margin: 0 auto; padding: 20px 20px 100px;
  }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .stats { color: #888; margin-bottom: 20px; font-size: 0.85rem; }

  /* Section headers */
  .section { margin-bottom: 24px; }
  .section-header {
    font-size: 1.1rem; color: #aaa; border-bottom: 1px solid #333;
    padding-bottom: 6px; margin-bottom: 12px; cursor: pointer; user-select: none;
  }
  .section-header:hover { color: #ccc; }

  /* Player row — one per line */
  .row {
    display: flex; align-items: center; gap: 12px;
    background: #1a1a1a; border: 1px solid #333; border-radius: 10px;
    padding: 10px 14px; margin-bottom: 8px;
    transition: border-color 0.2s;
  }
  .row.selected { border-color: #0b84ff; }
  .row-name {
    min-width: 70px; font-weight: 600; font-size: 0.95rem;
    white-space: nowrap;
  }
  .gender {
    font-size: 0.7rem; padding: 1px 7px; border-radius: 8px;
    flex-shrink: 0;
  }
  .gender-M { background: #1e3a5f; color: #5ba3f5; }
  .gender-F { background: #5f1e3a; color: #f55b8a; }

  /* Photo options — horizontal scroll */
  .photos {
    display: flex; gap: 8px; overflow-x: auto; flex: 1;
    padding: 2px 0;
  }
  .photo-opt { flex-shrink: 0; text-align: center; cursor: pointer; }
  .photo-opt input { display: none; }
  .photo-opt .img-wrap {
    width: 100px; height: 100px; border-radius: 8px;
    border: 2px solid transparent; overflow: hidden;
    transition: border-color 0.15s;
  }
  .photo-opt input:checked + .img-wrap {
    border-color: #0b84ff;
  }
  .photo-opt .img-wrap img { width: 100%; height: 100%; object-fit: cover; }
  .photo-opt .source { font-size: 0.6rem; color: #666; margin-top: 2px; }
  .skip-opt {
    display: flex; align-items: center; justify-content: center;
    width: 100px; height: 100px; border-radius: 8px;
    background: #222; color: #555; font-size: 0.7rem;
    flex-shrink: 0; cursor: pointer;
    border: 2px solid transparent;
  }
  .skip-opt.active { border-color: #ff6b6b; }

  /* No-photo list */
  .no-photo-list { line-height: 2.2; color: #666; font-size: 0.85rem; padding: 4px 0; }
  .no-photo-list .badge {
    display: inline-block; padding: 2px 10px; border-radius: 10px;
    margin: 2px 3px; font-size: 0.8rem;
  }

  /* Submit bar */
  .submit-bar {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: #1a1a1a; border-top: 1px solid #333;
    padding: 14px; text-align: center; z-index: 100;
  }
  .submit-btn {
    background: #0b84ff; color: white; border: none;
    padding: 12px 40px; border-radius: 10px;
    font-size: 1rem; font-weight: 600; cursor: pointer;
  }
  .submit-btn:hover { background: #0070e0; }
  .submit-btn:disabled { background: #333; color: #666; cursor: not-allowed; }
  .count { color: #888; margin-left: 10px; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>선수 사진 선택</h1>
<p class="stats">STATS_PLACEHOLDER</p>
CARDS_PLACEHOLDER
<div class="submit-bar">
  <button class="submit-btn" onclick="submitSelections()">업로드</button>
  <span class="count" id="countLabel">0명 선택됨</span>
</div>
<script>
function updateCount() {
  let count = 0;
  document.querySelectorAll('.row').forEach(row => {
    const checked = row.querySelector('input[type=radio]:checked');
    const hasSelection = checked && checked.value !== 'none';
    row.classList.toggle('selected', hasSelection);
    if (hasSelection) count++;
  });
  document.getElementById('countLabel').textContent = count + '명 선택됨';
}

document.addEventListener('change', e => {
  if (e.target.type === 'radio') updateCount();
});

// Handle skip button toggle
document.querySelectorAll('.skip-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const radio = btn.previousElementSibling;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', {bubbles: true}));
  });
});

async function submitSelections() {
  const selections = {};
  document.querySelectorAll('.row').forEach(row => {
    const name = row.dataset.name;
    const checked = row.querySelector('input[type=radio]:checked');
    if (checked && checked.value !== 'none') {
      selections[name] = checked.value;
    }
  });
  const btn = document.querySelector('.submit-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';
  try {
    const resp = await fetch('/submit', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({selections}),
    });
    if (resp.ok) {
      document.body.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:80vh;flex-direction:column">' +
        '<h1 style="font-size:3rem;margin-bottom:16px">Done!</h1>' +
        '<p style="color:#888">Close this tab.</p></div>';
    }
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Retry';
    alert('Failed: ' + e.message);
  }
}

// Auto-select first photo for each player
document.querySelectorAll('.row').forEach(row => {
  const first = row.querySelector('input[type=radio]');
  if (first && first.value !== 'none') first.checked = true;
});
updateCount();
</script>
</body>
</html>"""


def _build_player_row(name: str, photos: list[dict], gender: str) -> str:
    """Build a single player row HTML (one line per player)."""
    photos_html = []
    for i, photo in enumerate(photos):
        source_indices = [
            j for j, p in enumerate(photos[:i + 1]) if p["source"] == photo["source"]
        ]
        img_id = f"{photo['source']}_{len(source_indices) - 1}"
        photos_html.append(
            f'<label class="photo-opt">'
            f'<input type="radio" name="sel_{name}" value="{img_id}">'
            f'<div class="img-wrap">'
            f'<img src="/img/{urllib.parse.quote(name)}/{i}" loading="lazy">'
            f'</div>'
            f'<div class="source">{photo["label"]}</div>'
            f'</label>'
        )
    # Skip option
    photos_html.append(
        f'<input type="radio" name="sel_{name}" value="none" '
        f'{"checked" if not photos else ""} style="display:none">'
        f'<div class="skip-opt">Skip</div>'
    )

    return (
        f'<div class="row" data-name="{name}">'
        f'<span class="row-name">{name}</span>'
        f'<span class="gender gender-{gender}">{gender}</span>'
        f'<div class="photos">{"".join(photos_html)}</div>'
        f'</div>'
    )


def build_picker_html(
    candidates: dict[str, list[dict]],
    players: list[dict],
    already_uploaded: set[str] | None = None,
) -> str:
    """Build picker HTML with 3 sections: no photo / pending / already uploaded."""
    gender_map = {p["name"]: p["gender"] for p in players}
    already_uploaded = already_uploaded or set()

    new_with_photos = []
    uploaded_with_photos = []
    without_photos = []

    for name in sorted(candidates.keys()):
        gender = gender_map.get(name, "M")
        has_candidates = bool(candidates[name])
        is_uploaded = name in already_uploaded

        if is_uploaded and has_candidates:
            uploaded_with_photos.append((name, candidates[name], gender))
        elif is_uploaded:
            uploaded_with_photos.append((name, [], gender))
        elif has_candidates:
            new_with_photos.append((name, candidates[name], gender))
        else:
            without_photos.append((name, gender))

    stats = (
        f"Total: {len(players)} / "
        f"New: {len(new_with_photos)} / "
        f"Uploaded: {len(uploaded_with_photos)} / "
        f"No photo: {len(without_photos)}"
    )

    # Build rows for new players (not yet uploaded)
    new_rows = [
        _build_player_row(name, photos, gender)
        for name, photos, gender in new_with_photos
    ]

    # Build rows for already uploaded players (can re-select)
    uploaded_rows = [
        _build_player_row(name, photos, gender)
        for name, photos, gender in uploaded_with_photos
    ]

    # No-photo badge list
    no_photo_html = ""
    if without_photos:
        badges = "".join(
            f'<span class="badge gender-{g}">{n}</span>'
            for n, g in without_photos
        )
        no_photo_html = (
            f'<div class="section">'
            f'<h2 class="section-header">사진 없음 ({len(without_photos)})</h2>'
            f'<p class="no-photo-list">{badges}</p>'
            f'</div>'
        )

    content = f"""
    {no_photo_html}
    <div class="section">
      <h2 class="section-header">미등록 ({len(new_with_photos)})</h2>
      <div id="pending-list">{''.join(new_rows)}</div>
    </div>
    <div class="section">
      <h2 class="section-header" style="color:#4a9">등록 완료 ({len(uploaded_with_photos)})</h2>
      <div id="uploaded-list">{''.join(uploaded_rows)}</div>
    </div>"""

    html = PICKER_HTML.replace("STATS_PLACEHOLDER", stats)
    html = html.replace("CARDS_PLACEHOLDER", content)
    return html


def run_picker(
    candidates: dict[str, list[dict]],
    players: list[dict],
    already_uploaded: set[str] | None = None,
) -> dict[str, str]:
    """Run local web picker server. Returns {player_name: source_index}."""

    shutdown_event = threading.Event()
    result_holder: dict[str, dict] = {"selections": {}}

    html_content = build_picker_html(candidates, players, already_uploaded)

    class PickerHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass  # suppress server logs

        def do_GET(self):
            if self.path == "/":
                self._serve_html(html_content)
            elif self.path.startswith("/img/"):
                self._serve_image()
            else:
                self.send_error(404)

        def do_POST(self):
            if self.path == "/submit":
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
                result_holder["selections"] = body.get("selections", {})
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
                shutdown_event.set()
            else:
                self.send_error(404)

        def _serve_html(self, content: str):
            data = content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _serve_image(self):
            # Path: /img/{name}/{index}
            parts = self.path.split("/")
            if len(parts) < 4:
                self.send_error(404)
                return
            name = urllib.parse.unquote(parts[2])
            try:
                idx = int(parts[3])
            except ValueError:
                self.send_error(404)
                return

            photos = candidates.get(name, [])
            if idx >= len(photos):
                self.send_error(404)
                return

            photo_path = photos[idx]["path"]
            try:
                with open(photo_path, "rb") as f:
                    img_data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(img_data)))
                self.end_headers()
                self.wfile.write(img_data)
            except FileNotFoundError:
                self.send_error(404)

    # Use port 0 to let OS pick a free port
    server = http.server.HTTPServer(("127.0.0.1", 0), PickerHandler)
    port = server.server_address[1]

    server_thread = threading.Thread(target=server.serve_forever)
    server_thread.daemon = True
    server_thread.start()

    url = f"http://127.0.0.1:{port}"
    print(f"\n[Picker] Opening browser at {url}")
    webbrowser.open(url)

    print("[Picker] Waiting for selection... (select photos in browser)")
    shutdown_event.wait()

    server.shutdown()
    print("[Picker] Selection received!")

    return result_holder["selections"]


# ---------------------------------------------------------------------------
# Step 5: Upload to Supabase Storage
# ---------------------------------------------------------------------------
def ensure_storage_bucket(supabase_url: str, service_key: str) -> bool:
    """Create player-photos bucket if it doesn't exist."""
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }
    # Check if bucket exists
    resp = requests.get(
        f"{supabase_url}/storage/v1/bucket/{STORAGE_BUCKET}",
        headers=headers,
        timeout=10,
    )
    if resp.status_code == 200:
        return True

    # Create bucket
    resp = requests.post(
        f"{supabase_url}/storage/v1/bucket",
        headers={**headers, "Content-Type": "application/json"},
        json={
            "id": STORAGE_BUCKET,
            "name": STORAGE_BUCKET,
            "public": True,
            "allowed_mime_types": ["image/jpeg", "image/png"],
            "file_size_limit": 2_097_152,  # 2MB
        },
        timeout=10,
    )
    if resp.status_code in (200, 201):
        print(f"[Storage] Bucket '{STORAGE_BUCKET}' created")
        return True

    print(f"[Storage] Failed to create bucket: {resp.status_code} {resp.text}")


def list_uploaded_photos(supabase_url: str, service_key: str) -> set[str]:
    """Return set of player names that already have photos in Storage."""
    import hashlib as _hl
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }
    resp = requests.post(
        f"{supabase_url}/storage/v1/object/list/{STORAGE_BUCKET}",
        headers={**headers, "Content-Type": "application/json"},
        json={"prefix": "", "limit": 1000},
        timeout=10,
    )
    if resp.status_code != 200:
        return set()
    files = {item["name"] for item in resp.json() if item.get("name")}
    return files


def get_uploaded_names(supabase_url: str, service_key: str, all_names: list[str]) -> set[str]:
    """Check which player names already have uploaded photos."""
    import hashlib as _hl
    existing_files = list_uploaded_photos(supabase_url, service_key)
    if not existing_files:
        return set()
    uploaded = set()
    for name in all_names:
        name_hash = _hl.md5(name.encode()).hexdigest()[:12]
        if f"{name_hash}.jpg" in existing_files:
            uploaded.add(name)
    return uploaded
    return False


def upload_photo(
    supabase_url: str,
    service_key: str,
    player_name: str,
    photo_path: str,
) -> str | None:
    """Upload photo to Supabase Storage. Returns public URL or None."""
    import hashlib
    # Supabase Storage doesn't allow non-ASCII keys; use hash-based filename
    name_hash = hashlib.md5(player_name.encode()).hexdigest()[:12]
    filename = f"{name_hash}.jpg"
    url = f"{supabase_url}/storage/v1/object/{STORAGE_BUCKET}/{filename}"
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
        "Content-Type": "image/jpeg",
        "x-upsert": "true",
    }
    with open(photo_path, "rb") as f:
        resp = requests.post(url, headers=headers, data=f.read(), timeout=15)

    if resp.status_code in (200, 201):
        return f"{supabase_url}/storage/v1/object/public/{STORAGE_BUCKET}/{filename}"

    print(f"[Upload] Failed for {player_name}: {resp.status_code} {resp.text}")
    return None



# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Player Photo Picker")
    parser.add_argument("--skip-photos", action="store_true", help="Skip Mac Photos source")
    parser.add_argument("--skip-somoim", action="store_true", help="Skip Somoim source")
    parser.add_argument("--player", type=str, help="Process only this player")
    parser.add_argument("--dry-run", action="store_true", help="Skip upload & sheet write")
    args = parser.parse_args()

    # Load config
    env = load_env()
    supabase_url = env.get("VITE_SUPABASE_URL", "")
    anon_key = env.get("VITE_SUPABASE_ANON_KEY", "")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url or not anon_key:
        print("[ERROR] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY required in .env.local")
        sys.exit(1)

    # Fetch players
    print("[INFO] Fetching player list from Google Sheets...")
    players = fetch_players(supabase_url, anon_key)
    print(f"[INFO] Found {len(players)} players")

    if args.player:
        players = [p for p in players if p["name"] == args.player]
        if not players:
            print(f"[ERROR] Player '{args.player}' not found")
            sys.exit(1)

    # Check which players already have uploaded photos in Storage
    all_names = [p["name"] for p in players]
    already_uploaded: set[str] = set()
    if service_key:
        print("[INFO] Checking existing uploads in Storage...")
        already_uploaded = get_uploaded_names(supabase_url, service_key, all_names)
        print(f"[INFO] {len(already_uploaded)} players already have uploaded photos")

    for p in players:
        p["has_photo"] = p["name"] in already_uploaded

    players_needing_photos = [p for p in players if not p["has_photo"]]
    print(f"[INFO] {len(players_needing_photos)} players need photos, "
          f"{len(already_uploaded)} already uploaded")

    # ALL players are candidates (already uploaded ones can be re-selected)
    player_names = [p["name"] for p in players]

    # Create temp directory for candidates
    tmp_dir = Path(tempfile.mkdtemp(prefix="photo_picker_"))
    print(f"[INFO] Temp directory: {tmp_dir}")

    # Gather candidates from all sources
    all_candidates: dict[str, list[dict]] = {name: [] for name in player_names}

    if not args.skip_photos:
        print("\n--- Source 1: Mac Photos ---")
        photos_results = gather_from_photos(player_names, tmp_dir)
        for name, photos in photos_results.items():
            all_candidates[name].extend(photos)

    if not args.skip_somoim:
        print("\n--- Source 2: Somoim ---")
        somoim_results = gather_from_somoim(player_names, tmp_dir)
        for name, photos in somoim_results.items():
            all_candidates[name].extend(photos)

    # Count results
    with_candidates = sum(1 for v in all_candidates.values() if v)
    print(f"\n[INFO] {with_candidates}/{len(player_names)} players have photo candidates")

    if with_candidates == 0:
        print("[INFO] No photo candidates found from any source.")
        return

    # For already-uploaded players, fetch their current photo as first candidate
    if already_uploaded:
        import hashlib as _hl
        for name in already_uploaded:
            name_hash = _hl.md5(name.encode()).hexdigest()[:12]
            current_url = f"{supabase_url}/storage/v1/object/public/{STORAGE_BUCKET}/{name_hash}.jpg"
            save_path = tmp_dir / f"{name}_current.jpg"
            try:
                resp = requests.get(current_url, timeout=10)
                if resp.status_code == 200:
                    save_path.write_bytes(resp.content)
                    current_entry = {
                        "path": str(save_path),
                        "source": "current",
                        "label": "현재 사진",
                    }
                    if name not in all_candidates:
                        all_candidates[name] = []
                    all_candidates[name].insert(0, current_entry)
            except Exception:
                pass

    print("\n--- Photo Picker ---")
    selections = run_picker(all_candidates, players, already_uploaded)

    if not selections:
        print("[INFO] No photos selected.")
        return

    # Filter out unchanged selections (current photo kept as-is)
    changed = {k: v for k, v in selections.items() if not v.startswith("current_")}
    print(f"\n[INFO] {len(selections)} selected, {len(changed)} changed")

    if not changed and not args.dry_run:
        print("[INFO] No changes to upload.")
        return

    # Resolve selections to file paths
    resolved: dict[str, str] = {}
    for name, sel_id in changed.items():
        # sel_id format: "{source}_{index}" e.g. "photos_0", "somoim_0"
        parts = sel_id.rsplit("_", 1)
        if len(parts) != 2:
            continue
        source, idx_str = parts
        try:
            idx = int(idx_str)
        except ValueError:
            continue

        matching = [p for p in all_candidates.get(name, []) if p["source"] == source]
        if idx < len(matching):
            resolved[name] = matching[idx]["path"]

    if args.dry_run:
        print("\n--- Dry Run Results ---")
        for name, path in resolved.items():
            print(f"  {name}: {path}")
        print(f"\n[DRY RUN] Would upload {len(resolved)} photos")
        return

    # Upload and update sheets
    if not service_key:
        print("\n[WARN] SUPABASE_SERVICE_ROLE_KEY not set in .env.local")
        print("[WARN] Skipping upload. Results saved locally:")
        for name, path in resolved.items():
            print(f"  {name}: {path}")
        return

    print("\n--- Uploading ---")
    if not ensure_storage_bucket(supabase_url, service_key):
        print("[ERROR] Could not create/access storage bucket")
        return

    success_count = 0
    uploaded: dict[str, str] = {}  # name -> public_url
    for name, photo_path in resolved.items():
        public_url = upload_photo(supabase_url, service_key, name, photo_path)
        if public_url:
            print(f"  [OK] {name} -> {public_url}")
            uploaded[name] = public_url
            success_count += 1
        else:
            print(f"  [FAIL] {name}")

    # Report
    print(f"\n=== Report ===")
    print(f"  Uploaded: {success_count}/{len(resolved)}")
    print(f"  Skipped:  {len(player_names) - len(resolved)}")

    # Save URL mapping for manual sheet entry
    if uploaded:
        csv_path = PROJECT_ROOT / "scripts" / "photo_urls.csv"
        with open(csv_path, "w", encoding="utf-8") as f:
            f.write("name,url,formula\n")
            for name, url in sorted(uploaded.items()):
                f.write(f'{name},{url},=IMAGE("{url}")\n')
        print(f"\n  URL list saved to: {csv_path}")
        print(f"  Copy the 'formula' column to Google Sheets column J")


if __name__ == "__main__":
    main()
