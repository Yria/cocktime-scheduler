import { Download, MonitorDown } from "lucide-react";
import pushInstallAndroid from "../../assets/push-install-android.webp";
import pushInstallIos from "../../assets/push-install-ios.webp";
import { isAndroid, isIOS } from "../../lib/push/platform";

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

/**
 * "홈 화면에 앱으로 추가" 플랫폼별 안내 — 모바일(iOS/안드로이드)은 스크린샷 이미지,
 * 데스크톱은 텍스트 단계. 알림 설정 시트(PushSettingsSheet)와 설치 유도 토스트(InstallPromptToast)가 공유.
 */
export default function InstallGuide() {
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
		</div>
	);
}
