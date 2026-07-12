import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_GRADE, MIN_GRADE } from "../../lib/constants";
import { fetchMembers } from "../../lib/supabase/members";
import type { Gender } from "../../types";

/** 비교 추정에 쓰는 표본 한 명(동성 기준). */
export interface GradeAnchor {
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
	/** 비교에서 제외할 본인 이름(중복 비교 방지). */
	excludeName?: string;
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
	anchors: providedAnchors,
	onEstimate,
	onCancel,
}: {
	gender: Gender;
	excludeName?: string;
	anchors?: GradeAnchor[];
	onEstimate: (grade: number) => void;
	onCancel: () => void;
}) {
	const [loaded, setLoaded] = useState<GradeAnchor[] | null>(null);
	const [loading, setLoading] = useState(!providedAnchors);

	// 표본 미제공 시 활성 회원 로드.
	useEffect(() => {
		if (providedAnchors) return;
		let alive = true;
		void fetchMembers().then((members) => {
			if (!alive) return;
			setLoaded(
				members.map((m) => ({ name: m.name, grade: m.skills.grade, gender: m.gender })),
			);
			setLoading(false);
		});
		return () => {
			alive = false;
		};
	}, [providedAnchors]);

	// 동성 + 본인 제외 + 유효 등급만, 등급 오름차순.
	const pool = useMemo(() => {
		const src = providedAnchors ?? loaded ?? [];
		return src
			.filter(
				(a) =>
					a.gender === gender &&
					a.name !== excludeName &&
					a.grade >= MIN_GRADE &&
					a.grade <= MAX_GRADE,
			)
			.sort((a, b) => a.grade - b.grade);
	}, [providedAnchors, loaded, gender, excludeName]);

	const [lo, setLo] = useState(MIN_GRADE);
	const [hi, setHi] = useState(MAX_GRADE);
	const [usedNames, setUsedNames] = useState<Set<string>>(() => new Set());
	const [asked, setAsked] = useState(0);

	// 구간 [lo,hi] 중앙에 가장 가까운 미사용 표본. 없으면 null(→ 수렴).
	const pickAnchor = useCallback(
		(l: number, h: number, used: Set<string>): GradeAnchor | null => {
			const mid = (l + h) / 2;
			let best: GradeAnchor | null = null;
			let bestDist = Infinity;
			for (const a of pool) {
				if (used.has(a.name)) continue;
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

	const answer = (dir: "better" | "similar" | "worse") => {
		if (!current) return;
		if (dir === "similar") {
			finalize(current.grade);
			return;
		}
		const nextLo = dir === "better" ? current.grade + 1 : lo;
		const nextHi = dir === "worse" ? current.grade - 1 : hi;
		const used = new Set(usedNames);
		used.add(current.name);
		setUsedNames(used);
		setAsked((n) => n + 1);

		if (nextLo > nextHi) {
			// 구간 붕괴 → 중앙값으로 수렴
			finalize((nextLo + nextHi) / 2);
			return;
		}
		const next = pickAnchor(nextLo, nextHi, used);
		if (!next) {
			// 남은 표본 없음 → 현재 구간 중앙으로 수렴
			finalize((nextLo + nextHi) / 2);
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

	return (
		<div
			className="rounded-xl px-3.5 py-3"
			style={{ background: "var(--mat-ultra-thin)", border: "1px solid var(--border-light)" }}
		>
			<p className="text-xs text-faint mb-1">
				질문 {asked + 1} · 추정 구간 {lo}~{hi}등급
			</p>
			<p className="text-sm text-strong mb-3">
				<span className="font-bold">{current.name}</span>
				<span className="text-muted"> ({current.gender === "F" ? "여" : "남"})</span> 님과 비교하면 실력이 어떤가요?
			</p>
			<div className="flex flex-col gap-1.5">
				<button
					type="button"
					onClick={() => answer("better")}
					className="w-full py-2.5 rounded-lg text-sm font-bold"
					style={{ color: "#0b8a3a", background: "rgba(40,199,94,0.12)" }}
				>
					▲ 더 잘해요
				</button>
				<button
					type="button"
					onClick={() => answer("similar")}
					className="w-full py-2.5 rounded-lg text-sm font-bold"
					style={{ color: "#8a6d00", background: "rgba(240,176,0,0.14)" }}
				>
					= 비슷해요
				</button>
				<button
					type="button"
					onClick={() => answer("worse")}
					className="w-full py-2.5 rounded-lg text-sm font-bold text-muted"
					style={{ background: "rgba(120,120,140,0.14)" }}
				>
					▼ 더 못해요
				</button>
			</div>
			<button
				type="button"
				onClick={onCancel}
				className="w-full mt-2 py-1.5 text-xs font-semibold text-faint"
			>
				그만두고 직접 선택
			</button>
		</div>
	);
}
