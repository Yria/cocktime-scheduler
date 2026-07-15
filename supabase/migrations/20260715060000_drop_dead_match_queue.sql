-- 죽은 테이블 정리: dues_match_queue
-- 옛 자동제안/보류 큐(§8) 잔재. 행 0개 + 참조하는 함수/FK/뷰 없음(확인) → 안전 삭제.
-- (member_name_aliases는 행 33개 + dues_cancel_match 참조가 있어 별도 결정 후 처리)
drop table if exists public.dues_match_queue;
