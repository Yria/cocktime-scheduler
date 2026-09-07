import { useEffect, useMemo, useRef, useState } from "react";
import type {
	AccountingCommand,
	OperationResult,
} from "../../lib/dues/v2/types";
import {
	accountingError,
	commitAccounting,
	previewAccounting,
} from "../../lib/supabase/accountingV2";

type Prepared = {
	payload: AccountingCommand;
	request: string;
	revision: number;
	key: string;
	result?: OperationResult;
};

/** Ordinary selections are local; the atomic command validates revision and balances.
 * Carry still previews server auto-application. Unknown commit outcomes reuse the same request. */
export function useInlineAccounting(
	command: AccountingCommand | null,
	revision: number,
	paused: boolean,
	onDone: () => Promise<void>,
) {
	const key = JSON.stringify(command);
	const needsPreview = command?.action === "carry";
	const local = useMemo<Prepared | null>(
		() =>
			key === "null"
				? null
				: {
						payload: JSON.parse(key),
						request: crypto.randomUUID(),
						revision,
						key,
					},
		[key, revision],
	);
	const [prepared, setPrepared] = useState<Prepared | null>(null);
	const [attempt, setAttempt] = useState<Prepared | null>(null);
	const [busy, setBusy] = useState(false);
	const [retry, setRetry] = useState(0);
	const [failure, setFailure] = useState<{
		key: string;
		revision: number;
		message: string;
	} | null>(null);
	const error = failure?.key === key ? failure.message : "";
	const running = useRef(false);
	useEffect(() => {
		if (attempt || !needsPreview) return;
		let disposed = false;
		if (key === "null" || paused) return;
		const timer = window.setTimeout(() => {
			const payload = JSON.parse(key) as AccountingCommand;
			const request = crypto.randomUUID();
			void previewAccounting(payload, request, revision)
				.then((result) => {
					if (!disposed)
						setPrepared({ payload, request, revision, key, result });
				})
				.catch((e) => {
					if (!disposed)
						setFailure({ key, revision, message: accountingError(e) });
				});
		}, 180);
		return () => {
			disposed = true;
			window.clearTimeout(timer);
		};
	}, [key, revision, paused, attempt, retry, needsPreview]);
	const ready =
		attempt ??
		(needsPreview
			? prepared?.key === key && prepared.revision === revision
				? prepared
				: null
			: local);
	const confirm = async () => {
		if (!ready || paused || running.current) return false;
		running.current = true;
		setBusy(true);
		setFailure(null);
		setAttempt(ready);
		try {
			await commitAccounting(ready.payload, ready.request, ready.revision);
			await onDone();
			return true;
		} catch (e) {
			if (
				typeof e === "object" &&
				e !== null &&
				"code" in e &&
				e.code === "40001"
			) {
				setAttempt(null);
				await onDone();
				setFailure({
					key,
					revision,
					message:
						"다른 처리가 반영됐어요. 바뀐 내역을 확인한 뒤 다시 확인해 주세요.",
				});
			} else if (typeof e === "object" && e !== null && "code" in e && e.code) {
				// A database rejection rolls back the transaction. Let the user fix it.
				setAttempt(null);
				setFailure({ key, revision, message: accountingError(e) });
			} else {
				setFailure({
					key,
					revision,
					message: `${accountingError(e)} ‘결과 다시 확인’으로 같은 처리의 결과를 확인해 주세요.`,
				});
			}
			return false;
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	return {
		refreshPreview: async () => {
			await onDone();
			setRetry((n) => n + 1);
		},
		confirm,
		result: ready?.result,
		ready: !!ready,
		busy,
		locked: !!attempt,
		error,
		preparing: !!command && !ready && !error && !paused,
	};
}
