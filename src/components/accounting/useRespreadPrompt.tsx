import { useEffect, useRef, useState } from "react";
import { won } from "../../lib/dues/duesText";
import { type SplitDrift, splitDrift } from "../../lib/dues/splitDrift";
import type { AccountingData } from "../../lib/dues/types";
import { accountingError, respreadCourtGroup } from "../../lib/supabase/dues";
import { fetchDuesSettings } from "../../lib/supabase/duesSettings";
import { duesActions } from "../../store/duesStore";
import ConfirmDialog from "../common/ConfirmDialog";
import type { OperationDraft } from "./OperationDialog";

const liveCount = (data: AccountingData, groupId: string) =>
	data.charges.filter((c) => c.group_id === groupId && c.state === "live")
		.length;

/**
 * 엔빵 회차에서 부과를 취소·변경해 **인원이 바뀌면** 남은 사람을 새 1인 금액으로 다시 나눌지 묻는다.
 * 인원이 그대로인 금액 변경(한 사람만 일부러 깎아 준 경우 등)은 묻지 않는다 — 되돌리면 의도가 사라진다.
 *
 * 사용: 전표를 여는 쪽이 `watch(draft)` 로 열 때 인원을 찍어 두고, 저장되면 `saved()` 를 부른다.
 */
export function useRespreadPrompt(data: AccountingData | null) {
	const before = useRef(new Map<string, number>());
	const [pending, setPending] = useState<string[] | null>(null);
	const [prompt, setPrompt] = useState<{
		group: string;
		label: string;
		drift: SplitDrift;
		revision: number; // 금액을 계산한 장부 기준 — 그 사이 다른 변경이 있으면 서버가 거부한다
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const mounted = useRef(true);
	// StrictMode 의 마운트→해제→마운트에서도 살아나도록 본문에서 다시 켠다.
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const [error, setError] = useState("");

	const watch = (draft: OperationDraft | null) => {
		before.current.clear();
		setPending(null);
		if (!data || draft?.type !== "replace") return;
		for (const id of draft.chargeIds ?? []) {
			const group = data.charges.find((c) => c.id === id)?.group_id;
			if (group && !before.current.has(group))
				before.current.set(group, liveCount(data, group));
		}
	};
	// 전표 없이 묶음에 사람을 바로 더할 때(부과 변경의 [사람 추가]) — 발행 직전 인원을 찍어 둔다.
	const watchGroup = (groupId: string) => {
		before.current.clear();
		setPending(null);
		if (data) before.current.set(groupId, liveCount(data, groupId));
	};
	const saved = () => {
		if (before.current.size) setPending([...before.current.keys()]);
	};

	// 저장 결과가 반영된 data 로 판정한다. 저장 직후엔 화면 data 가 아직 옛것일 수 있어,
	// 인원 변화가 보일 때까지 pending 을 유지한다(인원이 그대로인 변경은 다음 watch 에서 지워진다).
	useEffect(() => {
		if (!pending || !data) return;
		const changed = pending.filter((groupId) => {
			const was = before.current.get(groupId);
			return was !== undefined && was !== liveCount(data, groupId);
		});
		if (!changed.length) return;
		// pending 을 비우면 이 효과가 다시 돌므로, 조회 결과는 효과 수명이 아니라 화면 수명으로 가린다.
		setPending(null);
		void fetchDuesSettings().then((settings) => {
			if (!mounted.current) return;
			for (const groupId of changed) {
				const group = data.groups.find((g) => g.id === groupId);
				const drift =
					group &&
					// 정액을 모르면 스냅 판정이 틀릴 수 있어 묻지 않는다(서버는 정액 근처를 정액으로 맞춘다).
					typeof settings?.courtFeeDefault === "number" &&
					splitDrift(group, data.charges, settings.courtFeeDefault);
				if (group && drift) {
					setError("");
					setPrompt({
						group: groupId,
						label: group.label,
						drift,
						revision: data.mode.revision,
					});
					return;
				}
			}
		});
	}, [pending, data]);

	// 재발행은 서버가 한다 — 클라이언트 replace 로는 선납 표식·당일취소 표시(line)·rule 이 사라진다.
	const respread = async () => {
		if (!prompt) return;
		setBusy(true);
		setError("");
		try {
			await respreadCourtGroup(prompt.group, prompt.revision);
			await duesActions.load();
			setPrompt(null);
		} catch (e) {
			setError(accountingError(e));
		} finally {
			setBusy(false);
		}
	};

	const dialog = prompt && (
		<ConfirmDialog
			zIndex={80}
			title="엔빵 인원이 바뀌었습니다"
			confirmLabel={`${prompt.drift.head}명 ${won(prompt.drift.perHead)}으로 다시 나누기`}
			cancelLabel="그대로 두기"
			busy={busy}
			busyLabel="다시 나누는 중…"
			onConfirm={() => void respread()}
			onCancel={() => setPrompt(null)}
		>
			<div className="ac-respread">
				<p>
					{prompt.label} · 부과 인원이{" "}
					{prompt.drift.issuedHead !== null
						? `${prompt.drift.issuedHead}명에서 `
						: ""}
					{prompt.drift.head}명이 됐습니다.
				</p>
				<p>
					대관 {won(prompt.drift.total)} ÷ {prompt.drift.head}명 ={" "}
					<strong>1인 {won(prompt.drift.perHead)}</strong>
				</p>
				<p>
					지금 {prompt.drift.charged.map(won).join("/")}씩이라{" "}
					{prompt.drift.shortfall >= 0
						? `${won(prompt.drift.shortfall)}이 덜 걷힙니다.`
						: `${won(-prompt.drift.shortfall)}이 더 걷힙니다.`}{" "}
					확인하면 남은 {prompt.drift.head}명의 부과를 새 금액으로 다시
					발행합니다. 이미 낸 돈은 새 부과에 그대로 씁니다.
				</p>
				{error && <p className="ac-respread-error">{error}</p>}
			</div>
		</ConfirmDialog>
	);
	return { watch, watchGroup, saved, dialog };
}
