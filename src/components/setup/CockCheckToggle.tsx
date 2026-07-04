import { Switch } from "../common/Switch";

interface Props {
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}

/** 콕 체크 on/off 스위치 — on이면 입장 선수의 콕 제출을 확인해야 매칭 대기 상태가 된다. */
export function CockCheckToggle({ enabled, onChange }: Props) {
	return (
		<div
			className="card-lq"
			style={{
				padding: "10px 16px",
				marginBottom: 12,
				display: "flex",
				alignItems: "center",
				gap: 14,
			}}
		>
			<div style={{ flex: 1, minWidth: 0 }}>
				<p
					className="text-strong"
					style={{ fontSize: 14, fontWeight: 700, margin: 0 }}
				>
					콕 체크
				</p>
				<p
					className="text-muted"
					style={{ fontSize: 11, margin: "2px 0 0", lineHeight: 1.4 }}
				>
					켜면 선수의 콕 제출을 확인해야 매칭 대기 상태가 됩니다
				</p>
			</div>
			<Switch
				checked={enabled}
				onChange={onChange}
				ariaLabel="콕 체크"
				onColor="var(--ios-green, #34c759)"
			/>
		</div>
	);
}
