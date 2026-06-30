# -*- coding: utf-8 -*-
import random

# ---- 선수 정의 ----
GROUPS = ['A', 'B', 'C', 'D', 'E', 'F']
NAMES = {
    'A': {1: '박현아', 2: '이한비', 3: '오상진', 4: '오용진', 5: '차성민'},
    'B': {1: '김주영', 2: '황영민', 3: '남필립', 4: '손형일', 5: '이재원'},
    'C': {1: '심유진', 2: '윤지윤', 3: '김길환', 4: '심상욱', 5: '최양회'},
    'D': {1: '송수민', 2: '이지인', 3: '강민규', 4: '김태혁', 5: '우창형'},
    'E': {1: '엄지현', 2: '장한별', 3: '강우석', 4: '송유현', 5: '이후섭'},
    'F': {1: '노보람', 2: '이규웅', 3: '박세경', 4: '이홍희', 5: '정현민'},
}

# 페어 타입 분류
YEO = [(1, 2)]                                          # 여복
HON = [(1, 3), (1, 4), (1, 5), (2, 3), (2, 4), (2, 5)]  # 혼복
NAM = [(3, 4), (3, 5), (4, 5)]                          # 남복

def pid(g, n):
    return (g, n)

# ---- Phase 1: 조-쌍별 타입 배분 (w=여복, x=남복, m=혼복) ----
# 여복: 6-사이클  A-B-C-D-E-F-A  (각 변 1)  -> 각 조 여복 2경기
# 남복: 대각 매칭 {A-D, B-E, C-F} 가중치 2, 나머지 모든 쌍 1 -> 각 조 남복 6경기
# 혼복: m = 4 - w - x -> 각 조 혼복 12경기
idx = {g: i for i, g in enumerate(GROUPS)}

def edge_type(a, b):
    d = (idx[a] - idx[b]) % 6
    if d in (1, 5):
        return 'cycle'   # 6-사이클 인접 (거리 1)
    if d == 3:
        return 'diam'    # 대각 (거리 3)
    return 'tri'         # 삼각(거리 2): {A,C,E},{B,D,F}

# 타입 배분 (w=여복, m=혼복, x=남복):
#   cycle : 1 / 1 / 2   - 여복을 분산하되 m을 1로 낮춰 여-여 재대결 하한 최소화
#   diam  : 0 / 2 / 2
#   tri   : 0 / 4 / 0   - 같은 조와 4경기 모두 혼복(여-여 4쌍 정확히 소진 → 무중복 가능)
ALLOC_BY_TYPE = {'cycle': (1, 1, 2), 'diam': (0, 2, 2), 'tri': (0, 4, 0)}

pairs = [(GROUPS[i], GROUPS[j]) for i in range(6) for j in range(i + 1, 6)]
alloc = {}  # (g1,g2) -> (w, m, x)
for (a, b) in pairs:
    w, m, x = ALLOC_BY_TYPE[edge_type(a, b)]
    assert w + m + x == 4
    alloc[(a, b)] = (w, m, x)

# 검증: 행 합
for g in GROUPS:
    sw = sm = sx = 0
    for (a, b), (w, m, x) in alloc.items():
        if g in (a, b):
            sw += w; sm += m; sx += x
    assert (sw, sm, sx) == (2, 12, 6), (g, sw, sm, sx)

# ---- Phase 2: 경기 생성 ----
# 각 조의 타입별 슬롯(상대조 목록)에 페어 라벨을 균등 배정
# 여복: 슬롯 2개 모두 (1,2)
# 남복: 슬롯 6개 -> {34,35,45} 각 2회
# 혼복: 슬롯 12개 -> 6종 각 2회

def assign_constrained(parts, pool, copies, rnd):
    """parts: [(slot_idx, side, opp_group)] -> {(slot_idx,side): pair}
    제약: 각 페어를 copies회씩 사용 + 같은 상대 조에는 동일 페어 1회만(=한 페어는 서로 다른 조로)."""
    target = {p: copies for p in pool}
    used_in_opp = {}   # opp_group -> set(pair)
    assign = {}
    order = parts[:]
    rnd.shuffle(order)
    # 가장 제약 심한(슬롯 적은 조) 먼저 처리하면 백트래킹 효율↑
    opp_count = {}
    for (_, _, opp) in order:
        opp_count[opp] = opp_count.get(opp, 0) + 1
    order.sort(key=lambda t: -opp_count[t[2]])

    def bt(k):
        if k == len(order):
            return True
        si, side, opp = order[k]
        cands = [p for p in pool if target[p] > 0 and p not in used_in_opp.get(opp, set())]
        rnd.shuffle(cands)
        cands.sort(key=lambda p: -target[p])   # 남은 횟수 많은 페어 먼저 → 분산
        for p in cands:
            target[p] -= 1
            used_in_opp.setdefault(opp, set()).add(p)
            assign[(si, side)] = p
            if bt(k + 1):
                return True
            del assign[(si, side)]
            used_in_opp[opp].discard(p)
            target[p] += 1
        return False

    return assign if bt(0) else None

def build_matches(seed):
    rnd = random.Random(seed)
    # 타입별 조-쌍 슬롯 리스트
    slots = {'yeo': [], 'hon': [], 'nam': []}
    for (a, b), (w, m, x) in alloc.items():
        slots['yeo'] += [(a, b)] * w
        slots['hon'] += [(a, b)] * m
        slots['nam'] += [(a, b)] * x

    def assign_labels(type_key, pool):
        slist = slots[type_key]
        part = {g: [] for g in GROUPS}
        for i, (a, b) in enumerate(slist):
            part[a].append((i, 'a', b))   # a의 상대 조 = b
            part[b].append((i, 'b', a))   # b의 상대 조 = a
        side_label = {}
        for g in GROUPS:
            res = assign_constrained(part[g], pool, 2, rnd)
            if res is None:
                return None
            side_label.update(res)
        out = []
        for i, (a, b) in enumerate(slist):
            out.append((a, side_label[(i, 'a')], b, side_label[(i, 'b')], type_key))
        return out

    matches = []
    for tk, pool in [('yeo', YEO), ('hon', HON), ('nam', NAM)]:
        part_m = assign_labels(tk, pool)
        if part_m is None:
            return None
        matches += part_m
    return matches

# ---- Phase 3: 라운드 스케줄링 (12라운드 x 5코트, 라운드 내 중복 출전 금지) ----
def players_of(match):
    a, pa, b, pb, t = match
    return [pid(a, pa[0]), pid(a, pa[1]), pid(b, pb[0]), pid(b, pb[1])]

def schedule(matches, seed, restarts=4000):
    M = len(matches)
    mplayers = [set(players_of(m)) for m in matches]
    # 충돌 그래프
    conflict = [set() for _ in range(M)]
    for i in range(M):
        for j in range(i + 1, M):
            if mplayers[i] & mplayers[j]:
                conflict[i].add(j)
                conflict[j].add(i)
    deg = [len(conflict[i]) for i in range(M)]
    NR = 12
    CAP = 5
    base_order = sorted(range(M), key=lambda i: -deg[i])

    rnd = random.Random(seed)
    for attempt in range(restarts):
        # 약간의 랜덤성: 동일 degree 그룹 셔플
        order = base_order[:]
        # 가벼운 perturbation
        for _ in range(rnd.randint(0, 8)):
            i = rnd.randrange(M); j = rnd.randrange(M)
            order[i], order[j] = order[j], order[i]

        color = [-1] * M
        round_count = [0] * NR
        round_players = [set() for _ in range(NR)]

        def backtrack(pos):
            if pos == M:
                return True
            mi = order[pos]
            rounds = list(range(NR))
            rnd.shuffle(rounds)
            # 가장 덜 찬 라운드 우선 (균등화) + 랜덤
            rounds.sort(key=lambda r: round_count[r])
            for r in rounds:
                if round_count[r] >= CAP:
                    continue
                if round_players[r] & mplayers[mi]:
                    continue
                color[mi] = r
                round_count[r] += 1
                before = mplayers[mi]
                round_players[r] |= before
                if backtrack(pos + 1):
                    return True
                color[mi] = -1
                round_count[r] -= 1
                round_players[r] -= before
            return False

        # 재귀 한계 회피용 반복 백트래킹은 생략(깊이 60 OK)
        import sys
        sys.setrecursionlimit(10000)
        if backtrack(0):
            return color
    return None

# ---- 실행 & 검증 ----
def verify(matches, color):
    # 각 페어 2회
    from collections import Counter
    paircnt = Counter()
    for (a, pa, b, pb, t) in matches:
        paircnt[(a, pa)] += 1
        paircnt[(b, pb)] += 1
    for g in GROUPS:
        for p in YEO + HON + NAM:
            assert paircnt[(g, p)] == 2, (g, p, paircnt[(g, p)])
    # 개인 8경기
    pc = Counter()
    for m in matches:
        for pl in players_of(m):
            pc[pl] += 1
    for g in GROUPS:
        for n in range(1, 6):
            assert pc[(g, n)] == 8, ((g, n), pc[(g, n)])
    # 조-쌍 4경기
    gp = Counter()
    for (a, pa, b, pb, t) in matches:
        gp[tuple(sorted((a, b)))] += 1
    for (a, b) in pairs:
        assert gp[(a, b)] == 4, ((a, b), gp[(a, b)])
    # 타입 매칭
    for (a, pa, b, pb, t) in matches:
        def typ(p):
            if p in YEO: return 'yeo'
            if p in HON: return 'hon'
            return 'nam'
        assert typ(pa) == typ(pb) == t
    # 라운드 중복 없음 + 라운드당 5경기
    rc = Counter()
    rp = {r: [] for r in range(12)}
    for i, m in enumerate(matches):
        rc[color[i]] += 1
        rp[color[i]] += players_of(m)
    for r in range(12):
        assert rc[r] == 5, (r, rc[r])
        assert len(rp[r]) == len(set(rp[r])), r
    # 신규: 한 페어는 같은 상대 조를 두 번 만나지 않음 (Rule X)
    pair_opps = {}
    for (a, pa, b, pb, t) in matches:
        pair_opps.setdefault((a, pa), []).append(b)
        pair_opps.setdefault((b, pb), []).append(a)
    for k, opps in pair_opps.items():
        assert len(opps) == 2 and opps[0] != opps[1], (k, opps)
    return True

import math
from collections import Counter as _C

def meet_keys(m):
    a, pa, b, pb, t = m
    return (tuple(sorted([(a, pa[0]), (b, pb[0])])),
            tuple(sorted([(a, pa[0]), (b, pb[1])])),
            tuple(sorted([(a, pa[1]), (b, pb[0])])),
            tuple(sorted([(a, pa[1]), (b, pb[1])])))

def score_repeats(ms):
    """잔여 개인-개인 재대결(2회 이상) 쌍 수 — 작을수록 공정."""
    opp = _C()
    for m in ms:
        for k in meet_keys(m):
            opp[k] += 1
    return sum(1 for v in opp.values() if v > 1)

PIDX = {(g, n): idx[g] * 5 + (n - 1) for g in GROUPS for n in range(1, 6)}

def anneal(matches, seed, iters=250000):
    """Rule X(페어→서로 다른 조)·각종 카운트를 보존하면서 라벨을 교환해
    잔여 개인 재대결을 최소화하는 담금질. 30x30 정수 카운트로 고속화."""
    rnd = random.Random(98765 + seed)
    M = [list(m) for m in matches]            # [a,pa,b,pb,t]
    part = {g: [] for g in GROUPS}            # g -> [(idx, label_pos, opp, type)]
    for i, (a, pa, b, pb, t) in enumerate(M):
        part[a].append((i, 1, b, t))
        part[b].append((i, 3, a, t))
    cnt = [[0] * 30 for _ in range(30)]
    repeats = 0

    def mpairs(i):
        a, pa, b, pb, t = M[i]
        a0, a1 = PIDX[(a, pa[0])], PIDX[(a, pa[1])]
        b0, b1 = PIDX[(b, pb[0])], PIDX[(b, pb[1])]
        out = []
        for u in (a0, a1):
            for v in (b0, b1):
                out.append((u, v) if u < v else (v, u))
        return out

    def touch(i, d):
        nonlocal repeats
        for (u, v) in mpairs(i):
            c = cnt[u][v]
            if d > 0:
                cnt[u][v] = c + 1
                if c + 1 == 2:
                    repeats += 1
            else:
                if c == 2:
                    repeats -= 1
                cnt[u][v] = c - 1

    for i in range(len(M)):
        touch(i, +1)
    used = {}   # (g,type,opp) -> set(pair)
    for g in GROUPS:
        for (i, pos, opp, t) in part[g]:
            used.setdefault((g, t, opp), set()).add(M[i][pos])

    best, bestM = repeats, [list(m) for m in M]
    T = 1.8
    for _ in range(iters):
        g = rnd.choice(GROUPS)
        pl = part[g]
        i1, pos1, o1, t1 = pl[rnd.randrange(len(pl))]
        i2, pos2, o2, t2 = pl[rnd.randrange(len(pl))]
        if i1 == i2 or t1 != t2 or o1 == o2:
            continue
        l1, l2 = M[i1][pos1], M[i2][pos2]
        if l1 == l2:
            continue
        if l2 in used[(g, t1, o1)] or l1 in used[(g, t1, o2)]:  # Rule X 위반
            continue
        before = repeats
        touch(i1, -1); touch(i2, -1)
        M[i1][pos1], M[i2][pos2] = l2, l1
        touch(i1, +1); touch(i2, +1)
        d = repeats - before
        if d <= 0 or rnd.random() < math.exp(-d / T):
            us1 = used[(g, t1, o1)]; us2 = used[(g, t1, o2)]
            us1.discard(l1); us1.add(l2)
            us2.discard(l2); us2.add(l1)
            if repeats < best:
                best, bestM = repeats, [list(m) for m in M]
        else:
            touch(i1, -1); touch(i2, -1)
            M[i1][pos1], M[i2][pos2] = l1, l2
            touch(i1, +1); touch(i2, +1)
        T *= 0.99998
    return [tuple(m) for m in bestM], best

# 솔루션 캐시 (담금질이 무거우므로 재실행 시 재사용; 생성 로직 변경 시 캐시 삭제)
import os, pickle
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bracket_sol.pkl')

if os.path.exists(CACHE):
    with open(CACHE, 'rb') as f:
        matches, color = pickle.load(f)
    verify(matches, color)
    print(f"캐시 로드: 잔여 재대결={score_repeats(matches)}건")
else:
    # 생성 → 담금질로 잔여 재대결 최소화 → 스케줄
    best_pack = None
    for seed in range(10):
        m0 = build_matches(seed)
        if m0 is None:
            continue
        m1, sc = anneal(m0, seed)
        print(f"  seed={seed} anneal -> {sc}")
        if best_pack is None or sc < best_pack[0]:
            best_pack = (sc, seed, m1)
        if best_pack[0] <= 10:
            break
    print(f"담금질 후 최소 잔여 재대결 = {best_pack[0]}")

    sol = None
    matches = best_pack[2]
    for sd in range(400):
        color = schedule(matches, sd)
        if color is not None:
            verify(matches, color)
            sol = (matches, color)
            print(f"SOLVED sched_seed={sd}, 잔여 재대결={best_pack[0]}건")
            break
    if sol is None:
        print("NO SOLUTION FOUND")
        raise SystemExit(1)
    matches, color = sol
    with open(CACHE, 'wb') as f:
        pickle.dump((matches, color), f)

# ---- 출력: 라운드 x 코트 표 (조번호 표기) ----
def cell(m):
    a, pa, b, pb, t = m
    return f"{a}{pa[0]}·{a}{pa[1]} vs {b}{pb[0]}·{b}{pb[1]}"

# 라운드별 코트 배정
rounds = {r: [] for r in range(12)}
for i, m in enumerate(matches):
    rounds[color[i]].append(m)

# 고정칸(심유진·김길환 vs 송수민·김태혁 = C{1,3} vs D{1,4})은 R10 코트4(index 3)로 정렬 — 마크다운과 일치
def _is_pin(m):
    return set(players_of(m)) == {('C', 1), ('C', 3), ('D', 1), ('D', 4)}
for r in range(12):
    pins = [m for m in rounds[r] if _is_pin(m)]
    if pins and r == 9:
        m = pins[0]
        rounds[r].remove(m)
        rounds[r].insert(3, m)

print("\n=== 코드(조+번호) 표기 ===")
print("라운드 | 코트1 | 코트2 | 코트3 | 코트4 | 코트5")
for r in range(12):
    ms = rounds[r]
    cells = [cell(m) for m in ms]
    print(f"R{r+1:>2} | " + " | ".join(cells))

# ---- 출력: 이름 표기 ----
def cell_name(m):
    a, pa, b, pb, t = m
    return (f"{NAMES[a][pa[0]]}·{NAMES[a][pa[1]]} vs "
            f"{NAMES[b][pb[0]]}·{NAMES[b][pb[1]]}")

print("\n=== 이름 표기 ===")
for r in range(12):
    print(f"--- 라운드 {r+1} ---")
    for ci, m in enumerate(rounds[r]):
        t = {'yeo': '여복', 'hon': '혼복', 'nam': '남복'}[m[4]]
        print(f"  코트{ci+1} [{t}] {cell_name(m)}")

# ---- 통계 ----
from collections import Counter
print("\n=== 검증 통계 ===")
print(f"총 경기수: {len(matches)} (기대 60)")
pc = Counter()
for m in matches:
    for pl in players_of(m):
        pc[pl] += 1
print("개인 경기수 모두 8:", all(v == 8 for v in pc.values()))
# 휴식 분포
rest = {}
for g in GROUPS:
    for n in range(1, 6):
        played = set(color[i] for i, m in enumerate(matches) if (g, n) in players_of(m))
        rest[(g, n)] = sorted(set(range(12)) - played)
maxgap = 0
for k, restrounds in rest.items():
    played = sorted(set(range(12)) - set(restrounds))
    gaps = [played[i+1]-played[i] for i in range(len(played)-1)]
    if gaps: maxgap = max(maxgap, max(gaps))
print(f"개인별 최대 연속 대기(라운드 간격) 최댓값: {maxgap}")

# 페어 -> 서로 다른 상대 조 검증 + 잔여 개인 재대결(룰상 불가피한 여복발) 집계
pair_opps = {}
for (a, pa, b, pb, t) in matches:
    pair_opps.setdefault((a, pa), []).append(b)
    pair_opps.setdefault((b, pb), []).append(a)
samegrp = sum(1 for o in pair_opps.values() if o[0] == o[1])
print(f"같은 상대 조를 두 번 만나는 페어 수: {samegrp} (기대 0)")

opp_meet = Counter()
for (a, pa, b, pb, t) in matches:
    for xx in [(a, pa[0]), (a, pa[1])]:
        for yy in [(b, pb[0]), (b, pb[1])]:
            opp_meet[frozenset([xx, yy])] += 1
reps = [k for k, v in opp_meet.items() if v > 1]
def gender(p):
    return '여' if p[1] <= 2 else '남'
ww = sum(1 for k in reps if all(gender(p) == '여' for p in k))
mm = sum(1 for k in reps if all(gender(p) == '남' for p in k))
print(f"개인-개인 재대결(2회) 쌍: {len(reps)}건  (여-여 {ww} / 남-남 {mm} / 혼성 {len(reps)-ww-mm})")

# ============================================================
# HTML 대진표 생성
# ============================================================
TYPE_KO = {'yeo': '여복', 'hon': '혼복', 'nam': '남복'}
TYPE_CLS = {'yeo': 'w', 'hon': 'm', 'nam': 'n'}

def code(g, n):
    return f"{g}{n}"

# 선수별 출전 라운드
player_rounds = {(g, n): [] for g in GROUPS for n in range(1, 6)}
for i, m in enumerate(matches):
    for (gg, nn) in players_of(m):
        player_rounds[(gg, nn)].append(color[i] + 1)
for k in player_rounds:
    player_rounds[k] = sorted(player_rounds[k])

CSS = """
<style>
:root{
  --bg:#FBFCFA; --panel:#FFFFFF; --ink:#15201A; --muted:#5E6E64;
  --line:#E2E8E2; --line2:#EEF2EE; --accent:#1C7A48; --accent-deep:#115C34;
  --w-tx:#B0306A; --w-bg:#FAE9F0; --w-bd:#F1CCDD;
  --m-tx:#9A6711; --m-bg:#FAF1DA; --m-bd:#EDDFB4;
  --n-tx:#2360A8; --n-bg:#E7F0FA; --n-bd:#CDDFF2;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:"Apple SD Gothic Neo","Pretendard",-apple-system,system-ui,"Malgun Gothic",sans-serif;
  line-height:1.5;-webkit-font-smoothing:antialiased;}
.wrap{max-width:1040px;margin:0 auto;padding:40px 28px 80px;}
.mono{font-family:ui-monospace,"SF Mono",Menlo,"Cascadia Code",monospace;font-variant-numeric:tabular-nums;}

/* masthead */
.mast{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;
  flex-wrap:wrap;padding-bottom:22px;border-bottom:2px solid var(--ink);}
.mast .kicker{font-size:12px;letter-spacing:.22em;text-transform:uppercase;
  color:var(--accent);font-weight:700;margin-bottom:8px;}
.mast h1{margin:0;font-size:31px;font-weight:800;letter-spacing:-.02em;line-height:1.05;}
.mast h1 small{display:block;font-size:14px;font-weight:500;color:var(--muted);letter-spacing:0;margin-top:7px;}
.stats{display:flex;gap:10px;flex-wrap:wrap;}
.stat{border:1px solid var(--line);border-radius:9px;background:var(--panel);
  padding:8px 13px;text-align:center;min-width:62px;}
.stat b{display:block;font-size:20px;font-weight:800;letter-spacing:-.01em;}
.stat span{font-size:11px;color:var(--muted);letter-spacing:.04em;}

/* sections */
section{margin-top:44px;}
.sec-head{display:flex;align-items:baseline;gap:12px;margin-bottom:16px;}
.sec-head .no{font-family:ui-monospace,monospace;font-size:12px;color:var(--accent);
  font-weight:700;border:1px solid var(--n-bd);border-color:#CFE2D4;border-radius:6px;
  padding:2px 7px;background:#EEF6F0;}
.sec-head h2{margin:0;font-size:18px;font-weight:800;letter-spacing:-.01em;}
.sec-head p{margin:0;color:var(--muted);font-size:13px;}

/* roster */
.roster{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}
.gcard{border:1px solid var(--line);border-radius:11px;background:var(--panel);overflow:hidden;}
.gcard h3{margin:0;padding:9px 13px;font-size:14px;font-weight:800;
  background:var(--accent);color:#fff;letter-spacing:.02em;
  display:flex;justify-content:space-between;align-items:center;}
.gcard h3 span{font-weight:500;font-size:11px;opacity:.85;}
.gcard ul{list-style:none;margin:0;padding:6px 0;}
.gcard li{display:flex;align-items:center;gap:9px;padding:4px 13px;font-size:13.5px;}
.gcard li .pos{font-family:ui-monospace,monospace;font-size:11px;width:20px;text-align:center;
  border-radius:4px;padding:1px 0;font-weight:700;flex:none;}
.pos.f{background:var(--w-bg);color:var(--w-tx);}
.pos.mm{background:var(--n-bg);color:var(--n-tx);}

/* grid table */
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:11px;background:var(--panel);}
table.grid{border-collapse:collapse;width:100%;min-width:760px;}
table.grid th,table.grid td{border-bottom:1px solid var(--line2);padding:9px 11px;text-align:left;}
table.grid thead th{background:#F2F6F2;font-size:11px;letter-spacing:.08em;color:var(--muted);
  font-weight:700;text-transform:uppercase;border-bottom:1px solid var(--line);}
table.grid tbody tr:last-child td{border-bottom:none;}
table.grid td.rd{font-weight:800;color:var(--accent-deep);background:#F7FAF7;
  font-family:ui-monospace,monospace;width:48px;}
table.grid td.code{font-family:ui-monospace,monospace;font-size:13px;white-space:nowrap;}
table.grid td.code .vs{color:var(--muted);font-size:11px;padding:0 3px;}

/* round cards */
.rounds{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;}
.rcard{border:1px solid var(--line);border-radius:12px;background:var(--panel);
  overflow:hidden;break-inside:avoid;}
.rcard .rh{display:flex;align-items:baseline;gap:9px;padding:10px 14px;
  border-bottom:1px solid var(--line);background:#F7FAF7;}
.rcard .rh b{font-family:ui-monospace,monospace;font-size:15px;font-weight:800;color:var(--accent-deep);}
.rcard .rh span{font-size:12.5px;color:var(--muted);}
.rcard .crt{display:grid;grid-template-columns:24px 40px 1fr;align-items:center;gap:9px;
  padding:8px 14px;border-bottom:1px solid var(--line2);font-size:13.5px;}
.rcard .crt:last-child{border-bottom:none;}
.rcard .cn{font-family:ui-monospace,monospace;font-size:11px;color:var(--muted);font-weight:700;}
.chip{font-size:10.5px;font-weight:700;text-align:center;border-radius:5px;padding:2px 0;letter-spacing:.02em;}
.chip.w{background:var(--w-bg);color:var(--w-tx);border:1px solid var(--w-bd);}
.chip.m{background:var(--m-bg);color:var(--m-tx);border:1px solid var(--m-bd);}
.chip.n{background:var(--n-bg);color:var(--n-tx);border:1px solid var(--n-bd);}
.match .vs{color:var(--muted);font-size:11px;padding:0 5px;font-weight:600;}
.match .tm{font-weight:600;}

/* player schedule */
.psched{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;}
.pcard{border:1px solid var(--line);border-radius:11px;background:var(--panel);overflow:hidden;}
.pcard h4{margin:0;padding:7px 12px;font-size:12.5px;font-weight:800;color:#fff;background:var(--accent-deep);}
.pcard table{border-collapse:collapse;width:100%;}
.pcard td{padding:4px 12px;font-size:12.5px;border-bottom:1px solid var(--line2);}
.pcard tr:last-child td{border-bottom:none;}
.pcard td.nm{font-weight:600;white-space:nowrap;}
.pcard td.rs{font-family:ui-monospace,monospace;font-size:11px;color:var(--muted);text-align:right;}

.legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--muted);}
.legend .li{display:flex;align-items:center;gap:6px;}

/* principles */
.rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:22px;}
.rule{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;
  background:var(--panel);padding:10px 13px;}
.rule .t{font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:7px;}
.rule .t .ck{color:var(--accent);font-weight:800;}
.rule .d{font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.45;}
.rule.warn{border-left-color:var(--m-tx);}
.rule.warn .ck{color:var(--m-tx);}
.foot{margin-top:54px;padding-top:18px;border-top:1px solid var(--line);
  font-size:12px;color:var(--muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;}

@media (max-width:560px){
  .wrap{padding:26px 16px 60px;}
  .mast h1{font-size:25px;}
}
@media print{
  body{background:#fff;}
  .wrap{max-width:none;padding:0;}
  section{margin-top:28px;}
  .rcard,.gcard,.pcard,.tablewrap{break-inside:avoid;box-shadow:none;}
}
</style>
"""

def build_html():
    parts = ['<title>배드민턴 복식 대진표</title>', CSS, '<div class="wrap">']
    # masthead
    parts.append('''
<header class="mast">
  <div>
    <div class="kicker">Badminton · 복식 토너먼트</div>
    <h1>대진표
      <small>6개 조 · 페어별 2회 · 1인 8경기 · 조별 상대 4경기 균등 편성</small>
    </h1>
  </div>
  <div class="stats">
    <div class="stat"><b>30</b><span>선수</span></div>
    <div class="stat"><b>60</b><span>경기</span></div>
    <div class="stat"><b>12</b><span>라운드</span></div>
    <div class="stat"><b>5</b><span>코트</span></div>
  </div>
</header>''')

    # 편성 원칙 / 공정성
    parts.append(f'''
<div class="rules">
  <div class="rule"><div class="t"><span class="ck">✓</span> 페어 2회 · 1인 8경기</div>
    <div class="d">조마다 10개 페어를 각 2회씩 사용 → 전원 정확히 8경기.</div></div>
  <div class="rule"><div class="t"><span class="ck">✓</span> 조별 상대 4경기 균등</div>
    <div class="d">자기 조 제외 5개 조와 각 4경기. 타입(여복·혼복·남복)끼리만 대결.</div></div>
  <div class="rule"><div class="t"><span class="ck">✓</span> 같은 페어의 상대 재회 0건</div>
    <div class="d">모든 페어의 2회를 서로 다른 조에 배정 — 한 페어가 같은 상대(개인·페어)를 두 번 만나지 않음.</div></div>
  <div class="rule warn"><div class="t"><span class="ck">≈</span> 개인 재대결 {len(reps)}건 (불가피분)</div>
    <div class="d">여–여 {ww} (이론상 최소) · 남–남 {mm} · 혼성 {len(reps)-ww-mm}. ‘페어 2회+여복 규칙’상 두 사람이 다른 페어로 재회하는 건 0으로 만들 수 없어 최소화함.</div></div>
</div>''')

    # roster
    parts.append('<section><div class="sec-head"><span class="no">01</span><h2>조 편성</h2>'
                 '<p>1·2번 여자 · 3·4·5번 남자</p></div><div class="roster">')
    for g in GROUPS:
        parts.append(f'<div class="gcard"><h3>{g}조 <span>5명</span></h3><ul>')
        for n in range(1, 6):
            cls = 'f' if n <= 2 else 'mm'
            parts.append(f'<li><span class="pos {cls}">{n}</span>{NAMES[g][n]}</li>')
        parts.append('</ul></div>')
    parts.append('</div></section>')

    # code grid
    parts.append('<section><div class="sec-head"><span class="no">02</span><h2>코드 대진표</h2>'
                 '<p>가로 = 코트 · 세로 = 라운드 · 표기 <span class="mono">조번호·조번호 vs 조번호·조번호</span></p></div>')
    parts.append('<div class="tablewrap"><table class="grid"><thead><tr><th>R</th>'
                 + ''.join(f'<th>코트 {c}</th>' for c in range(1, 6))
                 + '</tr></thead><tbody>')
    for r in range(12):
        parts.append(f'<tr><td class="rd">{r+1}</td>')
        for m in rounds[r]:
            a, pa, b, pb, t = m
            parts.append(f'<td class="code">{code(a,pa[0])}·{code(a,pa[1])}'
                         f'<span class="vs">vs</span>{code(b,pb[0])}·{code(b,pb[1])}</td>')
        parts.append('</tr>')
    parts.append('</tbody></table></div></section>')

    # round cards (names)
    parts.append('<section><div class="sec-head"><span class="no">03</span><h2>라운드별 경기 (선수명)</h2>'
                 '<p>앞 두 명이 한 팀</p></div>')
    parts.append('<div class="legend">'
                 '<span class="li"><span class="chip w" style="width:34px">여복</span> 여자복식</span>'
                 '<span class="li"><span class="chip m" style="width:34px">혼복</span> 혼합복식</span>'
                 '<span class="li"><span class="chip n" style="width:34px">남복</span> 남자복식</span></div>')
    parts.append('<div class="rounds" style="margin-top:14px">')
    for r in range(12):
        parts.append(f'<div class="rcard"><div class="rh"><b>R{r+1}</b><span>라운드 {r+1}</span></div>')
        for ci, m in enumerate(rounds[r]):
            a, pa, b, pb, t = m
            cls = TYPE_CLS[t]; ko = TYPE_KO[t]
            t1 = f'{NAMES[a][pa[0]]}·{NAMES[a][pa[1]]}'
            t2 = f'{NAMES[b][pb[0]]}·{NAMES[b][pb[1]]}'
            parts.append(f'<div class="crt"><span class="cn">C{ci+1}</span>'
                         f'<span class="chip {cls}">{ko}</span>'
                         f'<span class="match"><span class="tm">{t1}</span>'
                         f'<span class="vs">vs</span><span class="tm">{t2}</span></span></div>')
        parts.append('</div>')
    parts.append('</div></section>')

    # player schedule
    parts.append('<section><div class="sec-head"><span class="no">04</span><h2>선수별 출전 라운드</h2>'
                 '<p>각 8경기</p></div><div class="psched">')
    for g in GROUPS:
        parts.append(f'<div class="pcard"><h4>{g}조</h4><table>')
        for n in range(1, 6):
            rs = ' '.join(f'{x}' for x in player_rounds[(g, n)])
            parts.append(f'<tr><td class="nm">{NAMES[g][n]}</td>'
                         f'<td class="rs">{rs}</td></tr>')
        parts.append('</table></div>')
    parts.append('</div></section>')

    parts.append('<div class="foot"><span>배드민턴 복식 대진표</span>'
                 '<span>여복 6 · 혼복 36 · 남복 18 = 60경기</span></div>')
    parts.append('</div>')
    return '\n'.join(parts)

with open('bracket.html', 'w', encoding='utf-8') as f:
    f.write(build_html())
print("\nHTML written: bracket.html")
