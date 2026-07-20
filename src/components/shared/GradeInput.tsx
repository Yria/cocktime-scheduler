import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_GRADE, MIN_GRADE } from "../../lib/constants";
import { magnetGenderRing } from "../../lib/magnetStyle";
import { fetchMembers, fetchRecentActiveMemberIds } from "../../lib/supabase/members";
import type { Gender } from "../../types";
import PlayerAvatar from "./PlayerAvatar";

/** 비교 추정에 쓰는 표본 한 명(동성 기준). */
export interface GradeAnchor {
	/** 안정적 식별자(members.id 우선, 없으면 session_players.id). 제외·중복 판정 및 사진 키로 쓴다. */
	id: string;
	name: string;
	grade: number;
	gender: Gender;
}

interface GradeInputProps {
	/** 현재 등급 (1~10). */
	value: number;
	onChange: (grade: number) => void;
	/** 비교 표본(동성)을 고르는 기준 성별. */
	gender: Gender;
	/** 편집 대상 본인 이름(아바타/라벨 표시용). */
	excludeName?: string;
	/** 편집 대상 본인 id(members.id 등) — 비교에서 제외(동명이인 오제외 방지) + 본인 아바타 사진 키. */
	excludeId?: string;
	/**
	 * 비교 표본. 미지정 시 활성 회원을 직접 로드한다(게스트/신규 입력 흐름).
	 * 이미 회원 목록을 들고 있는 화면(회원관리·보드)은 넘겨서 추가 조회를 피한다.
	 */
	anchors?: GradeAnchor[];
	/** 헤더 문구(기본 "실력 등급"). */
	title?: string;
}

const TIER_LABEL = (g: number): string => {
	if (g <= 2) return "입문";
	if (g <= 4) return "초급";
	if (g <= 6) return "중급";
	if (g <= 8) return "상급";
	return "최상급";
};

const clampGrade = (g: number): number =>
	Math.max(MIN_GRADE, Math.min(MAX_GRADE, Math.round(g)));

/**
 * 실력 등급(1~10) 입력 — 직접 선택 + "비교로 추정"(동성 이진 탐색).
 * 회원/게스트 실력 입력 전반에서 공용으로 쓴다.
 */
export function GradeInput({
	value,
	onChange,
	gender,
	excludeName,
	excludeId,
	anchors,
	title = "실력 등급",
}: GradeInputProps) {
	const [comparing, setComparing] = useState(false);

	return (
		<div>
			<div className="flex items-center justify-between mb-2">
				<p className="text-xs font-semibold text-muted uppercase tracking-wide">
					{title}
				</p>
				{!comparing && (
					<button
						type="button"
						onClick={() => setComparing(true)}
						className="text-xs font-semibold rounded-full px-2.5 py-1"
						style={{ color: "#007aff", background: "rgba(11,132,255,0.1)" }}
					>
						🤔 비교로 추정
					</button>
				)}
			</div>

			{comparing ? (
				<ComparisonEstimator
					gender={gender}
					excludeName={excludeName}
					excludeId={excludeId}
					anchors={anchors}
					onEstimate={(g) => {
						onChange(clampGrade(g));
						setComparing(false);
					}}
					onCancel={() => setComparing(false)}
				/>
			) : (
				<GradeScale value={value} onChange={onChange} />
			)}
		</div>
	);
}

/** 1~10 눈금 — value 이하 셀이 채워지는 세기 막대. 셀 탭으로 등급 선택. */
function GradeScale({
	value,
	onChange,
}: {
	value: number;
	onChange: (grade: number) => void;
}) {
	return (
		<div>
			<div className="flex gap-1">
				{Array.from({ length: MAX_GRADE }, (_, i) => {
					const g = i + 1;
					const filled = g <= value;
					return (
						<button
							key={g}
							type="button"
							onClick={() => onChange(g)}
							aria-label={`${g}등급`}
							style={{
								flex: 1,
								minWidth: 0,
								height: 34,
								borderRadius: 8,
								fontSize: 12,
								fontWeight: 700,
								cursor: "pointer",
								transition: "all 0.12s",
								color: filled ? "#fff" : "#98a0ab",
								background: filled
									? "linear-gradient(175deg,#38de72 0%,#20b257 100%)"
									: "rgba(120,120,140,0.14)",
								border: g === value ? "2px solid #0b8a3a" : "1px solid transparent",
							}}
						>
							{g}
						</button>
					);
				})}
			</div>
			<p className="text-xs text-faint mt-1.5">
				<span className="font-bold text-strong">{value}등급</span>
				<span className="mx-1">·</span>
				{TIER_LABEL(value)}
			</p>
		</div>
	);
}

/**
 * 동성 회원과 1:1 비교로 등급 추정 — 이진 탐색.
 * 표본 중 현재 가능 구간 [lo,hi] 중앙에 가까운 사람을 보여주고,
 * "더 잘함/비슷/더 못함"으로 구간을 좁혀 3~4번 만에 등급으로 수렴한다.
 */
function ComparisonEstimator({
	gender,
	excludeName,
	excludeId,
	anchors: providedAnchors,
	onEstimate,
	onCancel,
}: {
	gender: Gender;
	excludeName?: string;
	excludeId?: string;
	anchors?: GradeAnchor[];
	onEstimate: (grade: number) => void;
	onCancel: () => void;
}) {
	const [loaded, setLoaded] = useState<GradeAnchor[] | null>(null);
	const [loading, setLoading] = useState(!providedAnchors);

	// 표본 미제공 시 활성 회원 로드 — 비교군은 최근 3달 참석 회원으로 한정.
	// (최근 활동 집합이 비면 이력 자체가 없는 것으로 보고 미필터 폴백.)
	useEffect(() => {
		if (providedAnchors) return;
		let alive = true;
		void Promise.all([fetchMembers(), fetchRecentActiveMemberIds(3)]).then(
			([members, recentIds]) => {
				if (!alive) return;
				const pool = recentIds.size
					? members.filter((m) => recentIds.has(m.id))
					: members;
				setLoaded(
					pool.map((m) => ({ id: m.id, name: m.name, grade: m.skills.grade, gender: m.gender })),
				);
				setLoading(false);
			},
		);
		return () => {
			alive = false;
		};
	}, [providedAnchors]);

	// 동성 + 본인 제외(id 기준 — 동명이인 오제외 방지) + 유효 등급만, 등급 오름차순.
	const pool = useMemo(() => {
		const src = providedAnchors ?? loaded ?? [];
		return src
			.filter(
				(a) =>
					a.gender === gender &&
					(excludeId == null || a.id !== excludeId) &&
					a.grade >= MIN_GRADE &&
					a.grade <= MAX_GRADE,
			)
			.sort((a, b) => a.grade - b.grade);
	}, [providedAnchors, loaded, gender, excludeId]);

	const [lo, setLo] = useState(MIN_GRADE);
	const [hi, setHi] = useState(MAX_GRADE);
	const [usedIds, setUsedIds] = useState<Set<string>>(() => new Set());
	const [asked, setAsked] = useState(0);
	// "비슷해요" 로 모은 상대 등급들 — 즉시 확정 대신 평균내어 우열을 가리기 힘든 구간을 수렴시킨다.
	const [similarAnchors, setSimilarAnchors] = useState<number[]>([]);

	// 구간 [lo,hi] 중앙에 가장 가까운 미사용 표본. 없으면 null(→ 수렴).
	const pickAnchor = useCallback(
		(l: number, h: number, used: Set<string>): GradeAnchor | null => {
			const mid = (l + h) / 2;
			let best: GradeAnchor | null = null;
			let bestDist = Infinity;
			for (const a of pool) {
				if (used.has(a.id)) continue;
				if (a.grade < l || a.grade > h) continue;
				const d = Math.abs(a.grade - mid);
				if (d < bestDist) {
					bestDist = d;
					best = a;
				}
			}
			return best;
		},
		[pool],
	);

	const [current, setCurrent] = useState<GradeAnchor | null>(null);
	const [started, setStarted] = useState(false);

	// 표본이 준비되면 첫 질문을 한 번만 세팅(표본 배열 참조가 바뀌어도 진행 중 질문을 리셋하지 않음).
	useEffect(() => {
		if (loading || started) return;
		setStarted(true);
		setCurrent(pickAnchor(MIN_GRADE, MAX_GRADE, new Set()));
	}, [loading, started, pickAnchor]);

	const finalize = (grade: number) => onEstimate(clampGrade(grade));

	// 최종 등급 확정 — "비슷" 앵커가 있으면 그 평균을 구간 안으로 클램프, 없으면 구간 중앙.
	const settle = (l: number, h: number, sims: number[]) => {
		if (sims.length) {
			const avg = sims.reduce((s, g) => s + g, 0) / sims.length;
			finalize(l <= h ? Math.min(h, Math.max(l, avg)) : avg);
		} else {
			finalize((l + h) / 2);
		}
	};

	const answer = (dir: "better" | "similar" | "worse" | "skip") => {
		if (!current) return;
		const g = current.grade;
		// 구간 갱신: better/worse = 단단한 컷(초과/미만), similar = g±1 근방으로 좁힘, skip = 구간 유지.
		let nextLo = lo;
		let nextHi = hi;
		if (dir === "better") nextLo = g + 1;
		else if (dir === "worse") nextHi = g - 1;
		else if (dir === "similar") {
			nextLo = Math.max(lo, g - 1);
			nextHi = Math.min(hi, g + 1);
		}

		// "비슷"은 "정확히 같다"가 아니라 근방 신호 → 앵커로 모아 평균낸다(즉시 확정 안 함).
		const nextSims = dir === "similar" ? [...similarAnchors, g] : similarAnchors;
		const used = new Set(usedIds);
		used.add(current.id);
		setUsedIds(used);
		setSimilarAnchors(nextSims);
		// skip 은 구간을 좁히지 않으므로 질문 번호(asked)도 올리지 않는다.
		if (dir !== "skip") setAsked((n) => n + 1);

		// 종료: 구간이 한 등급으로 확정/붕괴, 또는 "비슷"이 충분히 모임(2회 또는 이미 좁은 구간), 또는 표본 소진.
		const enoughSimilar =
			nextSims.length >= 2 || (nextSims.length >= 1 && nextHi - nextLo <= 1);
		if (nextLo >= nextHi || enoughSimilar) {
			settle(nextLo, nextHi, nextSims);
			return;
		}
		const next = pickAnchor(nextLo, nextHi, used);
		if (!next) {
			// 남은 표본 없음 → 현재 구간(평균/중앙)으로 수렴
			settle(nextLo, nextHi, nextSims);
			return;
		}
		setLo(nextLo);
		setHi(nextHi);
		setCurrent(next);
	};

	if (loading || !started) {
		return (
			<div className="rounded-xl px-3 py-6 text-center text-sm text-faint" style={{ background: "var(--mat-ultra-thin)" }}>
				표본 불러오는 중…
			</div>
		);
	}

	if (!current) {
		return (
			<div
				className="rounded-xl px-3 py-4 text-center"
				style={{ background: "var(--mat-ultra-thin)" }}
			>
				<p className="text-sm text-muted mb-2">비교할 동성 회원이 없어요.</p>
				<button
					type="button"
					onClick={onCancel}
					className="text-xs font-semibold rounded-full px-3 py-1.5"
					style={{ color: "#007aff", background: "rgba(11,132,255,0.1)" }}
				>
					직접 선택으로
				</button>
			</div>
		);
	}

	// 편집 대상(본인) 표시값 — 세 호출부 모두 excludeName/gender가 편집 대상이다(로그인 관리자 아님).
	const subjectName = excludeName ?? "";
	const subjectLabel = subjectName || "나";
	const gc = magnetGenderRing(current.gender); // 항상 #rrggbb → glow에 8자리 hex로 결합
	const oppGenderLabel = current.gender === "F" ? "여" : "남";

	return (
		<div
			className="rounded-2xl px-4 pt-3.5 pb-2.5"
			style={{
				background: "var(--mat-ultra-thin)",
				border: "1px solid var(--border-light)",
				overflow: "hidden",
			}}
		>
			<style>{`
				@keyframes cmpVsIn{0%{opacity:0;transform:scale(.93)}100%{opacity:1;transform:none}}
			`}</style>

			{/* 진행 헤더 — 편집 대상 본인 추정 구간(상대 등급 아님 → 노출 OK) */}
			<div className="flex items-center justify-between mb-1.5">
				<span className="text-xs font-semibold text-faint">질문 {asked + 1}</span>
				<span className="text-xs font-semibold" style={{ color: "#0b8a3a" }}>
					{lo}~{hi}등급으로 좁히는 중
				</span>
			</div>

			{/* 수렴 밴드 — lo~hi 구간만 초록, 답변마다 좁혀짐 */}
			<div className="flex gap-1 mb-4" aria-hidden="true">
				{Array.from({ length: MAX_GRADE }, (_, i) => {
					const g = i + 1;
					const on = g >= lo && g <= hi;
					return (
						<div
							key={g}
							style={{
								flex: 1,
								height: 7,
								borderRadius: 4,
								transition: "background 0.25s ease",
								background: on
									? "linear-gradient(90deg,#38de72,#20b257)"
									: "rgba(120,120,140,0.16)",
							}}
						/>
					);
				})}
			</div>

			{/* VS 아레나 — current 교체 시 key로 리마운트되어 등장 애니메이션 재생 */}
			<div
				key={current.id}
				className="flex items-center justify-center mb-3"
				style={{ animation: "cmpVsIn .28s ease" }}
			>
				{/* 편집 대상 — 등급은 추정 중(사이드 라벨의 lo~hi로 표기) */}
				<div className="flex flex-col items-center" style={{ width: 96 }}>
					<PlayerAvatar
						name={subjectName}
						gender={gender}
						photoId={excludeId}
						size={88}
						ringWidth={3}
						fallbackChar="나"
					/>
					<span className="text-[13px] font-bold text-strong mt-2 max-w-full truncate px-1">
						{subjectLabel}
					</span>
					<span className="text-[11px] text-faint mt-0.5">
						{lo}~{hi}등급
					</span>
				</div>

				{/* VS — 담백한 텍스트(원형 뱃지 제거) */}
				<span
					aria-hidden
					className="text-faint"
					style={{
						margin: "0 10px",
						fontSize: 19,
						fontWeight: 900,
						fontStyle: "italic",
						letterSpacing: "-0.02em",
					}}
				>
					VS
				</span>

				{/* 상대(기준) — 등급 숫자·티어 라벨 절대 노출 X(이진 탐색 취지 유지) */}
				<div className="flex flex-col items-center" style={{ width: 96 }}>
					<div style={{ borderRadius: "50%", boxShadow: `0 4px 18px ${gc}40` }}>
						<PlayerAvatar
							name={current.name}
							gender={current.gender}
							photoId={current.id}
							size={88}
							ringWidth={3}
						/>
					</div>
					<span className="text-[13px] font-bold text-strong mt-2 max-w-full truncate px-1">
						{current.name}
					</span>
					<span className="text-[11px] text-faint mt-0.5">{oppGenderLabel}</span>
				</div>
			</div>

			{/* 질문 — 주어=편집 대상, 원본과 동일 의미 */}
			<p className="text-sm text-strong text-center mb-3">
				<span className="font-bold">{current.name}</span>님과 비교하면 실력이 어떤가요?
			</p>

			{/* 답변 — 위=더 잘함 / 아래=더 못함 방향감 */}
			<div className="flex flex-col gap-1.5">
				<button
					type="button"
					onClick={() => answer("better")}
					className="w-full rounded-xl text-sm font-bold transition active:scale-[0.97]"
					style={{ minHeight: 52, color: "#0b8a3a", background: "rgba(40,199,94,0.12)" }}
				>
					▲ 더 잘해요
				</button>
				<button
					type="button"
					onClick={() => answer("similar")}
					className="w-full rounded-xl text-sm font-bold transition active:scale-[0.97]"
					style={{ minHeight: 52, color: "#8a6d00", background: "rgba(240,176,0,0.14)" }}
				>
					＝ 비슷해요
				</button>
				<button
					type="button"
					onClick={() => answer("worse")}
					className="w-full rounded-xl text-sm font-bold text-muted transition active:scale-[0.97]"
					style={{ minHeight: 52, background: "rgba(120,120,140,0.14)" }}
				>
					▼ 더 못해요
				</button>
			</div>

			{/* 스킵 — 이 사람으론 판단이 어려우면 구간 유지한 채 다른 사람으로 */}
			<button
				type="button"
				onClick={() => answer("skip")}
				className="w-full mt-1.5 rounded-xl text-[13px] font-bold text-muted transition active:scale-[0.97]"
				style={{
					minHeight: 44,
					background: "transparent",
					border: "1px solid var(--border-light)",
				}}
			>
				🤔 잘 모르겠어요 · 다른 사람과
			</button>

			<button
				type="button"
				onClick={onCancel}
				className="w-full mt-2 py-2 text-xs font-semibold text-faint"
			>
				그만두고 직접 선택
			</button>
		</div>
	);
}
