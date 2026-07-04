import { useEffect, useRef, useState } from "react";
import { authActions, authDisplayName, useAuthStore } from "../store/authStore";
import { bumpPlayerPhotoVersion } from "../lib/playerPhoto";
import {
	processImageToSquareJpeg,
	uploadPlayerPhoto,
} from "../lib/playerPhotoUpload";
import KakaoLocationSearch from "./common/KakaoLocationSearch";
import ModalSheet from "./common/ModalSheet";
import {
	inputCls,
	inputStyle,
	labelCls,
	labelStyle,
} from "./common/fieldStyles";
import PlayerAvatar from "./shared/PlayerAvatar";
import { dongFromAddress } from "../lib/carpool/dong";

// 프로필 입력 모달. 두 모드:
//   - "signup"(기본): 가입 후 미완 프로필 입력. 닫기 없음(필수). 저장 성공 시 store 갱신으로 Home 이 언마운트.
//   - "edit": 회원정보 수정. 닫기/취소 가능 + 회원 탈퇴 버튼. 저장 성공 시 onClose 로 닫음.
// 이름(카카오 prefill, 성/이름 분리 입력 — 성 누락 방지, 저장은 합쳐서 members.name 한 컬럼)·
// 성별·출생년도·거주지(동) 입력.

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

	// 이름은 카카오에서 받아온 값(members.name)으로 prefill.
	// 성/이름 분리: 첫 글자=성, 나머지=이름으로 쪼갠다. 복성(남궁 등)이 갈려도
	// 저장 시 그대로 이어 붙이므로 사용자가 안 고치면 원본과 동일(무손실).
	const prefillName = (myName || authDisplayName(user)).trim();
	const [lastName, setLastName] = useState(prefillName.slice(0, 1));
	const [firstName, setFirstName] = useState(prefillName.slice(1));
	// DB에는 합친 한 컬럼(members.name)으로 저장 — 사진 키·이니셜도 이 값 기준.
	const fullName = lastName.trim() + firstName.trim();
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
			setError(null);
		} catch (err) {
			console.error("processImageToSquareJpeg:", err);
			setError("이미지를 처리하지 못했어요. 다른 사진을 선택해 주세요.");
		}
	};

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
		if (!lastName.trim()) {
			setError("성을 입력하세요.");
			return;
		}
		if (!firstName.trim()) {
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
		const finalName = fullName;
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
		// signup 모드는 onClose 미전달 → 배경 클릭/Escape 로 닫히지 않음(필수 입력 유지).
		<ModalSheet
			position="center"
			zIndex={70}
			closeOnEscape={mode === "edit"}
			onClose={mode === "edit" ? onClose : undefined}
			title={mode === "edit" ? "회원정보 수정" : "가입 정보 입력"}
		>
			<div className="px-5 pb-5">
				<p
					className="text-muted"
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
								padding: 0,
								border: "none",
								background: "none",
								borderRadius: "50%",
								cursor: "pointer",
								flexShrink: 0,
							}}
							aria-label="프로필 사진 변경"
						>
							{/* 로컬 프리뷰(방금 고른 사진)는 항상 표시. 없으면 원격 URL, 그것도 실패하면 이니셜.
							    key=이름: 이름이 바뀌면 사진 URL 도 바뀌므로 리마운트로 onError fallback 을 초기화(새 URL 재시도).
							    성별 미선택(null) 시엔 성별색 대신 중립 회색(성별 추정 강요 방지). */}
							<PlayerAvatar
								key={fullName}
								name={fullName}
								gender={gender}
								size={96}
								ringWidth={3}
								previewSrc={photoPreview ?? undefined}
								fallbackChar="+"
								ringColor={gender ? undefined : "#cbd5e1"}
								bgColor={gender ? undefined : "#e2e8f0"}
								inkColor={gender ? undefined : "#64748b"}
							/>
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

					{/* 이름 — 성/이름 분리 입력(성 누락 방지). 카카오 값을 첫 글자/나머지로 쪼개 prefill. */}
					<div>
						<label className={labelCls} style={labelStyle} htmlFor="ps-last-name">
							이름{requiredMark}
						</label>
						<div className="flex gap-2">
							<input
								id="ps-last-name"
								type="text"
								value={lastName}
								onChange={(e) => setLastName(e.target.value)}
								placeholder="성"
								aria-label="성"
								className={inputCls}
								style={{ ...inputStyle, flex: "1 1 0" }}
							/>
							<input
								id="ps-first-name"
								type="text"
								value={firstName}
								onChange={(e) => setFirstName(e.target.value)}
								placeholder="이름"
								aria-label="이름"
								className={inputCls}
								style={{ ...inputStyle, flex: "2.6 1 0" }}
							/>
						</div>
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
							className="text-muted"
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
						className="btn-solid-blue"
						style={{ marginTop: 2 }}
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
		</ModalSheet>
	);
}
