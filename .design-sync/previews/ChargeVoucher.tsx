import { ChargeVoucher, duesFixture } from "cocktime-scheduler";

const done = async () => {};
const noop = () => {};
const sessions = [
	{
		id: 12,
		title: "대관",
		status: "closed",
		scheduled_at: "2026-09-06T19:00:00+09:00",
		ends_at: "2026-09-06T22:00:00+09:00",
		place: "에이트민턴",
		court: true,
	},
] as never;

/** 새 수동 부과 전표 — 모달이 아니라 부과 탭 안에서 열리고 여기서 확정된다. */
export const ManualIssue = () => (
	<ChargeVoucher
		draft={{ type: "issue" }}
		data={duesFixture}
		sessions={sessions}
		viewYm="2026-09"
		onClose={noop}
		onDone={done}
	/>
);

/** 미납·입금 이월 전표. */
export const CarryTransfer = () => (
	<ChargeVoucher
		draft={{ type: "carry" }}
		data={duesFixture}
		sessions={sessions}
		viewYm="2026-09"
		onClose={noop}
		onDone={done}
	/>
);

/** 파라미터가 없는 명령(이월금 적용) — 사유가 프리셋으로 채워진 전표. */
export const ApplyCarryCash = () => (
	<ChargeVoucher
		draft={{
			type: "simple",
			command: { action: "apply", reason: "납기가 도래한 이월 입금 사용" },
		}}
		data={duesFixture}
		sessions={sessions}
		viewYm="2026-09"
		onClose={noop}
		onDone={done}
	/>
);
