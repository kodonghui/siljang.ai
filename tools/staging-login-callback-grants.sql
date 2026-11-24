-- TASK-173·032: 사장님 세션·카카오 수신/콜백·가게 등록/조회에 필요한 서버 역할 권한.
-- psql -v runtime_role=<기존 서버 역할> -f tools/staging-login-callback-grants.sql
-- 실제 역할은 새로 만들지 않는다. 각 작업에 필요한 열 권한만 더하며 운영 기록의 권한은 바꾸지 않는다.
GRANT SELECT, INSERT, UPDATE ON owners, customers, consultations, messages TO :"runtime_role";
-- 로그인할 때 기한 지난 세션을 정리하므로 DELETE도 필요하다(owner-session.ts).
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_sessions TO :"runtime_role";
GRANT SELECT ON shops, kakao_channels TO :"runtime_role";
-- TASK-072: 할 일의 연결 대상과 손님 ID를 같은 가게에서 찾는 관계 열만 읽는다.
GRANT SELECT (id, shop_id, order_id) ON change_requests, issue_reports, payment_requests, refunds TO :"runtime_role";
-- API-040 접속기록은 응답과 같은 트랜잭션에 넣으며 조회·수정·삭제 권한은 주지 않는다.
GRANT INSERT (shop_id, actor_kind, owner_id, operator_id, action, api_id, request_path,
  subject_ids, target_kind, target_id, reason, client_ip) ON access_logs TO :"runtime_role";
-- TASK-066: 요청 시각은 AI 문맥 경계, kind/amount/version은 사장님 전용 출력에서 읽는다.
GRANT SELECT (shop_id, consultation_id, requested_at, kind, amount, version) ON orders TO :"runtime_role";
-- TASK-066: 공용 역할의 열 권한이다. 앱의 requireOwner가 상세/제작 자료와 장부의 사장님 범위를 확인한다.
-- 손님·일 실행기에는 order-output 함수를 허용하지 않는다. 역할 자체가 행위자를 구분하지는 않는다.
GRANT SELECT (shop_id, order_id, version, customer_name, customer_phone, allergy_answer)
  ON order_details TO :"runtime_role";
-- TASK-066: 모델 문맥 코드는 공개 계산값만 읽고 근거의 자유 입력은 읽지 않는다.
GRANT SELECT (id, shop_id, draft_id, draft_revision, price_list_id, amount, amount_max, display_kind, order_kind, valid_until, quoted_at)
  ON quotes TO :"runtime_role";
-- TASK-067: 견적과 요청 당시 운영규정의 계산에 필요한 열만 읽는다.
GRANT SELECT (draft_id, price_list_id, operating_rules_id) ON orders TO :"runtime_role";
GRANT SELECT (size_option_id, flavor_option_id, design_option_id, design_id) ON order_drafts TO :"runtime_role";
GRANT SELECT (shop_id, draft_id, price_list_id, option_id) ON order_draft_extras TO :"runtime_role";
GRANT SELECT (id, shop_id, draft_id) ON reference_photos TO :"runtime_role";
GRANT SELECT, INSERT ON quotes TO :"runtime_role";
GRANT SELECT (shop_id, order_id, version, pickup_at) ON order_details TO :"runtime_role";
GRANT SELECT (custom_material_ordered_at, production_started_at) ON productions TO :"runtime_role";
-- FOR SHARE에는 열 하나의 UPDATE 권한이 필요하다. 앱의 이 경로는 ID를 바꾸지 않는다.
GRANT UPDATE (id) ON shops, kakao_channels TO :"runtime_role";
-- TASK-028: AI 실패/콜백 만료의 질문 참조·할 일·발신 대기 알림.
-- 이 경로는 새 행만 넣는다. 기존 건의 수정·삭제나 운영 기록/접속기록 권한은 더하지 않는다.
GRANT SELECT, INSERT ON handoffs, handoff_questions, owner_tasks, owner_alerts TO :"runtime_role";
-- TASK-081: 확인 카드는 새로 만들고 처리 결과만 고친다. 키·받는 사람·묶인 버전·기한·삭제는 열지 않는다.
GRANT SELECT ON confirm_cards TO :"runtime_role";
GRANT INSERT (shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version,
  draft_id, draft_revision, payload, created_at, expires_at) ON confirm_cards TO :"runtime_role";
GRANT UPDATE (used_at, outcome, payload) ON confirm_cards TO :"runtime_role";
-- TASK-072: 알림 임대·묶음·발송 상태의 열만 바꾼다. 가게·종류·이벤트·할 일 연결과 삭제는 열지 않는다.
GRANT UPDATE (status, batched_into_id, attempts, next_attempt_at, kakao_task_id,
  requested_at, delivery_checked_at, sent_at, fail_code) ON owner_alerts TO :"runtime_role";
-- TASK-068: 같은 날짜 건을 재사용한 수신 ID만 기존 할 일의 내부 기록에 묶는다.
GRANT UPDATE (detail) ON owner_tasks TO :"runtime_role";
-- 사장님 기다림을 가게의 답하는 시간 안에서 계산한다.
GRANT SELECT ON business_calendars TO :"runtime_role";
-- TASK-028: 누적 비용 확인과 모델 호출 기록. 서버 검증에 따른 미사용 사유만 고친다.
GRANT SELECT, INSERT, UPDATE (fallback_reason) ON ai_calls TO :"runtime_role";
-- 정상 모델의 검증된 자유 입력 항목만 초안에 남긴다. 알레르기 답/주문자 정보는 여기서 다루지 않는다.
GRANT SELECT (id, shop_id, consultation_id, status, revision, lettering, design_notes, colors, excluded_ingredients, courier_pickup, created_at),
  INSERT (shop_id, consultation_id, lettering, design_notes, colors, excluded_ingredients, courier_pickup, created_at, updated_at),
  UPDATE (lettering, design_notes, colors, excluded_ingredients, courier_pickup, revision, updated_at)
  ON order_drafts TO :"runtime_role";
-- TASK-028: 번호를 가린 본문과 원본 최소 정보는 같은 수신 트랜잭션에서 새로 남긴다.
GRANT SELECT, INSERT ON masked_values TO :"runtime_role";
-- TASK-028: 미전달 일반 글은 다음 응답/콜백에 전한 뒤 상태와 시각만 고친다.
GRANT SELECT, UPDATE (status, sent_at) ON notifications TO :"runtime_role";
-- API-072 자체는 자기 받은 주문의 식별자/상태만 읽는다. 위 사장님 출력의 추가 열 권한과는 별개다.
GRANT SELECT (id, shop_id, order_no, customer_id, consultation_id, status, personal_data_purged_at), UPDATE (id)
  ON orders TO :"runtime_role";
-- 글 후기의 버전만 읽고 새 글과 이전 버전의 교체 시각을 남긴다. 기존 본문 수정/삭제는 없다.
GRANT SELECT (id, shop_id, order_id, version, superseded_at),
  INSERT (shop_id, order_id, version, body, created_at), UPDATE (superseded_at) ON reviews TO :"runtime_role";
-- TASK-032: 새 가게의 등록 필드만 쓴다. 승인 상태·예약 링크·기존 가게 변경/삭제 권한은 더하지 않는다.
GRANT INSERT (id, owner_id, name, contact_phone, business_address, contact_email, business_name,
  representative_name, business_reg_no, mail_order_reg_no, mail_order_authority, mail_order_exemption,
  food_license_no, food_business_type, license_photo_key, entrustment_terms_version, entrustment_consented_at,
  created_at, updated_at) ON shops TO :"runtime_role";
-- API-009는 자기 가게 범위에서 가장 최근의 변경 요청을 보여 준다. 변경 요청 쓰기는 TASK-036이다.
GRANT SELECT ON shop_identity_changes TO :"runtime_role";
-- API-008의 선점·완료·오류 시 해제. 내용 대신 요청 지문과 결과 ID만 남긴다(DEC-04).
GRANT SELECT, INSERT, UPDATE, DELETE ON request_keys TO :"runtime_role";

-- TASK-041: 캘린더의 설정·날짜 잠금/저장. 기존 주문·자리는 조회만 한다.
GRANT INSERT, UPDATE ON business_calendars TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON calendar_days TO :"runtime_role";
GRANT SELECT (id, shop_id, day, order_id, status, overbooked) ON slot_holds TO :"runtime_role";
-- 저장 전 주문 확인과 미발송 안내의 날짜 재계산에 필요한 열만 읽는다.
GRANT SELECT (pickup_day, pickup_at) ON orders TO :"runtime_role";
-- TASK-082: 자리 처리의 잠금 번호·수락·재제작 관계와 결제 기한만 읽는다.
GRANT SELECT (accepted_at, lock_version, remake_of_order_id), UPDATE (status, lock_version) ON orders TO :"runtime_role";
GRANT SELECT (kind, status, due_at, due_cap_at, claimed_at, version, change_request_id),
  UPDATE (status, expired_at, version) ON payment_requests TO :"runtime_role";
GRANT SELECT (base_version, lock_version, new_pickup_at, amount_delta, status),
  UPDATE (status, closed_at, lock_version) ON change_requests TO :"runtime_role";
GRANT SELECT (payment_request_id, hold_key),
  INSERT (shop_id, day, order_id, payment_request_id, hold_key, status, overbooked, fixed_at, created_at),
  UPDATE (status, fixed_at, released_at, release_reason, done_at) ON slot_holds TO :"runtime_role";
-- 추가 수락을 쓴 주문 연결만 남긴다. 수락 판정·기한 변경·행 삭제는 열지 않는다.
GRANT UPDATE (day_used_order_id) ON handoffs TO :"runtime_role";
-- 주문 상태를 쓸 때 커밋의 기존 제약 트리거가 제작 시각과 확인된 결제를 읽는다.
GRANT SELECT (confirmed_payment_id) ON orders TO :"runtime_role";
GRANT SELECT (no_pickup_at) ON productions TO :"runtime_role";
GRANT SELECT (id, voided_at) ON payments TO :"runtime_role";
GRANT SELECT (shop_id, order_id, handed_over_at) ON productions TO :"runtime_role";
-- 이미 보낸 안내·시도 횟수·본문은 바꾸지 않는다.
GRANT UPDATE (scheduled_for, next_attempt_at) ON notifications TO :"runtime_role";

-- TASK-038: 가격표의 새 버전·옵션·규칙·도안을 남기고 이전 내용은 읽기만 한다.
GRANT SELECT, INSERT, UPDATE (superseded_at) ON price_lists TO :"runtime_role";
GRANT SELECT, INSERT ON price_options, price_option_rules, designs TO :"runtime_role";

-- TASK-039: 새 규정·조문·환불 단계를 남기고 이전 내용은 읽기만 한다.
GRANT SELECT, INSERT, UPDATE (superseded_at) ON operating_rules TO :"runtime_role";
GRANT SELECT, INSERT ON rule_clauses, refund_tiers TO :"runtime_role";

-- TASK-040: 새 계좌/옛 계좌의 교체 시각만 쓴다. 예금주 확인 이력·일반 승인/삭제는 금지한다.
GRANT SELECT, UPDATE (retired_at) ON payment_accounts TO :"runtime_role";
GRANT INSERT (shop_id, bank_name, account_number_enc, account_last4, holder_name,
  holder_mismatch_confirmed, card_payment_url, created_at) ON payment_accounts TO :"runtime_role";

-- TASK-042: 연결별 설정/키 버전만 쓴다. 기존 봇 ID·가게 ID 변경과 삭제는 허용하지 않는다.
GRANT EXECUTE ON FUNCTION claim_kakao_bot(uuid,text,timestamptz) TO :"runtime_role";
GRANT INSERT (shop_id, bot_id, channel_public_id, card_block_id, orderer_block_id, allergy_block_id,
  depositor_block_id, review_block_id, claim_expires_at, skill_key_issued_at, created_at)
  ON kakao_channels TO :"runtime_role";
GRANT UPDATE (channel_public_id, card_block_id, orderer_block_id, allergy_block_id, depositor_block_id,
  review_block_id, status, claim_expires_at, check_started_at, linked_at, verified_blocks, test_user_key,
  event_status, event_task_id, event_checked_at, event_fail_reason, configuration_order, retired_at,
  skill_key_version, skill_key_issued_at, previous_key_until) ON kakao_channels TO :"runtime_role";

-- TASK-034: 운영자 세션·표시 이름 조회와 전용 확인 함수만 허용한다.
GRANT SELECT (id, display_name, disabled_at, mfa_enrolled_at) ON operators TO :"runtime_role";
GRANT SELECT (id, operator_id, token_hash, created_at, expires_at, ended_at) ON operator_sessions TO :"runtime_role";
GRANT EXECUTE ON FUNCTION review_shop_license(uuid,uuid,text,timestamptz,text,text,text) TO :"runtime_role";

-- TASK-037: 연락처/공개 정보와 운영 설정만 바꾼다. 신원·영업 승인·소유자/삭제는 더하지 않는다.
GRANT UPDATE (name, contact_phone, business_address, contact_email, pickup_address,
  mail_order_reg_no, mail_order_authority, mail_order_exemption, completion_photo_enabled,
  idle_close_hours, owner_wait_minutes, daily_ai_cost_limit_krw, awaiting_payment_limit, updated_at)
  ON shops TO :"runtime_role";

-- TASK-036: 사장님 요청의 새 행만 허용하고 판정/기존 신원 수정은 전용 함수로 제한한다.
GRANT INSERT (id, shop_id, business_name, representative_name, business_reg_no,
  prev_business_name, prev_representative_name, prev_business_reg_no, evidence_photo_key, requested_at)
  ON shop_identity_changes TO :"runtime_role";
GRANT EXECUTE ON FUNCTION review_shop_identity(uuid,uuid,uuid,text,timestamptz,text,uuid,text,text,text) TO :"runtime_role";

-- TASK-033: 보류된 자기 가게의 신고 재업로드만 실행한다. 일반 신고/판정 UPDATE는 주지 않는다.
GRANT EXECUTE ON FUNCTION resubmit_shop_license(uuid,uuid,text,timestamptz,text,text,text,text) TO :"runtime_role";

-- TASK-044: 예약 주소/발급 시각과 새 처리방침만 남긴다. 영업 판정·기존 본문 수정/삭제는 허용하지 않는다.
GRANT UPDATE (booking_slug, booking_issued_at) ON shops TO :"runtime_role";
GRANT SELECT, INSERT ON privacy_policies TO :"runtime_role";

-- TASK-045: 게시/철회 여부와 공개 사진 위치만 읽는다. 동의·게시·사진의 쓰기/삭제는 열지 않는다.
GRANT SELECT (id, shop_id, photo_consent_id, completion_photo_id, review_photo_id, published_at, unpublished_at)
  ON portfolio_items TO :"runtime_role";
GRANT SELECT (id, shop_id, consented, withdrawn_at, publishable) ON photo_consents TO :"runtime_role";
GRANT SELECT (id, shop_id, storage_key) ON completion_photos, review_photos TO :"runtime_role";

-- TASK-047: 설정 카드의 연결 여부만 읽는다. 시트 ID/이름과 OAuth 참조는 열지 않는다.
GRANT SELECT (shop_id, status) ON ledger_links TO :"runtime_role";
REVOKE SELECT (unlinked_at) ON ledger_links FROM :"runtime_role";
