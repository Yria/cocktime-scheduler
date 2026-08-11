-- 회식 가게: "지도 링크 수동 붙여넣기" → 카카오 장소 검색(좌표 저장)으로 교체.
--
-- 20260811020000 은 meal_place_url(지도 공유 링크)을 운영진이 직접 붙여넣게 했다. 그런데 이 리포엔
-- 이미 장소 등록·거주지 입력에 쓰는 카카오 키워드 검색 공용 컴포넌트(common/KakaoLocationSearch)가
-- 있다 — 타이핑 자동완성 + 지도 미리보기 + 좌표 반환. 링크를 찾아 붙여넣게 할 이유가 없다.
--
-- 좌표를 저장하면 buildPlaceMapTarget(lib/kakaoMap.ts)이 이름 검색보다 정확한 타깃을 만든다:
--   웹  map.kakao.com/link/map/<이름>,<lat>,<lng>  (핀 표시)
--   앱  kakaomap://look?p=<lat>,<lng>              (네이티브 지도 핀)
-- places.lat/lng 와 같은 double precision 으로 맞춰 buildPlaceMapTarget 이 두 경로를 구분 없이 받는다.
--
-- meal_place_url 은 도입 당일 제거한다 — 전 회차에서 값 0건임을 확인했고(입력 UI 가 하루도 안 떴다),
-- 쓰이지 않는 컬럼을 남기면 나중에 "링크는 어디서 넣나" 하는 혼선만 생긴다.
-- meal_place(가게명)는 그대로 유지 — 검색 결과의 이름이 여기 들어가고, SDK 키가 없거나
-- 검색으로 못 찾는 가게는 직접 타이핑한 이름만 저장된다(이름만 있어도 지도 검색으로 폴백).

alter table public.sessions
	add column if not exists meal_place_lat double precision,
	add column if not exists meal_place_lng double precision;

alter table public.sessions
	drop column if exists meal_place_url;
