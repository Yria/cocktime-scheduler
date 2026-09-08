import { useState } from "react";
import { Search } from "lucide-react";
import { matchingMembers } from "../../lib/dues/v2/selection";
import { memberLabel } from "../../lib/dues/v2/summary";
import type { AccountingData } from "../../lib/dues/v2/types";
import { amountInputProps } from "../../lib/dues/v2/amountInput";
import { won } from "../admin/dues/duesText";

export interface ManualIssueLine {
	member_id: string;
	amount: number;
	due_ym: string;
}

/** Composes the existing issue command's fields; no persistence or member matching by name. */
export default function ManualChargeFields({
	data,
	label,
	date,
	lines,
	unitAmount,
	totalAmount,
	rounding,
	split,
	onLabel,
	onDate,
	onLines,
	onUnit,
	onTotal,
	onRounding,
	onSplit,
	onAdvanced,
	optionsOpen,
	onOptions,
	onReset,
}: {
	data: AccountingData;
	label: string;
	date: string;
	lines: ManualIssueLine[];
	unitAmount: string;
	totalAmount: string;
	rounding: string;
	split: boolean;
	onLabel: (value: string) => void;
	onDate: (value: string) => void;
	onLines: (lines: ManualIssueLine[]) => void;
	onUnit: (value: string) => void;
	onTotal: (value: string) => void;
	onRounding: (value: string) => void;
	onSplit: (value: boolean) => void;
	onAdvanced: () => void;
	optionsOpen: boolean;
	onOptions: () => void;
	onReset: () => void;
}) {
	const [query, setQuery] = useState("");
	const [includeOthers, setIncludeOthers] = useState(false);
	const [excluded, setExcluded] = useState<string[]>([]);
	const selected = new Set(lines.map((line) => line.member_id));
	const year = query.match(/(?:^|\s)(\d{2}|\d{4})(?:년생)?$/)?.[1];
	const nameQuery = year
		? query.replace(/(?:^|\s)\d{2,4}(?:년생)?$/, "").trim()
		: query;
	const matches = new Set(matchingMembers(data, nameQuery).map((m) => m.id));
	const people = data.members
		.filter(
			(m) =>
				matches.has(m.id) &&
				(!year ||
					(year.length === 2
						? String(m.birth_year).slice(-2) === year
						: String(m.birth_year) === year)),
		)
		.filter(
			(m) => includeOthers || selected.has(m.id) || (m.active && !m.guest),
		);
	const amount = lines[0]?.amount ?? 0;
	const sum = lines.reduce((sum, line) => sum + line.amount, 0);
	return (
		<div className="ac-voucher-compact">
			<div className="ac-issue-identity">
				<div className="ac-voucher-identity">
					<div>
						<div className="ac-issue-name-heading">
							<label htmlFor="manual-issue-name">부과 이름</label>
						</div>
						<input
							id="manual-issue-name"
							className="ac-field"
							value={label}
							onChange={(e) => onLabel(e.target.value)}
							placeholder="예: 9월 정모 회식비"
						/>
					</div>
					<label>
						발생일
						<input
							className="ac-field"
							type="date"
							value={date}
							onChange={(e) => onDate(e.target.value)}
						/>
					</label>
				</div>
			</div>
			<div className="ac-voucher-part">
				<div className="ac-section-heading">
					<h4>명단 {lines.length}명</h4>
					<span className="ac-caption">눌러서 선택·제외</span>
				</div>
				<div className="ac-search">
					<Search size={15} aria-hidden="true" />
					<input
						aria-label="대상 회원 검색"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="이름·초성·년생 검색"
					/>
				</div>
				<div
					className="ac-voucher-roster"
					role="group"
					aria-label="부과 대상 명단"
				>
					{people.map((m) => (
						<button
							type="button"
							className={`ac-chip${excluded.includes(m.id) && !selected.has(m.id) ? " is-excluded" : ""}`}
							key={m.id}
							aria-label={memberLabel(data, m.id)}
							aria-pressed={selected.has(m.id)}
							onClick={() => {
								setExcluded((prev) =>
									selected.has(m.id)
										? [...prev, m.id]
										: prev.filter((id) => id !== m.id),
								);
								onLines(
									selected.has(m.id)
										? lines.filter((line) => line.member_id !== m.id)
										: [
												...lines,
												{
													member_id: m.id,
													amount: Number(unitAmount),
													due_ym: date.slice(0, 7),
												},
											],
								);
							}}
						>
							<span>{m.name}</span>
							<small>
								{m.birth_year
									? String(m.birth_year).slice(-2)
									: memberLabel(data, m.id).slice(m.name.length + 3)}
								{m.gender
									? `·${m.gender === "M" ? "남" : m.gender === "F" ? "여" : m.gender}`
									: ""}
								{m.guest ? "·게스트" : ""}
							</small>
						</button>
					))}
					{!people.length && (
						<p className="ac-empty">조건에 맞는 회원이 없습니다.</p>
					)}
				</div>

				{optionsOpen && (
					<label className="ac-check">
						<input
							type="checkbox"
							checked={includeOthers}
							onChange={(e) => setIncludeOthers(e.target.checked)}
						/>
						게스트·비활성 회원 포함
					</label>
				)}
			</div>
			<div className="ac-voucher-part">
				<div className="ac-segment" role="group" aria-label="부과액 계산 방식">
					<button
						type="button"
						className="ac-chip"
						aria-pressed={split}
						onClick={() => onSplit(true)}
					>
						총액 분할
					</button>
					<button
						type="button"
						className="ac-chip"
						aria-pressed={!split}
						onClick={() => onSplit(false)}
					>
						인당 직접
					</button>
				</div>
				<label>
					{split ? "총액" : "인당 금액"}
					<input
						className="ac-field ac-number"
						aria-label={split ? "총액으로 나누기" : "인당 금액"}
						type="number"
						min="1"
						{...amountInputProps}
						value={split ? totalAmount : unitAmount}
						onChange={(e) =>
							split ? onTotal(e.target.value) : onUnit(e.target.value)
						}
					/>
				</label>
				{split && (
					<div className="ac-choice-chips" role="group" aria-label="올림 단위">
						{[10, 100, 1000].map((unit) => (
							<button
								type="button"
								className="ac-chip"
								key={unit}
								aria-pressed={rounding === String(unit)}
								onClick={() => onRounding(String(unit))}
							>
								{won(unit)} 올림
							</button>
						))}
					</div>
				)}
			</div>
			<div className="ac-issue-summary" aria-label="부과 금액 요약">
				<div className="ac-issue-summary-row">
					<span>인당 금액</span>
					<strong className="ac-number">{won(amount)}</strong>
				</div>
				<div className="ac-issue-summary-row ac-issue-sum">
					<strong>{lines.length}명 부과 합계</strong>
					<strong className="ac-number">{won(sum)}</strong>
				</div>
				{split && Number(totalAmount) > 0 && lines.length > 0 && (
					<p className="ac-caption">
						총액 {won(Number(totalAmount))} · 올림 차액{" "}
						{won(sum - Number(totalAmount))}
					</p>
				)}
			</div>
			<button
				type="button"
				className="ac-link ac-issue-settings"
				aria-expanded={optionsOpen}
				onClick={onOptions}
			>
				상세 설정
			</button>
			{optionsOpen && (
				<div className="ac-issue-extras">
					<button type="button" className="ac-link" onClick={onAdvanced}>
						개별 금액·납기 설정
					</button>
					<button type="button" className="ac-link" onClick={onReset}>
						입력 초기화
					</button>
				</div>
			)}
		</div>
	);
}
