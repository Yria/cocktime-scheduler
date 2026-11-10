import type {
	MatchSidePlayer,
	MyMatchRecord,
} from "../../lib/supabase/matchResults";
import PlayerAvatar from "../shared/PlayerAvatar";

const hm = new Intl.DateTimeFormat("ko-KR", {
	timeZone: "Asia/Seoul",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

function Side({
	label,
	players,
	mine,
}: {
	label: string;
	players: MatchSidePlayer[];
	mine: boolean;
}) {
	return (
		<div className="me-rec-side" data-mine={mine ? "" : undefined}>
			<b>{label}</b>
			<span className="me-rec-avs" aria-hidden="true">
				{players.map((p, i) => (
					<span key={p.memberId ?? `${p.name}-${i}`}>
						<PlayerAvatar
							name={p.name}
							gender={p.gender}
							photoId={p.memberId ?? undefined}
							size={22}
							ringWidth={1.5}
						/>
					</span>
				))}
			</span>
			<span className="me-rec-names">{players.map((p) => p.name).join(" ")}</span>
		</div>
	);
}

interface Props {
	record: MyMatchRecord;
	busy: boolean;
	onSubmit: (r: MyMatchRecord) => void;
}

/**
 * 승패 기록 한 장 — 왼쪽 칩(승/패/미기록), 가운데 우리 팀·상대 팀, 오른쪽 점수 변동.
 * 미반영(혼합·게스트 포함 등) 경기는 결과가 있어도 Δ 대신 '점수 미반영'이라 쓴다 —
 * 0 으로 적으면 '졌는데 안 깎였다'로 오해한다.
 * 우리/상대는 실제 편이다 — 결과 입력 때 고친 편을 서버(match_my_history)가 teamA/teamB/mySide 에 이미 반영해 준다.
 */
export default function MatchRecordCard({ record: r, busy, onSubmit }: Props) {
	const mine = r.mySide === "A" ? r.teamA : r.teamB;
	const theirs = r.mySide === "A" ? r.teamB : r.teamA;
	const result = r.winner == null ? "none" : r.winner === r.mySide ? "win" : "loss";
	const chip = result === "win" ? "승" : result === "loss" ? "패" : "미기록";
	const meta = [
		r.courtId != null ? `${r.courtId}코트` : null,
		r.gameType,
		r.endedAt ? hm.format(new Date(r.endedAt)) : null,
	]
		.filter(Boolean)
		.join(" · ");

	let right: React.ReactNode = null;
	if (r.winner != null && r.rated && r.delta != null) {
		const sign = r.delta > 0 ? "up" : r.delta < 0 ? "down" : "zero";
		right = (
			<div className="me-rec-delta">
				{/* 음수는 하이픈 대신 진짜 빼기 기호(−) — 숫자 폭과 맞아 +18 / −12 가 세로로 줄 선다 */}
				<strong data-sign={sign}>
					{r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? `−${Math.abs(r.delta)}` : "±0"}
				</strong>
				{r.ratingAfter != null && <span>{r.ratingAfter.toLocaleString("ko-KR")}</span>}
			</div>
		);
	} else if (r.winner != null && !r.rated) {
		right = <span className="me-rec-unrated">점수 미반영</span>;
	} else if (r.canSubmit) {
		// 기한 안내는 목록 위 배너 한 줄로 모았다 — 카드마다 같은 문장을 반복하지 않는다.
		right = (
			<button
				type="button"
				className="me-rec-input"
				disabled={busy}
				onClick={() => onSubmit(r)}
				aria-label={`${theirs.map((p) => p.name).join(" ")} 상대 경기 결과 입력`}
			>
				{busy ? "기록 중…" : "결과 입력"}
			</button>
		);
	}

	return (
		<article
			className="me-rec"
			aria-label={`${chip}${r.winner != null && !r.rated ? ", 점수 미반영" : ""}`}
		>
			<span className="me-rec-chip" data-r={result} aria-hidden="true">
				{chip}
			</span>
			<div className="me-rec-teams">
				<Side label="우리" players={mine} mine />
				<Side label="상대" players={theirs} mine={false} />
				{meta && <p className="me-rec-meta">{meta}</p>}
			</div>
			{right ?? <span />}
		</article>
	);
}
