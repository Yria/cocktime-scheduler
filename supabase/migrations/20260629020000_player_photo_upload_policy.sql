-- player-photos 버킷: 프로필 화면에서 본인이 사진을 직접 업로드할 수 있도록 정책 추가.
-- 기존엔 service_role 스크립트(scripts/fetch_photos.py)로만 업로드되어 authenticated 쓰기 정책이 없었다.
-- 사진 파일명은 md5(name)[:12].jpg 해시 키라 본인 소유 판별이 어렵고, 운영진의 회원 사진 관리도
-- 고려해야 하므로 현 운영 정책(다른 테이블도 아직 넓게 허용, RLS 정교화는 Phase 9)에 맞춰
-- authenticated 사용자에게 이 버킷 쓰기를 허용한다.

-- 버킷 보장(이미 존재하면 public=true만 갱신).
insert into storage.buckets (id, name, public)
values ('player-photos', 'player-photos', true)
on conflict (id) do update set public = true;

-- 공개 읽기(공개 버킷이지만 정책 명시).
drop policy if exists "player_photos_public_read" on storage.objects;
create policy "player_photos_public_read" on storage.objects
	for select using (bucket_id = 'player-photos');

-- 로그인 사용자 업로드.
drop policy if exists "player_photos_auth_insert" on storage.objects;
create policy "player_photos_auth_insert" on storage.objects
	for insert to authenticated with check (bucket_id = 'player-photos');

-- 로그인 사용자 덮어쓰기(upsert) — 클라이언트 업로드는 upsert라 기존 파일 갱신 시 UPDATE 경로를 탄다.
drop policy if exists "player_photos_auth_update" on storage.objects;
create policy "player_photos_auth_update" on storage.objects
	for update to authenticated
	using (bucket_id = 'player-photos')
	with check (bucket_id = 'player-photos');

-- 삭제 정책은 두지 않는다. 클라이언트는 업로드(upsert)만 하고 사진을 삭제하지 않으며,
-- 파일명이 md5(name) 결정적 키라 delete 허용 시 키 추측으로 타인 사진을 지울 수 있어 공격면만 늘린다.
-- 관리용 정리는 service_role(scripts/fetch_photos.py)이 RLS를 우회해 처리한다.
drop policy if exists "player_photos_auth_delete" on storage.objects;
