import { useState } from "react";
import { matchingMembers } from "../../lib/dues/v2/selection";
import { memberLabel } from "../../lib/dues/v2/summary";
import type { AccountingData } from "../../lib/dues/v2/types";

export default function MemberPicker({
	data,
	value,
	onChange,
	label = "납부자",
	suggestedName = "",
}: {
	data: AccountingData;
	value: string;
	onChange: (id: string) => void;
	label?: string;
	suggestedName?: string;
}) {
	const [query, setQuery] = useState(suggestedName);
	const matches = matchingMembers(data, query);
	return (
		<div className="flex flex-col gap-2">
			<label className="text-sm">
				{label} 이름·초성 검색
				<input
					aria-label={`${label} 이름·초성 검색`}
					className="w-full rounded-xl border border-black/15 dark:border-white/20 bg-transparent px-3 py-2"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="이름 또는 초성"
				/>
			</label>
			{value && (
				<div className="flex gap-2 items-center text-sm rounded-lg bg-blue-500/10 p-2">
					<span className="flex-1">
						선택한 {label}: {memberLabel(data, value)}
					</span>
					<button
						type="button"
						className="text-[#0b84ff]"
						onClick={() => {
							onChange("");
							setQuery("");
						}}
					>
						{label} 변경
					</button>
				</div>
			)}
			<div
				role="group"
				aria-label={`${label} 검색 결과`}
				className="max-h-40 overflow-y-auto flex flex-col gap-1"
			>
				{matches.map((m) => (
					<button
						key={m.id}
						type="button"
						aria-pressed={value === m.id}
						className={`text-left text-sm rounded-lg p-2 ${value === m.id ? "bg-blue-500/15 text-[#0b84ff]" : "bg-black/5 dark:bg-white/5"}`}
						onClick={() => onChange(m.id)}
					>
						{memberLabel(data, m.id)}
						{!m.active && " · 비활성"}
					</button>
				))}
				{!matches.length && (
					<p className="text-sm text-muted">
						검색 결과가 없습니다. 이름이나 초성으로 다시 검색하세요.
					</p>
				)}
			</div>
		</div>
	);
}
