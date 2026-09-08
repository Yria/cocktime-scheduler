import { MemberPicker, duesFixture } from "cocktime-scheduler";

const A = duesFixture.members[0].id;

/** 적요로 후보가 좁혀진 상태 — 정산함이 쓰는 compact 모드. */
export const SearchByDepositName = () => (
	<MemberPicker
		compact
		data={duesFixture}
		value=""
		suggestedName="박민준0906"
		onChange={() => {}}
	/>
);

/** 납부자가 정해진 상태 + 미납 요약을 함께 보여주는 모습. */
export const PayerChosen = () => (
	<MemberPicker
		compact
		data={duesFixture}
		value={A}
		suggestedName="박민준0906"
		descriptionForMember={(id) =>
			id === A ? "9월 회비 완납 · 대관비 6,500원 미납" : "남은 미납 없음"
		}
		onChange={() => {}}
	/>
);

/** 대납 흐름의 '낼 사람' 선택 — 라벨이 접근명을 만든다. */
export const ProxyBeneficiary = () => (
	<MemberPicker
		compact
		data={duesFixture}
		value=""
		label="낼 사람"
		onChange={() => {}}
	/>
);
