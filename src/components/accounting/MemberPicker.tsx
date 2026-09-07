import { Check, Search, UserRound } from "lucide-react";
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
	const selected = data.members.find((m) => m.id === value);
	return (
		<div className="ac-member-picker">
			{selected ? (
				<div className="ac-selected-person">
					<span className="ac-avatar">
						<UserRound size={18} />
					</span>
					<div className="ac-person-copy">
						<span className="ac-caption">
							선택한 {label}:{" "}
							<span className="sr-only">{memberLabel(data, value)}</span>
						</span>
						<strong>{selected.name}</strong>
						{memberLabel(data, value) !== selected.name && (
							<small>
								{memberLabel(data, value).slice(selected.name.length + 3)}
							</small>
						)}
					</div>
					<button
						type="button"
						className="ac-link"
						onClick={() => {
							onChange("");
							setQuery("");
						}}
					>
						{label} 변경
					</button>
				</div>
			) : (
				<>
					<label className="ac-label" htmlFor={`member-search-${label}`}>
						{label}
					</label>
					<div className="ac-search">
						<Search size={17} aria-hidden="true" />
						<input
							id={`member-search-${label}`}
							aria-label={`${label} 이름·초성 검색`}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="이름 또는 초성으로 검색"
							autoComplete="off"
						/>
					</div>
					<div
						role="group"
						aria-label={`${label} 검색 결과`}
						className="ac-people"
					>
						{matches.map((m) => {
							const fullLabel = memberLabel(data, m.id);
							return (
								<button
									key={m.id}
									type="button"
									aria-label={`${fullLabel}${!m.active ? " · 비활성" : ""}`}
									aria-pressed={value === m.id}
									className="ac-person-option"
									onClick={() => onChange(m.id)}
								>
									<span className="ac-avatar">{m.name.slice(0, 1)}</span>
									<span className="ac-person-copy">
										<strong>{m.name}</strong>
										<small>
											{[
												fullLabel.slice(m.name.length + 3),
												!m.active ? "비활성" : "",
											]
												.filter(Boolean)
												.join(" · ") || "회원"}
										</small>
									</span>
									<Check
										size={16}
										className="ac-person-check"
										aria-hidden="true"
									/>
								</button>
							);
						})}
						{!matches.length && (
							<p className="ac-empty">
								검색 결과가 없어요.
								<br />
								이름이나 초성으로 다시 검색해 주세요.
							</p>
						)}
					</div>
				</>
			)}
		</div>
	);
}
