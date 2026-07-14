-- 정산함 '무시' 기능 완전 제거: 불필요 거래는 카테고리(기타/이자 등)로 분류하므로 ignore 불필요.
-- 클라이언트 wrapper·호출처 없음 확인 후 RPC 드롭. (status='ignored' 값은 남겨두되 더 이상 생성되지 않음.)
drop function if exists public.dues_ignore_transaction(bigint, text);
drop function if exists public.dues_unignore_transaction(bigint);
