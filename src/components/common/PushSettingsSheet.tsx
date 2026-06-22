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

export default function PushSettingsSheet({ onClose }: Props) {
	const memberId = useAuthStore((s) => s.memberId);
	const installState = usePushStore((s) => s.installState);
	const permission = usePushStore((s) => s.permission);
	const subscribed = usePushStore((s) => s.subscribed);
	const busy = usePushStore((s) => s.busy);

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

	let content: React.ReactNode;
	if (installState === "unsupported") {
		content = note("이 브라우저는 잠금화면 알림을 지원하지 않아요.");
	} else if (installState === "ios-needs-install") {
		content = (
			<div className="flex flex-col gap-2">
				{note(
					"아이폰에서 잠금화면 알림을 받으려면 먼저 홈 화면에 추가해야 해요.",
				)}
				<ol
					className="text-[#0f1724] dark:text-white"
					style={{ fontSize: 14, fontWeight: 500, paddingLeft: 18, lineHeight: 1.8 }}
				>
					<li>Safari 하단의 공유 버튼을 누르세요</li>
					<li>'홈 화면에 추가'를 선택하세요</li>
					<li>홈 화면의 '콕타임' 앱으로 다시 열어 주세요</li>
				</ol>
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
