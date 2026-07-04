import { Group, Rect, Text } from "react-konva";
import { MAGNET_R } from "../../lib/board/constants";

/** 자석 우상단 라운드 배지(예약/휴식 공용). 캔버스 출력 동일성을 위해 폰트/perfectDraw 고정. */
export const MagnetBadge = ({ text, fill }: { text: string; fill: string }) => (
	<Group x={MAGNET_R - 8} y={-MAGNET_R + 8} listening={false}>
		<Rect x={-16} y={-9} width={32} height={18} cornerRadius={9} fill={fill} perfectDrawEnabled={false} />
		<Text
			x={-16}
			y={-9}
			width={32}
			height={18}
			text={text}
			fontSize={10}
			fontStyle="bold"
			fontFamily="Inter, system-ui, sans-serif"
			fill="#FFFFFF"
			align="center"
			verticalAlign="middle"
			perfectDrawEnabled={false}
		/>
	</Group>
);
