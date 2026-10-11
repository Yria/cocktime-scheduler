// 이 기기에서 보드 항목(자석·팀 카드·코트)을 드래그하는 중인지 — Pixi 런타임이 시작/드롭/취소 때 갱신한다.
// 동시 편집(multiEditor)에서 원격 보드 적용과 rebase 결과 적용을 드롭/취소 뒤로 미루는 데 쓴다
// (드래그 중 적용하면 runtime.refresh 가 드래그를 취소한다). boardStore 와 분리해 저장 subscribe 를 건드리지 않는다.
let active = false;
const listeners = new Set<() => void>();

export function setLocalDragActive(next: boolean) {
	if (active === next) return;
	active = next;
	for (const listener of [...listeners]) listener();
}

export function isLocalDragActive(): boolean {
	return active;
}

/** useSyncExternalStore 호환 구독. */
export function subscribeLocalDrag(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

/** 드래그가 끝날 때까지 기다린다(드래그 중이 아니면 즉시). */
export function waitForLocalDragEnd(): Promise<void> {
	if (!active) return Promise.resolve();
	return new Promise((resolve) => {
		const off = subscribeLocalDrag(() => {
			if (active) return;
			off();
			resolve();
		});
	});
}
