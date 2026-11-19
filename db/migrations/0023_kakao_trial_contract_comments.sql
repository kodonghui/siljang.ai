-- TASK-011. 계약에서 확인한 값의 의미를 스키마 주석과 맞춥니다.
COMMENT ON COLUMN messages.kakao_message_id IS '수신 카카오 메시지의 HMAC-SHA256 중복 확인 키. 정규 봇 ID·사용자 키·블록 ID·발화·수신 2초 구간에서 만듦(REQ-132, 06 DEC-28)';
COMMENT ON COLUMN kakao_channels.bot_id IS '오픈빌더 설정의 기본 봇 ID. 수신 값의 끝 느낌표 하나를 제거한 뒤 가게를 찾음(SPEC-017, 06 DEC-28)';
