-- 장소에 지도 링크 보관(네이버/카카오 공유 URL). 좌표(lat/lng)는 기존 컬럼 사용.
-- 미리보기/길찾기 버튼용 원본 링크를 함께 저장한다.
alter table public.places
	add column if not exists map_url text;
