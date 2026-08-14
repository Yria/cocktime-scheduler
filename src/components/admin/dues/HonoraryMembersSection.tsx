import { useEffect, useState } from "react";
import { duesSetHonorary, fetchHonoraryReasons } from "../../../lib/supabase/dues";
import type { AdminMemberRow } from "../../../lib/supabase/adminMembers";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import ConfirmDialog from "../../common/ConfirmDialog";
import BirthYearTag from "../../shared/BirthYearTag";
import { nameWithBirthYear } from "../../../lib/birthYear";
import { inputCls, inputStyle, labelCls, labelStyle } from "../../common/fieldStyles";
import { nameMatches } from "./matching";

// 명예회원(회비 면제) 관리 섹션 — DuesSettingsModal 안에 삽입.
// 지정/해제는 즉시 반영(RPC): 지정 시 미납 회비 self-heal 정리까지 한 트랜잭션.
// 검색은 nameMatches(부분+초성) 재사용. 사유는 지정 시 선택 입력.

function genderYear(m: AdminMemberRow): string {
	const g = m.gender === "M" ? "남" : m.gender === "F" ? "여" : "";
	return [g, m.birthYear ? String(m.birthYear) : ""].filter(Boolean).join(" ");
}

export default function HonoraryMembersSection() {
	const members = useDuesStore((s) => s.members);

	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<AdminMemberRow | null>(null);
	const [reason, setReason] = useState("");
	const [busyId, setBusyId] = useState<string | null>(null);
	const [confirmRemove, setConfirmRemove] = useState<AdminMemberRow | null>(null);
	const [error, setError] = useState<string | null>(null);
	// 사유(관리자 전용 member_honorary) — memberId→reason. members와 분리 조회.
	const [reasons, setReasons] = useState<Record<string, string>>({});

	// 방어: 설정 모달이 월 로드 없이 열린 경우 회원 슬라이스 확보.
	useEffect(() => {
		if (members.length === 0) void duesActions.refreshMembers();
	}, [members.length]);

	// 사유 로드(마운트 1회). 지정/해제 후엔 각 핸들러에서 갱신.
	useEffect(() => {
		let cancelled = false;
		void fetchHonoraryReasons().then((r) => {
			if (!cancelled) setReasons(r);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const honoraryList = members
		.filter((m) => m.isHonorary)
		.sort((a, b) => a.name.localeCompare(b.name));

	// 후보 = 활성·비게스트·비운영진(이미 면제)·비명예회원 중 이름/초성 매칭.
	const candidates = query.trim()
		? members
				.filter(
					(m) =>
						m.isActive &&
						!m.isGuest &&
						!m.isAdmin &&
						!m.isHonorary &&
						nameMatches(m.name, query),
				)
				.slice(0, 6)
		: [];

	const pick = (m: AdminMemberRow) => {
		setSelected(m);
		setQuery("");
		setError(null);
	};

	const cancelAdd = () => {
		setSelected(null);
		setReason("");
		setError(null);
	};

	const doAdd = async () => {
		if (!selected || busyId) return;
		setBusyId(selected.id);
		setError(null);
		const res = await duesSetHonorary(selected.id, true, reason.trim() || null);
		if (res.ok) {
			await duesActions.refreshMembers();
			setReasons(await fetchHonoraryReasons());
			const ym = useDuesStore.getState().loadedYm;
			if (ym) await duesActions.refreshMonth(ym); // 정리된 미납 회비를 현황에 반영
			cancelAdd();
		} else {
			setError(res.error ?? "지정에 실패했어요.");
		}
		setBusyId(null);
	};

	const doRemove = async (m: AdminMemberRow) => {
		if (busyId) return;
		setBusyId(m.id);
		setError(null);
		const res = await duesSetHonorary(m.id, false);
		if (res.ok) {
			await duesActions.refreshMembers();
			setReasons(await fetchHonoraryReasons());
		} else {
			setError(res.error ?? "해제에 실패했어요.");
		}
		// 성공·실패 모두 다이얼로그를 닫는다(실패 안내는 섹션 본문에 노출 — 다이얼로그 뒤 가림 방지).
		setConfirmRemove(null);
		setBusyId(null);
	};

	return (
		<div className="pt-1">
			<p className="text-strong" style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
				명예회원 (회비 면제)
			</p>
			<p className="text-faint" style={{ fontSize: 12.5, marginBottom: 8, lineHeight: 1.5 }}>
				지정하면 매월 회비 부과에서 제외돼요. 이미 부과된 미납 회비는 자동으로 정리돼요(납부분은 유지). 대관비는 별도예요.
			</p>

			{/* 현재 명예회원 목록 */}
			{honoraryList.length === 0 ? (
				<p className="text-muted" style={{ fontSize: 13 }}>지정된 명예회원이 없어요.</p>
			) : (
				<div className="flex flex-col gap-2">
					{honoraryList.map((m) => (
						<div
							key={m.id}
							className="flex items-center gap-3"
							style={{ background: "rgba(120,120,128,0.06)", borderRadius: 10, padding: "10px 12px" }}
						>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div className="text-strong truncate" style={{ fontSize: 14, fontWeight: 600 }}>
									{m.name}
									<BirthYearTag birthYear={m.birthYear} size={11.5} />
								</div>
								{reasons[m.id] && (
									<div className="text-muted truncate" style={{ fontSize: 12.5, marginTop: 2 }}>
										{reasons[m.id]}
									</div>
								)}
							</div>
							<button
								type="button"
								onClick={() => setConfirmRemove(m)}
								disabled={busyId != null}
								style={{ color: "#ef4444", background: "none", border: "none", fontSize: 12.5, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
							>
								해제
							</button>
						</div>
					))}
				</div>
			)}

			{/* 추가: 선택 전 검색 / 선택 후 사유 입력 */}
			<div style={{ marginTop: 10 }}>
				{selected ? (
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<span className="text-strong" style={{ fontSize: 13.5, fontWeight: 600 }}>
								{selected.name}
							</span>
							<span className="text-faint" style={{ fontSize: 12 }}>{genderYear(selected)}</span>
							<button
								type="button"
								onClick={cancelAdd}
								className="text-muted"
								style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 12.5, cursor: "pointer" }}
							>
								취소
							</button>
						</div>
						<div>
							<label className={labelCls} style={labelStyle}>지정 사유 (선택)</label>
							<textarea
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								rows={2}
								placeholder="예: 창단 공로 · 코치 등"
								className={inputCls}
								style={{ ...inputStyle, height: "auto", minHeight: 60, resize: "vertical" }}
							/>
						</div>
						<button
							type="button"
							onClick={doAdd}
							disabled={busyId != null}
							className="btn-tint-blue"
						>
							{busyId ? "지정 중…" : "명예회원으로 지정"}
						</button>
					</div>
				) : (
					<div>
						<input
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="이름·초성으로 회원 검색 (예: ㅎㅅㅁ)"
							className={inputCls}
							style={inputStyle}
						/>
						{query.trim() && (
							<div
								className="flex flex-col"
								style={{ marginTop: 6, border: "1px solid rgba(120,120,128,0.2)", borderRadius: 10, overflow: "hidden" }}
							>
								{candidates.length === 0 ? (
									<div className="text-faint" style={{ fontSize: 13, padding: "10px 12px" }}>검색 결과 없어요.</div>
								) : (
									candidates.map((m) => (
										<button
											key={m.id}
											type="button"
											onClick={() => pick(m)}
											className="text-strong"
											style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", textAlign: "left", padding: "10px 12px", fontSize: 14, cursor: "pointer" }}
										>
											{m.name}
											<span className="text-faint" style={{ fontSize: 12 }}>{genderYear(m)}</span>
										</button>
									))
								)}
							</div>
						)}
					</div>
				)}
			</div>

			{error && (
				<p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444", marginTop: 8 }}>{error}</p>
			)}

			{confirmRemove && (
				<ConfirmDialog
					title="명예회원 해제"
					message={`${nameWithBirthYear(confirmRemove.name, confirmRemove.birthYear)} 님을 명예회원에서 해제할까요? 다음 회비부터 다시 부과돼요(이번 달은 자동 재생성되지 않아요).`}
					confirmLabel="해제"
					tone="danger"
					maxWidth="xs"
					busy={busyId === confirmRemove.id}
					busyLabel="해제 중…"
					onConfirm={() => void doRemove(confirmRemove)}
					onCancel={() => setConfirmRemove(null)}
					onDismiss={() => setConfirmRemove(null)}
				/>
			)}
		</div>
	);
}
