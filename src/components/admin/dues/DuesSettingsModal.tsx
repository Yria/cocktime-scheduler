import { useEffect, useState } from "react";
import {
	type DuesSettings,
	type PlaceFeeRow,
	fetchDuesSettings,
	fetchPlaceFees,
	updateDuesSettings,
	updatePlaceFee,
} from "../../../lib/supabase/dues";
import ModalSheet from "../../common/ModalSheet";
import { inputCls, inputStyle, labelCls, labelStyle } from "../../common/fieldStyles";
import EmptyState from "../../shared/EmptyState";

interface Props {
	onClose: () => void;
}

// 회비 설정(관리자): 회비/대관비 기본액·offset·클럽 계좌 + 장소별 대관비. 한 번에 저장.
export default function DuesSettingsModal({ onClose }: Props) {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [monthlyFee, setMonthlyFee] = useState("5000");
	const [courtFeeDefault, setCourtFeeDefault] = useState("6000");
	const [offsetDays, setOffsetDays] = useState("3");
	const [bankName, setBankName] = useState("");
	const [bankAccount, setBankAccount] = useState("");
	const [accountHolder, setAccountHolder] = useState("");

	const [places, setPlaces] = useState<PlaceFeeRow[]>([]);
	// 장소별 편집값(문자열; 빈 문자열=대관비 없음).
	const [placeFees, setPlaceFees] = useState<Record<number, string>>({});

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const [s, p] = await Promise.all([fetchDuesSettings(), fetchPlaceFees()]);
			if (cancelled) return;
			if (s) {
				setMonthlyFee(String(s.monthlyFee));
				setCourtFeeDefault(String(s.courtFeeDefault));
				setOffsetDays(String(s.offsetDays));
				setBankName(s.bankName ?? "");
				setBankAccount(s.bankAccount ?? "");
				setAccountHolder(s.accountHolder ?? "");
			}
			setPlaces(p);
			setPlaceFees(
				Object.fromEntries(
					p.map((pl) => [pl.id, pl.courtFeePerHour == null ? "" : String(pl.courtFeePerHour)]),
				),
			);
			setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const handleSave = async () => {
		if (saving) return;
		const mf = Number(monthlyFee);
		const cf = Number(courtFeeDefault);
		const od = Number(offsetDays);
		if (!Number.isInteger(mf) || mf < 0 || !Number.isInteger(cf) || cf < 0) {
			setError("금액은 0 이상 정수여야 해요.");
			return;
		}
		if (!Number.isInteger(od) || od < 0 || od > 15) {
			setError("오프셋 일수는 0~15 사이여야 해요.");
			return;
		}
		setError(null);
		setSaving(true);
		const patch: Partial<DuesSettings> = {
			monthlyFee: mf,
			courtFeeDefault: cf,
			offsetDays: od,
			bankName: bankName.trim() || null,
			bankAccount: bankAccount.trim() || null,
			accountHolder: accountHolder.trim() || null,
		};
		const okSettings = await updateDuesSettings(patch);
		// 변경된 장소 대관비만 업데이트
		let okPlaces = true;
		for (const pl of places) {
			const raw = (placeFees[pl.id] ?? "").trim();
			const next = raw === "" ? null : Number(raw);
			if (next !== null && (!Number.isInteger(next) || next < 0)) {
				okPlaces = false;
				continue;
			}
			if (next !== pl.courtFeePerHour) {
				const ok = await updatePlaceFee(pl.id, next);
				if (!ok) okPlaces = false;
			}
		}
		setSaving(false);
		if (okSettings && okPlaces) {
			onClose();
		} else {
			setError("일부 항목 저장에 실패했어요. 다시 시도해 주세요.");
		}
	};

	return (
		<ModalSheet position="bottom" onClose={onClose} closeOnEscape title="회비 설정">
			<div className="px-5 pb-6">
				{loading ? (
					<EmptyState loading style={{ padding: "2rem 0" }} />
				) : (
					<div className="flex flex-col gap-4">
						{/* 금액·오프셋 */}
						<div className="flex gap-3">
							<div style={{ flex: 1 }}>
								<label className={labelCls} style={labelStyle}>회비/월 (원)</label>
								<input
									type="number"
									inputMode="numeric"
									value={monthlyFee}
									onChange={(e) => setMonthlyFee(e.target.value)}
									className={inputCls}
									style={inputStyle}
								/>
							</div>
							<div style={{ flex: 1 }}>
								<label className={labelCls} style={labelStyle}>대관비 (인당, 원)</label>
								<input
									type="number"
									inputMode="numeric"
									value={courtFeeDefault}
									onChange={(e) => setCourtFeeDefault(e.target.value)}
									className={inputCls}
									style={inputStyle}
								/>
							</div>
						</div>

						<div>
							<label className={labelCls} style={labelStyle}>
								가입 오프셋 (일) — 가입일+N일이 든 달의 다음 달부터 회비 부과
							</label>
							<input
								type="number"
								inputMode="numeric"
								value={offsetDays}
								onChange={(e) => setOffsetDays(e.target.value)}
								className={inputCls}
								style={{ ...inputStyle, maxWidth: 120 }}
							/>
						</div>

						{/* 클럽 계좌(민감 · 관리자만) */}
						<div className="pt-1">
							<p className="text-strong" style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
								클럽 계좌 <span className="text-faint" style={{ fontWeight: 500 }}>(회원에겐 마스킹 노출)</span>
							</p>
							<div className="flex flex-col gap-3">
								<div className="flex gap-3">
									<div style={{ flex: 1 }}>
										<label className={labelCls} style={labelStyle}>은행</label>
										<input
											type="text"
											value={bankName}
											onChange={(e) => setBankName(e.target.value)}
											placeholder="○○은행"
											className={inputCls}
											style={inputStyle}
										/>
									</div>
									<div style={{ flex: 1 }}>
										<label className={labelCls} style={labelStyle}>예금주</label>
										<input
											type="text"
											value={accountHolder}
											onChange={(e) => setAccountHolder(e.target.value)}
											className={inputCls}
											style={inputStyle}
										/>
									</div>
								</div>
								<div>
									<label className={labelCls} style={labelStyle}>계좌번호</label>
									<input
										type="text"
										inputMode="numeric"
										value={bankAccount}
										onChange={(e) => setBankAccount(e.target.value)}
										placeholder="숫자만 (예: 3333012345678)"
										className={inputCls}
										style={inputStyle}
									/>
								</div>
							</div>
						</div>

						{/* 장소별 대관비 */}
						<div className="pt-1">
							<p className="text-strong" style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
								장소별 코트 시간당 요금
							</p>
							<p className="text-faint" style={{ fontSize: 12.5, marginBottom: 8, lineHeight: 1.5 }}>
								코트 1개 시간당 요금(예: 13,000). 비워두면 대관비 없는 장소예요(회원 대관비 부과 안 함).
								세션별 실제 지출은 수지 탭에서 입력(할인 반영). 회원 대관비는 위 "대관비(인당)" 고정액.
							</p>
							{places.length === 0 ? (
								<p className="text-muted" style={{ fontSize: 13 }}>등록된 장소가 없어요.</p>
							) : (
								<div className="flex flex-col gap-2">
									{places.map((pl) => (
										<div key={pl.id} className="flex items-center gap-3">
											<span className="text-strong" style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
												{pl.name}
											</span>
											<input
												type="number"
												inputMode="numeric"
												value={placeFees[pl.id] ?? ""}
												onChange={(e) =>
													setPlaceFees((prev) => ({ ...prev, [pl.id]: e.target.value }))
												}
												placeholder="없음"
												className={inputCls}
												style={{ ...inputStyle, width: 110, textAlign: "right" }}
											/>
											<span className="text-faint" style={{ fontSize: 13 }}>원</span>
										</div>
									))}
								</div>
							)}
						</div>

						{error && (
							<p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>{error}</p>
						)}

						<button
							type="button"
							onClick={handleSave}
							disabled={saving}
							className="btn-solid-blue"
						>
							{saving ? "저장 중…" : "저장"}
						</button>
					</div>
				)}
			</div>
		</ModalSheet>
	);
}
