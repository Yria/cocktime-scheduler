import { Download, MonitorDown, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import pushInstallAndroid from "../../assets/push-install-android.webp";
import pushInstallIos from "../../assets/push-install-ios.webp";
import { isAndroid, isIOS } from "../../lib/push/platform";
import { useAuthStore } from "../../store/authStore";
import { pushActions, usePushStore } from "../../store/pushStore";
import { toast } from "../../store/toastStore";
import Spinner from "../shared/Spinner";
import ModalSheet from "./ModalSheet";
import SheetHeader from "./SheetHeader";

interface Props {
	onClose: () => void;
}

function platformLabel(): string {
	if (isIOS()) return "아이폰";
	if (isAndroid()) return "안드로이드";
	return "이 기기";
}

interface InstallStep {
	icon: React.ReactNode;
	text: string;
}

/** 데스크톱 홈 화면 설치 단계(모바일은 이미지 안내로 대체). */
function installSteps(): InstallStep[] {
	return [
		{
			icon: <MonitorDown size={16} />,
			text: "주소창 오른쪽의 설치 아이콘을 누르세요",
		},
		{ icon: <Download size={16} />, text: "'설치'를 선택하세요" },
	];
}

/** 권한 차단(denied) 시 해제 경로 안내 */
function unblockHint(): string {
	if (isIOS()) return "기기 설정 > 알림 > 콕타임에서 '알림 허용'을 켜주세요.";
	if (isAndroid())
		return "기기 설정 > 앱 > 콕타임 > 알림에서 허용으로 바꿔주세요.";
	return "브라우저 주소창의 자물쇠 아이콘 > 알림에서 허용으로 바꿔주세요.";
}

export default function PushSettingsSheet({ onClose }: Props) {
	const memberId = useAuthStore((s) => s.memberId);
	const installState = usePushStore((s) => s.installState);
	const permission = usePushStore((s) => s.permission);
	const subscribed = usePushStore((s) => s.subscribed);
	const busy = usePushStore((s) => s.busy);

	// 모달을 열 때 현재 구독 가능 상태를 최신으로 다시 파악(권한·구독·설치 여부).
	const [checking, setChecking] = useState(true);
	useEffect(() => {
		let alive = true;
		void pushActions.init().finally(() => {
			if (alive) setChecking(false);
		});
		return () => {
			alive = false;
		};
	}, []);

	const handleEnable = async () => {
		if (!memberId) return;
		try {
			const st = await pushActions.enable(memberId);
			if (st.subscribed) {
				toast("잠금화면 알림이 켜졌어요", { variant: "success" });
			} else if (st.permission === "denied") {
				toast("알림이 차단되어 있어요", { variant: "error" });
			}
		} catch {
			toast("알림을 켜지 못했어요", { variant: "error" });
		}
	};

	const handleDisable = async () => {
		if (!memberId) return;
		await pushActions.disable(memberId);
		toast("잠금화면 알림을 껐어요");
	};

	const note = (text: string) => (
		<p className="text-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
			{text}
		</p>
	);

	// 플랫폼별 "홈 화면에 앱 추가" 안내. 모바일(iOS/안드로이드)은 스크린샷 이미지,
	// 데스크톱은 텍스트 단계로 안내한다.
	const installGuide = () => {
		const img = isIOS() ? pushInstallIos : isAndroid() ? pushInstallAndroid : null;
		if (img) {
			// 스크린샷 이미지가 설치 절차를 전부 설명하므로 부가 텍스트는 두지 않는다(이미지만).
			return (
				<img
					src={img}
					alt={`${platformLabel()} 앱 설치 안내`}
					style={{
						width: "100%",
						height: "auto",
						borderRadius: 14,
						display: "block",
					}}
				/>
			);
		}
		// 데스크톱: 이미지가 없어 텍스트 단계로 안내
		return (
			<div className="rounded-xl p-3.5 bg-[rgba(11,132,255,0.06)] dark:bg-[rgba(11,132,255,0.12)]">
				<p
					className="text-strong"
					style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}
				>
					📲 {platformLabel()}에서 앱으로 설치하기
				</p>
				<div className="flex flex-col gap-2.5">
					{installSteps().map((s) => (
						<div key={s.text} className="flex items-center gap-2.5">
							<span
								className="flex items-center justify-center rounded-lg text-[#0b84ff] bg-[rgba(11,132,255,0.1)] dark:bg-[rgba(11,132,255,0.18)]"
								style={{ width: 26, height: 26, flexShrink: 0 }}
							>
								{s.icon}
							</span>
							<span
								className="text-[#0f1724] dark:text-[rgba(235,235,245,0.85)]"
								style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 }}
							>
								{s.text}
							</span>
						</div>
					))}
				</div>
				<div style={{ marginTop: 8 }}>
					{note("설치한 뒤 이 화면에서 알림을 켜면 잠금화면으로 알림을 받아요.")}
				</div>
			</div>
		);
	};

	// ── 구독 가능 여부를 먼저 파악해 분기 ──
	let content: React.ReactNode;
	if (checking) {
		content = (
			<div className="flex items-center gap-2 py-3">
				<Spinner size={14} />
				<span className="text-muted" style={{ fontSize: 13 }}>
					알림 사용 가능 여부 확인 중…
				</span>
			</div>
		);
	} else if (installState === "unsupported") {
		content = note(
			"이 브라우저는 잠금화면 알림을 지원하지 않아요. 카카오톡 등 인앱 브라우저라면 Chrome·Safari로 열어 주세요.",
		);
	} else if (installState === "needs-install") {
		// 알림 필수 조건 — 홈 화면에 앱 설치 필요(iOS·Android·데스크톱 공통).
		// 필수 안내 문구 + 플랫폼별 설치 안내(모바일=스크린샷 이미지, 데스크톱=단계) + 후속 안내.
		content = (
			<div className="flex flex-col gap-2.5">
				{note("잠금화면 알림을 받으려면 먼저 홈 화면에 앱을 설치해야 해요.")}
				{installGuide()}
				{note(
					"설치한 뒤에는 브라우저가 아니라 홈 화면의 앱 아이콘으로 열어야 알림을 켤 수 있어요. (카카오톡 등 인앱 브라우저에서는 설치가 안 되니 Chrome·Safari로 열어 주세요.)",
				)}
			</div>
		);
	} else if (permission === "denied") {
		// 구독 불가 — 권한 차단됨 → 해제 도움말
		content = (
			<div className="flex flex-col gap-1.5">
				{note("알림이 차단돼 있어 켤 수 없어요.")}
				<div className="flex items-start gap-2">
					<span className="text-[#0b84ff]" style={{ flexShrink: 0, marginTop: 2 }}>
						<Settings size={16} />
					</span>
					{note(unblockHint())}
				</div>
			</div>
		);
	} else if (subscribed) {
		content = (
			<div className="flex flex-col gap-3">
				{note("잠금화면 알림이 켜져 있어요.")}
				<button
					type="button"
					onClick={handleDisable}
					disabled={busy}
					className="btn-tint-red"
				>
					{busy ? "처리 중…" : "알림 끄기"}
				</button>
			</div>
		);
	} else {
		// 구독 가능 — 여기 도달하면 이미 홈 화면 설치(standalone) 상태이므로 바로 켜기만 안내.
		content = (
			<div className="flex flex-col gap-3">
				{note("앱을 닫아도 대기→참석 확정, 일정 변경 알림을 받을 수 있어요.")}
				<button
					type="button"
					onClick={handleEnable}
					disabled={busy}
					className="btn-solid-blue text-[15px]"
				>
					{busy ? "처리 중…" : "잠금화면 알림 켜기"}
				</button>
			</div>
		);
	}

	return (
		<ModalSheet position="bottom" onClose={onClose}>
			{/* 닫기는 기존대로 배경 클릭 — ✕ 칩 없이 제목만(SheetHeader onClose 미전달) */}
			<SheetHeader title="잠금화면 알림" />
			<div className="px-5 pb-6 flex flex-col gap-3">{content}</div>
		</ModalSheet>
	);
}
