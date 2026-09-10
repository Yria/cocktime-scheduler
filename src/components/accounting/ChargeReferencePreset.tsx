import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, UsersRound } from "lucide-react";
import { sessionChoiceLabels } from "../../lib/dues/selection";
import {
	accountingError,
	accountingReferenceMembers,
	readAccountingReferenceSessions,
} from "../../lib/supabase/dues";

export interface ChargeReference {
	id: number;
	label: string;
	mealOnly: boolean;
	memberIds: string[];
}
type MonthPage = Awaited<ReturnType<typeof readAccountingReferenceSessions>> & {
	ym: string;
};
const monthLabel = (ym: string) =>
	`${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;

/** A roster preset edits the draft only. Selection and provenance change together. */
export default function ChargeReferencePreset({
	viewYm,
	active,
	onApply,
	onLoading,
}: {
	viewYm: string;
	active: boolean;
	onApply: (reference: ChargeReference | null) => void;
	onLoading: (loading: boolean) => void;
}) {
	const [pages, setPages] = useState<MonthPage[]>([]);
	const [loadingMonth, setLoadingMonth] = useState<string | null>(null);
	const [monthError, setMonthError] = useState("");
	const [retry, setRetry] = useState(0);
	const monthRequests = useRef(new Map<string, Promise<MonthPage>>());
	const rosterRequests = useRef(new Map<string, Promise<string[]>>());
	const [selection, setSelection] = useState<ChargeReference | null>(null);
	const [mealOnly, setMealOnly] = useState(false);
	const [loadingRoster, setLoadingRoster] = useState(false);
	const [rosterError, setRosterError] = useState("");
	const mounted = useRef(true);
	const applying = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	useEffect(() => {
		if (!active || pages.length) return;
		let disposed = false;
		let request = monthRequests.current.get(viewYm);
		if (!request) {
			request = readAccountingReferenceSessions(viewYm).then((page) => ({
				...page,
				ym: viewYm,
			}));
			monthRequests.current.set(viewYm, request);
		}
		void request
			.then((page) => {
				if (!disposed) {
					setPages([page]);
					setMonthError("");
				}
			})
			.catch((e) => {
				monthRequests.current.delete(viewYm);
				if (!disposed) setMonthError(accountingError(e));
			});
		return () => {
			disposed = true;
		};
	}, [active, pages.length, retry, viewYm]);

	const olderYm = pages.at(-1)?.previousYm;
	const loadOlder = async () => {
		if (!olderYm || loadingMonth) return;
		setLoadingMonth(olderYm);
		setMonthError("");
		try {
			const page = await readAccountingReferenceSessions(olderYm);
			if (mounted.current)
				setPages((previous) => [...previous, { ...page, ym: olderYm }]);
		} catch (e) {
			if (mounted.current) setMonthError(accountingError(e));
		} finally {
			if (mounted.current) setLoadingMonth(null);
		}
	};
	const sessions = pages.flatMap((page) => page.sessions);
	const labels = sessionChoiceLabels(sessions);
	const selectedSession = sessions.find((s) => s.id === selection?.id);
	const select = async (
		session: MonthPage["sessions"][number] | undefined,
		meal: boolean,
	) => {
		if (applying.current) return;
		setRosterError("");
		if (!session) {
			setSelection(null);
			onApply(null);
			return;
		}
		setMealOnly(meal);
		applying.current = true;
		setLoadingRoster(true);
		onLoading(true);
		const key = `${session.id}:${meal}`;
		try {
			let request = rosterRequests.current.get(key);
			if (!request) {
				request = accountingReferenceMembers(session.id, meal);
				rosterRequests.current.set(key, request);
			}
			const memberIds = [...new Set(await request)];
			if (!mounted.current) return;
			const reference = {
				id: session.id,
				label: labels.get(session.id)!,
				mealOnly: meal,
				memberIds,
			};
			onApply(reference);
			setSelection(reference);
			setMealOnly(meal);
		} catch (e) {
			rosterRequests.current.delete(key);
			if (mounted.current) {
				setMealOnly(selection?.mealOnly ?? false);
				setRosterError(accountingError(e));
			}
		} finally {
			applying.current = false;
			if (mounted.current) {
				setLoadingRoster(false);
				onLoading(false);
			}
		}
	};
	return (
		<div
			className="ac-reference-preset"
			role="group"
			aria-label="지난 명단 프리셋"
		>
			<div className="ac-reference-heading">
				<strong>
					<UsersRound size={15} aria-hidden="true" />
					지난 명단
				</strong>
				<span>{monthLabel(viewYm)}부터</span>
			</div>
			<p className="ac-caption">회차를 선택하면 아래 명단이 채워집니다.</p>
			<div className="ac-reference-tools">
				<label className="ac-check">
					<input
						type="checkbox"
						checked={mealOnly}
						disabled={
							loadingRoster || (!!selection && !selectedSession?.mealEnabled)
						}
						onChange={(e) => {
							if (selection)
								void select(
									sessions.find((s) => s.id === selection.id),
									e.target.checked,
								);
							else setMealOnly(e.target.checked);
						}}
					/>
					회식 참여자만
				</label>
				<button
					type="button"
					className="ac-link"
					disabled={loadingRoster || !selection}
					onClick={() => void select(undefined, mealOnly)}
				>
					회원 직접 선택
				</button>
			</div>
			{selection && !selectedSession?.mealEnabled && (
				<p className="ac-caption">이 회차는 회식 참석을 기록하지 않았습니다.</p>
			)}
			{mealOnly && (
				<p className="ac-caption">
					확정·늦참 참석자 중 ‘식사 안 함’을 제외합니다.
				</p>
			)}
			<ul
				className="ac-reference-list"
				aria-label="참고 회차"
				tabIndex={0}
				aria-busy={(!pages.length && !monthError) || !!loadingMonth}
			>
				{!pages.length && !monthError && (
					<li className="ac-caption">회차 불러오는 중…</li>
				)}
				{pages.map((page) => {
					const choices = page.sessions.filter(
						(s) => !mealOnly || s.mealEnabled,
					);
					return (
						<li key={page.ym} className="ac-reference-month">
							<span className="ac-reference-month-label">
								{monthLabel(page.ym)}
							</span>
							<div className="ac-reference-choices">
								{choices.map((session) => {
									const chosen = selection?.id === session.id;
									const label = labels.get(session.id)!;
									return (
										<button
											key={session.id}
											type="button"
											value={session.id}
											className="ac-reference-choice"
											aria-label={label}
											aria-pressed={chosen}
											disabled={loadingRoster}
											onClick={() => void select(session, mealOnly)}
										>
											<span>{label.slice(5)}</span>
											<Check size={14} aria-hidden="true" />
										</button>
									);
								})}
							</div>
							{!choices.length && (
								<p className="ac-caption">
									{mealOnly
										? "회식 참석을 기록한 회차가 없습니다."
										: "참고할 회차가 없습니다."}
								</p>
							)}
						</li>
					);
				})}
				{olderYm && (
					<li>
						<button
							type="button"
							className="ac-reference-more"
							disabled={!!loadingMonth}
							onClick={() => void loadOlder()}
							aria-label={`더 보기 · ${monthLabel(olderYm)}`}
						>
							{loadingMonth ? "불러오는 중…" : "더 보기"}
							<ChevronDown size={14} aria-hidden="true" />
						</button>
					</li>
				)}
			</ul>
			{monthError && (
				<div className="ac-reference-error" role="alert">
					<span>회차를 불러오지 못했습니다. {monthError}</span>
					{!pages.length && (
						<button
							type="button"
							className="ac-link"
							onClick={() => {
								setMonthError("");
								setRetry((n) => n + 1);
							}}
						>
							다시 시도
						</button>
					)}
				</div>
			)}
			{rosterError && (
				<p className="ac-reference-error" role="alert">
					명단을 불러오지 못했습니다. 다시 선택해 주세요. {rosterError}
				</p>
			)}
			<div className="ac-reference-status" role="status" aria-live="polite">
				{loadingRoster ? (
					"명단을 불러오는 중…"
				) : selection ? (
					<>
						<Check size={14} aria-hidden="true" />
						{selection.memberIds.length
							? `${selection.memberIds.length}명 불러옴 · 아래에서 자유롭게 수정하세요.`
							: "해당 회차의 대상이 없습니다. 아래에서 직접 선택하세요."}
					</>
				) : null}
			</div>
		</div>
	);
}
