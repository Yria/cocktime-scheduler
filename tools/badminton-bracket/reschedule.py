# -*- coding: utf-8 -*-
# 경기 조합(matches)은 그대로, 라운드 배치(color)만 재편성해 개인 연속 출전을 최소화.
# 페어/조쌍/타입/Rule X/재대결은 matches에만 의존 → 전부 보존. 스케줄 제약(5/라운드·중복0)만 재구성.
import random, math, pickle, os
from collections import Counter

GROUPS = ['A', 'B', 'C', 'D', 'E', 'F']
NAMES = {
    'A': {1: '박현아', 2: '이한비', 3: '오상진', 4: '오용진', 5: '차성민'},
    'B': {1: '김주영', 2: '황영민', 3: '남필립', 4: '손형일', 5: '이재원'},
    'C': {1: '심유진', 2: '윤지윤', 3: '김길환', 4: '심상욱', 5: '최양회'},
    'D': {1: '송수민', 2: '이지인', 3: '강민규', 4: '김태혁', 5: '우창형'},
    'E': {1: '엄지현', 2: '장한별', 3: '강우석', 4: '송유현', 5: '이후섭'},
    'F': {1: '노보람', 2: '이규웅', 3: '박세경', 4: '이홍희', 5: '정현민'},
}
idx = {g: i for i, g in enumerate(GROUPS)}
def pid(g, n): return idx[g] * 5 + (n - 1)
def pname(pi): return NAMES[GROUPS[pi // 5]][pi % 5 + 1]

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, 'bracket_sol.pkl'), 'rb') as f:
    matches, color = pickle.load(f)
matches = [tuple(m) for m in matches]
M = len(matches)

def players_of(m):
    a, pa, b, pb, t = m
    return [pid(a, pa[0]), pid(a, pa[1]), pid(b, pb[0]), pid(b, pb[1])]
mp = [players_of(m) for m in matches]

PIN_PLAYERS = {pid('C', 1), pid('C', 3), pid('D', 1), pid('D', 4)}
pin_idx = next(i for i in range(M) if set(mp[i]) == PIN_PLAYERS and color[i] == 9)
WEIGHT = {pid('F', 4): 3.0, pid('A', 5): 3.0}  # 이홍희·차성민 가중

def streaks(bits):
    runs = []; cur = 0
    for r in range(12):
        if bits[r] > 0: cur += 1
        elif cur: runs.append(cur); cur = 0
    if cur: runs.append(cur)
    return runs
def pen_row(bits):
    return sum((s - 2) ** 2 for s in streaks(bits) if s > 2)

def report(col, tag):
    pc = [[0] * 12 for _ in range(30)]
    for i in range(M):
        for p in mp[i]:
            pc[p][col[i]] += 1
    dist = Counter(); worst = []
    for p in range(30):
        mx = max(streaks(pc[p]))
        dist[mx] += 1
        worst.append((mx, p, [r + 1 for r in range(12) if pc[p][r]]))
    worst.sort(reverse=True)
    print(f"[{tag}] 최대연속 분포: " + ", ".join(f"{k}연속×{dist[k]}명" for k in sorted(dist, reverse=True)))
    for mx, p, rs in worst[:4]:
        print(f"    {pname(p)}({GROUPS[p//5]}{p%5+1}) 최대{mx}연속 R{rs}")
    for tp, lab in [(pid('F', 4), '이홍희'), (pid('A', 5), '차성민')]:
        print(f"  ▶ {lab}: 최대{max(streaks(pc[tp]))}연속 runs{streaks(pc[tp])} R{[r+1 for r in range(12) if pc[tp][r]]}")

report(color, "현재")

BIG = 40.0  # 이동=두 경기 라운드 맞교환(5/라운드 자동보존) → 중복출전 벌점만 관리
def W(p): return WEIGHT.get(p, 1.0)

def anneal(seed, iters=2500000):
    rnd = random.Random(seed)
    col = list(color)
    pcnt = [[0] * 12 for _ in range(30)]
    for i in range(M):
        for p in mp[i]:
            pcnt[p][col[i]] += 1
    conf = sum(max(0, pcnt[p][r] - 1) for p in range(30) for r in range(12))
    pen = [W(p) * pen_row(pcnt[p]) for p in range(30)]
    soft = sum(pen)
    best = soft if conf == 0 else None
    bestcol = list(col) if conf == 0 else None

    T = 30.0
    cooling = 0.9999985
    for _ in range(iters):
        i = rnd.randrange(M); j = rnd.randrange(M)
        if i == j or i == pin_idx or j == pin_idx:
            continue
        ri, rj = col[i], col[j]
        if ri == rj:
            continue
        aff = set(mp[i]) | set(mp[j])
        cells = set()
        for p in mp[i]:
            cells.add((p, ri)); cells.add((p, rj))
        for p in mp[j]:
            cells.add((p, rj)); cells.add((p, ri))
        old_c = sum(max(0, pcnt[p][r] - 1) for (p, r) in cells)
        old_pen = {p: pen[p] for p in aff}
        for p in mp[i]:
            pcnt[p][ri] -= 1; pcnt[p][rj] += 1
        for p in mp[j]:
            pcnt[p][rj] -= 1; pcnt[p][ri] += 1
        new_c = sum(max(0, pcnt[p][r] - 1) for (p, r) in cells)
        d_conf = new_c - old_c
        newpen = {p: W(p) * pen_row(pcnt[p]) for p in aff}
        d_soft = sum(newpen[p] - old_pen[p] for p in aff)
        d = BIG * d_conf + d_soft
        if d <= 0 or rnd.random() < math.exp(-d / T):
            col[i], col[j] = rj, ri
            conf += d_conf; soft += d_soft
            for p in aff:
                pen[p] = newpen[p]
            if conf == 0 and (best is None or soft < best):
                best, bestcol = soft, list(col)
        else:
            for p in mp[i]:
                pcnt[p][ri] += 1; pcnt[p][rj] -= 1
            for p in mp[j]:
                pcnt[p][rj] += 1; pcnt[p][ri] -= 1
        T *= cooling
    return best, bestcol

best = None; bestcol = None
for s in range(8):
    b, c = anneal(s)
    if c is not None and (best is None or b < best):
        best, bestcol = b, c
    print(f"  seed={s} best soft={b}")

assert bestcol is not None, "유효 스케줄 못 찾음"
color2 = bestcol
print()
report(color2, "재배치 후")

# ---- 검증 ----
def verify(col):
    rc = Counter(); rpl = {r: [] for r in range(12)}
    for i in range(M):
        rc[col[i]] += 1; rpl[col[i]] += mp[i]
    for r in range(12):
        assert rc[r] == 5, (r, rc[r])
        assert len(rpl[r]) == len(set(rpl[r])), r
    assert col[pin_idx] == 9
verify(color2)
print("\n검증 통과 ✓ (5/라운드·중복0·핀 R10 유지 · 조합 불변)")

with open(os.path.join(here, 'bracket_sol.pkl'), 'wb') as f:
    pickle.dump((matches, color2), f)
print("캐시 갱신 → bracket.py / gen_md.py 재실행하면 반영")
