/* ────────────────────────────────────────────────────────────────
 * ⚠️ 임시 파일 — 확인용 테스트 계정 진입 수단. 확인이 끝나면 **삭제**한다.
 *
 * 지우는 방법(2곳):
 *   1) 이 파일 삭제
 *   2) src/components/Home.tsx 에서 `TempTestLogin` import 1줄 + 로그인 화면의 <TempTestLogin /> 1줄 삭제
 *
 * 왜 필요한가: 로그인 UI가 카카오 OAuth 전용이라, 이메일/비밀번호로 만든 테스트 계정으로는
 * 들어갈 방법이 없다. signInWithPassword 는 **기존 계정 로그인만** 한다(가입 경로가 아니다) —
 * 자격증명을 모르면 아무것도 못 하므로 이 폼 자체가 새 진입로를 열지는 않는다.
 * 그래도 로그인 표면이 하나 늘어나는 것은 사실이므로 확인이 끝나면 바로 지운다.
 * ──────────────────────────────────────────────────────────────── */
import { useState } from "react";
import { supabase } from "../lib/supabase/client";

export default function TempTestLogin() {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [pw, setPw] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const submit = async () => {
		setBusy(true);
		setErr(null);
		const { error } = await supabase.auth.signInWithPassword({
			email: email.trim(),
			password: pw,
		});
		setBusy(false);
		// 성공하면 onAuthStateChange 가 세션을 받아 화면이 알아서 넘어간다.
		if (error) setErr(error.message);
	};

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="text-faint"
				style={{
					background: "none",
					border: "none",
					fontSize: 12,
					fontWeight: 500,
					cursor: "pointer",
					padding: "2px 0",
				}}
			>
				테스트 로그인
			</button>
		);
	}

	return (
		<div className="flex flex-col gap-2" style={{ width: "100%" }}>
			<input
				type="email"
				inputMode="email"
				autoCapitalize="none"
				autoCorrect="off"
				placeholder="이메일"
				value={email}
				onChange={(e) => setEmail(e.target.value)}
				className="text-strong"
				style={{
					width: "100%",
					padding: "11px 12px",
					borderRadius: 10,
					fontSize: 15,
					background: "rgba(0,0,0,0.03)",
					border: "1px solid rgba(0,0,0,0.12)",
				}}
			/>
			<input
				type="password"
				placeholder="비밀번호"
				value={pw}
				onChange={(e) => setPw(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") void submit();
				}}
				className="text-strong"
				style={{
					width: "100%",
					padding: "11px 12px",
					borderRadius: 10,
					fontSize: 15,
					background: "rgba(0,0,0,0.03)",
					border: "1px solid rgba(0,0,0,0.12)",
				}}
			/>
			{err && (
				<span className="text-[#d1362c]" style={{ fontSize: 12 }}>
					{err}
				</span>
			)}
			<button
				type="button"
				onClick={() => void submit()}
				disabled={busy || !email.trim() || !pw}
				style={{
					width: "100%",
					padding: "12px",
					borderRadius: 10,
					fontSize: 15,
					fontWeight: 700,
					color: "#fff",
					background: busy ? "rgba(11,132,255,0.5)" : "#0b84ff",
					border: "none",
					cursor: busy ? "not-allowed" : "pointer",
				}}
			>
				{busy ? "로그인 중…" : "로그인"}
			</button>
		</div>
	);
}
