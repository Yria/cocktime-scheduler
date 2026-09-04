import { useEffect, useState } from "react";
import {
	POINT_MAX,
	TICKET_SESSION_CAP,
} from "../../lib/schedule/waitStatus";
import type { WaitPointEntry } from "../../lib/supabase/waitPoints";
import { useWaitPointStore, waitPointActions } from "../../store/waitPointStore";
import TicketIcon from "../shared/TicketIcon";
import Spinner from "../shared/Spinner";

// 대기 포인트 섹션 — '내 정보'(ProfileSetup edit 모달) 안에 들어간다. 별도 라우트를 만들지 않는다.
// ModalSheet 자체가 overflow-y-auto(maxHeight 90dvh)라 안쪽에 또 스크롤 영역을 두지 않는다
// (iOS 에서 중첩 스크롤은 제스처가 엉킨다). 대신 기본 8줄만 펴고 나머지는 접어 둔다.

const PREVIEW = 8;

/** 원장 사유 코드 → 사람이 읽는 한 줄. 서버 detail.reason 값과 1:1로 맞춘다(20260904000000). */
function entryLabel(e: WaitPointEntry): string {
	switch (e.reason) {
		case "waitlisted_at_close":
			return "대기인 채로 회차 마감";
		case "backfill":
			return "지난 대기 소급 적립";
		case "join":
			return "우선참여권 사용";
		case "early_cancel":
			return "사전 취소 — 우선참여권 반환";
		case "admin_cancel":
			return "운영진 취소 — 우선참여권 반환";
		case "session_cancelled":
			return "회차 취소 — 우선참여권 반환";
		case "day_cancel":
			return "당일 취소";
		case "noshow":
			return "불참(보드 미등록)";
		default:
			return e.kind === "adjust"
				? `운영진 보정${e.note ? ` — ${e.note}` : ""}`
				: "포인트 변동";
	}
}

function fmtDay(iso: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	return new Intl.DateTimeFormat("ko-KR", {
		timeZone: "Asia/Seoul",
		month: "numeric",
		day: "numeric",
	}).format(d);
}

export default function WaitPointsSection() {
	const status = useWaitPointStore((s) => s.status);
	const ledger = useWaitPointStore((s) => s.ledger);
	const loading = useWaitPointStore((s) => s.ledgerLoading);
	const loaded = useWaitPointStore((s) => s.ledgerLoaded);
	const [expanded, setExpanded] = useState(false);

	// 모달을 열 때마다 새로 읽는다(폴링·구독은 없다 — 포인트는 회차가 끝나야 움직인다).
	// force 인 이유: 티켓을 쓴 직후 여기를 열면 캐시에 'spend' 행이 없어 방금 한 일이 안 보인다.
	useEffect(() => {
		void waitPointActions.loadLedger(true);
	}, []);

	// 조회 실패(비회원·네트워크)면 섹션 자체를 감춘다 — 빈 껍데기가 뜨는 것보다 낫다.
	if (!status && loaded) return null;

	const balance = status?.balance ?? 0;
	const hasTicket = Boolean(status?.hasTicket);
	const shown = expanded ? ledger : ledger.slice(0, PREVIEW);

	return (
		<div
			style={{
				borderTop: "1px solid rgba(120,120,128,0.18)",
				paddingTop: 16,
				marginTop: 2,
			}}
		>
			<div className="flex items-center" style={{ gap: 6, marginBottom: 8 }}>
				<span className="text-strong" style={{ fontSize: 14.5, fontWeight: 800 }}>
					대기 포인트
				</span>
				{hasTicket && (
					<span className="ticket-badge" aria-hidden="true">
						<TicketIcon size={17} />
					</span>
				)}
				<span className="flex-1" />
				<span
					className="text-strong"
					style={{ fontSize: 14.5, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}
				>
					{balance}
					<span className="text-faint" style={{ fontWeight: 700 }}>
						/{POINT_MAX}
					</span>
				</span>
			</div>

			{/* 진행 막대 — 7점에 닿으면 금색으로 바뀌어 '쓸 수 있다'가 한눈에 보인다. */}
			<div
				style={{
					height: 6,
					borderRadius: 999,
					background: "rgba(120,120,128,0.18)",
					overflow: "hidden",
				}}
				role="progressbar"
				aria-valuenow={balance}
				aria-valuemin={0}
				aria-valuemax={POINT_MAX}
				aria-label="대기 포인트"
			>
				<div
					style={{
						width: `${Math.min(100, (balance / POINT_MAX) * 100)}%`,
						height: "100%",
						borderRadius: 999,
						background: hasTicket ? "var(--ticket-gold)" : "#0b84ff",
						transition: "width 0.3s ease",
					}}
				/>
			</div>

			<p
				className="text-muted"
				style={{ fontSize: 12, lineHeight: 1.55, marginTop: 8 }}
			>
				{hasTicket
					? `우선참여권이 있어요. 만석인 일정에서 '참석하기'를 누르면 정원 외 자리로 바로 확정할 수 있어요(회차당 ${TICKET_SESSION_CAP}명까지). 쓰기 전까지 포인트는 더 쌓이지 않아요.`
					: `대기인 채로 회차가 마감될 때마다 1점씩 쌓이고, ${POINT_MAX}점을 모으면 만석인 일정에 정원 외 자리로 참여할 수 있어요. 당일에 취소하거나 오지 않으면 1점이 깎여요.`}
			</p>

			{loading && ledger.length === 0 ? (
				<div className="flex justify-center" style={{ padding: "14px 0" }}>
					<Spinner />
				</div>
			) : ledger.length === 0 ? (
				<p className="text-faint" style={{ fontSize: 12, marginTop: 10 }}>
					아직 포인트 내역이 없어요.
				</p>
			) : (
				<>
					<ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
						{shown.map((e) => (
							<li
								key={e.id}
								className="flex items-center"
								style={{ gap: 8, padding: "7px 0" }}
							>
								<span
									className="text-faint"
									style={{
										fontSize: 11.5,
										fontWeight: 600,
										minWidth: 38,
										fontVariantNumeric: "tabular-nums",
									}}
								>
									{fmtDay(e.sessionAt ?? e.createdAt)}
								</span>
								<span
									className="text-strong"
									style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}
								>
									{entryLabel(e)}
									{e.placeName && (
										<span className="text-faint" style={{ fontWeight: 500 }}>
											{" · "}
											{e.placeName}
										</span>
									)}
								</span>
								<span
									style={{
										fontSize: 12.5,
										fontWeight: 800,
										fontVariantNumeric: "tabular-nums",
										color:
											e.delta > 0
												? "#30d158"
												: e.delta < 0
													? "#ef4444"
													: "var(--tone-faint)",
									}}
								>
									{/* 상한에 막혀 0점이 된 적립 — 왜 안 올랐는지 보이게 그대로 표기한다. */}
									{e.delta > 0 ? `+${e.delta}` : e.delta < 0 ? `${e.delta}` : "0"}
								</span>
							</li>
						))}
					</ul>
					{ledger.length > PREVIEW && (
						<button
							type="button"
							onClick={() => setExpanded((v) => !v)}
							className="text-[#0b84ff]"
							style={{
								background: "none",
								border: "none",
								fontSize: 12.5,
								fontWeight: 700,
								cursor: "pointer",
								padding: "6px 0 0",
							}}
						>
							{expanded ? "접기" : `전체 ${ledger.length}건 보기`}
						</button>
					)}
				</>
			)}
		</div>
	);
}
