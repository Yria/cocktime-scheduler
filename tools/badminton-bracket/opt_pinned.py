# -*- coding: utf-8 -*-
# R10 코트4 = 심유진·김길환(C{1,3}) vs 송수민·김태혁(D{1,4}) 고정 + 전체 재담금질로 잔여 재대결 최소화.
import random, math, sys, pickle, os
from collections import Counter

sys.setrecursionlimit(10000)

GROUPS = ['A', 'B', 'C', 'D', 'E', 'F']
NAMES = {
    'A': {1: '박현아', 2: '이한비', 3: '오상진', 4: '오용진', 5: '차성민'},
    'B': {1: '김주영', 2: '황영민', 3: '남필립', 4: '손형일', 5: '이재원'},
    'C': {1: '심유진', 2: '윤지윤', 3: '김길환', 4: '심상욱', 5: '최양회'},
    'D': {1: '송수민', 2: '이지인', 3: '강민규', 4: '김태혁', 5: '우창형'},
    'E': {1: '엄지현', 2: '장한별', 3: '강우석', 4: '송유현', 5: '이후섭'},
    'F': {1: '노보람', 2: '이규웅', 3: '박세경', 4: '이홍희', 5: '정현민'},
}
YEO = [(1, 2)]
HON = [(1, 3), (1, 4), (1, 5), (2, 3), (2, 4), (2, 5)]
NAM = [(3, 4), (3, 5), (4, 5)]
TYPE_KO = {'yeo': '여복', 'hon': '혼복', 'nam': '남복'}

def pid(g, n):
    return (g, n)

idx = {g: i for i, g in enumerate(GROUPS)}

def edge_type(a, b):
    d = (idx[a] - idx[b]) % 6
    if d in (1, 5):
        return 'cycle'
    if d == 3:
        return 'diam'
    return 'tri'

ALLOC_BY_TYPE = {'cycle': (1, 1, 2), 'diam': (0, 2, 2), 'tri': (0, 4, 0)}
pairs = [(GROUPS[i], GROUPS[j]) for i in range(6) for j in range(i + 1, 6)]
alloc = {}
for (a, b) in pairs:
    alloc[(a, b)] = ALLOC_BY_TYPE[edge_type(a, b)]

def assign_constrained(parts, pool, copies, rnd, forced=None):
    forced = forced or {}
    target = {p: copies for p in pool}
    used_in_opp = {}
    assign = {}
    rest = []
    for (si, side, opp) in parts:
        key = (si, side)
        if key in forced:
            p = forced[key]
            if target[p] <= 0 or p in used_in_opp.get(opp, set()):
                return None
            target[p] -= 1
            used_in_opp.setdefault(opp, set()).add(p)
            assign[key] = p
        else:
            rest.append((si, side, opp))
    order = rest[:]
    rnd.shuffle(order)
    oc = {}
    for (_, _, opp) in order:
        oc[opp] = oc.get(opp, 0) + 1
    order.sort(key=lambda t: -oc[t[2]])

    def bt(k):
        if k == len(order):
            return True
        si, side, opp = order[k]
        cands = [p for p in pool if target[p] > 0 and p not in used_in_opp.get(opp, set())]
        rnd.shuffle(cands)
        cands.sort(key=lambda p: -target[p])
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
    slots = {'yeo': [], 'hon': [], 'nam': []}
    for (a, b), (w, m, x) in alloc.items():
        slots['yeo'] += [(a, b)] * w
        slots['hon'] += [(a, b)] * m
        slots['nam'] += [(a, b)] * x
    cd_i = slots['hon'].index(('C', 'D'))  # C-D 혼복은 유일(cycle edge m=1)

    def assign_labels(type_key, pool, forced_by_group=None):
        forced_by_group = forced_by_group or {}
        slist = slots[type_key]
        part = {g: [] for g in GROUPS}
        for i, (a, b) in enumerate(slist):
            part[a].append((i, 'a', b))
            part[b].append((i, 'b', a))
        side_label = {}
        for g in GROUPS:
            res = assign_constrained(part[g], pool, 2, rnd, forced_by_group.get(g))
            if res is None:
                return None
            side_label.update(res)
        out = []
        for i, (a, b) in enumerate(slist):
            out.append((a, side_label[(i, 'a')], b, side_label[(i, 'b')], type_key))
        return out

    matches = []
    pin_idx = None
    for tk, pool in [('yeo', YEO), ('hon', HON), ('nam', NAM)]:
        fbg = None
        if tk == 'hon':
            fbg = {'C': {(cd_i, 'a'): (1, 3)}, 'D': {(cd_i, 'b'): (1, 4)}}
        pm = assign_labels(tk, pool, fbg)
        if pm is None:
            return None, None
        if tk == 'hon':
            pin_idx = len(matches) + cd_i
        matches += pm
    return matches, pin_idx

def players_of(m):
    a, pa, b, pb, t = m
    return [pid(a, pa[0]), pid(a, pa[1]), pid(b, pb[0]), pid(b, pb[1])]

PIDX = {(g, n): idx[g] * 5 + (n - 1) for g in GROUPS for n in range(1, 6)}

def score_repeats(ms):
    opp = Counter()
    for (a, pa, b, pb, t) in ms:
        for u in [(a, pa[0]), (a, pa[1])]:
            for v in [(b, pb[0]), (b, pb[1])]:
                opp[frozenset([u, v])] += 1
    return sum(1 for v in opp.values() if v > 1)

def anneal(matches, seed, pinned_parts, iters=250000):
    rnd = random.Random(98765 + seed)
    M = [list(m) for m in matches]
    part = {g: [] for g in GROUPS}
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
    used = {}
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
        if (i1, pos1) in pinned_parts or (i2, pos2) in pinned_parts:
            continue  # 고정 슬롯은 라벨 변경 금지
        l1, l2 = M[i1][pos1], M[i2][pos2]
        if l1 == l2:
            continue
        if l2 in used[(g, t1, o1)] or l1 in used[(g, t1, o2)]:
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

def schedule(matches, seed, pin_idx, pin_round, restarts=8000):
    M = len(matches)
    mp = [set(players_of(m)) for m in matches]
    rnd = random.Random(seed)
    base = sorted([i for i in range(M) if i != pin_idx],
                  key=lambda i: -sum(1 for j in range(M) if j != i and mp[i] & mp[j]))
    for _ in range(restarts):
        order = base[:]
        for _ in range(rnd.randint(0, 8)):
            i = rnd.randrange(len(order)); j = rnd.randrange(len(order))
            order[i], order[j] = order[j], order[i]
        color = [-1] * M
        rc = [0] * 12
        rp = [set() for _ in range(12)]
        color[pin_idx] = pin_round
        rc[pin_round] = 1
        rp[pin_round] = set(mp[pin_idx])

        def bt(pos):
            if pos == len(order):
                return True
            mi = order[pos]
            rounds = list(range(12))
            rnd.shuffle(rounds)
            rounds.sort(key=lambda r: rc[r])
            for r in rounds:
                if rc[r] >= 5 or (rp[r] & mp[mi]):
                    continue
                color[mi] = r; rc[r] += 1; rp[r] |= mp[mi]
                if bt(pos + 1):
                    return True
                color[mi] = -1; rc[r] -= 1; rp[r] -= mp[mi]
            return False

        if bt(0):
            return color
    return None

def verify(ms, col):
    pc = Counter()
    for (a, pa, b, pb, t) in ms:
        pc[(a, pa)] += 1; pc[(b, pb)] += 1
    for g in GROUPS:
        for p in YEO + HON + NAM:
            assert pc[(g, p)] == 2, ('pair', g, p)
    ppl = Counter()
    for m in ms:
        for x in players_of(m):
            ppl[x] += 1
    for g in GROUPS:
        for n in range(1, 6):
            assert ppl[(g, n)] == 8, ('person', g, n)
    gp = Counter()
    for (a, pa, b, pb, t) in ms:
        gp[tuple(sorted((a, b)))] += 1
    for i in range(6):
        for j in range(i + 1, 6):
            assert gp[(GROUPS[i], GROUPS[j])] == 4
    def typ(p):
        return 'yeo' if p in YEO else ('hon' if p in HON else 'nam')
    for (a, pa, b, pb, t) in ms:
        assert typ(pa) == typ(pb) == t
    rc = Counter(); rp = {r: [] for r in range(12)}
    for i, m in enumerate(ms):
        rc[col[i]] += 1; rp[col[i]] += players_of(m)
    for r in range(12):
        assert rc[r] == 5
        assert len(rp[r]) == len(set(rp[r]))
    po = {}
    for (a, pa, b, pb, t) in ms:
        po.setdefault((a, pa), []).append(b)
        po.setdefault((b, pb), []).append(a)
    for k, o in po.items():
        assert len(o) == 2 and o[0] != o[1], ('ruleX', k, o)

PIN_ROUND = 9  # 라운드 10

best = None  # (repeats, matches, pin_idx, seed)
for seed in range(20):
    m0, pin_idx = build_matches(seed)
    if m0 is None:
        continue
    pinned_parts = {(pin_idx, 1), (pin_idx, 3)}
    m1, sc = anneal(m0, seed, pinned_parts)
    print(f"  seed={seed} anneal -> {sc}")
    if best is None or sc < best[0]:
        best = (sc, m1, pin_idx, seed)
print(f"고정 하 최소 잔여 재대결 = {best[0]}")

sc, matches, pin_idx, seed = best
# 고정 슬롯 라벨 확인
assert matches[pin_idx][0] == 'C' and matches[pin_idx][1] == (1, 3)
assert matches[pin_idx][2] == 'D' and matches[pin_idx][3] == (1, 4)

color = None
for sd in range(600):
    color = schedule(matches, sd, pin_idx, PIN_ROUND)
    if color is not None:
        break
assert color is not None, "스케줄 실패"
assert color[pin_idx] == PIN_ROUND
verify(matches, color)
print(f"스케줄 OK · 전체 불변식 통과 ✓ · 잔여 재대결 {score_repeats(matches)}건 · 고정매치 라운드 {color[pin_idx]+1}")

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bracket_sol.pkl'), 'wb') as f:
    pickle.dump((matches, color), f)

# 라운드 구성(인덱스) + 고정매치를 코트4(index3)로 정렬
rounds_idx = {r: [] for r in range(12)}
for i in range(len(matches)):
    rounds_idx[color[i]].append(i)
r9 = rounds_idx[PIN_ROUND]
r9.remove(pin_idx)
r9.insert(3, pin_idx)

out = []
out.append("## 조 편성\n")
out.append("| 조 | ①여 | ②여 | ③남 | ④남 | ⑤남 |")
out.append("|---|---|---|---|---|---|")
for g in GROUPS:
    out.append(f"| **{g}** | " + " | ".join(NAMES[g][n] for n in range(1, 6)) + " |")
out.append("\n## 라운드별 경기\n")
for r in range(12):
    out.append(f"### {r+1}라운드\n")
    out.append("| 코트 | 구분 | 경기 |")
    out.append("|---|---|---|")
    for ci, i in enumerate(rounds_idx[r]):
        a, pa, b, pb, t = matches[i]
        t1 = f"{NAMES[a][pa[0]]}·{NAMES[a][pa[1]]}"
        t2 = f"{NAMES[b][pb[0]]}·{NAMES[b][pb[1]]}"
        out.append(f"| {ci+1} | {TYPE_KO[t]} | {t1} vs {t2} |")
    out.append("")
md = "\n".join(out).rstrip() + "\n"
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bracket.md'), 'w', encoding='utf-8') as f:
    f.write(md)
print("\nbracket.md 생성. R10 미리보기:")
for ci, i in enumerate(rounds_idx[9]):
    a, pa, b, pb, t = matches[i]
    print(f"  코트{ci+1} [{TYPE_KO[t]}] {NAMES[a][pa[0]]}·{NAMES[a][pa[1]]} vs {NAMES[b][pb[0]]}·{NAMES[b][pb[1]]}")
