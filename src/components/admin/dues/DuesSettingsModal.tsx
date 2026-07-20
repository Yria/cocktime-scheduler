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
import { Switch } from "../../common/Switch";
import { inputCls, inputStyle, labelCls, labelStyle } from "../../common/fieldStyles";
import EmptyState from "../../shared/EmptyState";
import HonoraryMembersSection from "./HonoraryMembersSection";

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
	// 장소별 대관장소 여부(대관비 부과 대상) 편집값.
	const [placeGate, setPlaceGate] = useState<Record<number, boolean>>({});

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
			setPlaceGate(
				Object.fromEntries(p.map((pl) => [pl.id, pl.chargesCourtFee])),
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
		// 변경된 장소 대관장소 여부만 업데이트
		let okPlaces = true;
		for (const pl of places) {
			const next = placeGate[pl.id] ?? false;
			if (next !== pl.chargesCourtFee) {
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

						{/* 명예회원(회비 면제) */}
						<HonoraryMembersSection />

						{/* 장소별 대관장소 여부 */}
						<div className="pt-1">
							<p className="text-strong" style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
								대관장소 (대관비 부과 대상)
							</p>
							<p className="text-faint" style={{ fontSize: 12.5, marginBottom: 8, lineHeight: 1.5 }}>
								켜면 그 장소 세션 참석자에게 대관비를 부과해요. 실제 대관 총액은 일정(반복 규칙·회차)에서
								입력하고, 총액이 있으면 참석 인원으로 엔빵(나눗셈), 없으면 위 "대관비(인당)" 정액이 부과돼요.
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
											<Switch
												checked={placeGate[pl.id] ?? false}
												onChange={(v) =>
													setPlaceGate((prev) => ({ ...prev, [pl.id]: v }))
												}
												ariaLabel={`${pl.name} 대관장소`}
											/>
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
