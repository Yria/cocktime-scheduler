import { useEffect, useMemo, useRef, useState } from "react";
import { won } from "../../lib/dues/duesText";
import {
	groupAddCommand,
	groupAddDueYm,
	groupAddState,
} from "../../lib/dues/groupAdd";
import { matchingMembers } from "../../lib/dues/selection";
import { memberLabel } from "../../lib/dues/summary";
import type { AccountingData, BillingGroup } from "../../lib/dues/types";
import { accountingError } from "../../lib/supabase/dues";
import { randomId } from "../../lib/randomId";
import { duesActions } from "../../store/duesStore";
import PlayerAvatar from "../shared/PlayerAvatar";
import AccountingDetailModal from "./AccountingDetailModal";

/**
 * 발행된 부과 묶음에 사람을 한 명씩 더한다. 검색 → 이름을 누르면 확인 → 기존 사람과 같은 금액으로 발행.
 * 모달은 열어 둔 채로 다음 사람을 이어서 추가할 수 있다.
 */
export default function ChargeAddMember({
	data,
	group,
	amount,
	onClose,
	onBeforeAdd,
	onAdded,
}: {
	data: AccountingData;
	group: BillingGroup;
	amount: number;
	onClose: () => void;
	/** 발행 직전(인원 변화 감지용 — 엔빵 재분배 확인창). */
	onBeforeAdd?: () => void;
	onAdded?: () => void;
}) {
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState<string | null>(null);
	// 기본은 기존 사람들과 같은 금액, 확인 단계에서 이 사람만 다르게 고칠 수 있다.
	const [value, setValue] = useState(String(amount));
	const chosen = Number(value);
	const valid = value !== "" && Number.isSafeInteger(chosen) && chosen > 0;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [added, setAdded] = useState<string[]>([]);
	const input = useRef<HTMLInputElement>(null);
	// 모달이 닫기 버튼에 먼저 초점을 주므로 그 다음 프레임에 검색칸으로 옮긴다.
	useEffect(() => {
		const id = requestAnimationFrame(() =>
			input.current?.focus({ preventScroll: true }),
		);
		return () => cancelAnimationFrame(id);
	}, []);

	const rows = useMemo(
		() =>
			(query.trim() ? matchingMembers(data, query) : data.members)
				.filter((m) => m.active)
				.map((m) => ({ m, state: groupAddState(data, group.id, m.id) }))
				.filter((r) => r.state !== "charged")
				.sort(
					(a, b) =>
						Number(a.state === "blocked") - Number(b.state === "blocked") ||
						Number(a.m.guest) - Number(b.m.guest) ||
						a.m.name.localeCompare(b.m.name, "ko"),
				),
		[data, group.id, query],
	);

	const confirm = async () => {
		if (!picked || busy || !valid) return;
		setBusy(true);
		setError("");
		try {
			const name = memberLabel(data, picked);
			onBeforeAdd?.();
			await duesActions.commit(
				groupAddCommand(
					group,
					picked,
					name,
					chosen,
					groupAddDueYm(data, group),
				),
				randomId(),
				data.mode.revision,
			);
			setAdded((list) => [...list, name]);
			setPicked(null);
			setValue(String(amount));
			setQuery("");
			onAdded?.();
			requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
		} catch (e) {
			setError(accountingError(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<AccountingDetailModal
			title="사람 추가"
			subtitle={`${group.label} · 기본 1인 ${won(amount)} (기존과 같은 금액)`}
			onClose={() => !busy && onClose()}
		>
			<div className="ac-add-member">
				{added.length > 0 && (
					<p className="ac-saved" role="status">
						{added.join(", ")} 추가 완료
					</p>
				)}
				{picked ? (
					<form
						className="ac-add-confirm"
						onSubmit={(e) => {
							e.preventDefault();
							void confirm();
						}}
					>
						<p>
							<strong>{memberLabel(data, picked)}</strong>님에게 부과할까요?
						</p>
						<label className="ac-amount-edit-field">
							부과 금액
							<span className="ac-amount-edit-input">
								<input
									className="ac-field ac-number"
									type="number"
									inputMode="numeric"
									min="1"
									step="1"
									aria-label="부과 금액"
									// biome-ignore lint/a11y/noAutofocus: 사람을 고른 직후 바로 금액을 고칠 수 있게.
									autoFocus
									value={value}
									disabled={busy}
									onChange={(e) => setValue(e.target.value)}
								/>
								<span aria-hidden="true">원</span>
							</span>
						</label>
						<p className="ac-caption">
							{!valid
								? "1원 이상의 금액을 입력하세요."
								: chosen === amount
									? "기존 사람들과 같은 금액입니다."
									: `기본 ${won(amount)} 대신 이 사람만 ${won(chosen)}을 부과합니다.`}
						</p>
						{error && (
							<p className="ac-add-error" role="alert">
								{error}
							</p>
						)}
						<div className="ac-add-confirm-actions">
							<button
								type="button"
								className="btn-lq-secondary"
								disabled={busy}
								onClick={() => {
									setPicked(null);
									setValue(String(amount));
									setError("");
								}}
							>
								다시 고르기
							</button>
							<button
								type="submit"
								className="btn-lq-primary"
								disabled={busy || !valid}
							>
								{busy ? "부과 중…" : "부과하기"}
							</button>
						</div>
					</form>
				) : (
					<>
						<input
							ref={input}
							className="ac-field"
							type="search"
							aria-label="회원 이름 검색"
							placeholder="이름으로 검색"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
						{rows.length === 0 ? (
							<p className="ac-caption">추가할 수 있는 회원이 없습니다.</p>
						) : (
							<ul className="ac-add-list">
								{rows.map(({ m, state }) => {
									const [name, ...detail] = memberLabel(data, m.id).split(
										" · ",
									);
									return (
										<li key={m.id}>
											<button
												type="button"
												className="ac-add-item"
												disabled={state === "blocked"}
												onClick={() => setPicked(m.id)}
											>
												<PlayerAvatar
													name={m.name}
													gender={m.gender}
													photoId={m.guest ? undefined : m.id}
													size={32}
												/>
												<span className="ac-add-name">
													<strong>{name}</strong>
													{detail.length > 0 && (
														<span> · {detail.join(" · ")}</span>
													)}
													{state === "readd" && (
														<small>이 부과에서 취소됨 · 다시 부과합니다</small>
													)}
													{state === "blocked" && (
														<small>
															이 부과에서 면제된 기록이 있어 추가할 수 없습니다
														</small>
													)}
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</>
				)}
			</div>
		</AccountingDetailModal>
	);
}
