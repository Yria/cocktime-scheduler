import { ELO } from "../../lib/rating/elo";
import {
	isPlacement,
	nextTier,
	tierLabel,
	tierOf,
	tierProgress,
} from "../../lib/rating/tier";
import type { MyRating } from "../../lib/supabase/matchResults";
import TierFrame from "../rating/TierFrame";
import PlayerAvatar from "../shared/PlayerAvatar";

const AV = 68;
/** TierFrame 이 바깥으로 두르는 장식 여백 — TierFrame 내부 계산(지름의 22%)과 같은 값 */
const AV_PAD = Math.round(AV * 0.22);

const num = (n: number) => n.toLocaleString("ko-KR");

interface Props {
	name: string;
	gender: "M" | "F" | null;
	memberId: string;
	my: MyRating | null;
	myLoading: boolean;
}

/**
 * 내 정보 상단 — 등급 테두리 아바타 + 이름 + 등급/점수 + 승·패·승률.
 * 등급은 '표시용'(docs/MATCH_RESULT_ELO_SPEC.md §0)이라 숫자보다 테두리 모양이 주인공이다.
 * 점수를 못 읽었으면(my=null) 테두리·숫자를 감춘다 — 틀린 등급을 보여주느니 없는 편이 낫다.
 */
export default function MyHero({ name, gender, memberId, my, myLoading }: Props) {
	const avatar = (
		<PlayerAvatar name={name} gender={gender} photoId={memberId} size={AV} ringWidth={3} />
	);
	if (!my) {
		return (
			<section className="me-hero" aria-label="내 등급">
				<span className="me-hero-avatar" style={{ "--me-pad": "0px" } as React.CSSProperties}>
					{avatar}
				</span>
				<div className="min-w-0">
					<p className="me-hero-name text-strong">{name}</p>
					<p className="me-hero-note text-faint">
						{myLoading ? "등급을 불러오는 중…" : "등급을 불러오지 못했어요. 당겨서 새로고침해 주세요."}
					</p>
				</div>
			</section>
		);
	}

	const tier = tierOf(my.rating);
	const placement = isPlacement(my.games);
	const next = nextTier(my.rating);
	const progress = Math.round(tierProgress(my.rating) * 100);
	const total = my.wins + my.losses;
	const rate = total > 0 ? Math.round((my.wins / total) * 100) : null;

	return (
		<>
			<section className="me-hero" aria-label="내 등급">
				<span
					className="me-hero-avatar"
					style={{ "--me-pad": `${AV_PAD}px` } as React.CSSProperties}
				>
					<TierFrame tier={tier} placement={placement} size={AV} decorative>
						{avatar}
					</TierFrame>
				</span>
				<div className="min-w-0">
					<p className="me-hero-name text-strong">{name}</p>
					{placement ? (
						<>
							<p className="me-hero-rank">
								<span className="text-strong">배치 중</span>
								<span
									className="me-pips"
									role="img"
									aria-label={`배치 ${my.games}/${ELO.PLACEMENT_SHOW_GAMES}`}
								>
									{Array.from({ length: ELO.PLACEMENT_SHOW_GAMES }, (_, i) => (
										<i key={i} data-on={i < my.games ? "" : undefined} />
									))}
								</span>
								<span className="text-muted">
									{my.games}/{ELO.PLACEMENT_SHOW_GAMES}
								</span>
							</p>
							<p className="me-hero-note text-muted">
								{/* 배치 중엔 점수를 숨긴다 — 시작 점수(급수 기준)가 등급처럼 읽히면 오해를 산다 */}
								승패를 기록한 경기가 {ELO.PLACEMENT_SHOW_GAMES}번 쌓이면 등급이 정해져요
							</p>
						</>
					) : (
						<>
							<p className="me-hero-rank">
								<span className="text-strong">{tierLabel(tier)}</span>
								<span className="me-hero-score text-strong">{num(my.rating)}</span>
							</p>
							<div
								className="me-hero-meter"
								role="progressbar"
								aria-label={next ? `${next.label}까지 진행률` : "최고 등급"}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={progress}
							>
								<span style={{ width: `${progress}%` }} />
							</div>
							<p className="me-hero-note text-muted">
								{next
									? `${next.label}까지 ${num(next.min - my.rating)}점`
									: "가장 높은 등급이에요"}
							</p>
						</>
					)}
				</div>
			</section>
			<div className="me-stats" aria-label="승패 요약">
				<div>
					<strong>{my.wins}</strong>
					<span>승</span>
				</div>
				<div>
					<strong>{my.losses}</strong>
					<span>패</span>
				</div>
				<div>
					<strong>{rate == null ? "–" : `${rate}%`}</strong>
					<span>승률</span>
				</div>
			</div>
		</>
	);
}
