import { useState } from "react";
import { authActions, authDisplayName, useAuthStore } from "../store/authStore";
import KakaoLocationSearch from "./common/KakaoLocationSearch";

// 프로필 입력 모달. 두 모드:
//   - "signup"(기본): 가입 후 미완 프로필 입력. 닫기 없음(필수). 저장 성공 시 store 갱신으로 Home 이 언마운트.
//   - "edit": 회원정보 수정. 닫기/취소 가능 + 회원 탈퇴 버튼. 저장 성공 시 onClose 로 닫음.
// 이름(카카오 prefill)·성별·출생년도·거주지(동) 입력.

const labelCls = "text-[#64748b] dark:text-[rgba(235,235,245,0.6)] block mb-1.5";
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const inputCls =
	"w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-[#0f1724] dark:text-white border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]";
const inputStyle: React.CSSProperties = {
	padding: "11px 13px",
	borderRadius: 10,
	fontSize: 15,
	outline: "none",
};

const CURRENT_YEAR = new Date().getFullYear();

interface Props {
	mode?: "signup" | "edit";
	onClose?: () => void;
}

export default function ProfileSetup({ mode = "signup", onClose }: Props) {
	const user = useAuthStore((s) => s.user);
	const myName = useAuthStore((s) => s.myName);
	const myGender = useAuthStore((s) => s.myGender);
	const myBirthYear = useAuthStore((s) => s.myBirthYear);
	const myResidence = useAuthStore((s) => s.myResidence);

	// 이름은 카카오에서 받아온 값(members.name)으로 prefill
	const [name, setName] = useState(myName || authDisplayName(user));
	const [gender, setGender] = useState<"M" | "F" | null>(myGender);
	const [birthYear, setBirthYear] = useState(
		myBirthYear != null ? String(myBirthYear) : "",
	);
	const [residence, setResidence] = useState(myResidence ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSave = async () => {
		if (busy) return;
		const yearNum = Number(birthYear);
		if (!name.trim()) {
			setError("이름을 입력하세요.");
			return;
		}
		if (!gender) {
			setError("성별을 선택하세요.");
			return;
		}
		if (
			!birthYear.trim() ||
			!Number.isInteger(yearNum) ||
			yearNum < 1900 ||
			yearNum > CURRENT_YEAR
		) {
			setError("출생년도를 올바르게 입력하세요.");
			return;
		}
		if (!residence.trim()) {
			setError("사는 곳(동)을 입력하세요.");
			return;
		}
		setError(null);
		setBusy(true);
		const ok = await authActions.updateProfile({
			name: name.trim(),
			gender,
			birthYear: yearNum,
			residence: residence.trim(),
		});
		if (ok) {
			// signup: store 갱신 → Home 이 언마운트. edit: 명시적으로 닫기.
			if (mode === "edit") onClose?.();
		} else {
			setError("저장에 실패했어요. 다시 시도해 주세요.");
			setBusy(false);
		}
	};

	const handleDelete = async () => {
		if (busy) return;
		if (
			!confirm(
				"정말 탈퇴하시겠어요?\n계정과 회원 정보가 삭제되며 되돌릴 수 없습니다.",
			)
		)
			return;
		setBusy(true);
		setError(null);
		const ok = await authActions.deleteAccount();
		// 성공 시 로그아웃 → 로그인 화면으로(컴포넌트 언마운트). 실패만 처리.
		if (!ok) {
			setError("탈퇴 처리에 실패했어요. 다시 시도해 주세요.");
			setBusy(false);
		}
	};

	const genderBtn = (active: boolean, color: string): React.CSSProperties => ({
		flex: 1,
		padding: "12px 0",
		borderRadius: 10,
		fontSize: 15,
		fontWeight: 700,
		border: "none",
		cursor: "pointer",
		color: active ? "#fff" : "#64748b",
		background: active ? color : "rgba(100,116,139,0.12)",
	});

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				background: "rgba(0,0,0,0.5)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				zIndex: 70,
				padding: "1.25rem",
			}}
			onClick={mode === "edit" ? onClose : undefined}
			onKeyDown={(e) => {
				if (e.key === "Escape" && mode === "edit") onClose?.();
			}}
		>
			<div
				className="w-full max-w-sm bg-[#fafbff] dark:bg-[#0f172a]"
				style={{
					borderRadius: 16,
					padding: "1.5rem",
					boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
					maxHeight: "88dvh",
					overflowY: "auto",
				}}
				onClick={(e) => e.stopPropagation()}
			>
				<div
					className="flex items-start justify-between"
					style={{ marginBottom: 4 }}
				>
					<h2
						className="text-[#0f1724] dark:text-white"
						style={{ fontSize: 19, fontWeight: 800 }}
					>
						{mode === "edit" ? "회원정보 수정" : "가입 정보 입력"}
					</h2>
					{mode === "edit" && (
						<button
							type="button"
							onClick={onClose}
							className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
							style={{
								background: "none",
								border: "none",
								fontSize: 22,
								lineHeight: 1,
								cursor: "pointer",
								padding: "0 2px",
							}}
							aria-label="닫기"
						>
							×
						</button>
					)}
				</div>
				<p
					className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
					style={{ fontSize: 13.5, marginBottom: 18, lineHeight: 1.5 }}
				>
					{mode === "edit"
						? "정보를 수정한 뒤 저장하세요."
						: "원활한 모임 운영을 위해 아래 정보를 입력해 주세요."}
				</p>

				<div className="flex flex-col gap-4">
					{/* 이름 (카카오에서 가져온 값 prefill) */}
					<div>
						<label className={labelCls} style={labelStyle} htmlFor="ps-name">
							이름
						</label>
						<input
							id="ps-name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="이름"
							className={inputCls}
							style={inputStyle}
						/>
					</div>

					{/* 성별 */}
					<div>
						<span className={labelCls} style={labelStyle}>
							성별
						</span>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setGender("M")}
								style={genderBtn(gender === "M", "#1366a6")}
							>
								남
							</button>
							<button
								type="button"
								onClick={() => setGender("F")}
								style={genderBtn(gender === "F", "#b4762b")}
							>
								여
							</button>
						</div>
					</div>

					{/* 출생년도 */}
					<div>
						<label className={labelCls} style={labelStyle} htmlFor="ps-year">
							출생년도
						</label>
						<input
							id="ps-year"
							type="number"
							inputMode="numeric"
							min={1900}
							max={CURRENT_YEAR}
							value={birthYear}
							onChange={(e) => setBirthYear(e.target.value)}
							placeholder="예: 1990"
							className={inputCls}
							style={inputStyle}
						/>
					</div>

					{/* 사는 곳(동) — 지도 검색으로 선택(동 자동 추출), 직접 입력도 가능 */}
					<div>
						<label className={labelCls} style={labelStyle} htmlFor="ps-res">
							사는 곳 (동)
						</label>
						<KakaoLocationSearch
							placeholder="동/장소 이름으로 검색 (예: 역삼동)"
							heightPx={170}
							onPick={(r) => setResidence(r.region)}
						/>
						<input
							id="ps-res"
							type="text"
							value={residence}
							onChange={(e) => setResidence(e.target.value)}
							placeholder="검색해서 선택하거나 동을 직접 입력"
							className={inputCls}
							style={{ ...inputStyle, marginTop: 8 }}
						/>
					</div>

					{error && (
						<p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>
							{error}
						</p>
					)}

					<button
						type="button"
						onClick={handleSave}
						disabled={busy}
						style={{
							width: "100%",
							padding: "14px",
							borderRadius: 12,
							fontSize: 16,
							fontWeight: 700,
							color: "#fff",
							background: busy ? "rgba(11,132,255,0.5)" : "#0b84ff",
							border: "none",
							cursor: busy ? "not-allowed" : "pointer",
							boxShadow: busy ? "none" : "0 4px 16px rgba(11,132,255,0.3)",
							marginTop: 2,
						}}
					>
						{busy
							? "저장 중…"
							: mode === "edit"
								? "저장"
								: "저장하고 시작하기"}
					</button>

					{mode === "edit" && (
						<button
							type="button"
							onClick={handleDelete}
							disabled={busy}
							style={{
								width: "100%",
								padding: "12px",
								borderRadius: 12,
								fontSize: 14,
								fontWeight: 700,
								color: "#ef4444",
								background: "none",
								border: "none",
								cursor: busy ? "not-allowed" : "pointer",
								opacity: busy ? 0.5 : 1,
							}}
						>
							회원 탈퇴
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
