import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { scheduleActions, useScheduleStore } from "../../store/scheduleStore";

const labelCls =
	"text-[#64748b] dark:text-[rgba(235,235,245,0.6)] block mb-1.5";
const inputCls =
	"w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-[#0f1724] dark:text-white border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]";
const inputStyle: React.CSSProperties = {
	padding: "11px 13px",
	borderRadius: 10,
	fontSize: 15,
	outline: "none",
};

export default function ScheduleForm() {
	const navigate = useNavigate();
	const ready = useAuthStore((s) => s.ready);
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const memberId = useAuthStore((s) => s.memberId);
	const places = useScheduleStore((s) => s.places);

	const [title, setTitle] = useState("");
	const [scheduledAt, setScheduledAt] = useState("");
	const [placeId, setPlaceId] = useState<number | null>(null);
	const [courtCount, setCourtCount] = useState(4);
	const [capacity, setCapacity] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	const [addingPlace, setAddingPlace] = useState(false);
	const [newPlaceName, setNewPlaceName] = useState("");
	const [newPlaceCourts, setNewPlaceCourts] = useState("");

	useEffect(() => {
		void scheduleActions.load();
	}, []);

	// 운영진이 아니면 차단
	useEffect(() => {
		if (ready && !isAdmin) navigate("/", { replace: true });
	}, [ready, isAdmin, navigate]);

	const handlePlaceSelect = (id: number | null) => {
		setPlaceId(id);
		const p = places.find((x) => x.id === id);
		if (p?.default_court_count) setCourtCount(p.default_court_count);
	};

	const handleAddPlace = useCallback(async () => {
		if (!newPlaceName.trim()) return;
		const courts = newPlaceCourts ? Number(newPlaceCourts) : null;
		const place = await scheduleActions.addPlace(
			newPlaceName.trim(),
			null,
			courts,
			memberId,
		);
		if (place) {
			setPlaceId(place.id);
			if (courts) setCourtCount(courts);
			setAddingPlace(false);
			setNewPlaceName("");
			setNewPlaceCourts("");
		}
	}, [newPlaceName, newPlaceCourts, memberId]);

	const handleSubmit = useCallback(async () => {
		setError("");
		if (!title.trim()) {
			setError("제목을 입력하세요");
			return;
		}
		if (!scheduledAt) {
			setError("일시를 선택하세요");
			return;
		}
		setSaving(true);
		const row = await scheduleActions.create(
			{
				title: title.trim(),
				scheduledAt: new Date(scheduledAt).toISOString(),
				courtCount,
				capacity: capacity ? Number(capacity) : null,
				placeId,
			},
			memberId,
		);
		setSaving(false);
		if (row) navigate("/", { replace: true });
		else setError("저장에 실패했습니다");
	}, [title, scheduledAt, courtCount, capacity, placeId, memberId, navigate]);

	return (
		<div
			className="min-h-[100dvh] bg-[#fafbff] dark:bg-[#0f172a]"
			style={{
				padding: "1.25rem",
				paddingTop: "max(1.25rem, env(safe-area-inset-top))",
				paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
			}}
		>
			<div className="w-full max-w-sm mx-auto flex flex-col gap-4">
				<div className="flex items-center justify-between">
					<h1
						className="text-[#0f1724] dark:text-white"
						style={{ fontSize: 20, fontWeight: 800 }}
					>
						일정 추가
					</h1>
					<button
						type="button"
						onClick={() => navigate("/")}
						className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						style={{
							background: "none",
							border: "none",
							fontSize: 14,
							fontWeight: 600,
							cursor: "pointer",
						}}
					>
						취소
					</button>
				</div>

				<div>
					<label
						className={labelCls}
						style={{ fontSize: 13, fontWeight: 600 }}
						htmlFor="sf-title"
					>
						제목
					</label>
					<input
						id="sf-title"
						className={inputCls}
						style={inputStyle}
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="예: 수요 정기 모임"
					/>
				</div>

				<div>
					<label
						className={labelCls}
						style={{ fontSize: 13, fontWeight: 600 }}
						htmlFor="sf-when"
					>
						일시
					</label>
					<input
						id="sf-when"
						type="datetime-local"
						className={inputCls}
						style={inputStyle}
						value={scheduledAt}
						onChange={(e) => setScheduledAt(e.target.value)}
					/>
				</div>

				<div>
					<label
						className={labelCls}
						style={{ fontSize: 13, fontWeight: 600 }}
						htmlFor="sf-place"
					>
						장소
					</label>
					{!addingPlace ? (
						<div className="flex gap-2">
							<select
								id="sf-place"
								className={inputCls}
								style={{ ...inputStyle, flex: 1 }}
								value={placeId ?? ""}
								onChange={(e) =>
									handlePlaceSelect(
										e.target.value ? Number(e.target.value) : null,
									)
								}
							>
								<option value="">장소 선택 안 함</option>
								{places.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
							<button
								type="button"
								onClick={() => setAddingPlace(true)}
								className="text-[#0b84ff]"
								style={{
									background: "rgba(11,132,255,0.1)",
									border: "none",
									borderRadius: 10,
									padding: "0 14px",
									fontSize: 14,
									fontWeight: 700,
									cursor: "pointer",
								}}
							>
								새 장소
							</button>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<input
								className={inputCls}
								style={inputStyle}
								value={newPlaceName}
								onChange={(e) => setNewPlaceName(e.target.value)}
								placeholder="새 장소 이름"
							/>
							<div className="flex gap-2">
								<input
									className={inputCls}
									style={{ ...inputStyle, flex: 1 }}
									type="number"
									inputMode="numeric"
									value={newPlaceCourts}
									onChange={(e) => setNewPlaceCourts(e.target.value)}
									placeholder="기본 코트 수(선택)"
								/>
								<button
									type="button"
									onClick={handleAddPlace}
									className="text-white"
									style={{
										background: "#0b84ff",
										border: "none",
										borderRadius: 10,
										padding: "0 16px",
										fontSize: 14,
										fontWeight: 700,
										cursor: "pointer",
									}}
								>
									추가
								</button>
								<button
									type="button"
									onClick={() => setAddingPlace(false)}
									className="text-[#98a0ab]"
									style={{
										background: "none",
										border: "none",
										fontSize: 13,
										cursor: "pointer",
									}}
								>
									취소
								</button>
							</div>
						</div>
					)}
				</div>

				<div className="flex gap-3">
					<div style={{ flex: 1 }}>
						<label
							className={labelCls}
							style={{ fontSize: 13, fontWeight: 600 }}
							htmlFor="sf-courts"
						>
							코트 수
						</label>
						<input
							id="sf-courts"
							type="number"
							inputMode="numeric"
							className={inputCls}
							style={inputStyle}
							value={courtCount}
							onChange={(e) =>
								setCourtCount(Math.max(1, Number(e.target.value) || 1))
							}
						/>
					</div>
					<div style={{ flex: 1 }}>
						<label
							className={labelCls}
							style={{ fontSize: 13, fontWeight: 600 }}
							htmlFor="sf-cap"
						>
							정원(선택)
						</label>
						<input
							id="sf-cap"
							type="number"
							inputMode="numeric"
							className={inputCls}
							style={inputStyle}
							value={capacity}
							onChange={(e) => setCapacity(e.target.value)}
							placeholder="무제한"
						/>
					</div>
				</div>

				{error && (
					<p style={{ fontSize: 13, color: "#ef4444", fontWeight: 500 }}>
						{error}
					</p>
				)}

				<button
					type="button"
					onClick={handleSubmit}
					disabled={saving}
					style={{
						width: "100%",
						padding: "15px",
						borderRadius: 12,
						fontSize: 16,
						fontWeight: 700,
						color: "#fff",
						background: saving ? "rgba(11,132,255,0.5)" : "#0b84ff",
						border: "none",
						cursor: saving ? "not-allowed" : "pointer",
						boxShadow: saving ? "none" : "0 4px 16px rgba(11,132,255,0.3)",
						marginTop: 4,
					}}
				>
					{saving ? "저장 중…" : "일정 저장"}
				</button>
			</div>
		</div>
	);
}
