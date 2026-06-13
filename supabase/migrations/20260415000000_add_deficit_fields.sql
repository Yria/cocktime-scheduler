-- deficit 기반 선발을 위한 필드 추가
-- sessions.match_assign_count: 세션 내 총 매치 배정 횟수
-- session_players.joined_at_match: 해당 선수가 합류한 시점의 match_assign_count 값
ALTER TABLE sessions ADD COLUMN match_assign_count INT NOT NULL DEFAULT 0;
ALTER TABLE session_players ADD COLUMN joined_at_match INT NOT NULL DEFAULT 0;
