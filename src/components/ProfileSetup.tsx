import { useEffect, useRef, useState } from "react";
import { authActions, authDisplayName, useAuthStore } from "../store/authStore";
import {
	bumpPlayerPhotoVersion,
	getPlayerPhotoUrl,
} from "../lib/playerPhoto";
import {
	processImageToSquareJpeg,
	uploadPlayerPhoto,
} from "../lib/playerPhotoUpload";
import {
	magnetGenderBg,
	magnetGenderInk,
	magnetGenderRing,
} from "../lib/magnetStyle";
import KakaoLocationSearch from "./common/KakaoLocationSearch";
import { dongFromAddress } from "../lib/carpool/dong";

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

	// 프로필 사진: 새로 고른 파일은 저장 시 업로드한다(이름 확정 후 그 이름 키로 올림).
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
	const [photoPreview, setPhotoPreview] = useState<string | null>(null);
	const [photoFailed, setPhotoFailed] = useState(false);

	// 로컬 프리뷰 objectURL 정리(메모리 누수 방지).
	useEffect(() => {
		return () => {
			if (photoPreview) URL.revokeObjectURL(photoPreview);
		};
	}, [photoPreview]);

	const handlePickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = ""; // 같은 파일 재선택 허용
		if (!file) return;
		try {
			const blob = await processImageToSquareJpeg(file);
			setPhotoBlob(blob);
			setPhotoPreview((prev) => {
				if (prev) URL.revokeObjectURL(prev);
				return URL.createObjectURL(blob);
			});
			setPhotoFailed(false); // photoFailed는 원격 URL 전용 — 로컬 프리뷰엔 적용 금지
			setError(null);
		} catch (err) {
			console.error("processImageToSquareJpeg:", err);
			setError("이미지를 처리하지 못했어요. 다른 사진을 선택해 주세요.");
		}
	};

	// 원격(이름기반) 사진 URL — 로컬 프리뷰가 없을 때만 사용.
	const remotePhotoUrl = name.trim() ? getPlayerPhotoUrl(name) : null;
	// 성별 미선택(null) 시 성별색 대신 중립 회색(성별 추정 강요 방지).
	const ringColor = gender ? magnetGenderRing(gender) : "#cbd5e1";
	const bgColor = gender ? magnetGenderBg(gender) : "#e2e8f0";
	const inkColor = gender ? magnetGenderInk(gender) : "#64748b";

	// 필수 입력 표시(빨간 별표) — 이름·성별·출생년도·사는곳 모두 필수(프로필 사진만 선택).
	const requiredMark = (
		<span
			style={{ color: "#ef4444", marginLeft: 3, fontWeight: 700 }}
			aria-hidden="true"
		>
			*
		</span>
	);

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
		// 검색 선택·직접입력 모두 저장 시 동 단위로 정규화(상세주소·건물명 등 제거).
		const finalResidence = dongFromAddress(residence);
		setError(null);
		setBusy(true);
		const finalName = name.trim();
		// 사진 먼저 업로드(확정 이름 키로). signup 성공 시 updateProfile이 store를 바꿔
		// 컴포넌트를 언마운트하므로, 사진 업로드/버전 bump는 그 전에 끝낸다.
		if (photoBlob) {
			const uploaded = await uploadPlayerPhoto(finalName, photoBlob);
			if (!uploaded) {
				setError("사진 업로드에 실패했어요. 다시 시도해 주세요.");
				setBusy(false);
				return;
			}
			bumpPlayerPhotoVersion(finalName);
		}
		const ok = await authActions.updateProfile({
			name: finalName,
			gender,
			birthYear: yearNum,
			residence: finalResidence,
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
					{/* 프로필 사진 */}
					<div className="flex flex-col items-center" style={{ gap: 8 }}>
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							style={{
								position: "relative",
								width: 96,
								height: 96,
								borderRadius: "50%",
								border: `3px solid ${ringColor}`,
								background: bgColor,
								padding: 0,
								cursor: "pointer",
								overflow: "hidden",
								flexShrink: 0,
							}}
							aria-label="프로필 사진 변경"
						>
							{/* 로컬 프리뷰(방금 고른 사진)는 항상 표시. 없으면 원격 URL, 그것도 실패하면 이니셜. */}
							{photoPreview ? (
								<img
									src={photoPreview}
									alt="프로필 사진"
									draggable={false}
									style={{
										width: "100%",
										height: "100%",
										objectFit: "cover",
										display: "block",
									}}
								/>
							) : remotePhotoUrl && !photoFailed ? (
								<img
									src={remotePhotoUrl}
									alt="프로필 사진"
									onError={() => setPhotoFailed(true)}
									draggable={false}
									style={{
										width: "100%",
										height: "100%",
										objectFit: "cover",
										display: "block",
									}}
								/>
							) : (
								<span
									style={{
										display: "flex",
										width: "100%",
										height: "100%",
										alignItems: "center",
										justifyContent: "center",
										color: inkColor,
										fontSize: 40,
										fontWeight: 700,
									}}
								>
									{name.trim().charAt(0) || "+"}
								</span>
							)}
						</button>
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							className="text-[#0b84ff]"
							style={{
								background: "none",
								border: "none",
								fontSize: 13,
								fontWeight: 600,
								cursor: "pointer",
								padding: 0,
							}}
						>
							{photoPreview ? "다른 사진 선택" : "사진 변경"}
						</button>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							onChange={handlePickPhoto}
							style={{ display: "none" }}
						/>
					</div>

					{/* 이름 (카카오에서 가져온 값 prefill) */}
					<div>
						<label className={labelCls} style={labelStyle} htmlFor="ps-name">
							이름{requiredMark}
						</label>
						<input
							id="ps-name"
							type="text"
							value={name}
							onChange={(e) => {
								setName(e.target.value);
								// 이름이 바뀌면 사진 URL도 바뀌므로 fallback 상태 초기화(새 URL 재시도).
								if (!photoPreview) setPhotoFailed(false);
							}}
							placeholder="이름"
							className={inputCls}
							style={inputStyle}
						/>
					</div>

					{/* 성별 */}
					<div>
						<span className={labelCls} style={labelStyle}>
							성별{requiredMark}
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
							출생년도{requiredMark}
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

					{/* 사는 곳(동) — 자동완성 검색 + 직접입력 겸용 단일 필드(동 자동 추출). 저장 시 동 단위로 정규화. */}
					<div>
						<span className={labelCls} style={labelStyle}>
							사는 곳 (동){requiredMark}
						</span>
						<p
							className="text-[#64748b] dark:text-[rgba(235,235,245,0.55)]"
							style={{ fontSize: 12, lineHeight: 1.5, marginTop: 2, marginBottom: 8 }}
						>
							카풀 매칭에만 쓰이는 정보예요. 동 단위로만 저장됩니다.
						</p>
						<KakaoLocationSearch
							placeholder="동/장소 이름 입력 (예: 역삼동) → 목록에서 선택"
							heightPx={170}
							value={residence}
							onChangeText={setResidence}
							onPick={(r) => setResidence(r.region)}
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
