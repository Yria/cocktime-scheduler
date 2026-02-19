import { useMemo, useState } from "react";
import { OAUTH_AVAILABLE, requestAccessToken } from "../lib/googleAuth";
import { updatePlayer, updatePlayerWithToken } from "../lib/sheetsApi";
import type {
	Gender,
	Player,
	PlayerSkills,
	SessionSettings,
	SkillLevel,
} from "../types";

interface Props {
	players: Player[];
	savedNames: Set<string> | null;
	scriptUrl: string;
	onUpdatePlayer: (player: Player) => void;
	onStart: (selected: Player[], settings: SessionSettings) => void;
	onBack: () => void;
}

type GenderFilter = "all" | "M" | "F";

const SKILLS: (keyof PlayerSkills)[] = [
	"클리어",
	"스매시",
	"로테이션",
	"드랍",
	"헤어핀",
	"드라이브",
	"백핸드",
];
const SKILL_LEVELS: SkillLevel[] = ["O", "V", "X"];
const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = {
	O: "상",
	V: "중",
	X: "하",
};

const DEFAULT_SKILLS: PlayerSkills = {
	클리어: "V",
	스매시: "V",
	로테이션: "V",
	드랍: "V",
	헤어핀: "V",
	드라이브: "V",
	백핸드: "V",
};

const devSelectedNames = import.meta.env.VITE_DEV_SELECTED
	? new Set(
			(import.meta.env.VITE_DEV_SELECTED as string)
				.split(",")
				.map((n) => n.trim()),
		)
	: null;

function SkillButton({
	level,
	active,
	onClick,
}: {
	level: SkillLevel;
	active: boolean;
	onClick: () => void;
}) {
	const colorMap: Record<SkillLevel, string> = {
		O: active ? "btn-skill-high" : "",
		V: active ? "btn-skill-mid" : "",
		X: active ? "btn-skill-low" : "",
	};
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all ${
				active ? colorMap[level] : "glass-item text-gray-500 dark:text-gray-400"
			}`}
			style={
				active
					? level === "O"
						? {
								background: "linear-gradient(175deg,#38de72 0%,#28c75e 100%)",
								color: "#fff",
								border: "1px solid rgba(20,148,58,0.28)",
								boxShadow:
									"0 3px 10px rgba(40,199,94,0.28),inset 0 1px 0 rgba(255,255,255,0.25)",
							}
						: level === "V"
							? {
									background: "linear-gradient(175deg,#ffd14a 0%,#f0b000 100%)",
									color: "#fff",
									border: "1px solid rgba(200,140,0,0.28)",
									boxShadow:
										"0 3px 10px rgba(240,176,0,0.28),inset 0 1px 0 rgba(255,255,255,0.25)",
								}
							: {
									background: "rgba(110,110,130,0.32)",
									color: "#fff",
									border: "1px solid rgba(120,120,140,0.42)",
									boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
								}
					: undefined
			}
		>
			{SKILL_LEVEL_LABEL[level]}
		</button>
	);
}

export default function SessionSetup({
	players,
	savedNames,
	scriptUrl,
	onUpdatePlayer,
	onStart,
	onBack,
}: Props) {
	const [courtCount, setCourtCount] = useState(2);
	const [singleWomanIds, setSingleWomanIds] = useState<Set<string>>(new Set());
	const [selected, setSelected] = useState<Set<string>>(() => {
		const namesToSelect = savedNames ?? devSelectedNames;
		if (namesToSelect) {
			return new Set(
				players.filter((p) => namesToSelect.has(p.name)).map((p) => p.id),
			);
		}
		return new Set(players.map((p) => p.id));
	});
	const [search, setSearch] = useState("");
	const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");

	const [guests, setGuests] = useState<Player[]>([]);
	const [showGuestModal, setShowGuestModal] = useState(false);
	const [guestName, setGuestName] = useState("");
	const [guestGender, setGuestGender] = useState<Gender>("M");
	const [guestSkills, setGuestSkills] = useState<PlayerSkills>({
		...DEFAULT_SKILLS,
	});

	function openGuestModal() {
		setGuestName("");
		setGuestGender("M");
		setGuestSkills({ ...DEFAULT_SKILLS });
		setShowGuestModal(true);
	}

	function addGuest() {
		const name = guestName.trim();
		if (!name) return;
		const id = `guest-${Date.now()}`;
		const newGuest: Player = {
			id,
			name,
			gender: guestGender,
			skills: { ...guestSkills },
		};
		setGuests((prev) => [...prev, newGuest]);
		setSelected((prev) => new Set([...prev, id]));
		setShowGuestModal(false);
	}

	function removeGuest(id: string) {
		setGuests((prev) => prev.filter((g) => g.id !== id));
		setSelected((prev) => {
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
		setSingleWomanIds((prev) => {
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
	}

	const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
	const [editGender, setEditGender] = useState<Gender>("M");
	const [editSkills, setEditSkills] = useState<PlayerSkills>(
		{} as PlayerSkills,
	);
	const [editSaving, setEditSaving] = useState(false);
	const [editError, setEditError] = useState("");

	const filtered = useMemo(() => {
		return players.filter((p) => {
			const matchName = p.name.includes(search);
			const matchGender = genderFilter === "all" || p.gender === genderFilter;
			return matchName && matchGender;
		});
	}, [players, search, genderFilter]);

	const filteredGuests = useMemo(() => {
		return guests.filter((p) => {
			const matchName = p.name.includes(search);
			const matchGender = genderFilter === "all" || p.gender === genderFilter;
			return matchName && matchGender;
		});
	}, [guests, search, genderFilter]);

	function togglePlayer(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleAll() {
		const allFilteredPlayers = [...filtered, ...filteredGuests];
		const allSelected = allFilteredPlayers.every((p) => selected.has(p.id));
		setSelected((prev) => {
			const next = new Set(prev);
			if (allSelected) allFilteredPlayers.forEach((p) => next.delete(p.id));
			else allFilteredPlayers.forEach((p) => next.add(p.id));
			return next;
		});
	}

	const allPlayers = useMemo(() => [...players, ...guests], [players, guests]);

	const selectedFemales = useMemo(
		() => allPlayers.filter((p) => p.gender === "F" && selected.has(p.id)),
		[allPlayers, selected],
	);

	function toggleSingleWoman(id: string) {
		setSingleWomanIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function handleStart() {
		const selectedPlayers = allPlayers.filter((p) => selected.has(p.id));
		const validSingleWomanIds = selectedPlayers
			.filter((p) => p.gender === "F" && singleWomanIds.has(p.id))
			.map((p) => p.id);
		onStart(selectedPlayers, {
			courtCount,
			singleWomanIds: validSingleWomanIds,
		});
	}

	function openEdit(e: React.MouseEvent, player: Player) {
		e.stopPropagation();
		setEditingPlayer(player);
		setEditGender(player.gender);
		setEditSkills({ ...player.skills });
		setEditError("");
	}

	async function handleSave() {
		if (!editingPlayer) return;
		if (editingPlayer.id.startsWith("guest-")) {
			setGuests((prev) =>
				prev.map((g) =>
					g.id === editingPlayer.id
						? { ...g, gender: editGender, skills: { ...editSkills } }
						: g,
				),
			);
			setEditingPlayer(null);
			return;
		}
		setEditSaving(true);
		setEditError("");
		try {
			if (OAUTH_AVAILABLE) {
				const token = await requestAccessToken();
				await updatePlayerWithToken(
					token,
					editingPlayer.name,
					editGender,
					editSkills,
				);
			} else if (scriptUrl) {
				await updatePlayer(
					scriptUrl,
					editingPlayer.name,
					editGender,
					editSkills,
				);
			} else {
				throw new Error(
					"저장 방법이 설정되지 않았습니다 (OAuth Client ID 또는 Script URL 필요)",
				);
			}
			onUpdatePlayer({
				...editingPlayer,
				gender: editGender,
				skills: editSkills,
			});
			setEditingPlayer(null);
		} catch (e) {
			setEditError(e instanceof Error ? e.message : "저장 실패");
		} finally {
			setEditSaving(false);
		}
	}

	const selectedCount = allPlayers.filter((p) => selected.has(p.id)).length;
	const allFilteredSelected =
		[...filtered, ...filteredGuests].length > 0 &&
		[...filtered, ...filteredGuests].every((p) => selected.has(p.id));

	return (
		<div className="lq-bg h-[100dvh] overflow-hidden flex flex-col md:max-w-sm md:mx-auto">
			{/* Header */}
			<div className="lq-header h-14 px-4 flex items-center gap-3 flex-shrink-0">
				<button
					type="button"
					onClick={onBack}
					className="w-8 h-8 flex items-center justify-center rounded-full glass-item text-gray-500 dark:text-gray-400"
				>
					‹
				</button>
				<h2 className="font-bold text-gray-800 dark:text-white text-lg tracking-tight flex-1">
					세션 설정
				</h2>
			</div>

			<div className="flex-1 min-h-0 overflow-y-auto no-sb p-4 flex flex-col gap-3">
				{/* Court count */}
				<div className="glass rounded-2xl p-4 flex-shrink-0">
					<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
						코트 수
					</p>
					<div className="flex gap-1 glass-sub rounded-xl p-1">
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<button
								type="button"
								key={n}
								onClick={() => setCourtCount(n)}
								className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${
									courtCount === n
										? "glass-item"
										: "text-gray-400 dark:text-gray-500"
								}`}
								style={courtCount === n ? { color: "#007aff" } : undefined}
							>
								{n}
							</button>
						))}
					</div>
				</div>

				{/* Single woman */}
				{selectedFemales.length > 0 && (
					<div className="glass rounded-2xl p-4 flex-shrink-0">
						<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">
							혼복 허용 여성
						</p>
						<p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
							남3여1 구성에서 1인 배치 허용
						</p>
						<div className="flex flex-wrap gap-2">
							{selectedFemales.map((p) => (
								<button
									type="button"
									key={p.id}
									onClick={() => toggleSingleWoman(p.id)}
									className={`chip ${singleWomanIds.has(p.id) ? "" : ""}`}
									style={
										singleWomanIds.has(p.id)
											? {
													background: "rgba(255,45,135,0.16)",
													border: "1px solid rgba(255,45,135,0.42)",
													color: "#e8207a",
													boxShadow: "0 2px 10px rgba(255,45,135,0.22)",
												}
											: undefined
									}
								>
									🔴 {p.name}
								</button>
							))}
						</div>
					</div>
				)}

				{/* Player list */}
				<div className="glass rounded-2xl overflow-hidden flex flex-col">
					<div className="px-4 pt-4 pb-2 flex-shrink-0">
						<div className="flex items-center justify-between mb-3">
							<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
								참석자&nbsp;
								<span style={{ color: "#007aff" }}>{selectedCount}</span>
								&nbsp;/ {allPlayers.length}명
								{guests.length > 0 && (
									<span
										className="text-xs font-medium ml-1.5"
										style={{ color: "#ff8c00" }}
									>
										(게스트 {guests.length})
									</span>
								)}
							</p>
							<div className="flex items-center gap-3">
								<button
									type="button"
									onClick={toggleAll}
									className="text-xs font-semibold"
									style={{ color: "#007aff" }}
								>
									{allFilteredSelected ? "전체해제" : "전체선택"}
								</button>
								<button
									type="button"
									onClick={openGuestModal}
									className="badge badge-blend px-3 py-1"
								>
									+ 게스트
								</button>
							</div>
						</div>

						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="이름 검색…"
							className="lq-input mb-2.5"
						/>

						<div className="flex gap-1.5 mb-1">
							{(["all", "M", "F"] as GenderFilter[]).map((g) => (
								<button
									type="button"
									key={g}
									onClick={() => setGenderFilter(g)}
									className={`chip py-1.5 text-xs rounded-xl ${genderFilter === g ? "chip-on" : ""}`}
									style={
										genderFilter === g
											? { borderRadius: "10px" }
											: { borderRadius: "10px" }
									}
								>
									{g === "all" ? "전체" : g === "M" ? "남자" : "여자"}
								</button>
							))}
						</div>
					</div>

					<div
						className="divide-y"
						style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}
					>
						{filtered.map((player) => (
							<div
								key={player.id}
								className="lq-divider flex items-center px-4 py-3 gap-3"
							>
								<button
									type="button"
									onClick={() => togglePlayer(player.id)}
									className="flex items-center gap-3 flex-1 text-left min-w-0"
								>
									<span
										className={`lq-check ${selected.has(player.id) ? "checked" : ""}`}
									>
										{selected.has(player.id) && (
											<span className="text-white text-xs font-bold">✓</span>
										)}
									</span>
									<span className="text-lg flex-shrink-0">
										{player.gender === "F" ? "🔴" : "🔵"}
									</span>
									<span className="font-medium text-gray-800 dark:text-gray-100 text-sm truncate">
										{player.name}
									</span>
								</button>
								<button
									type="button"
									onClick={(e) => openEdit(e, player)}
									className="text-gray-300 dark:text-gray-600 flex-shrink-0 px-1 text-base"
								>
									✎
								</button>
							</div>
						))}

						{filteredGuests.map((guest) => (
							<div
								key={guest.id}
								className="lq-divider flex items-center px-4 py-3 gap-3"
								style={{ background: "rgba(255,140,0,0.04)" }}
							>
								<button
									type="button"
									onClick={() => togglePlayer(guest.id)}
									className="flex items-center gap-3 flex-1 text-left min-w-0"
								>
									<span
										className={`lq-check ${selected.has(guest.id) ? "checked" : ""}`}
									>
										{selected.has(guest.id) && (
											<span className="text-white text-xs font-bold">✓</span>
										)}
									</span>
									<span className="text-lg flex-shrink-0">
										{guest.gender === "F" ? "🔴" : "🔵"}
									</span>
									<span className="font-medium text-gray-800 dark:text-gray-100 text-sm truncate">
										{guest.name}
									</span>
									<span className="badge badge-blend flex-shrink-0">
										게스트
									</span>
								</button>
								<button
									type="button"
									onClick={(e) => openEdit(e, guest)}
									className="text-gray-300 dark:text-gray-600 flex-shrink-0 px-1 text-base"
								>
									✎
								</button>
								<button
									type="button"
									onClick={() => removeGuest(guest.id)}
									className="text-red-300 dark:text-red-700 flex-shrink-0 px-1 text-sm"
								>
									✕
								</button>
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Bottom CTA */}
			<div className="lq-bar p-4">
				<button
					type="button"
					onClick={handleStart}
					disabled={selectedCount < 4}
					className="btn-lq-primary w-full py-4 text-lg"
				>
					세션 시작 ({selectedCount}명)
				</button>
			</div>

			{/* Guest modal */}
			{showGuestModal && (
				<div className="fixed inset-0 lq-overlay flex items-end justify-center z-50 px-4 pb-6">
					<div className="lq-sheet w-full max-w-sm rounded-3xl overflow-hidden max-h-[90dvh] flex flex-col">
						<div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
							<h3 className="font-bold text-gray-800 dark:text-white text-lg">
								게스트 추가
							</h3>
							<button
								type="button"
								onClick={() => setShowGuestModal(false)}
								className="w-8 h-8 flex items-center justify-center rounded-full glass-item text-gray-400 dark:text-gray-500 text-sm"
							>
								✕
							</button>
						</div>

						<div className="no-sb overflow-y-auto px-5 pb-2 space-y-4">
							<div>
								<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
									이름
								</p>
								<input
									type="text"
									value={guestName}
									onChange={(e) => setGuestName(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && addGuest()}
									placeholder="게스트 이름 입력"
									// biome-ignore lint/a11y/noAutofocus: Intended UX
									autoFocus={true}
									className="lq-input"
								/>
							</div>

							<div>
								<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
									성별
								</p>
								<div className="flex gap-2">
									{(["M", "F"] as Gender[]).map((g) => (
										<button
											type="button"
											key={g}
											onClick={() => setGuestGender(g)}
											className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
												guestGender === g
													? "btn-lq-primary"
													: "glass-item text-gray-600 dark:text-gray-300"
											}`}
										>
											{g === "M" ? "🔵 남" : "🔴 여"}
										</button>
									))}
								</div>
							</div>

							<div>
								<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
									스킬{" "}
									<span className="font-normal normal-case">(기본값: 중)</span>
								</p>
								<div className="space-y-2">
									{SKILLS.map((skill) => (
										<div key={skill} className="flex items-center gap-3">
											<span className="text-sm text-gray-600 dark:text-gray-300 w-16 flex-shrink-0">
												{skill}
											</span>
											<div className="flex gap-1.5 flex-1">
												{SKILL_LEVELS.map((level) => (
													<SkillButton
														key={level}
														level={level}
														active={guestSkills[skill] === level}
														onClick={() =>
															setGuestSkills((prev) => ({
																...prev,
																[skill]: level,
															}))
														}
													/>
												))}
											</div>
										</div>
									))}
								</div>
							</div>
						</div>

						<div
							className="px-5 py-4 flex gap-3 flex-shrink-0"
							style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}
						>
							<button
								type="button"
								onClick={() => setShowGuestModal(false)}
								className="btn-lq-secondary flex-1 py-3 text-sm"
							>
								취소
							</button>
							<button
								type="button"
								onClick={addGuest}
								disabled={!guestName.trim()}
								className="flex-1 py-3 rounded-[14px] text-sm font-bold text-white disabled:opacity-30"
								style={{
									background: "linear-gradient(175deg,#ffaa40 0%,#ff8c00 100%)",
									border: "1px solid rgba(200,90,0,0.28)",
									boxShadow:
										"0 5px 18px rgba(255,140,0,0.32),inset 0 1px 0 rgba(255,255,255,0.28)",
								}}
							>
								추가
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Edit modal */}
			{editingPlayer && (
				<div className="fixed inset-0 lq-overlay flex items-end justify-center z-50 px-4 pb-6">
					<div className="lq-sheet w-full max-w-sm rounded-3xl overflow-hidden max-h-[90dvh] flex flex-col">
						<div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
							<div className="flex items-center gap-2">
								<h3 className="font-bold text-gray-800 dark:text-white text-lg">
									{editingPlayer.name}
								</h3>
								{editingPlayer.id.startsWith("guest-") && (
									<span className="badge badge-blend">게스트</span>
								)}
							</div>
							<button
								type="button"
								onClick={() => setEditingPlayer(null)}
								className="w-8 h-8 flex items-center justify-center rounded-full glass-item text-gray-400 dark:text-gray-500 text-sm"
							>
								✕
							</button>
						</div>

						<div className="no-sb overflow-y-auto px-5 pb-2 space-y-4">
							<div>
								<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
									성별
								</p>
								<div className="flex gap-2">
									{(["M", "F"] as Gender[]).map((g) => (
										<button
											type="button"
											key={g}
											onClick={() => setEditGender(g)}
											className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
												editGender === g
													? "btn-lq-primary"
													: "glass-item text-gray-600 dark:text-gray-300"
											}`}
										>
											{g === "M" ? "🔵 남" : "🔴 여"}
										</button>
									))}
								</div>
							</div>

							<div>
								<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
									스킬
								</p>
								<div className="space-y-2">
									{SKILLS.map((skill) => (
										<div key={skill} className="flex items-center gap-3">
											<span className="text-sm text-gray-600 dark:text-gray-300 w-16 flex-shrink-0">
												{skill}
											</span>
											<div className="flex gap-1.5 flex-1">
												{SKILL_LEVELS.map((level) => (
													<SkillButton
														key={level}
														level={level}
														active={editSkills[skill] === level}
														onClick={() =>
															setEditSkills((prev) => ({
																...prev,
																[skill]: level,
															}))
														}
													/>
												))}
											</div>
										</div>
									))}
								</div>
							</div>

							{editError && (
								<p className="text-red-500 dark:text-red-400 text-sm">
									{editError}
								</p>
							)}
							{!editingPlayer.id.startsWith("guest-") &&
								(OAUTH_AVAILABLE ? (
									<p className="text-xs text-gray-400 dark:text-gray-500">
										저장 시 구글 로그인 팝업이 뜰 수 있습니다
									</p>
								) : !scriptUrl ? (
									<p className="text-xs" style={{ color: "#ff8c00" }}>
										저장 방법 미설정 — 시트에 반영되지 않습니다
									</p>
								) : null)}
							{editingPlayer.id.startsWith("guest-") && (
								<p className="text-xs" style={{ color: "#ff8c00" }}>
									게스트는 세션 내에서만 유지됩니다
								</p>
							)}
						</div>

						<div
							className="px-5 py-4 flex gap-3 flex-shrink-0"
							style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}
						>
							<button
								type="button"
								onClick={() => setEditingPlayer(null)}
								className="btn-lq-secondary flex-1 py-3 text-sm"
							>
								취소
							</button>
							<button
								type="button"
								onClick={handleSave}
								disabled={editSaving}
								className="btn-lq-primary flex-1 py-3 text-sm"
							>
								{editSaving ? "저장 중…" : "저장"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
