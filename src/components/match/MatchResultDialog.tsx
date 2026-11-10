import { useId, useImperativeHandle, useMemo, useState } from "react";
import { ELO } from "../../lib/rating/elo";
import {
	isPlacement,
	nextTier,
	tierLabel,
	tierOf,
	tierProgress,
} from "../../lib/rating/tier";
import type { MatchTeamA, MatchWinner } from "../../lib/supabase/matchResults";
import ModalSheet from "../common/ModalSheet";
import TierFrame from "../rating/TierFrame";
import PlayerAvatar from "../shared/PlayerAvatar";
import {
	applySplit,
	boardPartner,
	canEditTeams,
	pickAnchor,
	type Slot,
	splitWithPartner,
	teamAIds,
} from "./teamSplit";

/**
 * MatchResultDialog — 경기 완료 직후(또는 '내 승패 기록'에서 보충할 때) 이긴 팀을 고르는 화면.
 *
 * 게임의 '결과 선언' 화면처럼 만든다: 좌우 두 팀 패널 + 가운데 VS. 패널을 누르면 그 팀에 승리 도장이
 * 찍히고 뒤로 햇살이 퍼진다. 진 쪽은 색이 빠진다. 이렇게까지 하는 이유는 **입력률**이다 — 건너뛰기가
 * 열려 있으므로(docs/MATCH_RESULT_ELO_SPEC.md §0) 누르는 쪽이 더 재밌어야 기록이 쌓인다.
 *
 * - 아바타는 움직이지 않는다(TierFrame/티켓과 같은 원칙). 움직이는 건 패널·도장·햇살뿐.
 * - 팀 색은 청/홍(게임의 진영 관례). 승리색은 금색 하나 — 청홍 어느 쪽이 이겨도 같은 '승리'로 읽히게.
 * - 결과 단계(showOutcome / outcome prop)는 선택이다. 호출부가 제출 후 내 Δ·점수를 받았을 때만 띄운다.
 * - 닫기: onClose 를 넘긴 곳만 배경·Esc 로 닫힌다. 안 넘기면 [기록]/[건너뛰기] 중 하나를 골라야 한다.
 * - '같은 편' 단계: 보드는 4명 그룹을 뽑을 뿐이라 코트의 편이 보드 A/B 와 다를 수 있다. 기준 선수(나, 아니면 보드
 *   A편 첫 사람) 옆에 나머지 셋을 칩으로 두고 짝을 고르게 한다(보드 짝이 미리 골라져 있다). 짝을 바꾸면 두 패널이
 *   다시 나뉘고, 이긴 팀 선택은 '보이는 패널' 기준이다. 제출은 { winner, teamA: 실제 A편 spId 두 개 }.
 *   짝을 안 바꿨으면 teamA = null(보드 나눔) — 열 때 찍은 spId 가 그 사이 로스터 교체로 낡아도 실패하지 않게.
 *   편이 바뀌면 고른 승자는 지운다 — 같은 'A' 라도 가리키는 두 사람이 달라졌으므로.
 */

/** 패널에 그릴 선수. Player(id=members.id)·SessionPlayer(memberId)·기록 항목 모두 그대로 넘길 수 있게 최소 구조만. */
export interface MatchDialogPlayer {
	name: string;
	gender: string | null;
	/** members.id — 사진 키. null 이면 게스트(이니셜). 키 자체가 없으면 id 를 사진 키로 본다(Player). */
	memberId?: string | null;
	id?: string;
	/** session_players.id — 실제 편을 서버에 보낼 때 쓴다. 넷 다 있어야 '같은 편' 단계가 열린다 */
	spId?: string | null;
}

/** 제출 값. winner 는 teamA(보이는 왼쪽 패널) 기준. teamA=null 이면 보드 나눔(편을 고칠 수 없던 경우). */
export interface MatchResultPick {
	winner: MatchWinner;
	teamA: MatchTeamA;
}

export interface MatchOutcome {
	/** 내 점수 변동. null = 미반영 경기(혼합·게스트 포함 등) */
	delta: number | null;
	/** 반영 후 내 점수 */
	rating: number;
	/** 반영 후 내 반영 경기 수 */
	games: number;
}

export interface MatchResultDialogHandle {
	/** 제출이 끝나고 내 Δ 를 받으면 호출 → 같은 시트가 결과 단계로 넘어간다. */
	showOutcome: (o: MatchOutcome) => void;
}

interface Props {
	/** 보드 나눔(또는 기록된 실제 편). 이 순서가 '같은 편' 단계의 기본값이다 */
	teamA: readonly MatchDialogPlayer[];
	teamB: readonly MatchDialogPlayer[];
	/** 내가 뛴 쪽 — 있으면 '우리 팀'/'상대 팀'으로 부르고 결과 단계에서 승/패를 말해 준다.
	 *  편을 고쳐도 나는 기준 선수라 내 패널 자리는 그대로다 */
	mySide?: MatchWinner;
	/** 보이는 나눔의 A팀 기대 승률(0~1). 있으면 패널 아래 '예상 승률'을 보여준다 — 편을 바꾸면 다시 부른다 */
	expectedA?: (
		teamA: readonly MatchDialogPlayer[],
		teamB: readonly MatchDialogPlayer[],
	) => number | null | undefined;
	busy?: boolean;
	/** 이미 확정된 결과가 있으면 그 팀이 선택된 채로 연다(읽기 전용이 아님 — 호출부가 판단) */
	initialWinner?: MatchWinner | null;
	/** 결과 단계를 prop 으로 직접 줄 때(ref 대신) */
	outcome?: MatchOutcome | null;
	/** 나 — 결과 단계에서 등급 테두리 안에 내 아바타를 그린다. 없으면 빈 원판 */
	me?: MatchDialogPlayer;
	/** 시트 제목 바꾸기(기본 '누가 이겼나요?') */
	title?: string;
	ref?: React.Ref<MatchResultDialogHandle>;
	onSubmit: (pick: MatchResultPick) => void;
	onSkip: () => void;
	onClose?: () => void;
}

function photoKey(p: MatchDialogPlayer): string | undefined {
	if ("memberId" in p) return p.memberId ?? undefined;
	return p.id && !p.id.startsWith("guest") ? p.id : undefined;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function MatchResultDialog({
	teamA,
	teamB,
	mySide,
	expectedA,
	busy = false,
	initialWinner = null,
	outcome: outcomeProp = null,
	me,
	title = "누가 이겼나요?",
	ref,
	onSubmit,
	onSkip,
	onClose,
}: Props) {
	const [winner, setWinner] = useState<MatchWinner | null>(initialWinner);
	const [outcomeState, setOutcomeState] = useState<MatchOutcome | null>(null);
	const outcome = outcomeProp ?? outcomeState;

	// 보드 순서 [A1, A2, B1, B2]. 기준 선수와 그 짝(처음엔 보드 짝).
	const players = useMemo(() => [...teamA, ...teamB], [teamA, teamB]);
	const editable = teamA.length === 2 && teamB.length === 2 && canEditTeams(players);
	const anchor = pickAnchor(players, me?.memberId);
	const [partner, setPartner] = useState<Slot>(() => boardPartner(anchor));
	// 짝을 바꿀 때마다 올려 패널의 '바뀜' 장식 레이어를 다시 튼다(0 = 처음, 장식 없음).
	const [swapTick, setSwapTick] = useState(0);
	const split = splitWithPartner(anchor, editable ? partner : boardPartner(anchor));
	const shown = editable ? applySplit(players, split) : { teamA, teamB };
	const expA = expectedA?.(shown.teamA, shown.teamB) ?? undefined;

	useImperativeHandle(ref, () => ({ showOutcome: setOutcomeState }), []);

	const sideName = (side: MatchWinner) => {
		if (!mySide) return side === "A" ? "A팀" : "B팀";
		return side === mySide ? "우리 팀" : "상대 팀";
	};

	if (outcome) {
		return (
			<ModalSheet
				position="center"
				className="p-6"
				onClose={onClose ?? onSkip}
				closeOnEscape
			>
				<OutcomeStep
					outcome={outcome}
					me={me}
					won={mySide && winner ? mySide === winner : null}
					onDone={onClose ?? onSkip}
				/>
			</ModalSheet>
		);
	}

	const choose = (side: MatchWinner) => {
		if (busy) return;
		setWinner((w) => (w === side ? null : side));
	};

	const pickPartner = (slot: Slot) => {
		if (busy || slot === partner) return;
		setPartner(slot);
		setWinner(null);
		setSwapTick((t) => t + 1);
	};

	const submit = () => {
		if (!winner) return;
		onSubmit({ winner, teamA: editable ? teamAIds(players, split) : null });
	};

	return (
		<ModalSheet
			position="center"
			className="p-5"
			onClose={onClose}
			closeOnEscape={!!onClose}
		>
			<div className="text-center mb-4">
				<h3 className="text-lg font-bold text-strong">{title}</h3>
				<p className="text-sm text-muted mt-0.5" aria-live="polite">
					{winner ? `${sideName(winner)} 승리` : "이긴 팀을 눌러 주세요"}
				</p>
			</div>

			{editable && (
				<PartnerStep
					anchor={players[anchor]}
					anchorIsMe={!!me?.memberId && players[anchor].memberId === me.memberId}
					options={([0, 1, 2, 3] as Slot[])
						.filter((s) => s !== anchor)
						.map((s) => ({ slot: s, player: players[s] }))}
					partner={partner}
					disabled={busy}
					onPick={pickPartner}
				/>
			)}

			<div className="mrd-arena" data-picked={winner ?? undefined}>
				<TeamPanel
					side="A"
					label={sideName("A")}
					mine={mySide === "A"}
					players={shown.teamA}
					swapTick={swapTick}
					expected={expA}
					state={winner == null ? "idle" : winner === "A" ? "win" : "lose"}
					disabled={busy}
					onPick={() => choose("A")}
				/>
				<div className="mrd-vs" aria-hidden="true">
					<span>VS</span>
				</div>
				<TeamPanel
					side="B"
					label={sideName("B")}
					mine={mySide === "B"}
					players={shown.teamB}
					swapTick={swapTick}
					expected={expA == null ? undefined : 1 - expA}
					state={winner == null ? "idle" : winner === "B" ? "win" : "lose"}
					disabled={busy}
					onPick={() => choose("B")}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-1.5">
				<button
					type="button"
					className="btn-lq-primary w-full"
					disabled={!winner || busy}
					onClick={submit}
				>
					{busy ? "기록 중…" : "결과 기록"}
				</button>
				<button
					type="button"
					className="mrd-skip text-sm text-muted"
					disabled={busy}
					onClick={onSkip}
				>
					모르겠어요 · 건너뛰기
				</button>
			</div>
		</ModalSheet>
	);
}

/**
 * '같은 편' 단계 — 기준 선수 + 나머지 셋 칩(하나만 고름, 라디오). 칩 아바타는 정적이고 고른 칩은 테두리 링으로만 표시.
 */
function PartnerStep({
	anchor,
	anchorIsMe,
	options,
	partner,
	disabled,
	onPick,
}: {
	anchor: MatchDialogPlayer;
	anchorIsMe: boolean;
	options: { slot: Slot; player: MatchDialogPlayer }[];
	partner: Slot;
	disabled: boolean;
	onPick: (slot: Slot) => void;
}) {
	const qId = useId();
	const question = anchorIsMe
		? "누구와 같은 편이었나요?"
		: `${anchor.name} 님과 같은 편은?`;
	return (
		<div className="mrd-pair">
			<p className="mrd-pair-q text-strong" id={qId}>
				{question}
			</p>
			<div className="mrd-pair-row">
				<span className="mrd-pair-anchor" aria-hidden="true">
					<PlayerAvatar
						name={anchor.name}
						gender={anchor.gender}
						size={32}
						photoId={photoKey(anchor)}
					/>
					<span className="mrd-pair-plus">+</span>
				</span>
				<div
					className="mrd-pair-chips"
					role="radiogroup"
					aria-labelledby={qId}
				>
					{options.map(({ slot, player }) => (
						<button
							type="button"
							role="radio"
							aria-checked={slot === partner}
							key={slot}
							className="mrd-chip"
							disabled={disabled}
							onClick={() => onPick(slot)}
						>
							<PlayerAvatar
								name={player.name}
								gender={player.gender}
								size={32}
								photoId={photoKey(player)}
							/>
							<span className="mrd-chip-name">{player.name}</span>
						</button>
					))}
				</div>
			</div>
			<p className="mrd-pair-hint text-faint">보드와 다르게 쳤다면 바꿔 주세요</p>
		</div>
	);
}

function TeamPanel({
	side,
	label,
	mine,
	players,
	swapTick,
	expected,
	state,
	disabled,
	onPick,
}: {
	side: MatchWinner;
	label: string;
	mine: boolean;
	players: readonly MatchDialogPlayer[];
	/** 0 보다 크면 편이 막 바뀌었다 — 장식 레이어(mrd-swap)를 그 값으로 다시 마운트해 한 번 훑는다 */
	swapTick: number;
	expected?: number;
	state: "idle" | "win" | "lose";
	disabled: boolean;
	onPick: () => void;
}) {
	return (
		<button
			type="button"
			className={`mrd-team mrd-team--${side.toLowerCase()}`}
			data-state={state}
			aria-pressed={state === "win"}
			aria-label={`${label} 승리 선택: ${players.map((p) => p.name).join(", ")}`}
			disabled={disabled}
			onClick={onPick}
		>
			{/* 승리 연출 레이어 — 패널 뒤 햇살 + 도장. 아바타는 이 위에 정적으로 놓인다. */}
			<span className="mrd-rays" aria-hidden="true" />
			{swapTick > 0 && (
				<span className="mrd-swap" key={swapTick} aria-hidden="true" />
			)}
			<span className="mrd-stamp" aria-hidden="true">
				승리
			</span>

			<span className={`mrd-team-label${mine ? " is-mine" : ""}`}>{label}</span>
			<span className="mrd-roster">
				{players.map((p) => (
					<span
						className="mrd-player"
						key={`${p.memberId ?? p.id ?? ""}:${p.name}`}
					>
						<PlayerAvatar
							name={p.name}
							gender={p.gender}
							size={44}
							photoId={photoKey(p)}
						/>
						<span className="mrd-name">{p.name}</span>
					</span>
				))}
			</span>
			{expected != null && (
				<span className="mrd-odds text-faint">예상 승률 {pct(expected)}</span>
			)}
		</button>
	);
}

function OutcomeStep({
	outcome,
	me,
	won,
	onDone,
}: {
	outcome: MatchOutcome;
	me?: MatchDialogPlayer;
	/** 내 승/패. 내 쪽을 모르면(운영진 입력) null */
	won: boolean | null;
	onDone: () => void;
}) {
	const { delta, rating, games } = outcome;
	const tier = tierOf(rating);
	const placement = isPlacement(games);
	const next = nextTier(rating);
	const headline = won == null ? "기록했어요" : won ? "승리!" : "아쉬운 패배";

	return (
		<div className="text-center">
			<p className={`mrd-out-head${won ? " is-win" : ""}`}>{headline}</p>

			{delta == null ? (
				<p className="text-sm text-muted mt-3 leading-relaxed">
					이번 경기는 점수에 반영되지 않아요.
					<br />
					혼합 경기이거나 게스트가 함께 뛴 경기예요.
				</p>
			) : (
				<p
					className={`mrd-delta ${delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}`}
				>
					{delta > 0 ? "+" : delta < 0 ? "−" : "±"}
					{Math.abs(delta)}
				</p>
			)}

			<div className="mrd-out-tier">
				<TierFrame tier={tier} placement={placement} size={36} decorative>
					{me ? (
						<PlayerAvatar
							name={me.name}
							gender={me.gender}
							size={36}
							photoId={photoKey(me)}
						/>
					) : (
						<span className="mrd-tier-dot" />
					)}
				</TierFrame>
				<div className="text-left min-w-0">
					<p className="text-[15px] font-bold text-strong">
						{placement
							? `배치 ${Math.min(games, ELO.PLACEMENT_SHOW_GAMES)}/${ELO.PLACEMENT_SHOW_GAMES}`
							: tierLabel(tier)}
						<span className="font-semibold text-muted ml-1.5 tabular-nums">
							{rating}점
						</span>
					</p>
					{!placement && next && (
						<div
							className="mrd-progress"
							role="progressbar"
							aria-label={`${next.label}까지 진행률`}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(tierProgress(rating) * 100)}
						>
							<span style={{ width: pct(tierProgress(rating)) }} />
						</div>
					)}
					<p className="text-xs text-faint mt-1">
						{placement
							? `${ELO.PLACEMENT_SHOW_GAMES - games}경기 더 하면 등급이 정해져요`
							: next
								? `${next.label}까지 ${next.min - rating}점`
								: "최고 등급이에요"}
					</p>
				</div>
			</div>

			<button
				type="button"
				className="btn-lq-primary w-full mt-5"
				onClick={onDone}
			>
				확인
			</button>
		</div>
	);
}
