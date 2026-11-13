"""06단계 API 계약의 목록: 오류 코드, 필드 오류 코드, 확인할 것, 카카오 스킬 결과, 결정 사항(DEC), 열린 질문, 서버 안의 일.

build_api.py가 이 목록으로 api/openapi.yaml의 components.x-corthex와 docs/06-api/README.md의 표를 만든다.
고칠 때는 이 파일을 고치고 `python3 -B research/cake-api-2026-11/build_api.py . --write`로 다시 만든다.
"""

# ── 오류 코드 (Problem Details의 code). 한 번만 적고 계약 전체가 같은 뜻으로 씀 ─────────────
# status: HTTP 상태, meaning: 뜻, message: 화면이 보이는 말(08단계가 다듬음), client: 화면이 할 일
ERRORS = {
    # 공통
    "validation_failed": dict(status=422, meaning="입력 필드가 계약의 한도나 형식에 맞지 않음. 필드마다 errors에 위치와 사유 코드", message="입력한 내용을 확인해 주세요", client="errors의 필드 옆에 사유를 보이고 넣은 값은 그대로 둠(G7 필드 오류)", spec="G7"),
    "idempotency_key_reused": dict(status=422, meaning="같은 요청 키로 다른 명령이나 다른 내용을 보냄", message="다시 시도해 주세요", client="새 요청 키를 만들어 다시 보냄(화면의 잘못이라 로그에 남김)", spec="G2"),
    "consent_required": dict(status=422, meaning="개인정보 처리 위탁·재위탁 조건에 동의하지 않음. 넣은 값도 남기지 않음", message="개인정보 처리 위탁 조건에 동의해야 가게를 등록할 수 있어요", client="동의 체크박스를 보이고 넣은 값은 화면에만 둠(G7 동의 필요)", spec="SPEC-002"),
    "google_authorization_failed": dict(status=422, meaning="구글 인가 코드가 틀렸거나 지났거나 시트 권한이 빠짐", message="구글 연결을 다시 해 주세요", client="구글 권한 요청을 처음부터 다시 하게 함", spec="SPEC-009"),
    "sheet_not_accessible": dict(status=422, meaning="고른 구글 시트나 탭을 받은 권한으로 열 수 없음", message="그 시트를 열 수 없어요. 주소와 탭 이름을 확인해 주세요", client="시트 주소 필드 옆에 사유를 보임", spec="SPEC-009"),
    "unauthenticated": dict(status=401, meaning="로그인(세션 쿠키)이 없거나 만료됨", message="다시 로그인해 주세요", client="로그인으로 보내고 로그인 뒤 원래 화면으로 돌아옴(SPEC-001)", spec="SPEC-001"),
    "kakao_login_failed": dict(status=401, meaning="카카오 인가 코드가 틀렸거나 지났거나 사장님이 동의를 거부함. 우리 쪽 기록은 남기지 않음", message="카카오 로그인을 다시 해 주세요", client="카카오 로그인 버튼을 다시 보임", spec="SPEC-001"),
    "operator_login_failed": dict(status=401, meaning="운영자 이메일·비밀번호·2단계 인증 번호 가운데 맞지 않는 것이 있음(어느 것인지 알리지 않음)", message="로그인 정보가 맞지 않아요", client="입력 필드를 비우고 다시 받음", spec="SPEC-001"),
    "skill_key_invalid": dict(status=401, meaning="카카오 스킬 요청의 스킬 키 헤더가 없거나 맞지 않음", message="(손님에게 보이지 않음)", client="오픈빌더 스킬 설정의 헤더 값을 확인(사장님 채널 연결 화면의 안내)", spec="SPEC-008"),
    "not_found": dict(status=404, meaning="경로의 기록이 없거나, 다른 가게 것이거나, ID 형식이 틀림. 셋을 구분하지 않음", message="찾을 수 없어요", client="목록으로 돌아가는 링크를 보임(G7 찾을 수 없음)", spec="G1"),
    "shop_not_registered": dict(status=404, meaning="로그인한 사장님에게 아직 가게가 없음", message="가게를 먼저 등록해 주세요", client="가게 등록 화면으로 보냄", spec="SPEC-001"),
    "not_set": dict(status=404, meaning="아직 정하지 않은 설정(결제 수단·영업 캘린더·카카오톡 채널·장부)", message="아직 정하지 않았어요", client="빈 입력 화면을 보임", spec="SPEC-006"),
    "method_not_allowed": dict(status=405, meaning="경로는 있지만 그 방법(GET·POST 등)은 계약에 없음. Allow 헤더에 되는 방법을 포함함", message="지원하지 않는 요청이에요", client="화면 코드의 잘못이라 추적 ID와 함께 로그에 남김", spec="G7", scope="계약에 없는 방법으로 호출한 모든 경로(DEC-02)"),
    "version_conflict": dict(status=409, meaning="화면이 본 뒤에 그 기록이 바뀜(baseRevision이 지금과 다름). 아무것도 바꾸지 않음", message="그 사이 바뀌었어요. 지금 상태를 확인해 주세요", client="지금 상태를 다시 읽어(GET) 보이고 다시 고르게 함(G7 이미 바뀜)", spec="G3"),
    "invalid_state": dict(status=409, meaning="지금 상태에서는 할 수 없는 명령(상태 머신 1-1~1-8이 허용하지 않음)", message="지금 상태에서는 할 수 없어요", client="detail을 보이고 지금 상태를 다시 읽음(G7 그 상태에서는 할 수 없음)", spec="G7"),
    "already_decided": dict(status=409, meaning="다른 결정이 이미 남음(이미 처리됨·이미 답함)", message="이미 처리됐어요", client="먼저 남은 결정을 다시 읽어 보임(G7 이미 처리됨)", spec="G3"),
    "order_cancelled": dict(status=409, meaning="그 사이 손님이나 가게가 주문을 취소함", message="그 사이 주문이 취소됐어요", client="주문을 다시 읽어 취소된 상태를 보임", spec="SPEC-031"),
    "confirmation_required": dict(status=409, meaning="확인을 받아야 저장하는 일. confirm에 확인할 것 목록. 아무것도 바꾸지 않음", message="저장하기 전에 확인해 주세요", client="confirm의 말을 보이고, 사장님이 확인하면 같은 요청에 confirm 값을 담아 새 요청 키로 다시 보냄", spec="SPEC-005"),
    "already_registered": dict(status=409, meaning="이 카카오 계정에 이미 가게가 있음(계정 하나에 가게 하나, R2)", message="이미 등록한 가게가 있어요", client="내 가게 조회(API-009)를 엶", spec="SPEC-002"),
    "channel_linked_elsewhere": dict(status=409, meaning="그 오픈빌더 봇이 이미 다른 가게에 연결됨. 묶지 않고 운영자에게 알림", message="이미 다른 가게에 연결된 채널이에요", client="다른 채널을 고르게 하고 우리 서비스 채널로 문의하게 함(G7 이미 다른 가게)", spec="SPEC-008"),
    "slot_released": dict(status=409, meaning="결제 기한이 지나 자리가 풀린 결제 안내라 '입금됨'을 받지 않음(R14)", message="자리가 풀린 주문이에요. 먼저 '결제 기한 연장'으로 자리를 다시 잡아 주세요", client="결제 기한 지난 주문의 결제 기한 연장 화면으로 보냄", spec="SPEC-034"),
    "stale_change": dict(status=409, meaning="이전 버전을 보고 만든 변경이라 반영하지 않음. 변경 요청은 '오래된 버전이라 받지 않음'으로 닫힘", message="그 사이 주문이 바뀌어 이 변경은 반영할 수 없어요", client="변경 요청과 지금 주문 버전을 다시 읽어 보임", spec="SPEC-045"),
    "undo_window_passed": dict(status=409, meaning="표시한 지 5분이 지나 되돌릴 수 없음", message="5분이 지나 되돌릴 수 없어요", client="제작 기록을 다시 읽어 보임", spec="SPEC-051"),
    "photo_consent_missing": dict(status=409, meaning="손님이 게시에 동의하지 않았거나 동의를 철회한 사진", message="손님이 게시에 동의한 사진만 올릴 수 있어요", client="그 사진의 동의 상태를 보임", spec="SPEC-063"),
    "request_in_progress": dict(status=409, meaning="같은 요청 키의 첫 요청을 아직 처리하는 중", message="처리하고 있어요. 잠시 뒤 다시 확인해 주세요", client="1초 뒤 같은 요청 키로 다시 보냄", spec="G2"),
    "file_too_large": dict(status=413, meaning="파일이 그 용도의 한도(신고증·도안 10MB, 완성 사진 20MB)를 넘음", message="사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요", client="파일 필드 옆에 한도를 보임", spec="SPEC-002"),
    "rate_limited": dict(status=429, meaning="같은 곳에서 너무 자주 호출함(예약 링크 페이지 1분 60번, 사장님 로그인 1분 10번)", message="잠시 뒤 다시 시도해 주세요", client="Retry-After 초 뒤에 다시 호출함", spec="SPEC-011"),
    "too_many_attempts": dict(status=429, meaning="운영자 로그인 실패가 15분에 5번을 넘음", message="잠시 뒤 다시 로그인해 주세요", client="Retry-After 초 동안 로그인 버튼을 막음", spec="SPEC-001"),
    "internal": dict(status=500, meaning="예상하지 못한 서버 오류. 내용은 로그에만(마스킹한 값과 추적 ID)", message="문제가 생겼어요. 다시 시도해 주세요", client="다시 시도 버튼과 추적 ID를 보임(G7 서버 실패)", spec="G7"),
    "kakao_unavailable": dict(status=503, meaning="카카오 로그인 서버가 답하지 않음", message="카카오에 연결하지 못했어요. 잠시 뒤 다시 해 주세요", client="다시 시도 버튼", spec="SPEC-001"),
    "google_unavailable": dict(status=503, meaning="구글 서버가 답하지 않음", message="구글에 연결하지 못했어요. 잠시 뒤 다시 해 주세요", client="다시 시도 버튼", spec="SPEC-009"),
    "storage_unavailable": dict(status=503, meaning="사진 저장소에 쓰지 못함. 등록·저장 전체를 남기지 않음", message="사진을 저장하지 못했어요. 다시 올려 주세요", client="파일을 다시 고르게 함", spec="SPEC-002"),
}

# ── 필드 오류의 사유 코드 (validation_failed의 errors[].code). 넣은 값·필드 밖 이름·내부 내용은 포함하지 않음 ──
FIELD_CODES = {
    "required": "꼭 넣어야 함",
    "too_short": "글자 수나 개수가 모자람",
    "too_long": "글자 수가 넘침",
    "bad_format": "형식이 맞지 않음(전화번호·날짜·주소 등)",
    "not_allowed": "고를 수 없는 값(예: 첫 버전에서 받지 않는 영업 종류, 받지 않는 파일 종류)",
    "out_of_range": "숫자가 범위 밖",
    "too_many": "개수가 넘침",
    "duplicate": "같은 값이 중복됨",
    "checksum_failed": "검증 숫자가 맞지 않음(사업자등록번호)",
    "upload_not_found": "올린 파일이 없거나 1시간이 지남",
    "upload_wrong_purpose": "다른 용도로 올린 파일",
    "conflict": "다른 행과 충돌함(같은 옵션 조합이 허용이자 금지)",
    "overlaps": "단계별 환불 기간이 중복됨",
    "gap": "단계별 환불 기간 사이가 빔",
    "exceeds_received": "환불 금액이 받은 금액에서 이미 정한 환불을 뺀 값을 넘음",
    "below_calculated": "보상이 아닌 환불 금액이 환불 계산값보다 낮음(REQ-170)",
    "in_past": "지난 날짜나 시각",
    "outside_window": "허용된 시간 밖(08:00~20:50, 60일 안 등)",
    "not_after_start": "끝이 시작보다 앞섬",
    "unknown_field": "계약에 없는 필드",
    "bad_json": "JSON으로 읽을 수 없음",
}

# ── 확인할 것 (confirmation_required의 confirm[].kind) ───────────────────────────────
CONFIRMATIONS = {
    "lowered_refund": dict(spec="SPEC-005", meaning="제작 전 취소 환불을 전액보다 낮춤(REQ-032)", message="제작 전 취소 환불을 전액보다 낮추면 분쟁 때 가게에 불리할 수 있어요(약관법 제8조, 한국소비자원 조정 사례). 그래도 저장할까요?"),
    "closed_day_with_orders": dict(spec="SPEC-007", meaning="확정 주문이 있는 날을 휴무로 바꿈. 주문과 자리는 그대로 남음(REQ-041)", message="이날 확정 주문 {count}건은 그대로 남아요. 휴무로 바꿀까요?"),
    "overbooking": dict(spec="SPEC-031", meaning="하루 최대 개수에 닿은 날에 마감 후 추가 수락(R10). 그날은 다른 손님에게 계속 마감", message="그날 남은 자리가 없어요. 추가로 받을까요?"),
    "not_pickup_day": dict(spec="SPEC-054", meaning="픽업 날짜 전에 인도를 기록함", message="오늘이 픽업 날이 아니에요. 그래도 인도를 기록할까요?"),
    "closed_day": dict(spec="SPEC-060", meaning="휴무일을 재제작 픽업 날로 정함", message="휴무일이에요. 이날로 정할까요?"),
    "holder_mismatch": dict(spec="SPEC-006", meaning="예금주가 등록한 상호·대표자와 다름. 사장님 답을 남김", message="예금주가 상호·대표자와 달라요. 가게 명의 계좌가 맞나요?"),
}

# ── 카카오 스킬 결과 (스킬 응답은 늘 200, 결과는 Siljang-Outcome 헤더와 예시 이름으로 구분, DEC-07) ──
# message: 손님에게 가는 말의 뼈대(08단계가 다듬음). handoff: 에스컬레이션 건을 남기는지와 그 사유
SKILL_OUTCOMES = {
    # 손님 메시지 (API-070)
    "answered": dict(spec="SPEC-020", meaning="AI 답이 4초 안에 준비되어 스킬 응답으로 바로 답함", message="(AI가 만든 답, 서버 확인을 지남)"),
    "callback_pending": dict(spec="SPEC-017", meaning="4초 안에 답이 준비되지 않아 콜백으로 답한다고 응답함. 답은 콜백으로 감", message="답을 준비하고 있어요"),
    "handed_over": dict(spec="SPEC-022", meaning="AI가 답하지 않고 사장님께 에스컬레이션함(먹어도 되는지·답할 수 없음·마감된 날·법·의료·손님 요청·다른 사용자·받기 전 문제·조문 없음·빈 답 두 번)", message="사장님 확인 뒤 답드릴게요", handoff="AI 출력의 handoff 사유나 서버가 정한 사유"),
    "ai_unavailable": dict(spec="SPEC-017", meaning="AI 모델이 오류를 냄(5xx·연결 실패). 한 번 다시 한 뒤에도 실패해 에스컬레이션함(R7)", message="사장님 확인 뒤 답드릴게요", handoff="ai_failure"),
    "ai_timeout": dict(spec="SPEC-017", meaning="콜백 기한(콜백 유효 시간 - 5초)까지 AI 답이 없어 에스컬레이션함. 콜백으로 감", message="사장님 확인 뒤 답드릴게요", handoff="callback_timeout"),
    "ai_key_missing": dict(spec="SPEC-017", meaning="서버에 AI 모델 키가 없거나 거절됨. AI를 호출하지 못해 에스컬레이션함", message="사장님 확인 뒤 답드릴게요", handoff="ai_failure"),
    "ai_limit_reached": dict(spec="SPEC-017", meaning="모델 회사의 사용 한도(429)에 닿아 에스컬레이션함", message="사장님 확인 뒤 답드릴게요", handoff="ai_failure"),
    "ai_cost_limit_reached": dict(spec="SPEC-017", meaning="가게의 하루 AI 비용 한도(REQ-163, 기본 5,000원)에 닿아 AI 없이 에스컬레이션함", message="사장님 확인 뒤 답드릴게요", handoff="ai_cost_limit"),
    "masking_failed": dict(spec="SPEC-021", meaning="번호 마스킹이 실패해 AI를 호출하지 않고 에스컬레이션함", message="사장님 확인 뒤 답드릴게요", handoff="masking_failed"),
    "ai_output_rejected": dict(spec="SPEC-020", meaning="AI 답이나 제안이 서버 확인(금액·날짜 판정·확정이라 말함·조문·플레이스홀더·광고·카드 대상)을 지나지 못해 그 부분을 버리고 정해진 문장으로 답함. 버린 제안은 쓰지 않음", message="(계산값으로 만든 정해진 문장)"),
    "card_shown": dict(spec="SPEC-069", meaning="서버가 저장된 값으로 확인 카드(주문 요청·입금 알리기·변경 요청·취소·신고·동의 철회)를 보임", message="(카드: 요약과 버튼)"),
    "photo_received": dict(spec="SPEC-019", meaning="참고·신고 사진을 받아 초안이나 신고 내용에 붙임. AI 모델로 보내지 않음", message="사진을 받았어요"),
    "photo_rejected": dict(spec="SPEC-019", meaning="사진 한도(상담마다 10장, 장당 20MB)를 넘었거나 사진이 아닌 파일", message="사진은 한 장 20MB, 한 상담에 10장까지 받을 수 있어요"),
    "unsupported_message": dict(spec="SPEC-017", meaning="음성·파일·이모티콘만 온 메시지", message="글이나 사진으로 말씀해 주세요"),
    "rate_limited": dict(spec="SPEC-017", meaning="한 손님이 1분에 20개를 넘게 보냄. 기록만 하고 AI를 호출하지 않음. 그 1분 안 첫 번째에만 이 말", message="잠시 뒤 다시 말씀해 주세요"),
    "duplicate": dict(spec="SPEC-017", meaning="같은 카카오 요청이 다시 옴. 처음 결과를 다시 보내고 기록·AI 호출·명령을 다시 하지 않음(REQ-132)", message="(처음 결과와 같은 말)"),
    "not_accepting": dict(spec="SPEC-017", meaning="연결되지 않은 채널이거나 예약 링크를 내기 전 가게. 상담을 열지 않음", message="아직 상담을 받지 않아요. 가게로 연락해 주세요: {가게 연락처}"),
    "channel_linked": dict(spec="SPEC-008", meaning="연결 확인 중인 채널의 테스트 메시지를 받아 채널을 가게에 묶음", message="연결됐어요. 이제 이 채널로 온 손님 메시지를 받아요"),
    "server_error": dict(spec="SPEC-017", meaning="스킬을 처리하다 서버 오류가 남. 손님에게 오류 내용을 보이지 않음(G6), 로그에는 추적 ID", message="잠시 뒤 다시 말씀해 주세요"),
    # 확인 카드 버튼 (API-071)
    "orderer_saved": dict(spec="SPEC-072", meaning="주문자 정보 블록의 이름·연락처가 형식에 맞아 초안에 남기고 주문 요청 카드를 보냄. 이 값은 AI로 보내지 않음(REQ-175, REQ-178)", message="(주문 요청 확인 카드: 요약에 주문자 이름·연락처)"),
    "order_requested": dict(spec="SPEC-029", meaning="주문 요청을 한 트랜잭션으로 남김. 기본 디자인이면 자리와 결제 안내까지", message="주문을 요청했어요(주문번호 {orderNo}). 결제가 확인되면 확정돼요"),
    "payment_claimed": dict(spec="SPEC-033", meaning="결제 안내를 '확인 요청됨'으로 두고 사장님께 결제 확인을 요청함", message="사장님께 알렸어요. 확인되면 알려 드릴게요"),
    "change_requested": dict(spec="SPEC-041", meaning="변경 요청을 남기고 사장님께 알림", message="변경을 요청했어요. 사장님이 보고 알려 드려요"),
    "order_cancelled": dict(spec="SPEC-046", meaning="주문을 '손님이 취소함'으로 두고 자리를 풂. 확인된 결제가 있으면 사장님께 환불 정할 일", message="주문을 취소했어요. 환불은 사장님이 정한 뒤 알려 드려요"),
    "issue_reported": dict(spec="SPEC-058", meaning="문제 신고를 남기고 사장님께 알림(기한 뒤면 '기한 뒤'로)", message="신고를 받았어요. 사장님이 보시고 정하실 거예요"),
    "consent_withdrawn": dict(spec="SPEC-063", meaning="사진 게시 동의를 철회하고 그 사진을 포트폴리오와 예약 링크 페이지에서 내림(5분 이내)", message="사진 게시 동의를 철회했어요. 곧 사진이 내려가요"),
    "declined": dict(spec="SPEC-069", meaning="손님이 카드의 '안 할래요'를 누름. 아무것도 남기지 않음", message="알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"),
    "input_invalid": dict(spec="SPEC-072", meaning="주문자 정보·입금자 이름 블록의 값이 형식에 맞지 않음(이름 1~30자, 연락처 숫자와 '-' 8~14자). 아무것도 남기지 않고 같은 블록 버튼으로 다시 물음(SPEC-033, SPEC-072)", message="이름은 1~30자, 연락처는 숫자와 '-'로 8~14자로 넣어 주세요"),
    "card_stale": dict(spec="SPEC-069", meaning="카드에 묶인 버전(초안 고친 번호·주문 버전·환불 금액)이 지금과 달라 거절하고 새 카드를 보임(G9). 쓴 것 없음", message="내용이 바뀌었어요. 새 카드를 확인해 주세요"),
    "card_expired": dict(spec="SPEC-069", meaning="카드의 30분 기한이 지나 거절하고 새 카드를 보임(G9). 쓴 것 없음", message="시간이 지나 새 카드를 보내 드려요"),
    "card_not_yours": dict(spec="SPEC-069", meaning="카드를 받은 사용자가 아닌 사람이 누름(A7). 쓴 것 없음", message="이 버튼은 카드를 받은 분만 누를 수 있어요"),
    "card_used": dict(spec="SPEC-069", meaning="이미 누른 카드를 다시 누름. 처음 결과를 다시 보냄(G2)", message="(처음 결과와 같은 말)"),
    "day_full": dict(spec="SPEC-029", meaning="기본 디자인 주문의 자리를 같은 트랜잭션에서 잡지 못해 주문 요청도 남기지 않음(R11). 가까운 날 최대 3개", message="그 사이 그날이 다 찼어요. 이날은 어떠세요?"),
    "retry_needed": dict(spec="SPEC-029", meaning="한 트랜잭션의 쓰기 가운데 하나가 실패해 하나도 남기지 않음(REQ-054)", message="다시 눌러 주세요"),
    "not_allowed_now": dict(spec="SPEC-033", meaning="지금 상태에서는 그 명령을 받지 않음(열린 결제 안내 없음, 받은 주문의 취소, 결제 전 주문의 변경 등). 지금 상태를 알림", message="지금은 할 수 없어요: {지금 상태}"),
    # 후기 (API-072)
    "review_saved": dict(spec="SPEC-062", meaning="받은 주문의 후기와 사진, 사진마다 게시 동의(기본 동의 안 함)를 남김", message="후기를 남겨 주셔서 고마워요"),
    "review_not_allowed": dict(spec="SPEC-062", meaning="받은 주문이 아니거나 그 주문을 요청한 사용자가 아님. 남기지 않음", message="받으신 주문에만 후기를 남길 수 있어요"),
    "review_invalid": dict(spec="SPEC-062", meaning="후기 글이 1~1,000자 밖이거나 사진이 5장을 넘음", message="후기는 1,000자, 사진은 5장까지 남길 수 있어요"),
    "photo_download_failed": dict(spec="SPEC-019", meaning="카카오 사진 주소에서 한 번 다시 받아도 실패함", message="사진을 받지 못했어요. 다시 보내 주세요"),
}

# ── 결정 사항 (DEC). 체크포인트에서 함께 확인 요청. decided가 빈 동안은 Claude 추천 ─────────────────
# 2026-11-12 14:01(KST) 06단계 체크포인트: 동희님이 이 작업 대화의 결정 카드("API 계약(작업 72개)과 정한 것 19개를
# 추천대로 굳힐까요?", 13:50 확인 요청)에서 '추천대로 굳힘'을 고르심. 19개 모두 선택안(choice) 그대로 확정함.
# needs_user는 체크포인트 전에 따로 확인 요청한 3개(DEC-12·13·18)의 표시로 남김
DECIDED_06 = "확정(2026-11-12 14:01 동희님 '추천대로 굳힘')"
DECISIONS = [
    dict(id="DEC-01", title="입력 오류는 모두 422", choice="입력 필드가 맞지 않으면 모든 API가 422 `validation_failed`를 반환함. 400은 쓰지 않음. 필드마다 `errors[{field, code}]`로 위치와 사유 코드만 포함하고 넣은 값은 되돌려 보내지 않음. JSON으로 읽을 수 없는 본문은 field `/`·code `bad_json`, 받지 않는 Content-Type은 field `header:Content-Type`·code `not_allowed`, 글자 필드의 NUL 문자는 `bad_format`으로 같은 422", why="G7의 '필드 오류(필드마다 이유)'를 한 형식으로. 계약서가 400·422 가운데 하나를 고르라 함", alt="400: JSON 형식 오류와 값 오류를 나눌 수 있지만 화면이 두 분기를 다뤄야 함", decided=DECIDED_06),
    dict(id="DEC-02", title="없는 ID·다른 가게 ID·형식이 틀린 ID는 같은 404", choice="경로의 ID가 없거나, 다른 가게 것이거나, 형식이 틀리면(100자를 넘는 것 포함) 모두 404 `not_found`, 같은 본문. 계약에 없는 경로도 같은 404. 경로는 있지만 방법이 없으면 405 `method_not_allowed`와 `Allow` 헤더. 403은 쓰지 않음(역할마다 세션 쿠키와 경로가 나뉨)", why="G1: 다른 가게 기록이 있는지조차 알리지 않음. SPEC-068 수락 기준", alt="형식이 틀린 ID는 422: 화면 개발에는 친절하지만 G1의 '구분하지 않음'과 어긋남", decided=DECIDED_06),
    dict(id="DEC-03", title="같은 상태로 가는 명령은 성공, 다른 결정이 있으면 409", choice="이미 그 상태인 명령(이미 마감된 날 마감, 확인된 가게 확인, 같은 '입금됨')은 200과 `outcome: unchanged`, 아무것도 바꾸지 않음. 다른 결정이 먼저 남았으면 409 `already_decided`", why="상태 머신 1-2의 '같은 상태로 가는 명령은 지금 상태를 반환함'과 G3의 '먼저 온 쓰기가 이김'", alt="같은 상태도 409: 두 번 누른 사장님께 오류가 보임", decided=DECIDED_06),
    dict(id="DEC-04", title="사장님·운영자 명령은 요청 키를 꼭 가짐", choice="사장님·운영자의 쓰기 명령은 `Idempotency-Key` 헤더(16~64자, 영문·숫자·`_`·`-`)가 꼭 있어야 하고, 빼면 422 `validation_failed`(header:Idempotency-Key, required). 같은 키가 다시 오면 처음 결과를 그대로 반환하고 `Idempotency-Replayed: true`를 붙임. 같은 키에 다른 내용은 422 `idempotency_key_reused`, 첫 요청을 처리하는 중이면 409 `request_in_progress`. 로그인·로그아웃, 사진 올리기(다시 해도 새 uploadId가 하나 더 생길 뿐), 구글 권한 요청 시작(기록을 바꾸지 않음)은 받지 않음. 카카오 스킬은 카카오 요청으로 만든 키(OPEN-1)와 카드 키를 씀", why="G2(화면 버튼은 화면이 만든 키)와 TBL-050 request_keys", alt="키 없이 버전 비교만: 네트워크가 끊겨 다시 보낸 요청이 두 번 남을 수 있음", decided=DECIDED_06),
    dict(id="DEC-05", title="동시 변경은 revision 비교", choice="고칠 수 있는 기록은 응답에 `revision`(서버가 만든 값)을 포함하고, 명령은 `baseRevision`을 보냄. 다르면 409 `version_conflict`이고 아무것도 바꾸지 않음. 409에는 지금 상태를 포함하지 않고 화면이 다시 읽음(GET). 처음 저장(가격표·운영규정·결제 수단·영업 캘린더·채널·장부)은 `baseRevision: null`. 주문·변경 요청의 revision은 쓸 때마다 하나 오르는 잠금 번호(05단계 `lock_version`, 4절 A6·5절 E15)로 만들고, 결제 안내는 `payment_requests.version`으로 만듦(2026-11-13 설계 재검토 H12)", why="G3(먼저 온 쓰기가 이기고 뒤는 '이미 바뀜'). 주문 내용 버전(`version`)은 상태만 바꾸는 쓰기(결제 확인·취소·받음)에서 오르지 않아 같은 버전을 읽은 결제 확인과 손님 취소가 둘 다 통과했음(RC-01). 그래서 revision은 쓸 때마다 바뀌는 값으로 둠. 오류 응답을 Problem 한 형식으로 두고, 지금 상태는 늘 같은 읽기 API에서 옴. 버전이 없는 기록(상태만 있는 결제 기한 결정 등)도 같은 방법으로", alt="If-Match 헤더: HTTP 표준이지만 어긋남이 412라 계약서의 409와 다르고, 목록의 행마다 값을 포함할 곳이 없음", decided=DECIDED_06),
    dict(id="DEC-06", title="확인이 필요한 저장은 409 confirmation_required", choice="제작 전 취소 환불 낮춤·확정 주문이 있는 날 휴무·마감 후 추가 수락·픽업 날이 아닌 인도·휴무일 재제작·예금주 다름은 아무것도 바꾸지 않고 409 `confirmation_required`와 `confirm` 목록을 반환함. 화면이 말을 보이고, 사장님이 확인하면 같은 요청에 `confirm` 값을 담아 다시 보냄", why="SPEC-005·007·031·038·054·060·006의 '먼저 보이고 확인받음'을 한 형식으로", alt="화면이 미리 계산해 묻기: 그 사이 상태가 바뀌면 확인 없이 저장될 수 있음", decided=DECIDED_06),
    dict(id="DEC-07", title="카카오 스킬은 늘 200과 스킬 응답", choice="카카오 스킬 API는 서버가 처리한 모든 경우에 200과 스킬 응답을 반환하고, 결과는 `Siljang-Outcome` 헤더와 이름 붙은 예시로 구분함. HTTP 오류는 스킬 키가 틀림(401)과 스킬 요청 형식이 아님(422)뿐. AI 실패·느림·키 없음·사용 한도·가게 비용 한도는 모두 에스컬레이션 응답(R7)", why="G6(손님에게 오류 내용을 보이지 않음). 200이 아니면 카카오가 손님에게 자기 오류 말을 보임", alt="AI 실패를 503으로: HTTP 쪽은 깔끔하지만 손님은 카카오 오류 말만 봄", decided=DECIDED_06),
    dict(id="DEC-08", title="카카오 스킬 인증은 오픈빌더 헤더 값", choice="오픈빌더 스킬 설정의 헤더 값(공식 문서 2026-11-12 확인: '헤더값 입력, 테스트 헤더값 입력')에 가게 연결마다 다른 스킬 키를 넣음. 헤더 이름 `Siljang-Skill-Key`. 키는 서버 시크릿과 연결 ID로 만들어 DB에 두지 않음(REQ-135)", why="문서에 요청 서명·IP 목록이 없음. 봇 ID만으로는 남이 요청을 꾸밀 수 있음", alt="주소에 비밀 경로: 로그와 오픈빌더 화면에 그대로 보임", decided=DECIDED_06),
    dict(id="DEC-09", title="파일은 먼저 올리고 ID로 씀", choice="신고증·도안·완성 사진은 `POST /owner/uploads`로 먼저 올리고(용도별 한도), 명령에는 `uploadId`만 씀(1시간 안). 응답의 사진은 15분 사는 서명 주소로만 보이고 저장 위치는 보이지 않음", why="명령을 JSON 하나로 두고 사진 실패를 명령 전에 알림(SPEC-002 '사진 저장이 실패하면 등록 전체를 남기지 않음')", alt="명령마다 multipart: 필드 오류와 파일 오류가 섞임", decided=DECIDED_06),
    dict(id="DEC-10", title="사장님 로그인은 인가 코드를 서버가 바꿈", choice="화면이 카카오 로그인으로 받은 인가 코드를 `POST /owner/session`으로 보내면 서버가 토큰으로 바꿔 카카오 회원번호만 남기고 토큰은 버림. 세션은 HttpOnly·Secure 쿠키. 운영자는 이메일·비밀번호·6자리 번호로 `POST /operator/session`", why="SPEC-001(카카오 토큰을 남기지 않음), R2. 쿠키라 화면 코드가 세션 값을 만지지 않음", alt="토큰을 화면에 줌: 화면 저장소가 털리면 세션도 털림", decided=DECIDED_06),
    dict(id="DEC-11", title="운영자 아닌 사람에게 운영자 API는 401", choice="운영자 API는 운영자 세션이 없으면 401. SPEC-001의 '운영자 화면은 운영자 계정이 아니면 찾을 수 없음'은 운영자 기록을 0건 보인다는 뜻으로 읽고, 그 화면 디자인은 08단계에서 정함", why="사장님 세션과 운영자 세션은 다른 쿠키라 섞이지 않음. 계약서가 로그인이 필요한 API에 401을 요구함", alt="세션이 없으면 404: 운영자 주소를 숨기지만 운영자도 세션이 만료되면 '찾을 수 없음'을 봄", decided=DECIDED_06),
    dict(id="DEC-12", title="예약 링크 조건에 '결제 수단'을 더함", choice="가격표·운영규정·영업 캘린더·영업 신고 확인·채널 연결에 더해 결제 수단(가게 계좌)이 있어야 예약 링크를 냄. `GET /owner/booking-link`의 `missing`에 `payment_destination`. 요구사항 버전 4 REQ-164로 더함", why="결제 안내는 가게 계좌를 꼭 참조함(TBL-031 payment_account_id NOT NULL, E6). 계좌 없이 링크가 나가면 기본 디자인 주문 요청이 한 트랜잭션을 마칠 수 없음. 03단계 FL-001 기본 경로도 링크 전에 계좌를 등록함", alt="REQ-105 글자대로(조건 다섯): 계좌가 없는 가게의 주문 요청이 실패함", needs_user=True, decided=DECIDED_06),
    dict(id="DEC-13", title="픽업 장소는 예약 링크를 막지 않음", choice="픽업 장소(E14)가 비어도 예약 링크를 냄. `GET /owner/booking-link`의 `recommended`에 `pickup_address`로 보이고, 비었으면 전날 안내에서 위치 문구를 빼고 가게 연락처만 포함함", why="05단계 E14가 06단계로 전달한 질문. 조건을 늘리지 않고 사장님께 알림", alt="픽업 장소도 조건으로: 전날 안내가 늘 위치를 포함하지만 SPEC-010이 바뀜", needs_user=True, decided=DECIDED_06),
    dict(id="DEC-14", title="목록은 커서 방식", choice="목록은 `cursor`와 `limit`(1~100, 기본 20)로 나눠 받고 `nextCursor`가 없으면 끝", why="할 일·주문이 쌓여도 같은 속도. 행이 끼어도 중복되거나 빠지지 않음", alt="쪽 번호: 화면은 쉽지만 새 행이 생기면 중복됨", decided=DECIDED_06),
    dict(id="DEC-15", title="돈·시각·날짜의 형식", choice="돈은 원 단위 정수. 시각은 가게 시간대 오프셋을 붙인 RFC 3339(예: 2026-11-20T14:00:00+09:00), 날짜는 가게 시간대의 YYYY-MM-DD(G8)", why="DB와 같음(돈 integer, 시각 timestamptz, 자리 날짜 date)", alt="UTC로만: 화면이 늘 바꿔야 함", decided=DECIDED_06),
    dict(id="DEC-16", title="요청 빈도 한도", choice="예약 링크 페이지는 같은 주소에서 1분 60번(SPEC-011), 사장님 로그인은 1분 10번, 운영자 로그인 실패는 15분 5번을 넘으면 429와 `Retry-After`. 손님 메시지의 1분 20번(SPEC-017)은 스킬 응답 `rate_limited`", why="SPEC-011의 긁어 가기 막기와 로그인 무차별 대입 막기", alt="한도 없음: 첫 버전 가게 1~3곳이라 버틸 수 있지만 운영자 계정이 위험", decided=DECIDED_06),
    dict(id="DEC-17", title="AI-1 출력 스키마를 이 계약에 확정함", choice="AI-1이 '06단계에서 확정'으로 전달한 출력 스키마를 `components.schemas.AiTurnOutput`으로 둠(HTTP로 오가지 않는 서버 안 구조화 출력). SPEC-049의 환불 계좌를 받는 필드 `refund_account_patch`를 더함", why="AI-1 출력 목록에 환불 계좌 필드가 없어 SPEC-049를 할 수 없었음", alt="환불 계좌는 사장님이 상담을 보고 손으로 넣음: AI 필드는 줄지만 사장님 일이 늘어남", decided=DECIDED_06),
    dict(id="DEC-18", title="후기는 카카오 '후기' 블록의 스킬로 받음", choice="후기는 후기 부탁 안내의 버튼이 여는 오픈빌더 블록이 `POST /kakao/skills/review`로 보냄(글, 보안 이미지 플러그인 사진 5장까지, 게시 동의). 게시 동의는 후기 하나에 한 번 묻고 그 답을 사진마다 남김(기본 동의 안 함)", why="AI-1이 후기를 다루지 않음(SPEC-062는 AI 없음). 카카오 대화에서 사진마다 따로 묻기는 번거로움", alt="사진마다 묻기: SPEC-062 글자 그대로지만 손님 단계가 사진 수만큼 늘어남", needs_user=True, decided=DECIDED_06),
    dict(id="DEC-19", title="응답에 포함하는 것", choice="손님·공개 응답에는 주문번호 밖의 ID(uuid)를 포함하지 않음. 사장님·운영자 응답은 uuid ID를 씀. 마스킹 원본 값은 에스컬레이션 건·상담 대화·환불 화면에만, 계좌는 결제 수단과 환불 화면에만", why="G6, REQ-137, R19", alt="모든 응답에 같은 형식: 손님 응답에 내부 ID가 섞일 수 있음", decided=DECIDED_06),
]

# ── 열린 질문 (계약 안 description의 'Open:'과 같은 것) ─────────────────────────────
OPEN_QUESTIONS = [
    dict(id="OPEN-1", where="API-070", text="카카오 메시지 ID: 스킬 요청 문서(2026-11-12 확인)에 요청·메시지 ID가 없음. 같은 요청 거르기 키는 실제 요청에 쓸 ID가 있으면 그것, 없으면 (봇 ID, 사용자 키, 블록 ID, 발화, 받은 시각을 2초로 내린 값)의 해시로 둠. 카카오가 같은 요청을 다시 보내는지와 함께 개발 전 실제 요청으로 확인"),
    dict(id="OPEN-2", where="API-070", text="콜백 유효 시간: 콜백 문서 본문은 5분, 같은 문서의 오류 표는 '1분 이내'라 어긋남. AI-1 전체 기한(유효 시간 - 5초)은 개발 전 테스트로 정함"),
    dict(id="OPEN-3", where="API-070", text="사진 메시지가 스킬 요청에 어떻게 오는지(발화에 주소인지, params인지) 문서에 없음. 개발 전 실제 요청으로 확인. 보안 이미지 플러그인(문서 확인)은 후기·신고 사진에 쓸 수 있음"),
    dict(id="OPEN-4", where="API-070", text="빈 응답(답을 보내지 않기)이 되는지 문서에 없음. 될 때까지 같은 메시지 반복과 한도 넘은 메시지에는 정해진 짧은 말을 다시 보냄"),
    dict(id="OPEN-5", where="API-001, API-004", text="세션 길이: 사장님 30일(쓰면 늘어남), 운영자 12시간을 첫 값으로 제안. 개발 전에 정함"),
    dict(id="OPEN-6", where="API-004", text="운영자 인증 서비스(비밀번호·2단계 인증 키를 맡길 곳)는 개발 전에 고름. 고른 서비스가 자기 로그인 화면을 쓰면 이 API를 그 플로우로 바꿈(운영자 화면만 씀)"),
    dict(id="OPEN-7", where="components.schemas.AiTurnOutput", text="AI 모델 회사·모델은 개발 전(10단계 전)에 고름. 고르는 날 그 회사의 지금 약관·데이터 방침을 확인하고 처리방침의 국외 이전 항목을 채움(AI-1)"),
    dict(id="OPEN-8", where="API-031", text="사장님이 오픈빌더 봇 ID를 찾는 곳(봇 설정 화면이나 주소)을 07·08단계 연결 안내에서 정함. 봇 ID 형식은 첫 테스트 메시지에서 확인"),
]

# ── 서버 안의 일 (호출하는 API가 없는 SPEC). 정해진 시각이나 이벤트로 서버가 함 ──────────────
JOBS = [
    dict(spec="SPEC-024", job="사장님 답 기다림 타이머: 기다리는 시간이 지나면 지연 안내 한 번과 다시 알림 한 번(답하는 시간 안에서만 셈)", seen_in="API-040(할 일의 waitStatus), API-042(답하면 멈춤), API-010(기다리는 시간 설정)"),
    dict(spec="SPEC-025", job="문의 끊김: 마지막 손님 메시지 뒤 가게가 정한 시간이 지나면 상담을 닫음", seen_in="API-070(이어가기), API-010(끊김 시간 설정)"),
    dict(spec="SPEC-037", job="결제 기한 처리: 기한이 지난 결제 안내의 자리를 풀고 사장님께 고를 일을 남김", seen_in="API-040(할 일), API-044(status=payment_overdue), API-047(고르기)"),
    dict(spec="SPEC-044", job="차액 결제 기한 처리: 변경 요청을 '차액 없어 닫힘'으로", seen_in="API-062"),
    dict(spec="SPEC-052", job="전날 안내: 다음 날 픽업할 손님에게 가게가 정한 시각(08:00~20:50)에 한 번", seen_in="API-027(시각 설정)"),
    dict(spec="SPEC-061", job="후기 부탁: 인도한 다음 날 가게가 정한 시각에 한 번(신고가 있으면 보내지 않음)", seen_in="API-027(시각 설정), API-072(버튼이 여는 후기 블록)"),
    dict(spec="SPEC-064", job="장부 쓰기와 다시 적기(1분·5분·30분·2시간·6시간, 그 뒤 하루 한 번), 24시간 실패 알림", seen_in="API-033(못 적은 쓰기 수), API-035(다시 연결하면 다시 적음)"),
    dict(spec="SPEC-065", job="지난 기록 지우기: 하루 한 번 03:00(05단계 README 6절 순서)", seen_in="API-043(지운 상담은 status deleted)"),
    dict(spec="SPEC-066", job="손님에게 먼저 보내는 안내: 친구면 카카오 이벤트 API로 바로, 아니면 다음 대화 때 먼저(1분·5분·30분 다시 보내기)", seen_in="API-070(먼저 전함), API-042"),
    dict(spec="SPEC-067", job="사장님 알림: 우리 서비스 채널로 할 일 종류와 목록 주소(1분 안 같은 종류는 묶음)", seen_in="API-040(할 일), API-002(채널 친구가 아니면 안내)"),
    dict(spec="SPEC-047", job="환불 보내기 다시 알림: 정한 뒤 24시간이 지나도 '보냄'이 없으면 사장님께 한 번 다시 알림(REQ-173)", seen_in="API-040(할 일 refund_send), API-061(보냄이면 닫힘)"),
]

# ── 깨지는 변화: main의 api/openapi.yaml과 견줘 check_api.py A13이 찾는 것. PR마다 더하고 지난 항목은 지우지 않음 ──────────
BREAKING_CHANGES = [
    dict(what=f"꼭 넣을 필드 더함: {w}", why=why, decided="2026-11-13 20:59 동희님 결정 카드 '추천안대로 (추천)'(설계 재검토 H1·H2)",
         client="응답에만 더한 필드라 보내는 요청은 그대로. 화면(08단계)은 새 필드를 읽음")
    for w, why in [
        ("PaymentRequest.arrivedAmount", "받은 금액을 결제 안내의 들어온 금액 합으로 셈(REQ-165, SPEC-071)"),
        ("PaymentRequest.arrivedAt", "들어온 금액을 남긴 시각(REQ-165, SPEC-071)"),
        ("Payment.voidedAt", "잘못 누른 결제 확인 취소(REQ-169, SPEC-070)"),
        ("Payment.voidReason", "결제 확인을 취소한 사유(REQ-169, SPEC-070)"),
        ("RefundPreview.confirmedAmount", "받은 금액을 확인된 결제와 그 밖의 들어온 금액으로 나눠 보임(REQ-165)"),
        ("RefundPreview.unconfirmedAmount", "받은 금액을 확인된 결제와 그 밖의 들어온 금액으로 나눠 보임(REQ-165)"),
        ("RefundPreview.minAmount", "보상이 아닌 환불은 계산값보다 낮게 정하지 못함(REQ-170)"),
    ]
] + [
    dict(what=w, why=why, decided="2026-11-13 20:59 동희님 결정 카드 '추천안대로 (추천)'(설계 재검토 H6·H11·H12)", client=client)
    for w, why, client in [
        ("꼭 넣을 필드 더함: ProductionDay.items[].summary의 designOption·extras·allergyAnswer·excludedIngredients·referencePhotoCount",
         "제작 목록에 알레르기 답·빼야 할 재료·더하는 옵션까지 보임(REQ-177, SPEC-050, 설계 재검토 H6)",
         "응답에만 더한 필드라 보내는 요청은 그대로. 제작 목록(SCR-030)이 새 필드를 읽음. 안쪽 필드라 A13은 찾지 않아 여기 적음"),
        ("AI 출력에서 뺌: AiTurnOutput.draft_patch.customer_name·customer_phone",
         "주문자 이름·연락처는 AI를 거치지 않는 주문자 정보 블록으로만 받음(REQ-175, REQ-178, SPEC-072, 설계 재검토 H11)",
         "AI 출력(AI-1)만 좁힘. HTTP 요청·응답은 그대로. 이 필드를 담은 AI 출력은 형식 검사에서 받지 않음(SPEC-020)"),
        ("값의 원본이 바뀜: Order·OrderSummary·ChangeRequest의 revision",
         "쓸 때마다 하나 오르는 잠금 번호(orders·change_requests.lock_version)로 만듦(DEC-05, 설계 재검토 H12)",
         "화면은 받은 revision을 baseRevision에 그대로 보내므로 바꿀 것 없음. 상태만 바뀐 뒤에 보낸 명령도 409 version_conflict가 됨"),
    ]
]

# ── 케이스 유형 (04단계와 같은 이름) ─────────────────────────────────────────────
KINDS = ["접근", "입력", "대상", "상태", "반복", "동시", "한도", "외부", "노출", "빈·끊김", "화면", "AI"]
