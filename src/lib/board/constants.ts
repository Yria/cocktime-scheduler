// Magnet (circle)
export const MAGNET_SIZE = 64;
export const MAGNET_R = MAGNET_SIZE / 2;
// 자석 인터랙션(드래그/탭) 히트 반경 — 시각 반경(MAGNET_R=32)보다 작게 둔다.
// 4명 팀은 자석 4개가 박스를 거의 메워 그룹 드래그용 빈틈이 ~6px뿐이었다.
// 히트 반경을 줄이면 자석 사이/주변·프레임이 부모 그룹(예비팀·코트카드) 드래그로 떨어져
// "보이는 자석 4개를 제외한 곳 어디서든" 그룹을 잡을 수 있다(탭 타깃 52px로 충분).
export const MAGNET_HIT_R = 26;

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

// Hit detection
export const TEAM_HIT_PADDING = 16;
// 그룹화: 두 자석이 지름의 10% 이상 겹칠 때만(중심거리 ≤ 0.9·지름). 살짝 닿는 정도로는 그룹 X.
export const PAIR_RADIUS = MAGNET_SIZE * 0.9;

// Empty slot
export const EMPTY_SLOT_SIZE = 44;
export const EMPTY_SLOT_R = EMPTY_SLOT_SIZE / 2;
// 그룹 합류 스냅 반경 — 드롭한 자석 중심이 빈 슬롯(구멍) 중심에서 이 거리 안일 때만 합류/예약.
// 슬롯 간격(SLOT_SIZE+SLOT_GAP=70)의 절반 미만이라 인접 슬롯 캐치먼트가 겹치지 않고,
// 박스 가운데/가장자리(슬롯 아님)는 잡히지 않아 "구멍에 정확히 놓을 때만" 반응한다.
export const SLOT_SNAP_R = SLOT_SIZE / 2; // 32

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

// 휴식존(rest zone) — 하단 푸터(RestBar)가 곧 휴식 드롭 영역. 접힘 상태에선 자석을 칠판 하단 경계
// 너머 바텀 바까지 내려야 휴식(칠판 안엔 밴드 없음), 펼침(탭) 상태에선 패널이 위로 열려 휴식자 노출.
export const REST_ZONE_H = MAGNET_SIZE + 44; // 펼침 패널 높이(라벨 + 자석 1줄)
export const REST_ZONE_BG = "rgba(15,23,42,0.92)"; // 다크 슬레이트(반투명)
export const REST_ZONE_STROKE = "#475569";
export const REST_ZONE_LABEL = "#94A3B8";
// 드래그가 필드 위로 들어온 액티베이트(hot) 상태 — 스카이 액센트로 "여기 놓기" 강조
export const REST_ZONE_HOT_BG = "rgba(56,189,248,0.18)";
export const REST_ZONE_HOT_STROKE = "#38BDF8";
export const REST_ZONE_HOT_LABEL = "#7DD3FC";
// 휴식 자석 시각화
export const RESTING_OPACITY = 0.55;
export const RESTING_BADGE_BG = "#475569";

// 팀에서 빼기(detach) 드롭존 — 팀 소속 자석 드래그 중에만 네비 영역에 DOM 오버레이로 노출(휴식존과 구분되는 레드/로즈).
// 판정 경계는 칠판 상단(y≤0); DETACH_ZONE_H는 펼침 휴식 패널이 칠판 최상단까지 차오르지 않게 하는 상단 안전 마진(restZoneHeight)으로만 쓰인다.
export const DETACH_ZONE_H = 72; // 펼침 휴식 패널 상단 안전 마진(논리)
export const DETACH_ZONE_BG = "rgba(76,29,29,0.92)"; // 다크 로즈(반투명)
export const DETACH_ZONE_STROKE = "#7F1D1D";
export const DETACH_ZONE_LABEL = "#FCA5A5";
export const DETACH_ZONE_HOT_BG = "rgba(239,68,68,0.22)"; // 드래그가 위로 올라온 hot
export const DETACH_ZONE_HOT_STROKE = "#F87171";
export const DETACH_ZONE_HOT_LABEL = "#FECACA";

// 드래그 중 겹침 대상 하이라이트(자석/그룹 공통) — 스카이 액센트
export const HILITE_STROKE = "#38BDF8";

// 콕 미확인(비활성) 자석 — 앰버(노랑). 탭하면 콕 제출 확인 다이얼로그.
export const COCK_PENDING_COLOR = "#EAB308";
