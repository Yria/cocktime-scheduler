import { AccountingOverview, duesFixture } from "cocktime-scheduler";

const sessionLabels = new Map([[12, "2026-09-06 · 에이트민턴 · 19:00–22:00"]]);

/** 한 달을 여는 화면 — 남은 회비, 대관·모임 대조, 이월 현황. 조작은 심지 않는다. */
export const MonthStatus = () => (
	<AccountingOverview
		data={duesFixture}
		ym="2026-09"
		sessionLabels={sessionLabels}
		onNavigate={() => {}}
	/>
);
