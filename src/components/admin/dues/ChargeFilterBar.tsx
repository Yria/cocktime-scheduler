import {
	REFINES,
	SOURCES,
	type ChargeFilter,
	type FilterContext,
	type FilterSelection,
	previewCount,
} from "../../../lib/dues/chargeFilters";
import { inputCls, selectStyle } from "../../common/fieldStyles";
import { ToggleChip } from "./duesUi";

/**
 * 수동 부과 대상 필터 바 — **레지스트리를 그리기만 한다.**
 * 이 파일에는 개별 필터 id 가 한 번도 등장하지 않는다. 필터를 추가하려면
 * `lib/dues/chargeFilters.ts` 의 SOURCES/REFINES 에 정의 하나를 넣으면 되고 이 화면은 그대로다.
 *
 * 그리는 규칙만 담당한다:
 *  · source = 라디오(하나), refine = 토글(여러 개)
 *  · `unavailable` 이 사유를 주면 감광 + 사유를 title 로(왜 못 쓰는지 숨기지 않는다)
 *  · 칩마다 "켜면 몇 명" 미리보기를 붙인다 — 누르기 전에 결과를 알 수 있어야 손이 덜 간다
 *  · `options` 가 있는 필터는 켜져 있을 때만 아래에 값 선택을 붙인다
 */
interface Props {
	ctx: FilterContext;
	value: FilterSelection;
	onChange: (next: FilterSelection) => void;
}

export default function ChargeFilterBar({ ctx, value, onChange }: Props) {
	const source = SOURCES.find((f) => f.id === value.sourceId);

	const pickSource = (f: ChargeFilter) => onChange({ ...value, sourceId: f.id });
	const toggleRefine = (f: ChargeFilter) =>
		onChange({
			...value,
			refineIds: value.refineIds.includes(f.id)
				? value.refineIds.filter((x) => x !== f.id)
				: [...value.refineIds, f.id],
		});
	const setParam = (id: string, param: string) =>
		onChange({ ...value, params: { ...value.params, [id]: param } });

	const chip = (f: ChargeFilter, on: boolean, onClick: () => void) => {
		const why = f.unavailable?.(ctx) ?? null;
		const n = previewCount(f, value, ctx);
		return (
			<ToggleChip
				key={f.id}
				label={
					<>
						{f.label}
						{n != null && (
							<span style={{ opacity: 0.7, fontWeight: 600 }}> {n}</span>
						)}
					</>
				}
				on={on}
				disabled={why != null}
				title={why ?? f.hint}
				onClick={onClick}
			/>
		);
	};

	/** 값 선택이 필요한 필터의 하위 줄. 선택지가 없으면 아예 그리지 않는다. */
	const optionRow = (f: ChargeFilter) => {
		const opts = f.options?.(ctx) ?? [];
		if (opts.length === 0 || f.unavailable?.(ctx)) return null;
		return (
			<select
				key={`opt-${f.id}`}
				value={value.params[f.id] ?? opts[0].value}
				onChange={(e) => setParam(f.id, e.target.value)}
				className={inputCls}
				style={{ ...selectStyle, padding: "7px 11px", paddingRight: 34, fontSize: 13 }}
				aria-label={`${f.label} 값`}
			>
				{opts.map((o) => (
					<option key={o.value} value={o.value}>
						{f.label} · {o.label}
					</option>
				))}
			</select>
		);
	};

	return (
		<div className="flex flex-col gap-2.5">
			<Group title="시작 목록" hint={source?.hint}>
				{SOURCES.map((f) => chip(f, f.id === value.sourceId, () => pickSource(f)))}
			</Group>
			{source && optionRow(source)}

			<Group title="걸러내기">
				{REFINES.map((f) =>
					chip(f, value.refineIds.includes(f.id), () => toggleRefine(f)),
				)}
			</Group>
			{REFINES.filter((f) => value.refineIds.includes(f.id)).map(optionRow)}
		</div>
	);
}

function Group({
	title,
	hint,
	children,
}: {
	title: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div className="flex items-baseline gap-1.5 mb-1">
				<span className="text-muted" style={{ fontSize: 12, fontWeight: 700 }}>
					{title}
				</span>
				{hint && (
					<span className="text-faint" style={{ fontSize: 11 }}>
						{hint}
					</span>
				)}
			</div>
			<div className="flex flex-wrap gap-1.5">{children}</div>
		</div>
	);
}
