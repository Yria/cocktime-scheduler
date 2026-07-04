import { labelCls, labelStyle } from "../common/fieldStyles";
import { PRESET_CHIPS } from "./ruleEditorPresets";
import type { PresetKey } from "./ruleEditorPresets";

interface Props {
	activePreset: PresetKey;
	ordinals: Set<number>;
	includeLast: boolean;
	onSelectPreset: (key: PresetKey) => void;
	onToggleOrdinal: (n: number) => void;
	onToggleLast: () => void;
}

/** '주차' 섹션 (프리셋 칩 + 직접선택 시 1~5주/마지막주 편집). 상태 변경은 부모 콜백에서 처리. */
export function WeekOrdinalField({
	activePreset,
	ordinals,
	includeLast,
	onSelectPreset,
	onToggleOrdinal,
	onToggleLast,
}: Props) {
	return (
		<div>
			<span className={labelCls} style={labelStyle}>
				주차
			</span>
			<div className="flex gap-1.5">
				{PRESET_CHIPS.map(({ key, label }) => {
					const active = activePreset === key;
					return (
						<button
							key={key}
							type="button"
							onClick={() => onSelectPreset(key)}
							style={{
								flex: 1,
								padding: "9px 0",
								borderRadius: 9,
								fontSize: 13,
								fontWeight: 700,
								border: "none",
								cursor: "pointer",
								color: active ? "#fff" : "#64748b",
								background: active ? "#0b84ff" : "rgba(100,116,139,0.12)",
							}}
						>
							{label}
						</button>
					);
				})}
			</div>

			{/* 직접선택: 1~5주 체크박스 + 마지막주 토글 */}
			{activePreset === "custom" && (
				<div className="flex flex-col gap-2 mt-2.5">
					<div className="flex gap-1.5">
						{[1, 2, 3, 4, 5].map((n) => {
							const active = ordinals.has(n);
							return (
								<button
									key={n}
									type="button"
									onClick={() => onToggleOrdinal(n)}
									style={{
										flex: 1,
										padding: "9px 0",
										borderRadius: 9,
										fontSize: 13.5,
										fontWeight: 700,
										border: active
											? "1px solid #0b84ff"
											: "1px solid rgba(0,0,0,0.12)",
										cursor: "pointer",
										color: active ? "#0b84ff" : "#64748b",
										background: active
											? "rgba(11,132,255,0.12)"
											: "transparent",
									}}
								>
									{active ? "✓ " : ""}
									{n}주
								</button>
							);
						})}
					</div>
					<button
						type="button"
						onClick={onToggleLast}
						style={{
							alignSelf: "flex-start",
							padding: "7px 13px",
							borderRadius: 9,
							fontSize: 13,
							fontWeight: 700,
							border: includeLast
								? "1px solid #0b84ff"
								: "1px solid rgba(0,0,0,0.12)",
							cursor: "pointer",
							color: includeLast ? "#0b84ff" : "#64748b",
							background: includeLast
								? "rgba(11,132,255,0.12)"
								: "transparent",
						}}
					>
						{includeLast ? "✓ " : ""}마지막주
					</button>
				</div>
			)}
		</div>
	);
}
