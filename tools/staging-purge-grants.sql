-- 정기 삭제 전용 역할. 공용 앱 역할과 다른 기존 역할을 purge_role로 전달한다.
-- 실제 역할/비밀번호를 이 파일에서 만들거나 기록하지 않는다.
GRANT USAGE ON SCHEMA public TO :"purge_role";
GRANT EXECUTE ON FUNCTION purge_closed_consultation(uuid,uuid,timestamptz) TO :"purge_role";
GRANT EXECUTE ON FUNCTION purge_expired_masked_value_erasures(integer) TO :"purge_role";
-- 당일 시작/차례 결과는 숫자 기록만 읽고 넣는다. 수정/삭제는 허용하지 않는다.
GRANT SELECT (id,shop_id,kind,created_at), INSERT (shop_id,kind,count,detail,created_at) ON ops_events TO :"purge_role";
-- 후보는 ID/관계/시각만 읽는다. 새 역할을 공용 앱 역할의 멤버로 만들지 않는다.
GRANT SELECT (id,shop_id,draft_id,customer_id,consultation_id,finished_at,personal_data_purged_at,lock_version),
  UPDATE (personal_data_purged_at,lock_version,updated_at) ON orders TO :"purge_role";
GRANT SELECT (id,shop_id,customer_id,status,ended_at,dropped_at) ON consultations TO :"purge_role";
GRANT SELECT (id,shop_id,consultation_id,status,order_id,day_used_order_id,limit_used_order_id) ON handoffs TO :"purge_role";
GRANT SELECT (shop_id,handoff_id,order_id) ON handoff_questions TO :"purge_role";
GRANT SELECT (id,shop_id,consultation_id,order_id,draft_id,payload), UPDATE (payload) ON confirm_cards TO :"purge_role";
GRANT SELECT (id,shop_id,consultation_id,order_id,status), UPDATE (description,content_purged_at,updated_at) ON issue_details TO :"purge_role";
GRANT SELECT (id,shop_id,order_id,notes_purged_at), UPDATE (no_compensation_reason,other_compensation_note,notes_purged_at) ON issue_reports TO :"purge_role";
GRANT SELECT (id,shop_id,kakao_user_key,purged_at,created_at), UPDATE (kakao_user_key,purged_at) ON customers TO :"purge_role";
-- 보관할 현재 이름 한 개는 복사하되, 보관된 이름의 직접 읽기는 열지 않는다.
GRANT SELECT (shop_id,order_id,version,customer_name), UPDATE (customer_name,customer_phone,allergy_answer,excluded_ingredients,lettering,design_notes) ON order_details TO :"purge_role";
GRANT SELECT (id,shop_id), UPDATE (customer_name,customer_phone,allergy_answer,excluded_ingredients,lettering,design_notes,updated_at) ON order_drafts TO :"purge_role";
GRANT SELECT (id,shop_id,order_id,issue_keep_until,issue_purged_at,contract_keep_until),
  INSERT (shop_id,order_id,customer_name,finished_at,contract_keep_until,issue_keep_until,created_at),
  UPDATE (issue_purged_at), DELETE ON kept_records TO :"purge_role";
GRANT SELECT (shop_id,draft_id,storage_key), DELETE ON reference_photos TO :"purge_role";
GRANT SELECT (shop_id,issue_details_id,storage_key), DELETE ON issue_photos TO :"purge_role";
GRANT SELECT (id,shop_id,order_id,depositor_name,version), UPDATE (depositor_name,version) ON payment_requests TO :"purge_role";
GRANT SELECT (id,shop_id,order_id,refund_bank_name,refund_account_enc,refund_account_last4,refund_holder_name),
  UPDATE (refund_bank_name,refund_account_enc,refund_account_last4,refund_holder_name) ON refunds TO :"purge_role";
GRANT SELECT (id,shop_id,order_id,changes,lock_version), UPDATE (changes,lock_version) ON change_requests TO :"purge_role";
GRANT SELECT (id,shop_id,order_id,change_request_id,issue_report_id,payment_request_id,refund_id,detail), UPDATE (detail) ON owner_tasks TO :"purge_role";
GRANT SELECT (shop_id,consultation_id,order_id), DELETE ON notifications TO :"purge_role";
GRANT SELECT, DELETE ON file_deletions TO :"purge_role";
GRANT INSERT (shop_id,storage_key,source,queued_at), UPDATE (attempts,last_tried_at) ON file_deletions TO :"purge_role";
GRANT SELECT (id,shop_id,accessed_at), UPDATE (id), DELETE ON access_logs TO :"purge_role";
GRANT SELECT (id,shop_id,called_at), UPDATE (id), DELETE ON ai_tool_calls TO :"purge_role";
GRANT SELECT (actor_kind,actor_id,request_key,created_at,state,processing_expires_at), UPDATE (request_key), DELETE ON request_keys TO :"purge_role";
