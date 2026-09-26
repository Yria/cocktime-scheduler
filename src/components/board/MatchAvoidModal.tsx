import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import ModalSheet from "../common/ModalSheet";
import ConfirmDialog from "../common/ConfirmDialog";
import PlayerPickerList, { type PlayerPickerItem } from "../shared/PlayerPickerList";
import { useSessionStore } from "../../store/sessionStore";
import { useMatchAvoidStore } from "../../store/matchAvoidStore";
import { AVOID_GROUP_MAX, AVOID_GROUP_MIN, avoidGroupError } from "../../lib/teamSelection/avoidGroups";
import type { MatchAvoidGroup } from "../../lib/supabase/matchAvoid";

/**
 * 같이 매칭하지 않기 — 목록 주인 한 계정만 여는 숨은 메뉴(보드 상단 코트 현황 롱프레스).
 * 묶음 안의 두 사람은 자동편성에서 같은 경기에 넣지 않는다. 드래그·추천 창 선택 같은 직접 배치는 막지 않는다.
 * 회원 단위로 저장해 다음 회차에도 유지된다. members 행이 있는 선수(RSVP 게스트 포함)만 고를 수 있고,
 * 세션 설정에서 이름만 넣은 선수는 고를 수 없다.
 */
export default function MatchAvoidModal({ onClose }: { onClose: () => void }) {
	const sessionPlayers = useSessionStore(s => s.sessionPlayers);
	const { groups, names, status, load, add, remove } = useMatchAvoidStore();
	const ready = status === "ready";
	const [selected, setSelected] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	const [removing, setRemoving] = useState<MatchAvoidGroup | null>(null);

	useEffect(() => { void load(); }, [load]);

	// 한 회차에 같은 회원이 두 행일 수는 없지만(member_id 유일), 방어적으로 회원 id 기준으로 하나만 남긴다.
	const members = useMemo(() => [...new Map([...sessionPlayers.values()].filter(p => p.memberId).map(p => [p.memberId!, p])).values()],
		[sessionPlayers]);
	const items = useMemo((): PlayerPickerItem[] => members.map(p => ({ player: p, isPlaying: false, isSelected: selected.includes(p.memberId!) })),
		[members, selected]);
	const selectedNames = new Map(members.filter(p => selected.includes(p.memberId!)).map(p => [p.memberId!, p.name]));
	const error = selected.length >= AVOID_GROUP_MIN ? avoidGroupError(selected, groups.map(group => group.memberIds)) : null;
	const label = (group: MatchAvoidGroup) => group.memberIds.map(id => names.get(id) ?? "알 수 없는 회원").join(" · ");

	const toggle = (memberId: string) => setSelected(current => current.includes(memberId)
		? current.filter(id => id !== memberId)
		: current.length < AVOID_GROUP_MAX ? [...current, memberId] : current);

	const save = async () => {
		setSaving(true);
		const ok = await add(selected, selectedNames);
		setSaving(false);
		if (ok) setSelected([]);
	};

	return (
		<>
			<ModalSheet position="center" onClose={onClose} closeOnEscape keyboardAware className="flex min-h-0 flex-col"
				title="같이 매칭하지 않기" subtitle="이 계정에만 보여요">
				<div className="flex min-h-0 flex-col gap-4 px-5 pb-5">
					<p className="text-sm leading-relaxed text-muted">
						한 묶음(2~4명) 안의 사람끼리는 자동편성에서 같은 경기에 넣지 않아요. 누가 보드를 편집하든 적용되고, 다음 회차에도 유지돼요. 직접 끌어다 넣거나 추천 창에서 고르는 건 막지 않고, 다른 사람 화면에는 아무 표시도 없어요.
					</p>

					<section aria-label="새 묶음" className="flex min-h-0 flex-col gap-2">
						<h4 className="text-sm font-semibold text-strong">새 묶음 · {selected.length}/{AVOID_GROUP_MAX}명</h4>
						<p className="text-sm text-muted" aria-live="polite">
							{selected.length ? `고른 사람: ${selected.map(id => selectedNames.get(id)).join(" · ")}` : "같이 넣지 않을 사람을 2~4명 골라 주세요"}
						</p>
						<PlayerPickerList
							players={items}
							onSelect={p => p.memberId && toggle(p.memberId)}
							isDisabled={p => !selected.includes(p.memberId!) && selected.length >= AVOID_GROUP_MAX}
							showSearch
							searchThreshold={0}
							showGenderFilter={false}
							maxHeight="26vh"
							emptyMessage="이번 회차에 고를 수 있는 회원이 없어요"
							noResultMessage="검색 결과가 없어요"
						/>
						{error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
						<button type="button" onClick={save}
							disabled={saving || !ready || selected.length < AVOID_GROUP_MIN || !!error}
							className="btn-lq-primary w-full disabled:opacity-40">
							{saving ? "저장 중…" : !ready ? "저장된 묶음을 먼저 불러와야 해요"
								: selected.length < AVOID_GROUP_MIN ? `${AVOID_GROUP_MIN}명 이상 골라 주세요` : "묶음 저장"}
						</button>
					</section>

					<section aria-label="저장된 묶음">
						<h4 className="mb-2 text-sm font-semibold text-strong">저장된 묶음 {ready && groups.length ? groups.length : ""}</h4>
						{status === "error" ? (
							<div role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-500/10">
								<span className="min-w-0 text-sm text-red-700 dark:text-red-300">
									{groups.length ? "최신 묶음을 불러오지 못했어요. 이전 목록으로 편성하고 있어요." : "묶음을 불러오지 못했어요. 불러오기 전까지 이 설정 없이 편성돼요."}
								</span>
								<button type="button" onClick={() => void load()} className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-blue-600 dark:text-blue-400">
									다시 불러오기
								</button>
							</div>
						) : !ready ? <p className="text-sm text-faint">불러오는 중…</p> : null}
						{groups.length === 0 ? (ready && <p className="text-sm text-faint">아직 없어요</p>)
							: <ul className="mt-2 flex flex-col gap-1.5">
								{groups.map(group => (
									<li key={group.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/5">
										<span className="min-w-0 text-sm font-medium text-strong">{label(group)}</span>
										<button type="button" onClick={() => setRemoving(group)} aria-label={`${label(group)} 묶음 삭제`}
											className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-red-600 dark:text-red-400">
											<Trash2 size={18} aria-hidden="true" />
										</button>
									</li>
								))}
							</ul>}
					</section>
				</div>
			</ModalSheet>
			{removing && (
				<ConfirmDialog
					title="묶음 삭제"
					message={`${label(removing)} 묶음을 지울까요? 이후 자동편성에서 다시 같은 경기에 들어갈 수 있어요.`}
					confirmLabel="삭제"
					tone="danger"
					zIndex={60}
					onConfirm={async () => { const group = removing; setRemoving(null); await remove(group.id); }}
					onCancel={() => setRemoving(null)}
					onDismiss={() => setRemoving(null)}
				/>
			)}
		</>
	);
}
