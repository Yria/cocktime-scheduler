-- 정모 식사(회식) 가게 위치: 어디서 먹는지를 회차에 적어 회원에게 보여준다.
-- 식사 체크(20260811010000)를 켤 때 함께 입력하는 부가정보 — 참여 여부를 고르려면
-- 어디서 먹는지 알아야 하므로 같은 자리(편집기 식사 토글 아래)에서 받는다.
--
--   · meal_place     : 가게 이름(또는 "가게명 주소"). 이것만 있어도 지도 열기가 된다
--                      (buildPlaceMapTarget 이 이름으로 카카오맵 검색 URL 을 만든다).
--   · meal_place_url : 지도 공유 링크(카카오/네이버). 있으면 검색 대신 이 링크를 쓴다 —
--                      places.map_url 과 같은 역할·같은 처리 경로.
--
-- 별도 places 행으로 만들지 않는 이유: places 는 대관장소 마스터(charges_court_fee 게이트,
-- 일정 장소 드롭다운의 원본)라 음식점을 섞으면 장소 선택 목록이 오염되고 대관비 부과 판정과
-- 얽힌다. 회식 가게는 회차마다 바뀌는 1회성 정보라 세션 행에 직접 둔다.
--
-- 쓰기는 is_regular·meal_enabled 와 같은 경로(클라이언트 직접 update, RLS sessions_admin_write
-- 로 운영진 한정)라 RPC 를 만들지 않는다. 재적용 안전(idempotent).

alter table public.sessions
	add column if not exists meal_place     text,
	add column if not exists meal_place_url text;
