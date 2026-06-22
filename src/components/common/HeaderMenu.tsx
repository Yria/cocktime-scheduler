import { EllipsisVertical } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authActions, authDisplayName, useAuthStore } from "../../store/authStore";
import ModalSheet from "./ModalSheet";

interface Props {
	/** "내 정보" 선택 시 프로필 수정 모달 열기 */
	onEditProfile: () => void;
}

export default function HeaderMenu({ onEditProfile }: Props) {
	const navigate = useNavigate();
	const authUser = useAuthStore((s) => s.user);
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const myName = useAuthStore((s) => s.myName);
	const [open, setOpen] = useState(false);

	const close = () => setOpen(false);
	const run = (fn: () => void) => () => {
		close();
		fn();
	};

	const itemClass =
		"w-full text-left px-5 py-3.5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]";
	// border는 인라인으로 주지 않는다(인라인이 className의 border-t를 덮어쓰므로).
	// Tailwind preflight가 버튼 테두리를 0으로 두어 className의 border-t만 적용된다.
	const itemStyle: React.CSSProperties = {
		background: "none",
		fontSize: 15,
		fontWeight: 600,
		cursor: "pointer",
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label="메뉴"
				className="flex items-center justify-center text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
				style={{
					width: 34,
					height: 34,
					background: "none",
					border: "none",
					cursor: "pointer",
				}}
			>
				<EllipsisVertical size={20} strokeWidth={2} />
			</button>

			{open && (
				<ModalSheet position="bottom" onClose={close}>
					{/* 사용자 정보 헤더 */}
					<div className="px-5 pt-5 pb-3">
						<p
							className="text-[#0f1724] dark:text-white"
							style={{ fontSize: 16, fontWeight: 800 }}
						>
							{myName || authDisplayName(authUser)}
						</p>
						{isAdmin && (
							<span
								className="text-[#0b84ff]"
								style={{ fontSize: 12, fontWeight: 700 }}
							>
								운영진
							</span>
						)}
					</div>

					<button
						type="button"
						onClick={run(onEditProfile)}
						className={`${itemClass} text-[#0f1724] dark:text-white`}
						style={itemStyle}
					>
						내 정보
					</button>
					{isAdmin && (
						<button
							type="button"
							onClick={run(() => navigate("/members"))}
							className={`${itemClass} text-[#0f1724] dark:text-white`}
							style={itemStyle}
						>
							회원 관리
						</button>
					)}
					<button
						type="button"
						onClick={run(() => void authActions.signOut())}
						className={`${itemClass} text-[#ff3b30]`}
						style={itemStyle}
					>
						로그아웃
					</button>
				</ModalSheet>
			)}
		</>
	);
}
