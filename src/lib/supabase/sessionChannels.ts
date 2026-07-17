/**
 * sessionChannels.ts
 *
 * 세션 실시간 채널(브로드캐스트+presence, 메타 postgres_changes) 배선 팩토리.
 * 도메인 처리/편집 락 결정은 호출자(sessionStore)가 핸들러로 주입한다 — 여기는 transport 배선만.
 */
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { PresenceState } from "../editLock";
import { type BroadcastPayload, createBroadcastChannel } from "./broadcast";
import { supabase } from "./client";
import type { SessionRow } from "./types";

export type SessionPlayersChange = RealtimePostgresChangesPayload<Record<string, unknown>>;

// player_updated / board_drafts_updated 는 브로드캐스트로 전송하지 않는다(Realtime 감축):
//   · player_updated → session_players postgres_changes 로 수렴
//   · board_drafts_updated → sessions-row UPDATE(board_drafts+version)로 수렴
// 둘 다 권위 경로와 중복이라 수신 리스너도 제거(발신자 로컬 반영은 applyBroadcast 직접 호출로 유지).
const BROADCAST_EVENTS = [
	"match_started",
	"match_completed",
	"match_roster_updated",
	"session_refresh_required",
] as const;

export interface SessionChannelHandlers {
	/** 브로드캐스트 수신 → 도메인 반영. */
	onBroadcast: (payload: BroadcastPayload) => void;
	/** presence(sync/join/leave) 변경 시 현재 presenceState 전달 → 접속자 목록 재산정(편집권 election 아님). */
	onPresenceSync: (state: PresenceState) => void;
	/** 다른 클라이언트가 세션 종료(is_active=false). */
	onEnd: () => void;
	/**
	 * sessions row UPDATE(is_active 제외) — match_assign_count + board_drafts/version + editor_*(서버 권위
	 * 편집 락)를 한 row에서 전달. board_drafts 는 이 DB UPDATE가 뷰어 수렴의 단일 권위 경로다(중복이던
	 * board_drafts_updated broadcast 제거 — Realtime 감축). 편집 락 변화도 같은 이벤트에 동승해 전파된다.
	 */
	onSessionRowUpdate: (row: SessionRow) => void;
	/** meta 채널 (재)구독 완료 — 재연결 직후 공백 보정용 단건 재조회 트리거. */
	onResync: () => void;
	/** session_players row 변경(INSERT/UPDATE/DELETE) — 선수 추가/삭제/상태가 row 단위로 즉시 전파. */
	onSessionPlayersChange: (payload: SessionPlayersChange) => void;
}

/**
 * 브로드캐스트/presence 채널과 메타 채널을 생성·구독하고 핸들로 반환.
 * - presence 자동 점유 election은 onPresenceSync 콜백 안에서 호출자가 결정(여기 묻지 않음).
 * - clientId/name으로 입장 track(claimAt=0, 미점유).
 */
export function createSessionChannels(
	sessionId: number,
	clientId: string,
	name: string,
	handlers: SessionChannelHandlers,
): { broadcastChannel: RealtimeChannel; metaChannel: RealtimeChannel } {
	const channel = createBroadcastChannel(sessionId, clientId);
	for (const event of BROADCAST_EVENTS) {
		channel.on("broadcast", { event }, ({ payload }) =>
			handlers.onBroadcast({ event, payload } as BroadcastPayload),
		);
	}
	// presence 변경(sync/join/leave) → 보유자/접속자 재산정. join/leave도 명시 구독해 인계 지연 방지.
	const syncPresence = () => {
		handlers.onPresenceSync(channel.presenceState() as unknown as PresenceState);
	};
	channel.on("presence", { event: "sync" }, syncPresence);
	channel.on("presence", { event: "join" }, syncPresence);
	channel.on("presence", { event: "leave" }, syncPresence);
	channel.subscribe((status) => {
		if (status === "SUBSCRIBED") {
			// 입장만 track(claimAt=0, 미점유). 첫 편집/인계 시 claim이 claimAt을 올린다.
			void channel
				.track({ clientId, name, claimAt: 0 })
				.then(() => syncPresence())
				.catch((e) => console.error("presence track failed:", e));
		}
	});

	// Session meta channel — 다른 클라이언트의 세션 종료(is_active=false) 및 match_assign_count 동기화
	const metaChannel = supabase
		.channel(`session-meta:${sessionId}`)
		.on(
			"postgres_changes",
			{
				event: "UPDATE",
				schema: "public",
				table: "sessions",
				filter: `id=eq.${sessionId}`,
			},
			(payload) => {
				const row = payload.new as SessionRow;
				if (!row.is_active) {
					handlers.onEnd();
					return;
				}
				// payload.new는 UPDATE 시 전체 컬럼을 포함 — match_assign_count/board_drafts/version/editor_*를
				// 한 번에 sessionStore로 전달. board_drafts 미변경 UPDATE에도 실려 오나 수신측이 멱등 처리.
				handlers.onSessionRowUpdate(row);
			},
		)
		.on(
			"postgres_changes",
			{
				event: "*", // INSERT/UPDATE/DELETE
				schema: "public",
				table: "session_players",
				filter: `session_id=eq.${sessionId}`,
			},
			(payload) => handlers.onSessionPlayersChange(payload),
		)
		.subscribe((status) => {
			// 재연결/최초 구독 완료 시 board_drafts를 1회 재조회해 SUBSCRIBED~첫 UPDATE 공백을 메운다.
			if (status === "SUBSCRIBED") handlers.onResync();
		});

	return { broadcastChannel: channel, metaChannel };
}
