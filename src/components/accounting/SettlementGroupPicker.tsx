import { useState } from "react";
import { Check, Search } from "lucide-react";
import { quickGroups } from "../../lib/dues/quickSettlement";
import type { AccountingData } from "../../lib/dues/types";

/** Shared category search for expense and direct-income designation. */
export default function SettlementGroupPicker({
	data,
	month,
	value: group,
	onChange: setGroup,
	searchable,
	allowUnclassified,
}: {
	data: AccountingData;
	month: string;
	value: string | null;
	onChange: (id: string) => void;
	searchable: boolean;
	allowUnclassified: boolean;
}) {
	const [groupQuery, setGroupQuery] = useState("");
	const [groupLimit, setGroupLimit] = useState(6);
	const groups = quickGroups(data, month, groupQuery);
	const visibleGroups = groups.slice(0, groupLimit);
	const selectedGroup = data.groups.find((g) => g.id === group);
	if (selectedGroup && !visibleGroups.some((g) => g.id === selectedGroup.id))
		visibleGroups.unshift(selectedGroup);
	return (
		<div className="ac-quick-groups">
			{searchable && (
				<div className="ac-search">
					<Search size={15} aria-hidden="true" />
					<input
						aria-label="회계 항목 검색"
						name="group-search"
						autoComplete="off"
						placeholder="항목·장소 검색…"
						value={groupQuery}
						onChange={(e) => {
							setGroupQuery(e.target.value);
							setGroupLimit(6);
						}}
					/>
				</div>
			)}
			<div className="ac-choice-chips" role="group" aria-label="회계 항목 선택">
				{visibleGroups.map((g) => (
					<button
						type="button"
						key={g.id}
						className="ac-chip"
						aria-pressed={group === g.id}
						onClick={() => setGroup(g.id)}
					>
						{g.label}
						{group === g.id && <Check size={14} aria-hidden="true" />}
					</button>
				))}
				{allowUnclassified && (
					<button
						type="button"
						className="ac-chip"
						aria-pressed={group === ""}
						onClick={() => setGroup("")}
					>
						미분류로 변경
					</button>
				)}
			</div>
			{groups.length > groupLimit && (
				<button
					type="button"
					className="ac-link"
					onClick={() => setGroupLimit(groupLimit + 12)}
				>
					항목 더 보기 ({groups.length - groupLimit})
				</button>
			)}
		</div>
	);
}
