import { useEffect, useState } from "react";
import {
	fetchGroupSettings,
	updateGroupSettings,
} from "../../lib/supabase/clubSettings";
import { toast } from "../../store/toastStore";
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from "../../types";
import ModalSheet from "../common/ModalSheet";

const FIELDS: { label: string; hint: string; field: keyof GroupSettings }[] = [
	{ label: "남자 콕", hint: "콕체크 1회당 (개)", field: "cockQuotaMale" },
	{ label: "여자 콕", hint: "콕체크 1회당 (개)", field: "cockQuotaFemale" },
	{ label: "월 지원", hint: "회원당 매달 (개)", field: "cockSupportPerMonth" },
];

/**
 * 그룹(클럽) 전역 설정 편집 — 운영진 전용. 콕 쿼터(남/여)와 월 콕 지원량.
 * "콕 내는 양"은 세션 콕체크 1회당 기준. 월 지원량은 회원당 매달 차감되는 지원 콕 수.
 */
export default function GroupSettingsModal({ onClose }: { onClose: () => void }) {
	const [s, setS] = useState<GroupSettings>(DEFAULT_GROUP_SETTINGS);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let alive = true;
		void fetchGroupSettings().then((gs) => {
			if (alive) {
				setS(gs);
				setLoading(false);
			}
		});
		return () => {
			alive = false;
		};
	}, []);

	const setNum = (key: keyof GroupSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
		const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
		setS((prev) => ({ ...prev, [key]: n }));
	};

	const onSave = async () => {
		setSaving(true);
		const ok = await updateGroupSettings(s);
		setSaving(false);
		if (ok) {
			toast("콕 설정을 저장했어요");
			onClose();
		} else {
			toast("저장에 실패했어요 (운영진만 가능)", { variant: "error" });
		}
	};

	return (
		<ModalSheet position="center" className="p-6" onClose={onClose}>
			<h3 className="font-bold text-gray-800 dark:text-white text-lg mb-1">콕 설정</h3>
			<p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
				콕체크 1회당 내는 콕 수와, 회원당 매달 지원하는 콕 수입니다. 그 달 첫 콕체크에서 지원분만큼 차감돼요.
			</p>

			{FIELDS.map(({ label, hint, field }) => (
				<div key={field} className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
					<div>
						<div className="text-[#0f1724] dark:text-white" style={{ fontSize: 14, fontWeight: 600 }}>
							{label}
						</div>
						<div className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.45)]" style={{ fontSize: 12 }}>
							{hint}
						</div>
					</div>
					<input
						type="number"
						min={0}
						inputMode="numeric"
						value={s[field]}
						onChange={setNum(field)}
						disabled={loading || saving}
						className="bg-white dark:bg-[rgba(30,30,35,0.8)] text-[#0f1724] dark:text-white border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]"
						style={{ width: 72, padding: "8px 10px", borderRadius: 8, fontSize: 15, textAlign: "center", outline: "none", flexShrink: 0 }}
					/>
				</div>
			))}

			<div className="flex gap-3" style={{ marginTop: 8 }}>
				<button type="button" onClick={onClose} disabled={saving} className="btn-lq-secondary flex-1 py-3 text-sm">
					취소
				</button>
				<button type="button" onClick={onSave} disabled={loading || saving} className="btn-lq-primary flex-1 py-3 text-sm">
					{saving ? "저장 중…" : "저장"}
				</button>
			</div>
		</ModalSheet>
	);
}
