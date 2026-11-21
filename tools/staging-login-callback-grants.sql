-- TASK-173: 사장님 세션과 카카오 수신·콜백에 필요한 서버 역할 권한.
-- psql -v runtime_role=<기존 서버 역할> -f tools/staging-login-callback-grants.sql
-- 실제 역할은 새로 만들지 않는다. 접속기록·운영 기록의 권한은 바꾸지 않는다.
GRANT SELECT, INSERT, UPDATE ON owners, customers, consultations, messages TO :"runtime_role";
-- 로그인할 때 기한 지난 세션을 정리하므로 DELETE도 필요하다(owner-session.ts).
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_sessions TO :"runtime_role";
GRANT SELECT ON shops, kakao_channels TO :"runtime_role";
-- FOR SHARE에는 열 하나의 UPDATE 권한이 필요하다. 앱의 이 경로는 ID를 바꾸지 않는다.
GRANT UPDATE (id) ON shops, kakao_channels TO :"runtime_role";
-- TASK-028: AI 실패/콜백 만료의 질문 참조·할 일·발신 대기 알림.
-- 이 경로는 새 행만 넣는다. 기존 건의 수정·삭제나 운영 기록/접속기록 권한은 더하지 않는다.
GRANT SELECT, INSERT ON handoffs, handoff_questions, owner_tasks, owner_alerts TO :"runtime_role";
-- 사장님 기다림을 가게의 답하는 시간 안에서 계산한다.
GRANT SELECT ON business_calendars TO :"runtime_role";
-- TASK-028: 누적 비용 확인만 한다. 호출 기록의 추가/수정/삭제 권한은 주지 않는다.
GRANT SELECT ON ai_calls TO :"runtime_role";
-- TASK-028: 번호를 가린 본문과 원본 최소 정보는 같은 수신 트랜잭션에서 새로 남긴다.
GRANT SELECT, INSERT ON masked_values TO :"runtime_role";
-- TASK-028: 미전달 일반 글은 다음 응답/콜백에 전한 뒤 상태와 시각만 고친다.
GRANT SELECT, UPDATE (status, sent_at) ON notifications TO :"runtime_role";
