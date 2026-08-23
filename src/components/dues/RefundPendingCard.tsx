import type { MyRefundRow } from "../../lib/supabase/dues";
import { fmtMD, won } from "../admin/dues/duesText";

/**
 * "돌려받을 돈" 안내 — 낼 돈보다 많이 보내 남은 잔돈(5,000원 낼 것에 6,000원 → 1,000원).
 *
 * 왜 회원에게 보여주나: 남은 돈은 운영진의 정산함에만 보였고, 돌려주려면 **회원의 계좌번호**가 필요한데
 * 물어볼 계기가 없어서 잔돈이 그대로 묶여 있었다. 그래서 본인 화면이 먼저 알리고 계좌번호를 청한다.
 *
 * [내 회비] 탭과 진입 알림(UnpaidDuesAlert)이 **같은 컴포넌트**를 쓴다 — 두 곳의 문구가 갈리면
 * "어디서 본 안내가 맞는지" 묻게 된다. 미납(빨강)과 반대 방향의 돈이라 초록으로 둔다.
 */
export default function RefundPendingCard({ rows }: { rows: MyRefundRow[] }) {
	if (rows.length === 0) return null;
	const total = rows.reduce((s, r) => s + r.left, 0);

	return (
		<div
			className="bg-[rgba(52,199,89,0.07)] border border-[rgba(52,199,89,0.28)]"
			style={{ borderRadius: 14, padding: "13px 14px" }}
		>
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-muted" style={{ fontSize: 13, fontWeight: 600 }}>
					돌려받을 돈
				</span>
				<span
					className="text-[#1c8a3b]"
					style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}
				>
					{won(total)}
				</span>
			</div>

			{/* 근거 — 언제 얼마를 보냈고 얼마가 쓰였는지. 이 줄이 없으면 "왜 남았지"를 운영진에게 물어야 한다. */}
			<div style={{ borderTop: "1px solid rgba(52,199,89,0.2)", margin: "9px 0 7px" }} />
			<div className="flex flex-col" style={{ gap: 3 }}>
				{rows.map((r) => (
					<div key={r.txId} className="flex items-baseline justify-between gap-3">
						<span className="text-strong" style={{ fontSize: 12.5, fontWeight: 600 }}>
							{fmtMD(`${r.date}T00:00:00+09:00`)} {won(r.paid)} 보냄 · {won(r.used)} 사용
						</span>
						<span
							className="text-[#1c8a3b]"
							style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
						>
							{won(r.left)} 남음
						</span>
					</div>
				))}
			</div>

			<p className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 9 }}>
				<b className="text-strong">환불받을 계좌번호를 운영진에게 알려주세요.</b> 은행·계좌번호·예금주를
				함께 보내주시면 확인 후 보내드려요. 다음 회비·대관비에서 빼고 싶으면 그렇게 말씀해 주셔도 돼요.
			</p>
		</div>
	);
}
