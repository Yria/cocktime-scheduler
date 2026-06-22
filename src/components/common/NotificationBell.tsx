import { Bell } from "lucide-react";
import { useState } from "react";
import { notificationMessage } from "../../lib/supabase/notifications";
import { useAuthStore } from "../../store/authStore";
import {
	notificationActions,
	useNotificationStore,
} from "../../store/notificationStore";
import ModalSheet from "./ModalSheet";

/** 알림 생성 시각 → 상대시간 표기 */
function timeAgo(iso: string): string {
	const diff = Date.now() - Date.parse(iso);
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "방금 전";
	if (min < 60) return `${min}분 전`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}시간 전`;
	const day = Math.floor(hr / 24);
	if (day < 7) return `${day}일 전`;
	return new Date(iso).toLocaleDateString("ko-KR", {
		month: "long",
		day: "numeric",
	});
}

export default function NotificationBell() {
	const memberId = useAuthStore((s) => s.memberId);
	const items = useNotificationStore((s) => s.items);
	const unreadCount = useNotificationStore((s) => s.unreadCount);
	const [open, setOpen] = useState(false);
	// 패널을 여는 순간의 미읽음 id 스냅샷. 일괄 읽음 처리 후에도
	// 이번 열람 동안은 "새 알림" 점을 유지해 무엇이 새 알림이었는지 보이게 한다.
	const [seenUnread, setSeenUnread] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	const handleOpen = () => {
		// markAllRead의 낙관적 갱신 전에 현재 미읽음을 캡처
		setSeenUnread(
			new Set(items.filter((n) => n.read_at == null).map((n) => n.id)),
		);
		setOpen(true);
		// 패널을 여는 순간 미읽음을 일괄 읽음 처리(서버 + 배지)
		if (memberId) void notificationActions.markAllRead(memberId);
	};

	const handleClose = () => {
		setOpen(false);
		setSeenUnread(new Set());
	};

	return (
		<>
			<button
				type="button"
				onClick={handleOpen}
				aria-label="알림"
				className="relative flex items-center justify-center text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
				style={{
					width: 40,
					height: 40,
					background: "none",
					border: "none",
					cursor: "pointer",
				}}
			>
				<Bell size={20} strokeWidth={2} />
				{unreadCount > 0 && (
					<span
						className="absolute flex items-center justify-center text-white"
						style={{
							top: 2,
							right: 2,
							minWidth: 16,
							height: 16,
							padding: "0 4px",
							borderRadius: 999,
							background: "#ff3b30",
							fontSize: 10,
							fontWeight: 700,
							lineHeight: 1,
						}}
					>
						{unreadCount > 99 ? "99+" : unreadCount}
					</span>
				)}
			</button>

			{open && (
				<ModalSheet position="bottom" onClose={handleClose}>
					<div className="px-5 pt-5 pb-3">
						<h3
							className="text-[#0f1724] dark:text-white"
							style={{ fontSize: 17, fontWeight: 800 }}
						>
							알림
						</h3>
					</div>
					<div
						style={{ maxHeight: "60vh", overflowY: "auto" }}
						className="pb-2"
					>
						{items.length === 0 ? (
							<div
								className="text-center text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
								style={{ fontSize: 14, padding: "32px 0 40px" }}
							>
								알림이 없어요
							</div>
						) : (
							items.map((n) => (
								<div
									key={n.id}
									className="flex items-start gap-3 px-5 py-3 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
								>
									<span
										style={{
											marginTop: 6,
											width: 7,
											height: 7,
											borderRadius: 999,
											flexShrink: 0,
											background: seenUnread.has(n.id)
												? "#0b84ff"
												: "transparent",
										}}
									/>
									<div className="flex-1 min-w-0">
										<p
											className="text-[#0f1724] dark:text-white"
											style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}
										>
											{notificationMessage(n)}
										</p>
										<span
											className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
											style={{ fontSize: 12 }}
										>
											{timeAgo(n.created_at)}
										</span>
									</div>
								</div>
							))
						)}
					</div>
				</ModalSheet>
			)}
		</>
	);
}
