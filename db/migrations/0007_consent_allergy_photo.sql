-- 0007_consent_allergy_photo: 알레르기 정보 따로 동의와 전용 블록, 사진마다 게시 동의와 동의가 살아 있는 포트폴리오(설계 재검토 H5·H10, 2026-11-13 20:59 결정 카드 '추천안대로 (추천)')
-- 알레르기 답은 손님이 알레르기 정보에 따로 동의한 뒤 AI를 거치지 않는 전용 블록으로만 받고, 동의하지 않으면 빼야 할 재료만으로 주문함(REQ-200~205, SPEC-075). 잠정, 5-2 질문 4의 답으로 다시 봄.
-- 동의의 답(동의함·동의 안 함·동의 필요 없음), 동의 글 버전, 시각을 초안과 주문 내용 버전에 두고, 동의 없는 알레르기 답은 데이터베이스가 막음(docs/05-erd/README.md 5절 E22).
-- 가게 채널의 버튼 블록은 '알레르기 답'을 더해 다섯(REQ-206). 사진 게시 동의는 주문 요청 때 묻지 않고 완성 사진 안내와 후기 사진에서 사진마다 받으며(REQ-207, REQ-208),
-- 포트폴리오 항목은 그 사진의 동의이고 동의함·철회 안 함인 동안만 올라 있음(REQ-209, 4절 A26). 잠정, 5-2 질문 6의 답으로 다시 봄.
-- 0006_account_encryption_access_log.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0007_consent_allergy_photo.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 연결된 채널·주문 내용 버전·주문 요청 때 받은 사진 게시 동의('order') 행이 없음.
-- 행이 있으면 이 파일은 실패함: 연결된 채널은 알레르기 답 블록을 받고 다시 연결 확인하고, 주문 내용 버전에는 알레르기 정보 동의의 답이 있어야 하고,
-- 주문 요청 때 받은 동의는 어느 완성 사진의 동의인지 알 수 없어 사진마다 다시 물어야 함.

-- TBL-004 kakao_channels: '알레르기 답' 블록 ID와 블록 다섯
ALTER TABLE kakao_channels
  ADD COLUMN allergy_block_id text CHECK (char_length(allergy_block_id) BETWEEN 1 AND 100),
  DROP CONSTRAINT kakao_channels_verified_blocks_check,
  DROP CONSTRAINT kakao_channels_blocks_chk;
ALTER TABLE kakao_channels
  ADD CONSTRAINT kakao_channels_verified_blocks_check CHECK (verified_blocks <@ ARRAY['card', 'orderer_info', 'allergy_answer', 'depositor_name', 'review']::text[]),
  ADD CONSTRAINT kakao_channels_blocks_chk CHECK (status <> 'linked' OR (card_block_id IS NOT NULL AND orderer_block_id IS NOT NULL AND allergy_block_id IS NOT NULL AND depositor_block_id IS NOT NULL AND review_block_id IS NOT NULL AND verified_blocks @> ARRAY['card', 'orderer_info', 'allergy_answer', 'depositor_name', 'review']::text[]));

-- TBL-020 order_drafts: 알레르기 정보 동의의 답, 동의 글 버전, 시각. 알레르기 답은 동의한 뒤나 동의 단계를 끈 배포에서만
ALTER TABLE order_drafts
  ADD COLUMN allergy_consent text CHECK (allergy_consent IN ('agreed', 'declined', 'not_required')),
  ADD COLUMN allergy_consent_version text CHECK (char_length(allergy_consent_version) BETWEEN 1 AND 20),
  ADD COLUMN allergy_consent_at timestamptz;
ALTER TABLE order_drafts
  ADD CONSTRAINT order_drafts_allergy_consent_chk CHECK ((allergy_consent IS NULL) = (allergy_consent_at IS NULL) AND coalesce(allergy_consent IN ('agreed', 'declined'), false) = (allergy_consent_version IS NOT NULL)),
  ADD CONSTRAINT order_drafts_allergy_answer_chk CHECK (allergy_answer IS NULL OR coalesce(allergy_consent IN ('agreed', 'not_required'), false));

-- TBL-026 order_details: 초안에서 옮긴 알레르기 정보 동의(버전마다 꼭 있음). 동의하지 않은 주문에는 알레르기 답이 없음
ALTER TABLE order_details
  ADD COLUMN allergy_consent text NOT NULL CHECK (allergy_consent IN ('agreed', 'declined', 'not_required')),
  ADD COLUMN allergy_consent_version text CHECK (char_length(allergy_consent_version) BETWEEN 1 AND 20),
  ADD COLUMN allergy_consent_at timestamptz NOT NULL;
ALTER TABLE order_details
  ADD CONSTRAINT order_details_allergy_consent_chk CHECK ((allergy_consent IN ('agreed', 'declined')) = (allergy_consent_version IS NOT NULL)),
  ADD CONSTRAINT order_details_allergy_answer_chk CHECK (allergy_answer IS NULL OR allergy_consent IN ('agreed', 'not_required'));

-- TBL-024 confirm_cards: 알레르기 정보 카드(초안에 묶임)와 사진 게시 동의 카드(주문에 묶임)
ALTER TABLE confirm_cards
  DROP CONSTRAINT confirm_cards_kind_check,
  DROP CONSTRAINT confirm_cards_draft_chk,
  DROP CONSTRAINT confirm_cards_order_chk;
ALTER TABLE confirm_cards
  ADD CONSTRAINT confirm_cards_kind_check CHECK (kind IN ('order_request', 'payment_claim', 'change_request', 'cancel', 'issue_report', 'consent_withdrawal', 'orderer_info', 'allergy_info', 'photo_consent')),
  ADD CONSTRAINT confirm_cards_draft_chk CHECK ((kind IN ('order_request', 'orderer_info', 'allergy_info')) = (draft_id IS NOT NULL AND draft_revision IS NOT NULL)),
  ADD CONSTRAINT confirm_cards_order_chk CHECK (kind IN ('order_request', 'orderer_info', 'allergy_info') OR (order_id IS NOT NULL AND order_version IS NOT NULL));

-- TBL-040 photo_consents: 주문 요청 때의 동의('order')를 없애고 완성 사진 한 장마다의 동의, 게시 가능(동의함·철회 안 함)과 포트폴리오가 참조하는 키
DROP INDEX photo_consents_order_uq;
ALTER TABLE photo_consents
  DROP CONSTRAINT photo_consents_scope_check,
  DROP CONSTRAINT photo_consents_scope_chk,
  ADD COLUMN completion_photo_id uuid,
  ADD COLUMN publishable boolean NOT NULL DEFAULT false;
UPDATE photo_consents SET publishable = (consented AND withdrawn_at IS NULL);
ALTER TABLE photo_consents
  ADD CONSTRAINT photo_consents_scope_check CHECK (scope IN ('completion_photo', 'review_photo')),
  ADD CONSTRAINT photo_consents_live_key UNIQUE (shop_id, id, publishable),
  ADD CONSTRAINT photo_consents_review_photo_key UNIQUE (shop_id, id, review_photo_id),
  ADD CONSTRAINT photo_consents_completion_photo_key UNIQUE (shop_id, id, completion_photo_id),
  ADD CONSTRAINT photo_consents_completion_photo_fk FOREIGN KEY (shop_id, completion_photo_id) REFERENCES completion_photos (shop_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT photo_consents_scope_chk CHECK ((scope = 'review_photo') = (review_photo_id IS NOT NULL) AND (scope = 'completion_photo') = (completion_photo_id IS NOT NULL)),
  ADD CONSTRAINT photo_consents_publishable_chk CHECK (publishable = (consented AND withdrawn_at IS NULL));
CREATE UNIQUE INDEX photo_consents_completion_photo_uq ON photo_consents (completion_photo_id) WHERE scope = 'completion_photo';

-- TBL-041 portfolio_items: 올라 있는 동안 동의가 살아 있음(consent_live)과 동의·사진의 짝
ALTER TABLE portfolio_items
  ADD COLUMN consent_live boolean DEFAULT true CHECK (consent_live);
UPDATE portfolio_items SET consent_live = NULL WHERE unpublished_at IS NOT NULL;
ALTER TABLE portfolio_items
  ADD CONSTRAINT portfolio_items_live_chk CHECK ((unpublished_at IS NULL) = (consent_live IS NOT NULL)),
  ADD CONSTRAINT portfolio_items_consent_live_fk FOREIGN KEY (shop_id, photo_consent_id, consent_live) REFERENCES photo_consents (shop_id, id, publishable) ON DELETE RESTRICT,
  ADD CONSTRAINT portfolio_items_consent_review_photo_fk FOREIGN KEY (shop_id, photo_consent_id, review_photo_id) REFERENCES photo_consents (shop_id, id, review_photo_id) ON DELETE RESTRICT,
  ADD CONSTRAINT portfolio_items_consent_completion_photo_fk FOREIGN KEY (shop_id, photo_consent_id, completion_photo_id) REFERENCES photo_consents (shop_id, id, completion_photo_id) ON DELETE RESTRICT;

-- 테이블·컬럼 설명(db/schema.sql과 같은 줄)
COMMENT ON TABLE photo_consents IS 'TBL-040 사진 게시 동의: 완성 사진과 후기 사진 한 장마다 받은 동의와 철회';
COMMENT ON COLUMN kakao_channels.check_started_at IS '''연결 확인''을 누른 시각(10분 안에 테스트 메시지와 버튼 블록 다섯이 와야 함)';
COMMENT ON COLUMN kakao_channels.card_block_id IS '가게 봇의 ''확인 카드'' 블록 ID. 확인 카드 버튼이 부름(SPEC-008, REQ-206)';
COMMENT ON COLUMN kakao_channels.allergy_block_id IS '가게 봇의 ''알레르기 답'' 블록 ID. 알레르기 정보 동의 카드의 버튼이 부르고 AI를 거치지 않고 답을 받음(SPEC-075, REQ-202, REQ-206)';
COMMENT ON COLUMN kakao_channels.verified_blocks IS '연결 확인 때 시험 버튼으로 우리 스킬에 닿은 블록(REQ-206)';
COMMENT ON COLUMN order_drafts.allergy_answer IS '알레르기 답(''없음''도 답, REQ-200). 알레르기 정보에 동의한 뒤 전용 블록으로 AI를 거치지 않고 받음(SPEC-075, REQ-202). AI로 보내지 않고(REQ-204) 이 주문 밖에서 쓰지 않음(REQ-142)';
COMMENT ON COLUMN order_drafts.allergy_consent IS '알레르기 정보 동의: 동의함·동의 안 함·동의 필요 없음(배포 설정으로 동의 단계를 끔, REQ-205). 비어 있으면 아직 묻지 않음(SPEC-075). 잠정, 5-2 질문 4';
COMMENT ON COLUMN order_drafts.allergy_consent_version IS '손님이 본 알레르기 정보 동의 글의 버전. 동의함·동의 안 함에만(REQ-201)';
COMMENT ON COLUMN order_drafts.allergy_consent_at IS '동의함·동의 안 함을 누른 시각, 동의 필요 없음이면 알레르기 답 블록을 연 시각(REQ-201, REQ-205)';
COMMENT ON COLUMN confirm_cards.kind IS '주문 요청·입금 알리기·변경 요청·취소·신고·동의 철회(SPEC-069)·주문자 정보(SPEC-072, 주문 요청 카드 앞에서 이름·연락처를 받음)·알레르기 정보(SPEC-075, 주문자 정보 카드 앞에서 따로 동의를 받음)·사진 게시 동의(SPEC-053, 완성 사진 안내의 버튼)';
COMMENT ON COLUMN confirm_cards.draft_id IS '주문 요청·주문자 정보·알레르기 정보 카드의 초안';
COMMENT ON COLUMN order_details.allergy_answer IS '알레르기 답. 알레르기 정보에 동의한 주문에만(REQ-200, REQ-203). 이 주문 밖에서 쓰지 않고 장부에 적지 않고 AI로 보내지 않음(REQ-142, REQ-204, SPEC-064). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN order_details.allergy_consent IS '초안에서 옮긴 알레르기 정보 동의: 동의함·동의 안 함(''알레르기 정보 동의 안 함''으로 보임, SPEC-050)·동의 필요 없음(REQ-201, REQ-205). 지우기는 이 동의 기록을 남김(SPEC-065)';
COMMENT ON COLUMN order_details.allergy_consent_version IS '손님이 본 알레르기 정보 동의 글의 버전. 동의함·동의 안 함에만(REQ-201)';
COMMENT ON COLUMN order_details.allergy_consent_at IS '알레르기 정보 동의의 답을 남긴 시각(초안에서 옮김)';
COMMENT ON COLUMN photo_consents.scope IS '완성 사진 한 장의 동의(완성 사진 안내의 버튼, SPEC-053)·후기 사진 한 장의 동의(SPEC-062)';
COMMENT ON COLUMN photo_consents.completion_photo_id IS '완성 사진의 동의면 그 사진. 안내 하나의 답을 그 안내에 붙인 사진마다 남김(REQ-207)';
COMMENT ON COLUMN photo_consents.review_photo_id IS '후기 사진의 동의면 그 사진(REQ-208)';
COMMENT ON COLUMN photo_consents.consented IS '동의 여부. 기본 ''동의 안 함''(REQ-207, REQ-208)';
COMMENT ON COLUMN photo_consents.withdrawn_at IS '손님이 동의를 철회한 시각. 그 사진을 포트폴리오에서 먼저 내린 뒤 씀(REQ-098, SPEC-063)';
COMMENT ON COLUMN photo_consents.publishable IS '포트폴리오에 올릴 수 있음: 동의했고 철회하지 않은 것과 늘 같음. 올라 있는 항목이 이 값을 참조해 올린 채로는 철회를 쓰지 못함(REQ-209, 4절 A26). 잠정, 5-2 질문 6';
COMMENT ON COLUMN portfolio_items.photo_consent_id IS '근거가 되는 게시 동의. 그 사진의 동의이고 동의함·철회 안 함이어야 올림(REQ-209)';
COMMENT ON COLUMN portfolio_items.completion_photo_id IS '올린 완성 사진(완성 사진 안내에서 받은 동의, REQ-207)';
COMMENT ON COLUMN portfolio_items.consent_live IS '올라 있는 동안 참, 내리면 비움. 근거 동의의 게시 가능을 참조해 동의하고 철회하지 않은 사진만 올라 있게 함(REQ-209, 5절 E22)';
