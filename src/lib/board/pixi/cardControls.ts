import { TEAM_BOX_BELOW, TEAM_CTA_H, TEAM_PAD, TEAM_W } from "../constants";

const UNCONFIRM_W = 28;
const UNCONFIRM_GAP = 6;
export const CARD_CTA_Y = TEAM_BOX_BELOW - TEAM_PAD - TEAM_CTA_H;

/** Local card coordinates shared by painting and picking, including the inactive gap. */
export function cardControls(showUnconfirm: boolean) {
	const left = -TEAM_W / 2 + TEAM_PAD;
	const offset = showUnconfirm ? UNCONFIRM_W + UNCONFIRM_GAP : 0;
	return {
		main: { x: left + offset, y: CARD_CTA_Y, width: TEAM_W - TEAM_PAD * 2 - offset, height: TEAM_CTA_H },
		unconfirm: showUnconfirm ? { x: left, y: CARD_CTA_Y, width: UNCONFIRM_W, height: TEAM_CTA_H } : null,
	};
}
