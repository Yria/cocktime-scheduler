import { useEffect, useState } from "react";
import { fetchCockSupportUsed } from "../../lib/supabase/clubSettings";
import { monthKST } from "../../lib/schedule/calendar";
import { useSessionStore } from "../../store/sessionStore";
import { DEFAULT_GROUP_SETTINGS } from "../../types";
import ModalSheet from "../common/ModalSheet";

/**
 * 콕 제출 확인 모달.
 * 회원이 이번 달 콕 지원(group_settings.cockSupportPerMonth, 기본 1개)을 아직 안 받았으면,
 * 그 회원이 실제로 내야 할 콕 수(쿼터 - 지원)를 크게 강조해 노출한다 — 운영진이 반사적으로 확인을 눌러
 * 지원분까지 받게 하는 실수를 막는다. 확인을 누르면 그 달 지원이 소진된다(sessionStore.confirmCock).
 *
 * 지원 사용 여부는 모달이 열릴 때 그 회원 단건으로 조회한다(늦참자도 정확). 조회가 끝날 때까지 확인 버튼은
 * 비활성 — 안내 배너가 뜨기 전에 확인이 눌리지 않게.
 */
export default function CockCheckModal({
	playerId,
	onClose,
}: {
	playerId: string;
	onClose: () => void;
}) {
	const player = useSessionStore((s) => s.sessionPlayers.get(playerId));
	const groupSettings = useSessionStore((s) => s.groupSettings);
	const confirmCock = useSessionStore((s) => s.confirmCock);

	const memberId = player?.memberId ?? null;
	// 회원의 이번 달 지원 사용 여부. null=조회 중, true=이미 소진, false=미사용(지원 가능). 비회원은 조회 안 함.
	const [usedResult, setUsedResult] = useState<boolean | null>(null);

	useEffect(() => {
		if (!memberId) return; // 비회원(게스트) → 지원 대상 아님(아래에서 supportAvailable=false)
		let alive = true;
		void fetchCockSupportUsed([memberId], monthKST()).then((set) => {
			if (alive) setUsedResult(set.has(memberId));
		});
		return () => {
			alive = false;
		};
	}, [memberId]);

	const gs = groupSettings ?? DEFAULT_GROUP_SETTINGS;
	const support = gs.cockSupportPerMonth;
	const quota = player?.gender === "F" ? gs.cockQuotaFemale : gs.cockQuotaMale;
	// 회원인데 아직 조회 중이면 로딩(배너 뜨기 전 확인 눌림 방지). 비회원은 기다릴 것 없음.
	const loading = !!memberId && usedResult === null;
	const supportAvailable = !!memberId && usedResult === false && support > 0;
	const payAmount = supportAvailable ? Math.max(0, quota - support) : quota;

	return (
		<ModalSheet position="center" className="p-6" onClose={onClose}>
			<h3 className="font-bold text-gray-800 dark:text-white text-lg mb-1.5">
				콕 제출 확인
			</h3>

			{supportAvailable && (
				<div
					style={{
						margin: "4px 0 14px",
						padding: "14px 16px",
						borderRadius: 12,
						background: "linear-gradient(180deg, #10b981 0%, #059669 100%)",
						color: "#fff",
						boxShadow: "0 6px 16px rgba(5,150,105,0.35)",
						textAlign: "center",
					}}
				>
					<div style={{ fontSize: 13, fontWeight: 700, opacity: 0.95, marginBottom: 4 }}>
						🎁 이번 달 콕 지원 대상
					</div>
					<div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.25 }}>
						{payAmount === 0 ? "콕 안 내도 돼요" : `콕 ${payAmount}개만 내면 돼요`}
					</div>
					<div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, marginTop: 4 }}>
						(원래 {quota}개 · 월 지원 {support}개 적용)
					</div>
				</div>
			)}

			<p className="text-sm text-gray-600 dark:text-gray-300 mb-5 leading-relaxed">
				<b>{player?.name ?? "이 선수"}</b> 님의 콕 제출을 확인했나요? 확인하면 매칭 대기 상태가 됩니다.
				{supportAvailable && " 확인 시 이번 달 콕 지원 1회가 사용 처리됩니다."}
			</p>

			<div className="flex gap-3">
				<button
					type="button"
					onClick={onClose}
					className="btn-lq-secondary flex-1 py-3 text-sm"
				>
					취소
				</button>
				<button
					type="button"
					disabled={loading}
					onClick={() => {
						void confirmCock(playerId);
						onClose();
					}}
					className="btn-lq-primary flex-1 py-3 text-sm"
					style={loading ? { opacity: 0.6, cursor: "default" } : undefined}
				>
					{loading ? "확인 중…" : "확인"}
				</button>
			</div>
		</ModalSheet>
	);
}
