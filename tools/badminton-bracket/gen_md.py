# -*- coding: utf-8 -*-
import pickle, os

GROUPS = ['A', 'B', 'C', 'D', 'E', 'F']
NAMES = {
    'A': {1: '박현아', 2: '이한비', 3: '오상진', 4: '오용진', 5: '차성민'},
    'B': {1: '김주영', 2: '황영민', 3: '남필립', 4: '손형일', 5: '이재원'},
    'C': {1: '심유진', 2: '윤지윤', 3: '김길환', 4: '심상욱', 5: '최양회'},
    'D': {1: '송수민', 2: '이지인', 3: '강민규', 4: '김태혁', 5: '우창형'},
    'E': {1: '엄지현', 2: '장한별', 3: '강우석', 4: '송유현', 5: '이후섭'},
    'F': {1: '노보람', 2: '이규웅', 3: '박세경', 4: '이홍희', 5: '정현민'},
}
TYPE_KO = {'yeo': '여복', 'hon': '혼복', 'nam': '남복'}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, 'bracket_sol.pkl'), 'rb') as f:
    matches, color = pickle.load(f)

# 라운드 재구성 (HTML/로그와 동일한 코트 순서: 매치 인덱스 순으로 append)
rounds = {r: [] for r in range(12)}
for i, m in enumerate(matches):
    rounds[color[i]].append(m)

out = []
out.append("## 조 편성")
out.append("")
out.append("| 조 | ①여 | ②여 | ③남 | ④남 | ⑤남 |")
out.append("|---|---|---|---|---|---|")
for g in GROUPS:
    cells = " | ".join(NAMES[g][n] for n in range(1, 6))
    out.append(f"| **{g}** | {cells} |")
out.append("")
out.append("## 라운드별 경기")
out.append("")
for r in range(12):
    out.append(f"### {r+1}라운드")
    out.append("")
    out.append("| 코트 | 구분 | 경기 |")
    out.append("|---|---|---|")
    for ci, m in enumerate(rounds[r]):
        a, pa, b, pb, t = m
        t1 = f"{NAMES[a][pa[0]]}·{NAMES[a][pa[1]]}"
        t2 = f"{NAMES[b][pb[0]]}·{NAMES[b][pb[1]]}"
        out.append(f"| {ci+1} | {TYPE_KO[t]} | {t1} vs {t2} |")
    out.append("")

md = "\n".join(out).rstrip() + "\n"
with open(os.path.join(here, 'bracket.md'), 'w', encoding='utf-8') as f:
    f.write(md)
print(md)
