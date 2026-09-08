import { Check, Search, UserRound, X } from "lucide-react";
import { useId, useState } from "react";
import { matchingMembers } from "../../lib/dues/v2/selection";
import { memberLabel } from "../../lib/dues/v2/summary";
import type { AccountingData } from "../../lib/dues/v2/types";

export default function MemberPicker({
	data,
	value,
	onChange,
	label = "납부자",
	suggestedName = "",
	descriptionForMember,
	compact = false,
	receipt = false,
}: {
	data: AccountingData;
	value: string;
	onChange: (id: string) => void;
	label?: string;
	suggestedName?: string;
	descriptionForMember?: (id: string) => string;
	compact?: boolean;
	receipt?: boolean;
}) {
	const searchId = useId();
	const [query, setQuery] = useState(
		receipt && !matchingMembers(data, suggestedName).length
			? ""
			: suggestedName,
	);
	const [limit, setLimit] = useState(8);
	const [onlyOwing, setOnlyOwing] = useState(false);
	const owing = new Set(
		data.due
			.filter((d) => d.remaining > 0)
			.map(
				(d) => data.charges.find((c) => c.id === d.charge_id)?.member_id ?? "",
			)
			.filter(Boolean),
	);
	const rank = (id: string, name: string) =>
		(suggestedName.replaceAll(" ", "").includes(name.replaceAll(" ", ""))
			? 0
			: 4) +
		(owing.has(id) ? 0 : 2) +
		(data.members.find((m) => m.id === id)?.active === false ? 1 : 0);
	// 입금자명의 0906 같은 날짜는 이름 매칭에 맡기고, 직접 검색할 때는 년생도 구분한다.
	const year =
		receipt && query !== suggestedName
			? query.match(/(?:^|\s)(\d{2}|\d{4})(?:년생)?$/)?.[1]
			: undefined;
	const nameQuery = year
		? query.replace(/(?:^|\s)\d{2,4}(?:년생)?$/, "").trim()
		: query;
	const matches = matchingMembers(data, nameQuery)
		.filter(
			(m) =>
				(!receipt || !onlyOwing || owing.has(m.id)) &&
				(!year ||
					(year.length === 2
						? String(m.birth_year).slice(-2) === year
						: String(m.birth_year) === year)),
		)
		.sort(
			(a, b) =>
				rank(a.id, a.name) - rank(b.id, b.name) ||
				a.name.localeCompare(b.name, "ko"),
		);
	const selected = data.members.find((m) => m.id === value);
	if (compact) {
		const choices =
			selected && !matches.some((m) => m.id === selected.id)
				? [selected, ...matches]
				: matches;
		return (
			<div
				className={`ac-payer-chips ${!receipt && selected && choices.length === 1 ? "is-resolved" : ""}`}
			>
				<div className="ac-payer-search-row">
					<label className="ac-label" htmlFor={searchId}>
						{label}
					</label>
					<div className="ac-search">
						<Search size={15} aria-hidden="true" />
						<input
							id={searchId}
							aria-label={`${label} 이름·초성 검색`}
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setLimit(8);
							}}
							name="payer-search"
							spellCheck={false}
							placeholder={receipt ? "회원 이름·년생" : "이름·초성 (ㅈㅅㅊ)"}
							autoComplete="off"
						/>
						{!!query && (
							<button
								type="button"
								className="ac-search-clear"
								aria-label={`${label} 검색어 지우기`}
								onClick={() => {
									setQuery("");
									setLimit(8);
								}}
							>
								<X size={16} aria-hidden="true" />
							</button>
						)}
					</div>
				</div>
				{receipt && (
					<div
						className="ac-choice-chips"
						role="group"
						aria-label="납부자 필터"
					>
						<button
							type="button"
							className="ac-chip"
							aria-pressed={onlyOwing}
							onClick={() => {
								setOnlyOwing(true);
								setLimit(8);
							}}
						>
							미납자
						</button>
						<button
							type="button"
							className="ac-chip"
							aria-pressed={!onlyOwing}
							onClick={() => {
								setOnlyOwing(false);
								setLimit(8);
							}}
						>
							전체
						</button>
					</div>
				)}
				<div
					className="ac-payer-options"
					role="group"
					aria-label={`${label} 검색 결과`}
				>
					{choices.slice(0, limit).map((m) => {
						const fullLabel = memberLabel(data, m.id);
						return (
							<button
								key={m.id}
								type="button"
								className="ac-payer-option"
								aria-label={`${fullLabel}${!m.active ? " · 비활성" : ""}`}
								aria-pressed={value === m.id}
								onClick={() => onChange(!receipt && value === m.id ? "" : m.id)}
							>
								<span>
									<strong>{m.name}</strong>
									{value === m.id && <Check size={14} aria-hidden="true" />}
									{fullLabel !== m.name && (
										<small>{fullLabel.slice(m.name.length + 3)}</small>
									)}
									{!m.active && <small>비활성</small>}
								</span>
								{descriptionForMember && (!selected || choices.length > 1) && (
									<small>{descriptionForMember(m.id)}</small>
								)}
							</button>
						);
					})}
				</div>
				{choices.length > limit && (
					<button
						type="button"
						className="ac-link ac-payer-more"
						onClick={() => setLimit(limit + 12)}
					>
						후보 더 보기 ({choices.length - limit}명)
					</button>
				)}
				{selected && (
					<span className="sr-only">
						선택한 {label}: {memberLabel(data, value)}
					</span>
				)}
				{!choices.length &&
					(query ? (
						<button
							type="button"
							className="ac-chip"
							onClick={() => {
								setQuery("");
								setLimit(8);
							}}
						>
							일치 없음 · 전체 보기
						</button>
					) : (
						<span className="ac-caption">등록된 회원이 없습니다.</span>
					))}
			</div>
		);
	}
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
						{descriptionForMember && (
							<small>{descriptionForMember(value)}</small>
						)}
					</div>
					<button
						type="button"
						className="ac-link"
						onClick={() => {
							onChange("");
							setQuery(suggestedName);
						}}
					>
						{label} 변경
					</button>
				</div>
			) : (
				<>
					<label className="ac-label" htmlFor={searchId}>
						{label}
					</label>
					<div className="ac-search">
						<Search size={17} aria-hidden="true" />
						<input
							id={searchId}
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
										{descriptionForMember && (
											<small>{descriptionForMember(m.id)}</small>
										)}
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
