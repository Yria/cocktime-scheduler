import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { isIOS } from "../../lib/push/platform";
import {
	installPromptActions,
	shouldShowInstallPrompt,
	useInstallPromptStore,
} from "../../store/installPromptStore";
import { toast, useToastStore } from "../../store/toastStore";
import InstallGuide from "./InstallGuide";
import ModalSheet from "./ModalSheet";
import SheetHeader from "./SheetHeader";

/** 첫 진입 직후 바로 튀지 않도록 살짝 지연 후 등장(초기 렌더 방해 방지). */
const APPEAR_DELAY_MS = 1500;

/**
 * 홈 화면 PWA 설치 유도 토스트 — 로그인된 홈 화면 하단에 떠서 "홈 화면에 앱으로 추가"를 권한다.
 * - Android/Chrome: '추가' → 네이티브 설치 프롬프트(원탭).
 * - iOS/네이티브 프롬프트 없음: '설치 방법' → 공유→홈화면추가 이미지 안내(InstallGuide) 시트.
 * - 이미 설치·닫음·인앱·데스크톱이면 렌더하지 않는다(shouldShowInstallPrompt).
 */
export default function InstallPromptToast() {
	const state = useInstallPromptStore();
	const canShow = shouldShowInstallPrompt(state);
	// 전역 Toaster(하단 중앙, z=2000)와 겹치지 않게, 알림 토스트가 떠 있으면 그 스택 위로 올린다.
	const toastCount = useToastStore((s) => s.items.length);

	const [appeared, setAppeared] = useState(false);
	const [showGuide, setShowGuide] = useState(false);

	useEffect(() => {
		if (!canShow) return;
		const t = window.setTimeout(() => setAppeared(true), APPEAR_DELAY_MS);
		return () => window.clearTimeout(t);
	}, [canShow]);

	if (!canShow) return null;

	const hasNativePrompt = state.deferred != null;

	const handleAdd = async () => {
		if (hasNativePrompt) {
			const outcome = await installPromptActions.promptInstall();
			if (outcome === "accepted") toast("홈 화면에 추가했어요", { variant: "success" });
			else if (outcome === "unavailable") setShowGuide(true); // 만약을 대비한 폴백
			// 'dismissed'(사용자가 네이티브 프롬프트를 취소)면 토스트는 유지 — 다시 시도 가능.
		} else {
			setShowGuide(true);
		}
	};

	return (
		<>
			<div
				role="region"
				aria-label="홈 화면에 앱 추가 안내"
				style={{
					position: "fixed",
					left: 12,
					right: 12,
					// 전역 Toaster(하단 safe+24부터 위로 스택)가 있으면 그 위로 올려 겹침 회피.
					bottom: `calc(env(safe-area-inset-bottom, 0px) + ${
						toastCount > 0 ? 24 + toastCount * 48 + 12 : 16
					}px)`,
					// 앱 모달(ModalSheet 기본 50) 아래 · 콘텐츠 위. 모달이 열리면 토스트를 덮고,
					// 이 토스트의 '설치 방법' 안내 시트(z=50)도 토스트 위에 올라온다.
					zIndex: 40,
					display: "flex",
					justifyContent: "center",
					pointerEvents: "none",
				}}
			>
				<div
					className="bg-white dark:bg-[#23232a] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.1)]"
					style={{
						pointerEvents: "auto",
						width: "100%",
						maxWidth: 440,
						borderRadius: 16,
						padding: "12px 12px 12px 14px",
						display: "flex",
						alignItems: "center",
						gap: 12,
						boxShadow: "0 10px 30px rgba(0,0,0,0.22)",
						transform: appeared ? "translateY(0)" : "translateY(140%)",
						opacity: appeared ? 1 : 0,
						transition: "transform 0.32s cubic-bezier(0.22,1,0.36,1), opacity 0.32s",
					}}
				>
					<div
						aria-hidden="true"
						style={{
							width: 40,
							height: 40,
							borderRadius: 11,
							flexShrink: 0,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 22,
							background:
								"linear-gradient(135deg, rgba(11,132,255,0.16), rgba(44,122,87,0.16))",
						}}
					>
						📲
					</div>

					<div className="min-w-0 flex-1">
						<div
							className="text-strong"
							style={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.3 }}
						>
							홈 화면에 앱으로 추가
						</div>
						<div
							className="text-faint"
							style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.35 }}
						>
							그래야 대기→참석 확정, 일정 변경 등 참여 알림을 받을 수 있어요
						</div>
					</div>

					<button
						type="button"
						onClick={handleAdd}
						style={{
							flexShrink: 0,
							fontSize: 13,
							fontWeight: 700,
							color: "#fff",
							background: "#0b84ff",
							border: "none",
							borderRadius: 9,
							padding: "8px 14px",
							cursor: "pointer",
						}}
					>
						{hasNativePrompt ? "추가" : "설치 방법"}
					</button>

					<button
						type="button"
						onClick={() => installPromptActions.dismiss()}
						aria-label="닫기"
						className="text-faint hover:text-[#e5484d] hover:bg-[rgba(229,72,77,0.12)] transition-colors"
						style={{
							flexShrink: 0,
							width: 28,
							height: 28,
							borderRadius: 999,
							border: "none",
							background: "transparent",
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							cursor: "pointer",
						}}
					>
						<X size={16} strokeWidth={2.5} />
					</button>
				</div>
			</div>

			{showGuide && (
				<ModalSheet position="bottom" onClose={() => setShowGuide(false)}>
					<SheetHeader
						title="홈 화면에 앱 추가하기"
						onClose={() => setShowGuide(false)}
					/>
					<div className="px-5 pb-5 flex flex-col gap-3">
						<p className="text-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
							{isIOS()
								? "공유 버튼을 누른 뒤 '홈 화면에 추가'를 선택하세요."
								: "브라우저 메뉴에서 '앱 설치' 또는 '홈 화면에 추가'를 선택하세요."}
							{" 그래야 대기→참석 확정, 일정 변경 등 참여 알림을 받을 수 있어요."}
						</p>
						<InstallGuide />
					</div>
				</ModalSheet>
			)}
		</>
	);
}
