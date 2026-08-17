-- 회원 프로필 사진의 "존재 여부 + 버전"을 DB에 명시한다.
--
-- 문제: 클라이언트는 지금까지 모든 회원에게 사진이 있다고 가정하고 <img src=".../{id}.jpg"> 를 걸었다.
--       사진 없는 회원(활성 기준 73명)마다 Storage 가 NoSuchKey(HTTP 400 본문 404) 를 돌려주는데,
--       오류 응답은 브라우저가 캐시하지 않으므로 명단을 열 때마다 매번 재요청된다.
--       실측(2026-08-16~17 edge_logs): 24시간 5,359건 = 전체 4xx 의 100%. 무료 플랜 한도를 태운 주범.
-- 처방: photo_updated_at 이 null 이면 클라이언트가 Storage 요청 자체를 하지 않는다.
--
-- 덤: 캐시 무효화 버전(?v=)도 이 컬럼으로 일원화한다. 종전 localStorage 버전은 사진을 올린
--     본인 브라우저에서만 동작해, 다른 회원은 cacheControl(600s) 이 만료될 때까지 옛 사진을 봤다.
alter table public.members
	add column if not exists photo_updated_at timestamptz;

comment on column public.members.photo_updated_at is
	'프로필 사진 최종 업로드 시각. null = 사진 없음(클라이언트가 Storage 요청을 건너뛴다). ?v= 캐시 버전 겸용.';

-- 백필: player-photos 버킷에 {members.id}.jpg 가 실제로 존재하는 회원만 채운다.
-- (버킷에는 구 규약 md5(이름) 파일도 남아 있으므로 이름이 아니라 id 로만 매칭한다.)
update public.members m
set photo_updated_at = o.updated_at
from storage.objects o
where o.bucket_id = 'player-photos'
  and o.name = m.id::text || '.jpg'
  and m.photo_updated_at is null;
