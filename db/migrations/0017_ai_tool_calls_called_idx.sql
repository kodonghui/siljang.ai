-- 0017_ai_tool_calls_called_idx: 30일 지난 AI 도구 호출 기록을 찾는 인덱스(설계 재검토 M8, 2026-11-15,
-- 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'. 설계 재검토 RC-15, docs/05-erd/README.md 5절 E11·6절 8)
-- 지우기(README 6절)가 상담이 열려 있거나 다룬 주문이 끝나지 않은 상담의 것도 30일 지난 ai_tool_calls 행을 지우므로(AI-1의 30일 보관)
-- 호출한 시각으로 찾는 인덱스를 더함. 테이블과 제약은 바꾸지 않음.
-- 0016_refund_counted_arrived.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0017_ai_tool_calls_called_idx.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 옮길 행이 없음.

-- TBL-049 ai_tool_calls: 호출한 시각
CREATE INDEX ai_tool_calls_called_idx ON ai_tool_calls (called_at); -- 30일 지난 도구 호출 기록 찾기(README 6절 8, E11)
