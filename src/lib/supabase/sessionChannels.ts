/**
 * sessionChannels.ts
 *
 * 세션 실시간 채널(브로드캐스트+presence, 메타 postgres_changes) 배선 팩토리.
 * 도메인 처리/편집 락 결정은 호출자(sessionStore)가 핸들러로 주입한다 — 여기는 transport 배선만.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { PresenceState } from "../editLock";
import { type BroadcastPayload, createBroadcastChannel } from "./broadcast";
import { supabase } from "./client";

const BROADCAST_EVENTS = [
	"match_started",
	"match_completed",
	"player_updated",
	"board_drafts_updated",
	"session_refresh_required",
] as const;

export interface SessionChannelHandlers {
	/** 브로드캐스트 수신 → 도메인 반영. */
	onBroadcast: (payload: BroadcastPayload) => void;
	/** presence(sync/join/leave) 변경 시 현재 presenceState 전달 → 보유자/자동점유 재산정. */
	onPresenceSync: (state: PresenceState) => void;
	/** 다른 클라이언트가 세션 종료(is_active=false). */
	onEnd: () => void;
	/** sessions.match_assign_count 변경. */
	onMetaUpdate: (matchAssignCount: number) => void;
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
				const row = payload.new as { is_active: boolean; match_assign_count?: number };
				if (!row.is_active) {
					handlers.onEnd();
					return;
				}
				if (row.match_assign_count !== undefined) {
					handlers.onMetaUpdate(row.match_assign_count);
				}
			},
		)
		.subscribe();

	return { broadcastChannel: channel, metaChannel };
}
