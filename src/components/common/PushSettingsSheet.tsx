import { isAndroid, isIOS, isStandalone } from "../../lib/push/platform";
import { useAuthStore } from "../../store/authStore";
import { pushActions, usePushStore } from "../../store/pushStore";
import { toast } from "../../store/toastStore";
import ModalSheet from "./ModalSheet";

interface Props {
	onClose: () => void;
}

const primaryBtn: React.CSSProperties = {
	width: "100%",
	padding: "14px",
	borderRadius: 12,
	fontSize: 15,
	fontWeight: 700,
	color: "#fff",
	background: "#0b84ff",
	border: "none",
	cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
	width: "100%",
	padding: "14px",
	borderRadius: 12,
	fontSize: 15,
	fontWeight: 700,
	color: "#ff3b30",
	background: "rgba(255,59,48,0.1)",
	border: "none",
	cursor: "pointer",
};

function platformLabel(): string {
	if (isIOS()) return "아이폰";
	if (isAndroid()) return "안드로이드";
	return "이 기기";
}

/** 플랫폼별 홈 화면 설치 단계 */
function installSteps(): string[] {
	if (isIOS())
		return [
			"Safari 하단의 공유 버튼(□↑)을 누르세요",
			"'홈 화면에 추가'를 선택하세요",
			"홈 화면의 '콕타임' 아이콘으로 다시 여세요",
		];
	if (isAndroid())
		return [
			"Chrome 오른쪽 위 ⋮ 메뉴를 누르세요",
			"'앱 설치'(또는 '홈 화면에 추가')를 선택하세요",
			"설치된 '콕타임' 앱으로 다시 여세요",
		];
	return [
		"주소창 오른쪽의 설치 아이콘을 누르세요",
		"'설치'를 선택하세요",
	];
}

export default function PushSettingsSheet({ onClose }: Props) {
	const memberId = useAuthStore((s) => s.memberId);
	const installState = usePushStore((s) => s.installState);
	const permission = usePushStore((s) => s.permission);
	const subscribed = usePushStore((s) => s.subscribed);
	const busy = usePushStore((s) => s.busy);
	const standalone = isStandalone();

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
		<p
			className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
			style={{ fontSize: 13, lineHeight: 1.6 }}
		>
			{text}
		</p>
	);

	// 플랫폼별 "홈 화면에 앱 추가" 단계 안내
	const installGuide = (highlight: boolean) => (
		<div
			className={
				highlight
					? "rounded-xl p-3.5 bg-[rgba(11,132,255,0.06)] dark:bg-[rgba(11,132,255,0.12)]"
					: ""
			}
		>
			<p
				className="text-[#0f1724] dark:text-white"
				style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}
			>
				📲 {platformLabel()}에서 앱으로 설치하기
			</p>
			<ol
				className="text-[#0f1724] dark:text-[rgba(235,235,245,0.85)]"
				style={{ fontSize: 13.5, fontWeight: 500, paddingLeft: 18, lineHeight: 1.9 }}
			>
				{installSteps().map((s) => (
					<li key={s}>{s}</li>
				))}
			</ol>
			{note("설치한 뒤 이 화면에서 알림을 켜면 잠금화면으로 알림을 받아요.")}
		</div>
	);

	let content: React.ReactNode;
	if (installState === "unsupported") {
		content = note("이 브라우저는 잠금화면 알림을 지원하지 않아요.");
	} else if (installState === "ios-needs-install") {
		// iOS는 홈 화면에 설치해야만 알림 가능 → 설치 안내를 메인으로
		content = (
			<div className="flex flex-col gap-2">
				{note(
					"아이폰은 홈 화면에 추가해야 잠금화면 알림을 받을 수 있어요. 아래 순서로 설치해 주세요.",
				)}
				{installGuide(true)}
			</div>
		);
	} else if (permission === "denied") {
		content = note(
			"알림이 차단되어 있어요. 기기 설정 > 콕타임 > 알림에서 허용으로 바꿔 주세요.",
		);
	} else if (subscribed) {
		content = (
			<div className="flex flex-col gap-3">
				{note("잠금화면 알림이 켜져 있어요.")}
				<button
					type="button"
					onClick={handleDisable}
					disabled={busy}
					style={{ ...secondaryBtn, opacity: busy ? 0.6 : 1 }}
				>
					{busy ? "처리 중…" : "알림 끄기"}
				</button>
			</div>
		);
	} else {
		// 켤 수 있는 상태(이미 설치됐거나 Android/데스크톱)
		content = (
			<div className="flex flex-col gap-3">
				{note("앱을 닫아도 대기→참석 확정, 일정 변경 알림을 받을 수 있어요.")}
				<button
					type="button"
					onClick={handleEnable}
					disabled={busy}
					style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}
				>
					{busy ? "처리 중…" : "잠금화면 알림 켜기"}
				</button>
				{/* 아직 홈 화면에 설치 안 했으면 설치 방법을 접이식으로 안내 */}
				{!standalone && (
					<details className="mt-1">
						<summary
							className="text-[#0b84ff] cursor-pointer"
							style={{ fontSize: 13, fontWeight: 600, listStyle: "none" }}
						>
							📲 앱으로 설치하는 방법 (권장)
						</summary>
						<div className="mt-2">{installGuide(false)}</div>
					</details>
				)}
			</div>
		);
	}

	return (
		<ModalSheet position="bottom" onClose={onClose}>
			<div className="px-5 pt-5 pb-6 flex flex-col gap-3">
				<h3
					className="text-[#0f1724] dark:text-white"
					style={{ fontSize: 17, fontWeight: 800 }}
				>
					잠금화면 알림
				</h3>
				{content}
			</div>
		</ModalSheet>
	);
}
