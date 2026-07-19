// 입금확인 자동선택: 입금액을 '실제 부과 금액'으로 정확히 맞추는 부분집합 탐색.
// 과거엔 대관비를 정액 6,000으로 가정해 `입금액 ÷ 6000`으로 개수를 셌으나, 엔빵 대관비(예: 7,500)는
// 6,000 배수가 아니라 아무것도 자동선택되지 않았다(원인). 이제 후보 항목의 실제 금액으로 정확히 맞춘다.

export interface MatchItem {
	key: string;
	amount: number;
}

/**
 * pool(우선순위 순) 중 금액 합이 정확히 target 인 부분집합의 key 목록. 없으면 null.
 * include-우선 DFS → 앞선(고우선) 항목을 최대한 포함하는 조합을 먼저 반환.
 * pool 은 작으므로(회비 1 + 대관 몇 개) 완전 탐색해도 무해. 정확히 안 떨어지면 null(→ 수동 선택).
 */
export function matchExactSubset(pool: MatchItem[], target: number): string[] | null {
	if (target <= 0) return null;
	const dfs = (i: number, rem: number, acc: string[]): string[] | null => {
		if (rem === 0) return acc;
		if (i >= pool.length || rem < 0) return null;
		if (pool[i].amount > 0 && pool[i].amount <= rem) {
			const inc = dfs(i + 1, rem - pool[i].amount, [...acc, pool[i].key]);
			if (inc) return inc;
		}
		return dfs(i + 1, rem, acc);
	};
	return dfs(0, target, []);
}
