-- 확인 카드의 수신 참조는 가게·상담·손님 범위에서 찾는다. 중복 여부는 기존 LIMIT 2 검증을 유지한다.
CREATE INDEX confirm_cards_source_message_idx ON confirm_cards (shop_id, consultation_id, customer_id, (payload->>'sourceMessageId'));
