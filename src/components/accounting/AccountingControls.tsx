import { useState } from "react";
import type { AccountingMode, ManagementAction } from "../../lib/dues/v2/types";
import { actionLabel } from "../../lib/dues/v2/types";
import {
	accountingError,
	exportAccounting,
	manageAccounting,
} from "../../lib/supabase/accountingV2";
import { accountingActions } from "../../store/accountingV2Store";
import ConfirmDialog from "../common/ConfirmDialog";

async function downloadBackup() {
	const backup = await exportAccounting();
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
	);
	const a = document.createElement("a");
	a.href = url;
	a.download = `accounting-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
	a.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export default function AccountingControls({
	mode,
	operationCount = 0,
}: {
	mode: AccountingMode;
	operationCount?: number;
}) {
	const [action, setAction] = useState<ManagementAction | null>(null);
	const [reason, setReason] = useState("");
	const [request, setRequest] = useState("");
	const [revision, setRevision] = useState(0);
	const [busy, setBusy] = useState(false);
	const [attempted, setAttempted] = useState(false);
	const [error, setError] = useState("");
	const [open, setOpen] = useState(false);
	const select = (a: ManagementAction) => {
		setAction(a);
		setAttempted(false);
		setReason("");
		setRequest(crypto.randomUUID());
		setRevision(mode.revision);
		setError("");
	};
	const confirm = async () => {
		if (!action || !reason.trim()) {
			setError("사유를 입력하세요");
			return;
		}
		setBusy(true);
		setAttempted(true);
		setError("");
		try {
			if (action === "activate" || action === "rollback")
				await downloadBackup();
			await manageAccounting(action, reason.trim(), request, revision);
			await accountingActions.mode();
			if (action !== "rollback") await accountingActions.load();
			setAction(null);
		} catch (e) {
			setError(accountingError(e));
		} finally {
			setBusy(false);
		}
	};
	if (!mode.available) return null;
	return (
		<div className="my-3 text-sm">
			<button
				type="button"
				className="text-muted underline"
				onClick={() => setOpen(!open)}
			>
				부과 운영·복구
			</button>
			{open && (
				<div className="my-3 rounded-xl border border-black/10 dark:border-white/15 p-3 flex flex-wrap gap-2">
					<button
						type="button"
						className="btn-lq-secondary"
						disabled={busy}
						onClick={() => {
							setBusy(true);
							void downloadBackup()
								.catch((e) => setError(accountingError(e)))
								.finally(() => setBusy(false));
						}}
					>
						백업 다운로드
					</button>
					{!mode.enabled ? (
						<button
							type="button"
							className="btn-lq-primary"
							onClick={() => select("activate")}
						>
							새 부과 시작
						</button>
					) : (
						<>
							<button
								type="button"
								className="btn-lq-secondary"
								onClick={() => select(mode.paused ? "resume" : "pause")}
							>
								{mode.paused ? "처리 재개" : "처리 일시 중지"}
							</button>
							<button
								type="button"
								className="btn-lq-secondary"
								disabled={!operationCount}
								onClick={() => select("undo")}
							>
								직전 처리 되돌리기
							</button>
							<button
								type="button"
								className="btn-lq-red"
								onClick={() => select("rollback")}
							>
								기존 부과로 복귀
							</button>
						</>
					)}
				</div>
			)}
			{error && !action && (
				<p role="alert" className="text-red-600">
					{error}
				</p>
			)}
			{action && (
				<ConfirmDialog
					title={actionLabel[action]}
					confirmLabel={actionLabel[action]}
					tone={
						action === "rollback" || action === "undo" ? "danger" : "primary"
					}
					busy={busy}
					onConfirm={() => void confirm()}
					onCancel={() => setAction(null)}
					onDismiss={busy ? undefined : () => setAction(null)}
				>
					<p className="mb-3 text-sm text-muted">
						{action === "activate"
							? "현재 부과·납부·환불을 그대로 가져옵니다. 기존 자료는 보존하고, 새 기능에서 처리를 시작합니다. 확정 전에 백업 파일을 다운로드합니다."
							: action === "rollback"
								? `새 기능에서 반영한 ${operationCount}건의 처리를 되돌리고 기존 기능으로 복귀합니다. 내역은 백업과 처리 이력에 남습니다. 실제 입출금은 유지되므로 전환 이후 들어온 거래는 다시 정산해야 할 수 있습니다.`
								: action === "undo"
									? "가장 최근의 부과·납부·이월·환불 처리를 직전 상태로 되돌립니다. 이후에 수집한 실제 입출금은 유지됩니다."
									: action === "pause"
										? "현재 내역은 계속 볼 수 있고, 새 부과·납부·환불 처리는 중지됩니다."
										: "부과·납부·이월·환불 처리를 다시 시작합니다."}
					</p>
					<label className="text-sm">
						처리 사유
						<input
							className="w-full rounded-lg border border-black/20 dark:border-white/20 bg-transparent p-2 my-2"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							disabled={busy || attempted}
						/>
					</label>
					{error && (
						<p role="alert" className="text-sm text-red-600">
							{error}
						</p>
					)}
				</ConfirmDialog>
			)}
		</div>
	);
}
