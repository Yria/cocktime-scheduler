/**
 * entryAlertStore — 앱 진입 알림의 **단일 슬롯**.
 *
 * 앱을 열 때 띄우는 안내가 둘 이상 생겼다(미납/환불 알림, 신규회원 프리패스 안내). 각자 조건이
 * 독립이라 동시에 참일 수 있는데, 모달을 겹쳐 띄우면 뒤엣것이 앞엣것을 덮어 배경 스크롤락·포커스가
 * 서로 엉킨다. 그래서 **한 번에 하나만** 띄우고, 앞의 것이 닫히면 다음 것이 그 자리에 뜬다.
 *
 * 패턴: 각 알림 컴포넌트가 "지금 띄울 조건이 참인가"만 신고하고(useEntryAlertSlot),
 * 실제로 그릴지는 스토어가 우선순위로 정한다(선언형 슬롯). 명령형 큐(push/shift)와 달리
 * 조건이 데이터에서 파생되므로 리렌더마다 중복 push 되는 사고가 원리적으로 없다.
 *
 * 닫힘은 **이번 앱 실행에만** 유효하다(영속 X) — 미납 알림의 기존 규칙과 같다. 조건이 계속 참이면
 * 다음에 앱을 열 때 다시 뜬다. 회원이 바뀌면(로그아웃·계정 전환) 닫힘을 버린다.
 */
import { useEffect } from "react";
import { create } from "zustand";

export type EntryAlertKind = "unpaidDues" | "newbieFreepass";

/**
 * 표시 순서 — 앞에 있는 것이 먼저 뜬다.
 * 돈 얘기(미납·환불)를 앞에 둔다: 놓치면 손해가 생기고, 신규 안내는 유예 기간 내내 다시 뜬다.
 */
const ORDER: EntryAlertKind[] = ["unpaidDues", "newbieFreepass"];

interface EntryAlertState {
	/** 조건이 참이라고 신고한 알림 */
	wanted: Partial<Record<EntryAlertKind, boolean>>;
	/** 이번 앱 실행에서 닫은 알림 */
	closed: Partial<Record<EntryAlertKind, boolean>>;
}

export const useEntryAlertStore = create<EntryAlertState>(() => ({
	wanted: {},
	closed: {},
}));

/** 지금 슬롯을 차지하는 알림(없으면 null). 조건이 참이고 아직 닫지 않은 것 중 우선순위 첫째. */
function frontOf(st: EntryAlertState): EntryAlertKind | null {
	return ORDER.find((k) => st.wanted[k] && !st.closed[k]) ?? null;
}

export const entryAlertActions = {
	/** 조건 신고. 값이 같으면 아무것도 하지 않는다(효과 안에서 불려도 리렌더 루프가 생기지 않게). */
	setWanted(kind: EntryAlertKind, wants: boolean) {
		if (Boolean(useEntryAlertStore.getState().wanted[kind]) === wants) return;
		useEntryAlertStore.setState((st) => ({
			wanted: { ...st.wanted, [kind]: wants },
		}));
	},

	/** 사용자가 닫음 — 이번 실행에선 다시 띄우지 않고, 슬롯을 다음 알림에게 넘긴다. */
	close(kind: EntryAlertKind) {
		useEntryAlertStore.setState((st) => ({
			closed: { ...st.closed, [kind]: true },
		}));
	},

	/** 로그아웃·계정 전환 — 다른 사람의 '봤음'을 물려받지 않게 닫힘을 버린다. */
	reset() {
		useEntryAlertStore.setState({ closed: {} });
	},
};

/**
 * 알림 하나가 슬롯을 요청한다. 반환값이 true 일 때만 모달을 그린다.
 *
 * @param kind 알림 종류(ORDER 에 우선순위를 적어 둘 것)
 * @param wants 이 알림 자체의 노출 조건(데이터에서 파생 — 스토어에 중복 저장하지 않는다)
 */
export function useEntryAlertSlot(
	kind: EntryAlertKind,
	wants: boolean,
): boolean {
	// 조건 신고. setWanted 가 같은 값이면 no-op 이라 여기서 상태가 튀지 않는다.
	useEffect(() => {
		entryAlertActions.setWanted(kind, wants);
	}, [kind, wants]);

	// 언마운트 때만 슬롯 반납 — wants 변경마다 반납하면 그 순간 다음 알림이 잠깐 끼어든다.
	useEffect(() => () => entryAlertActions.setWanted(kind, false), [kind]);

	return useEntryAlertStore((st) => frontOf(st) === kind);
}
