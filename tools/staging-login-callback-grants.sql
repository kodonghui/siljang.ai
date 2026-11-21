-- TASK-173: 사장님 세션과 카카오 수신·콜백에 필요한 서버 역할 권한.
-- psql -v runtime_role=<기존 서버 역할> -f tools/staging-login-callback-grants.sql
-- 실제 역할은 새로 만들지 않는다. 접속기록·운영 기록의 권한은 바꾸지 않는다.
GRANT SELECT, INSERT, UPDATE ON owners, customers, consultations, messages TO :"runtime_role";
-- 로그인할 때 기한 지난 세션을 정리하므로 DELETE도 필요하다(owner-session.ts).
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_sessions TO :"runtime_role";
GRANT SELECT ON shops, kakao_channels TO :"runtime_role";
-- FOR SHARE에는 열 하나의 UPDATE 권한이 필요하다. 앱의 이 경로는 ID를 바꾸지 않는다.
GRANT UPDATE (id) ON shops, kakao_channels TO :"runtime_role";
