// Magnet (circle)
export const MAGNET_SIZE = 64;
export const MAGNET_R = MAGNET_SIZE / 2;

// 자석 디자인 토큰은 단일 출처(magnetStyle)에서 가져온다 — PlayerCard(HTML)와 완전 동일.
import {
	MAGNET_SKILL_TRACK,
	MAGNET_SKILL_FG,
	MAGNET_GENDER_RING_M,
	MAGNET_GENDER_RING_F,
	MAGNET_GENDER_BG_M,
	MAGNET_GENDER_BG_F,
} from "../magnetStyle";

// Skill ring
export const RING_BG_COLOR = MAGNET_SKILL_TRACK;
export const RING_FG_COLOR = MAGNET_SKILL_FG;

// Gender colors
export const GENDER_M_COLOR = MAGNET_GENDER_RING_M;
export const GENDER_F_COLOR = MAGNET_GENDER_RING_F;
export const GENDER_M_LIGHT = MAGNET_GENDER_BG_M;
export const GENDER_F_LIGHT = MAGNET_GENDER_BG_F;

// Team slot grid
export const SLOT_SIZE = 64;
export const SLOT_GAP = 6;

// Team group layout
export const TEAM_PAD = 12;
export const TEAM_GAP = 8;
export const TEAM_CORNER_R = 16;
export const TEAM_LABEL_H = 14;
export const TEAM_VS_H = 12;
export const TEAM_CTA_H = 32;
export const TEAM_CTA_GAP = 6;

// Derived team dimensions
export const TEAM_GRID_W = SLOT_SIZE * 2 + SLOT_GAP;
export const TEAM_GRID_H = SLOT_SIZE * 2 + SLOT_GAP;
export const TEAM_W = TEAM_GRID_W + TEAM_PAD * 2;
export const TEAM_GRID_HALF = TEAM_GRID_H / 2;

// Team bounding box extents from anchor (for hit detection & collision)
export const TEAM_BOX_ABOVE = TEAM_GRID_HALF + TEAM_GAP + TEAM_LABEL_H + TEAM_PAD;
export const TEAM_BOX_BELOW = TEAM_GRID_HALF + TEAM_PAD + TEAM_CTA_GAP + TEAM_CTA_H;

// 상단 코트 레인 높이 — 경기중 코트 카드 전용 영역. 자유 자석/예비팀은 이 아래에만 배치.
export const COURT_LANE_H = TEAM_BOX_ABOVE + TEAM_BOX_BELOW + 24;

// Hit detection
export const TEAM_HIT_PADDING = 16;
// 그룹화: 두 자석이 지름의 10% 이상 겹칠 때만(중심거리 ≤ 0.9·지름). 살짝 닿는 정도로는 그룹 X.
export const PAIR_RADIUS = MAGNET_SIZE * 0.9;

// Empty slot
export const EMPTY_SLOT_SIZE = 44;
export const EMPTY_SLOT_R = EMPTY_SLOT_SIZE / 2;

// Toolbar & court bar
export const TOOLBAR_H = 48;
export const COURT_BAR_H = 36;

// Theme colors — 보드 캔버스(konva)는 다크 고정. 헤더/푸터는 앱 글래스 토큰(var(--mat-thick) 등) 사용.
export const BG_BOARD = "#0F172A";
export const TEXT_SECONDARY = "#94A3B8";
export const STROKE_DEFAULT = "#334155";

// Team status colors
export const TEAM_FORMING_BG = "#1E293B";
export const TEAM_FORMING_STROKE = "#334155";
export const TEAM_READY_BG = "#052E16";
export const TEAM_READY_STROKE = "#22C55E";
export const TEAM_PLAYING_BG = "#451A03";
export const TEAM_PLAYING_STROKE = "#F59E0B";
export const TEAM_QUEUED_BG = "#1E293B";
export const TEAM_QUEUED_STROKE = "#3B82F6";

// CTA
export const CTA_START_COLOR = "#22C55E";
export const CTA_QUEUE_COLOR = "#3B82F6";
export const CTA_FINISH_COLOR = "#3B82F6";
export const CTA_DISABLED_COLOR = "#475569";

// Reservation (ghost) 시각화
export const RESERVATION_OPACITY = 0.5;
export const RESERVATION_STROKE = "#A78BFA";
export const RESERVATION_DASH = [5, 4];
export const RESERVATION_BADGE_BG = "#7C3AED";
