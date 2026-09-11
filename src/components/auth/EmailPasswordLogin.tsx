import { useId, useRef, useState, type FormEvent } from "react";
import { authActions } from "../../store/authStore";
import { inputCls, inputStyle, labelCls, labelStyle } from "../common/fieldStyles";
import { emailPasswordErrorMessage, validateEmailPassword } from "./emailPasswordValidation";

interface Props {
	/** 다른 로그인 수단이 진행 중이면 입력·전송을 함께 막는다. */
	disabled?: boolean;
	onBusyChange?: (busy: boolean) => void;
}

export default function EmailPasswordLogin({ disabled = false, onBusyChange }: Props) {
	const id = useId();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// 같은 프레임의 연속 submit도 상태 업데이트를 기다리지 않고 차단한다.
	const submitting = useRef(false);
	const unavailable = disabled || busy;

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (disabled || submitting.current) return;
		const validationError = validateEmailPassword(email, password);
		setError(validationError);
		if (validationError) return;
		submitting.current = true;
		setBusy(true);
		onBusyChange?.(true);
		try {
			await authActions.signInWithPassword(email, password);
			setPassword("");
		} catch (cause) {
			setError(emailPasswordErrorMessage(cause));
		} finally {
			submitting.current = false;
			setBusy(false);
			onBusyChange?.(false);
		}
	};

	return (
		<form aria-label="이메일 로그인" aria-busy={busy} onSubmit={handleSubmit} noValidate className="w-full flex flex-col gap-3">
			<div>
				<label htmlFor={`${id}-email`} className={labelCls} style={labelStyle}>이메일</label>
				<input
					id={`${id}-email`} name="email" type="email" autoComplete="email" inputMode="email"
					autoCapitalize="none" autoCorrect="off" spellCheck={false} required disabled={unavailable}
					value={email} onChange={(event) => { setEmail(event.target.value); setError(null); }}
					aria-describedby={error ? `${id}-error` : undefined}
					className={`${inputCls} focus:ring-2 focus:ring-[#0b84ff]/40 disabled:opacity-60`} style={{ ...inputStyle, fontSize: 16 }}
				/>
			</div>
			<div>
				<label htmlFor={`${id}-password`} className={labelCls} style={labelStyle}>비밀번호</label>
				<div className="relative">
					<input
						id={`${id}-password`} name="password" type={showPassword ? "text" : "password"}
						autoComplete="current-password" required disabled={unavailable}
						autoCapitalize="none" autoCorrect="off" spellCheck={false}
						value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }}
						aria-describedby={error ? `${id}-error` : undefined}
						className={`${inputCls} focus:ring-2 focus:ring-[#0b84ff]/40 disabled:opacity-60`}
						style={{ ...inputStyle, fontSize: 16, paddingRight: 62 }}
					/>
					<button
						type="button" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
						aria-pressed={showPassword} disabled={unavailable} onClick={() => setShowPassword((shown) => !shown)}
						className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-muted disabled:opacity-60"
					>{showPassword ? "숨김" : "보기"}</button>
				</div>
			</div>
			{error && <p id={`${id}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
			<button
				type="submit" disabled={unavailable}
				className="w-full rounded-xl bg-[#0b84ff] px-4 py-3 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
			>{busy ? "로그인 중…" : "이메일로 로그인"}</button>
		</form>
	);
}
