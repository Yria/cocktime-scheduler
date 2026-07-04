import { WEEKDAY_LABELS } from "../../lib/schedule/recurrence";
import { labelCls, labelStyle } from "../common/fieldStyles";

interface Props {
	dayOfWeek: number;
	onSelect: (dow: number) => void;
}

/** '요일' 선택 행 (월~일 버튼). 선택 시 부수효과는 부모의 onSelect에서 처리. */
export function WeekdayField({ dayOfWeek, onSelect }: Props) {
	return (
		<div>
			<span className={labelCls} style={labelStyle}>
				요일
			</span>
			<div className="flex gap-1.5">
				{[1, 2, 3, 4, 5, 6, 0].map((dow) => {
					const label = WEEKDAY_LABELS[dow];
					const active = dow === dayOfWeek;
					return (
						<button
							key={label}
							type="button"
							onClick={() => onSelect(dow)}
							style={{
								flex: 1,
								padding: "9px 0",
								borderRadius: 9,
								fontSize: 14,
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
		</div>
	);
}
