import type { OperationDraft } from "./OperationDialog";
import type { useInlineAccounting } from "./useInlineAccounting";
import { won } from "../../lib/dues/duesText";

/** All operations share pending, validation, retry, and confirmation presentation. */
export default function SettlementConfirmation({
	flow,
	paused,
	disabled,
	hint,
	summary,
	title,
	operation,
	showSummary,
	unchangedExpense,
	savedExpense,
	onClose,
}: {
	flow: ReturnType<typeof useInlineAccounting>;
	paused: boolean;
	disabled: boolean;
	hint: string;
	summary: string;
	title: string;
	operation: OperationDraft["type"];
	showSummary: boolean;
	unchangedExpense: boolean;
	savedExpense: boolean;
	onClose: (saved?: boolean, summary?: string) => void;
}) {
	return (
		<div className="ac-quick-confirm">
			{hint ? (
				<p className="ac-blockers" aria-live="assertive">
					<span aria-hidden="true">!</span>
					<span>
						{hint}
						{flow.preparing && " · 확인 중…"}
					</span>
				</p>
			) : showSummary ? (
				<p className="ac-quick-summary" aria-live="polite">
					<span aria-hidden="true">✓</span>
					<span>
						{summary}
						{flow.preparing && " · 확인 중…"}
					</span>
				</p>
			) : null}
			{flow.result && operation === "carry" && flow.result.auto_applied > 0 && (
				<p className="ac-caption">
					이월 후 바로 납부에 사용 {won(flow.result.auto_applied)}
				</p>
			)}
			{/* 잠긴 이유를 확정 블록 안에 적는다 — 스크롤로 카드가 화면 밖이면
				    화면이 이유 없이 굳은 것처럼 보였다. */}
			{paused && (
				<p className="ac-caption">
					회계 처리가 일시 중지되어 확정할 수 없습니다.
				</p>
			)}
			{flow.error && !flow.locked && (
				<button
					type="button"
					className="ac-link"
					onClick={() => void flow.refreshPreview()}
				>
					내역 새로고침
				</button>
			)}
			{flow.error && (
				<p className="ac-quick-error" role="alert">
					{flow.error}
				</p>
			)}
			<div className="ac-quick-confirm-buttons">
				{(!unchangedExpense || flow.locked) && (
					<button
						type="button"
						className="ac-inline-confirm"
						aria-label={
							flow.busy
								? "처리 중…"
								: flow.locked
									? "결과 다시 확인"
									: operation === "expense" && savedExpense
										? "변경 저장"
										: `${title} 확인`
						}
						disabled={
							(!flow.locked && disabled) || !flow.ready || flow.busy || paused
						}
						onClick={() =>
							void flow.confirm().then((done) => {
								if (done) onClose(true, summary || `${title} 확인`);
							})
						}
					>
						{flow.busy
							? "처리 중…"
							: flow.locked
								? "결과 다시 확인"
								: operation === "expense" && savedExpense
									? "변경 저장"
									: "확인"}
					</button>
				)}
			</div>
		</div>
	);
}
