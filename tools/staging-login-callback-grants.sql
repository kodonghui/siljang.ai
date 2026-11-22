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
-- TASK-028: 누적 비용 확인과 모델 호출 기록. 서버 검증에 따른 미사용 사유만 고친다.
GRANT SELECT, INSERT, UPDATE (fallback_reason) ON ai_calls TO :"runtime_role";
-- 정상 모델의 검증된 자유 입력 항목만 초안에 남긴다. 알레르기 답/주문자 정보는 여기서 다루지 않는다.
GRANT SELECT (id, shop_id, consultation_id, status, revision, lettering, design_notes, colors, excluded_ingredients, courier_pickup),
  INSERT (shop_id, consultation_id, lettering, design_notes, colors, excluded_ingredients, courier_pickup, created_at, updated_at),
  UPDATE (lettering, design_notes, colors, excluded_ingredients, courier_pickup, revision, updated_at)
  ON order_drafts TO :"runtime_role";
-- TASK-028: 번호를 가린 본문과 원본 최소 정보는 같은 수신 트랜잭션에서 새로 남긴다.
GRANT SELECT, INSERT ON masked_values TO :"runtime_role";
-- TASK-028: 미전달 일반 글은 다음 응답/콜백에 전한 뒤 상태와 시각만 고친다.
GRANT SELECT, UPDATE (status, sent_at) ON notifications TO :"runtime_role";
-- API-072: 자기 받은 주문의 식별자/상태만 확인한다. 연락처/금액/주문 내용은 읽지 않는다.
GRANT SELECT (id, shop_id, order_no, customer_id, consultation_id, status, personal_data_purged_at), UPDATE (id)
  ON orders TO :"runtime_role";
-- 글 후기의 버전만 읽고 새 글과 이전 버전의 교체 시각을 남긴다. 기존 본문 수정/삭제는 없다.
GRANT SELECT (id, shop_id, order_id, version, superseded_at),
  INSERT (shop_id, order_id, version, body, created_at), UPDATE (superseded_at) ON reviews TO :"runtime_role";
