# 06단계 API 계약: 수제케이크 주문제작 API

상태: 확정(2026-11-12 14:01 동희님 '추천대로 굳힘', 14절). 원본은 [`api/openapi.yaml`](../../api/openapi.yaml)(OpenAPI 3.1)이고, 사람이 보는 곳은 Swagger UI 페이지 [Siljang API 계약](https://claude.ai/artifact/EKihED8HYG5vXWT3YQfUom)입니다(`truth: source`, 3절). 계약 파일과 이 문서의 표는 [`research/cake-api-2026-11/`](../../research/cake-api-2026-11/)의 목록에서 `build_api.py`가 함께 만들어서, 둘이 어긋나지 않습니다. 계약 파일은 손으로 고치지 않습니다.

## 1. 한눈에

<!-- BEGIN generated:counts -->
API 77개 · 응답 382개 · 오류 코드 37개 · 필드 오류 사유 22개 · 확인할 것 6개 · 스킬 결과 44개 · 결정 사항 22개 · 열린 질문 9개 · 서버 안의 일 13개 · 스키마 137개
<!-- END generated:counts -->

- 사장님 화면이 호출하는 API가 60개(로그인·로그아웃 포함), 운영자 화면이 11개, 손님이 여는 예약 링크 페이지가 2개, 카카오 오픈빌더가 호출하는 스킬이 4개입니다(4절. 안내 스킬 API-073은 우리 서버가 부른 카카오 Event API를 거쳐 옴). 기능 명세 SPEC-001~074가 모두 API 하나 이상에 이어집니다.
- API마다 응답 목록(성공·422·401·403·404·409·default)을 포함하거나, 포함하지 않는 사유를 `x-corthex.omit`에 적었습니다. 응답 하나는 `API-001#401`처럼 부르고, 모든 응답에 이름 붙은 예시가 있습니다. 예시는 지어낸 가게 '달빛케이크'의 값입니다.
- 오류는 한 형식(RFC 9457 Problem Details에 `code`·`traceId`를 더함)이고 오류 코드는 목록 하나(6절)에만 있습니다. 화면이 보일 말과 할 일도 코드마다 적었습니다.
- 카카오 스킬은 늘 200과 스킬 응답을 반환하고, 결과는 `Siljang-Outcome` 헤더와 예시 이름으로 나눕니다(DEC-07, 7절). AI 모델 실패·느림·키 없음·사용 한도·가게 비용 한도는 저마다 결과 코드를 갖고, 손님에게는 모두 "사장님 확인 뒤 답드릴게요"로 에스컬레이션합니다(AI-1).
- 요청 필드에는 05단계 테이블.컬럼의 한도를 달았습니다. 검사 도구가 계약이 허용하는 값을 만들어 실제 DB 컬럼의 타입과 CHECK에 넣어 보고, 막히는 값이 없음을 확인했습니다(12절).
- 목 서버 Prism이 계약을 읽어 모든 응답 예시를 그대로 반환하고, 계약 테스트 도구 Schemathesis도 계약을 읽어 예시 단계를 통과했습니다(12절).
- 체크포인트: 2026-11-12 14:01 동희님이 API 72개와 결정 사항 19개(8절)를 추천대로 확정하셨습니다(14절). DEC-12의 조건은 요구사항 버전 4 REQ-164가 되었습니다. 2026-11-13 설계 재검토(환불 길)로 응답에 필드 7개를 더한 깨지는 변화가 있습니다(11절, 15절). 같은 재검토의 H6·H11·H12로 스킬 결과 2개(`orderer_saved`·`input_invalid`)와 제작 목록 요약 필드를 더하고, 주문·변경 요청의 `revision`을 쓸 때마다 오르는 잠금 번호로 만들었습니다(15절). H7·H8·H9로 안내 스킬 API-073, 채널 연결의 버튼 블록 ID·시험 버튼·먼저 보내기 상태, 주문 요청 카드의 규정 글을 더하고(DEC-20~22, OPEN-9), 요청과 응답에 꼭 있는 필드 8개를 더한 깨지는 변화가 있습니다(11절, 15절). H3으로 상담 상태 `ended`(상담 끝남)를 더하고, 끝나고 30일이 지나 보관 기록이 된 주문은 목록에서 빼고 하나를 읽으면 404로 하는 공통 규칙을 더했습니다(5절, 15절). H4로 운영자의 가게 기록 보기(API-074~076, 가린 값)와 사유를 적은 원래 값 열기(API-077), 접속기록(SPEC-074), 결제 계좌의 암호화와 예금주 확인(API-013·014·024·025)을 더하고, 응답에 꼭 있는 필드 1개를 더한 깨지는 변화가 있습니다(5절, 11절, 15절).

## 2. 읽은 것과 만든 것

| 읽은 것 | 버전 | 쓴 것 |
| --- | --- | --- |
| [`docs/04-functional-spec/spec.md`](../04-functional-spec/spec.md) | 04단계 확정(2026-11-12), 커밋 af62db2 | SPEC-001~069의 주 플로우·예외·수락 기준, 공통 규칙 G1~G9, 상태 머신 1-1~1-8, AI-1(상담 답 만들기) |
| [`db/schema.sql`](../../db/schema.sql) | 05단계 확정(2026-11-12 11:56), 커밋 af62db2 | 요청 필드의 한도(TBL-001~051의 컬럼), 상태 값, 응답에 포함하는 필드 |
| [`docs/02-prd/requirements.md`](../02-prd/requirements.md) | 버전 3(REQ-001~163) | 설명에 단 REQ 번호 |
| [`docs/01-domain/domain.md`](../01-domain/domain.md) | TERM-001~074 | 이름 |
| 카카오 비즈니스 공식 문서: [스킬 만들기](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/make_skill), [응답 형식](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/answer_json_format), [콜백](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/ai_chatbot_callback_guide), [플러그인 값](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/apply_skill_to_plugin), [이벤트 API](https://kakaobusiness.gitbook.io/main/tool/chatbot/main_notions/event-api) | 2026-11-12에 읽음 | 스킬 요청·응답의 필드와 한도, 헤더 값 인증(DEC-08), 콜백, 보안 이미지 플러그인. 문서에 없는 것은 9절 열린 질문 |
| 카카오 비즈니스 [이벤트 API](https://kakaobusiness.gitbook.io/main/tool/chatbot/main_notions/event-api)(발송 결과 조회 포함)와 [월렛](https://kakaobusiness.gitbook.io/main/tool/chatbot/main_notions/wallet), 카카오 디벨로퍼스 [카카오톡 채널 REST API](https://developers.kakao.com/docs/ko/kakaotalk-channel/rest-api) | 2026-11-13에 다시 읽음(설계 재검토 H7) | Event API 요청과 taskId, 발송 결과 조회와 errorType, 월렛 연결 조건, 채널 관계 조회(DEC-20, DEC-21). 문서로 확인되지 않은 권한은 OPEN-9 |

빠진 입력: 계약서는 화면이 있으면 사이트맵(SCR)도 읽으라 합니다. 사이트맵은 이 뒤의 07단계라 아직 없어서, API는 플로우(FL)와 SPEC에서 화면이 할 일을 읽어 만들었습니다. 07·08단계에서 화면이 더 필요한 API가 나오면 계약에 더합니다(13절).

| 만든 것 | 무엇 |
| --- | --- |
| [`api/openapi.yaml`](../../api/openapi.yaml) | 원본 계약. API마다 `operationId`와 `x-corthex`(API ID, SPEC ID, 뺀 응답과 사유, 케이스 유형 근거), 응답마다 예시. `components.x-corthex`에 오류 코드·필드 오류 사유·확인할 것·스킬 결과·결정 사항·열린 질문·서버 안의 일·깨지는 변화 |
| [`research/cake-api-2026-11/`](../../research/cake-api-2026-11/) | `api_catalog.py`(오류 코드·결과·결정 사항·열린 질문), `api_schemas.py`(스키마), `api_examples.py`(예시), `api_ops.py`(API 77개), `build_api.py`(계약 파일과 이 문서의 표를 만듦), `check_api.py`(검사), `requirements.txt`(검사 도구 버전), `build_viewer.py`와 `viewer.html`(검토 도구 Swagger UI 페이지를 만듦, 3절) |

다시 만들고 검사하는 법(저장소 맨 위에서):

```sh
python3 -B research/cake-api-2026-11/build_api.py . --write
python -m venv .venv-api && .venv-api/bin/pip install -r research/cake-api-2026-11/requirements.txt
.venv-api/bin/python -B research/cake-api-2026-11/check_api.py . --db "host=… port=… user=…" --mock http://127.0.0.1:4010
```

`--db`는 검사용 PostgreSQL 서버입니다. 검사용 DB `api_check_schema`를 만들고 끝나면 지우니 운영 서버에는 쓰지 않습니다. `--mock`은 아래 목 서버 주소입니다.

## 3. 보는 법

- **Swagger UI 페이지(바로 보기)**: [Siljang API 계약](https://claude.ai/artifact/EKihED8HYG5vXWT3YQfUom)에서 설치 없이 봅니다. 동희님 계정의 비공개 페이지라 다른 사람은 공유해야 열립니다. 원본을 그대로 보여 주고, API 이름 앞의 API ID와 설명 끝의 '반환하지 않는 응답'만 `x-corthex`에서 옮겨 붙였습니다. 계약이 바뀌면 `build_viewer.py`로 다시 만들어(아래) 같은 주소에 올립니다. 작업 계정을 옮길 때마다(2026-11-12 밤, 2026-11-13) 새 주소로 다시 올렸고, 옛 주소의 페이지는 더 고치지 않습니다.
- **Swagger UI(내 컴퓨터)**: `docker run --rm -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml -v "$PWD/api:/api" swaggerapi/swagger-ui`를 돌리고 http://localhost:8080 을 엽니다. 도커가 없으면 https://editor.swagger.io 에 `api/openapi.yaml`을 끌어 놓아도 됩니다. API는 태그(로그인·가게·주문 …)로 묶여 있고, 응답마다 예시를 골라 볼 수 있습니다.
- **목 서버**(화면 개발과 QA가 서버 없이 쓰는 곳): `npx @stoplight/prism-cli@5.14.2 mock api/openapi.yaml`을 돌리면 http://127.0.0.1:4010 에서 계약대로 답합니다. 맞는 요청은 성공 응답의 첫 예시, 로그인 없는 요청은 401의 첫 예시, 틀린 입력은 422의 첫 예시(`validation_failed`)를 받습니다. 다른 응답은 헤더로 고릅니다.

```sh
curl -H 'Cookie: siljang_owner=example' http://127.0.0.1:4010/owner/orders/68598d4e-7858-598f-aa63-2b51daa7d590
curl -X POST -H 'Cookie: siljang_owner=example' -H 'Idempotency-Key: ui-0123456789abcdef' \
     -H 'Prefer: code=409, example=version_conflict' -H 'Content-Type: application/json' \
     -d '{"baseRevision":"x","decision":"accept"}' \
     http://127.0.0.1:4010/owner/orders/68598d4e-7858-598f-aa63-2b51daa7d590/custom-decision
```

페이지 재생성: `npm pack swagger-ui-dist@5.17.14`로 받은 꾸러미의 `package/swagger-ui.css`를 넣어 `python3 -B research/cake-api-2026-11/build_viewer.py . 나갈_폴더 --css package/swagger-ui.css`를 돌리면 `siljang-api-contract.html`과 `openapi.json`이 나옵니다. 스타일시트는 버전이 섞이지 않게 SHA-256을 확인합니다.

## 4. API 목록

'호출하는 쪽'의 사장님·운영자는 세션 쿠키(`siljang_owner`, `siljang_operator`), 스킬 키는 오픈빌더 헤더 값(`Siljang-Skill-Key`)입니다. '응답'은 그 API가 반환할 수 있는 상태 전부입니다.

<!-- BEGIN generated:operations -->
| ID | API | 방법·경로 | operationId | 호출하는 쪽 | SPEC | 응답 |
| --- | --- | --- | --- | --- | --- | --- |
| API-001 | 사장님 로그인(카카오 인가 코드) | `POST /owner/session` | `createOwnerSession` | 누구나 | SPEC-001, SPEC-068 | 200 · 401 · 422 · 429 · 503 · default |
| API-002 | 로그인한 사장님과 가게, 상단 배너 | `GET /owner/me` | `getOwnerMe` | 사장님 | SPEC-001, SPEC-067 | 200 · 401 · default |
| API-003 | 사장님 로그아웃 | `DELETE /owner/session` | `deleteOwnerSession` | 사장님(없어도 됨) | SPEC-001 | 204 · default |
| API-004 | 운영자 로그인(이메일·비밀번호·2단계 인증) | `POST /operator/session` | `createOperatorSession` | 누구나 | SPEC-001 | 200 · 401 · 422 · 429 · default |
| API-005 | 로그인한 운영자 | `GET /operator/me` | `getOperatorMe` | 운영자 | SPEC-001 | 200 · 401 · default |
| API-006 | 운영자 로그아웃 | `DELETE /operator/session` | `deleteOperatorSession` | 운영자(없어도 됨) | SPEC-001 | 204 · default |
| API-007 | 사진 업로드(신고증·도안·완성 사진) | `POST /owner/uploads` | `createUpload` | 사장님 | SPEC-002, SPEC-004, SPEC-053 | 201 · 401 · 413 · 422 · 503 · default |
| API-008 | 가게 등록 | `POST /owner/shop` | `registerShop` | 사장님 | SPEC-002, SPEC-068 | 201 · 401 · 409 · 422 · 503 · default |
| API-009 | 내 가게 조회 | `GET /owner/shop` | `getShop` | 사장님 | SPEC-002, SPEC-003, SPEC-009 | 200 · 401 · 404 · default |
| API-010 | 가게 설정 수정 | `PATCH /owner/shop` | `updateShop` | 사장님 | SPEC-009, SPEC-017, SPEC-024, SPEC-025, SPEC-052 | 200 · 401 · 404 · 409 · 422 · default |
| API-011 | 보류된 영업 신고 재업로드 | `PUT /owner/shop/license` | `resubmitLicense` | 사장님 | SPEC-003 | 200 · 401 · 404 · 409 · 422 · default |
| API-012 | 영업 신고 확인할 가게 목록 | `GET /operator/shops` | `listReviewShops` | 운영자 | SPEC-003, SPEC-002 | 200 · 401 · 422 · default |
| API-013 | 영업 신고 확인할 가게 하나 | `GET /operator/shops/{shopId}` | `getReviewShop` | 운영자 | SPEC-003 | 200 · 401 · 404 · default |
| API-014 | 영업 신고 확인·보류 | `POST /operator/shops/{shopId}/license-review` | `reviewLicense` | 운영자 | SPEC-003 | 200 · 401 · 404 · 409 · 422 · default |
| API-015 | 운영자 알림 | `GET /operator/alerts` | `listOperatorAlerts` | 운영자 | SPEC-008, SPEC-010, SPEC-017 | 200 · 401 · 422 · default |
| API-016 | 현재 가격표 버전 | `GET /owner/price-list` | `getCurrentPriceList` | 사장님 | SPEC-004 | 200 · 401 · 404 · default |
| API-017 | 가격표 새 버전 저장 | `POST /owner/price-list/versions` | `createPriceListVersion` | 사장님 | SPEC-004 | 201 · 200 · 401 · 404 · 409 · 422 · default |
| API-018 | 가격표 버전 목록 | `GET /owner/price-list/versions` | `listPriceListVersions` | 사장님 | SPEC-004 | 200 · 401 · 404 · default |
| API-019 | 가격표 버전 하나 | `GET /owner/price-list/versions/{version}` | `getPriceListVersion` | 사장님 | SPEC-004, SPEC-013 | 200 · 401 · 404 · default |
| API-020 | 현재 운영규정(없으면 템플릿) | `GET /owner/operating-rules` | `getCurrentOperatingRules` | 사장님 | SPEC-005 | 200 · 401 · 404 · default |
| API-021 | 운영규정 확정(새 버전) | `POST /owner/operating-rules/versions` | `createOperatingRulesVersion` | 사장님 | SPEC-005 | 201 · 200 · 401 · 404 · 409 · 422 · default |
| API-022 | 운영규정 버전 목록 | `GET /owner/operating-rules/versions` | `listOperatingRulesVersions` | 사장님 | SPEC-005 | 200 · 401 · 404 · default |
| API-023 | 운영규정 버전 하나 | `GET /owner/operating-rules/versions/{version}` | `getOperatingRulesVersion` | 사장님 | SPEC-005, SPEC-016 | 200 · 401 · 404 · default |
| API-024 | 결제 수단 조회 | `GET /owner/payment-destination` | `getPaymentDestination` | 사장님 | SPEC-006 | 200 · 401 · 404 · default |
| API-025 | 결제 수단 등록·수정 | `PUT /owner/payment-destination` | `setPaymentDestination` | 사장님 | SPEC-006 | 200 · 401 · 404 · 409 · 422 · default |
| API-026 | 영업 캘린더 설정 조회 | `GET /owner/calendar` | `getCalendarSettings` | 사장님 | SPEC-007 | 200 · 401 · 404 · default |
| API-027 | 영업 캘린더 설정 등록·수정 | `PUT /owner/calendar` | `setCalendarSettings` | 사장님 | SPEC-007, SPEC-052, SPEC-061 | 200 · 401 · 404 · 409 · 422 · default |
| API-028 | 날짜별 남은 자리와 마감 현황 | `GET /owner/calendar/days` | `listCalendarDays` | 사장님 | SPEC-007, SPEC-012, SPEC-015 | 200 · 401 · 404 · 422 · default |
| API-029 | 그날 휴무·하루 최대 개수·주문 마감 수정 | `PATCH /owner/calendar/days/{day}` | `updateCalendarDay` | 사장님 | SPEC-007, SPEC-012, SPEC-015 | 200 · 401 · 404 · 409 · 422 · default |
| API-030 | 채널 연결 상태와 스킬 설정 값 | `GET /owner/kakao-channel` | `getKakaoChannel` | 사장님 | SPEC-008 | 200 · 401 · 404 · default |
| API-031 | 연결할 채널(오픈빌더 봇) 설정 | `PUT /owner/kakao-channel` | `setKakaoChannel` | 사장님 | SPEC-008 | 200 · 401 · 404 · 409 · 422 · default |
| API-032 | 연결 확인 시작(10분) | `POST /owner/kakao-channel/check` | `startKakaoChannelCheck` | 사장님 | SPEC-008 | 200 · 401 · 404 · 409 · 422 · default |
| API-033 | 장부 연결 상태 | `GET /owner/ledger` | `getLedger` | 사장님 | SPEC-009, SPEC-064 | 200 · 401 · 404 · default |
| API-034 | 구글 권한 요청 시작 | `POST /owner/ledger/authorization` | `startLedgerAuthorization` | 사장님 | SPEC-009 | 200 · 401 · 404 · 422 · default |
| API-035 | 장부 연결·다시 연결 | `PUT /owner/ledger` | `linkLedger` | 사장님 | SPEC-009, SPEC-064 | 200 · 401 · 404 · 409 · 422 · 503 · default |
| API-036 | 장부 연결 해제 | `DELETE /owner/ledger` | `unlinkLedger` | 사장님 | SPEC-009 | 200 · 401 · 404 · 409 · 422 · default |
| API-037 | 예약 링크와 미충족 조건 | `GET /owner/booking-link` | `getBookingLink` | 사장님 | SPEC-010 | 200 · 401 · 404 · default |
| API-038 | 예약 링크 페이지 | `GET /public/shops/{slug}` | `getBookingPage` | 누구나 | SPEC-011, SPEC-014, SPEC-063 | 200 · 404 · 429 · default |
| API-039 | 가게 개인정보 처리방침 | `GET /public/shops/{slug}/privacy-policy` | `getPrivacyPolicy` | 누구나 | SPEC-010, SPEC-011, SPEC-018 | 200 · 404 · 429 · default |
| API-040 | 할 일 목록 | `GET /owner/tasks` | `listOwnerTasks` | 사장님 | SPEC-067, SPEC-022, SPEC-024, SPEC-037 | 200 · 401 · 404 · 422 · default |
| API-041 | 에스컬레이션 건 하나 | `GET /owner/handoffs/{handoffId}` | `getHandoff` | 사장님 | SPEC-022, SPEC-023, SPEC-021 | 200 · 401 · 404 · default |
| API-042 | 에스컬레이션 건 답변 | `POST /owner/handoffs/{handoffId}/answer` | `answerHandoff` | 사장님 | SPEC-023, SPEC-024, SPEC-066 | 200 · 401 · 404 · 409 · 422 · default |
| API-043 | 상담 대화 조회 | `GET /owner/consultations/{consultationId}/messages` | `listConsultationMessages` | 사장님 | SPEC-021, SPEC-019, SPEC-068, SPEC-065 | 200 · 401 · 404 · 422 · default |
| API-044 | 주문 목록 | `GET /owner/orders` | `listOrders` | 사장님 | SPEC-031, SPEC-037, SPEC-068 | 200 · 401 · 404 · 422 · default |
| API-045 | 주문 하나 | `GET /owner/orders/{orderId}` | `getOrder` | 사장님 | SPEC-031, SPEC-013, SPEC-045, SPEC-068 | 200 · 401 · 404 · default |
| API-046 | 맞춤 주문 검토(수락·금액 변경 수락·거절) | `POST /owner/orders/{orderId}/custom-decision` | `decideCustomOrder` | 사장님 | SPEC-031, SPEC-015, SPEC-032 | 200 · 401 · 404 · 409 · 422 · default |
| API-047 | 결제 기한 지난 주문: 결제 기한 연장·취소 | `POST /owner/orders/{orderId}/overdue-decision` | `decideOverdueOrder` | 사장님 | SPEC-038, SPEC-039, SPEC-015, SPEC-032, SPEC-037 | 200 · 401 · 404 · 409 · 422 · default |
| API-048 | 가게 사정 취소 | `POST /owner/orders/{orderId}/shop-cancel` | `cancelOrderByShop` | 사장님 | SPEC-048, SPEC-016, SPEC-015, SPEC-071 | 200 · 401 · 404 · 409 · 422 · default |
| API-049 | 환불 계산 미리보기(가게 규칙) | `GET /owner/orders/{orderId}/refund-preview` | `getRefundPreview` | 사장님 | SPEC-016, SPEC-047, SPEC-071 | 200 · 401 · 404 · 422 · default |
| API-050 | 환불 결정 | `POST /owner/orders/{orderId}/refunds` | `decideRefund` | 사장님 | SPEC-047, SPEC-016, SPEC-066, SPEC-064, SPEC-067, SPEC-049, SPEC-071 | 201 · 401 · 404 · 409 · 422 · default |
| API-051 | 날짜별 제작 목록과 그날 픽업 | `GET /owner/production-days/{day}` | `getProductionDay` | 사장님 | SPEC-050, SPEC-054, SPEC-045 | 200 · 401 · 404 · 422 · default |
| API-052 | 맞춤 재료 주문·제작 시작·완성 표시 | `POST /owner/orders/{orderId}/production-marks` | `markProduction` | 사장님 | SPEC-051, SPEC-053, SPEC-066 | 200 · 401 · 404 · 409 · 422 · default |
| API-053 | 표시 실행 취소(5분 이내) | `POST /owner/orders/{orderId}/production-marks/undo` | `undoProductionMark` | 사장님 | SPEC-051 | 200 · 401 · 404 · 409 · 422 · default |
| API-054 | 인도(픽업 완료됨·퀵으로 보냄) | `POST /owner/orders/{orderId}/handover` | `handOverOrder` | 사장님 | SPEC-054, SPEC-055, SPEC-064, SPEC-061 | 200 · 401 · 404 · 409 · 422 · default |
| API-055 | 미수령 표시 | `POST /owner/orders/{orderId}/no-pickup` | `markNoPickup` | 사장님 | SPEC-055, SPEC-064 | 200 · 401 · 404 · 409 · 422 · default |
| API-056 | 미수령 케이크 폐기 | `POST /owner/orders/{orderId}/discard` | `discardOrder` | 사장님 | SPEC-055 | 200 · 401 · 404 · 409 · 422 · default |
| API-057 | 입금 대조 목록 | `GET /owner/payment-requests` | `listPaymentRequests` | 사장님 | SPEC-034, SPEC-033, SPEC-035, SPEC-037 | 200 · 401 · 404 · 422 · default |
| API-058 | 결제 안내 하나 | `GET /owner/payment-requests/{paymentRequestId}` | `getPaymentRequest` | 사장님 | SPEC-034, SPEC-035 | 200 · 401 · 404 · default |
| API-059 | 입금 대조(입금됨·미입금·금액 불일치·대조 완료·들어옴·결제 확인 취소) | `POST /owner/payment-requests/{paymentRequestId}/reconciliation` | `reconcilePaymentRequest` | 사장님 | SPEC-034, SPEC-035, SPEC-036, SPEC-045, SPEC-015, SPEC-064, SPEC-070, SPEC-071 | 200 · 401 · 404 · 409 · 422 · default |
| API-060 | 환불 하나(손님 환불 계좌 포함) | `GET /owner/refunds/{refundId}` | `getRefund` | 사장님 | SPEC-047, SPEC-049, SPEC-021 | 200 · 401 · 404 · default |
| API-061 | 환불 '보냄' 표시 | `POST /owner/refunds/{refundId}/sent` | `markRefundSent` | 사장님 | SPEC-047, SPEC-049, SPEC-066, SPEC-064, SPEC-067 | 200 · 401 · 404 · 409 · 422 · default |
| API-062 | 변경 요청 하나 | `GET /owner/change-requests/{changeRequestId}` | `getChangeRequest` | 사장님 | SPEC-042, SPEC-041, SPEC-043, SPEC-044 | 200 · 401 · 404 · default |
| API-063 | 변경 요청 응답(수락·거절) | `POST /owner/change-requests/{changeRequestId}/decision` | `decideChangeRequest` | 사장님 | SPEC-042, SPEC-043, SPEC-045, SPEC-015, SPEC-032 | 200 · 401 · 404 · 409 · 422 · default |
| API-064 | 문제 신고 하나 | `GET /owner/issue-reports/{issueReportId}` | `getIssueReport` | 사장님 | SPEC-058, SPEC-059, SPEC-057 | 200 · 401 · 404 · default |
| API-065 | 보상 결정(재제작·일부 환불·전액 환불·없음) | `POST /owner/issue-reports/{issueReportId}/compensation` | `decideCompensation` | 사장님 | SPEC-059, SPEC-060, SPEC-047, SPEC-015 | 200 · 401 · 404 · 409 · 422 · default |
| API-066 | 후기와 사진 게시 동의 | `GET /owner/reviews` | `listReviews` | 사장님 | SPEC-062, SPEC-063 | 200 · 401 · 404 · 422 · default |
| API-067 | 포트폴리오와 올릴 수 있는 사진 | `GET /owner/portfolio` | `getPortfolio` | 사장님 | SPEC-063 | 200 · 401 · 404 · default |
| API-068 | 포트폴리오 게시 | `POST /owner/portfolio/items` | `addPortfolioItem` | 사장님 | SPEC-063 | 201 · 200 · 401 · 404 · 409 · 422 · default |
| API-069 | 포트폴리오 게시 취소 | `DELETE /owner/portfolio/items/{portfolioItemId}` | `removePortfolioItem` | 사장님 | SPEC-063 | 200 · 401 · 404 · 409 · 422 · default |
| API-070 | 손님 메시지 수신(카카오 오픈빌더 스킬) | `POST /kakao/skills/message` | `receiveCustomerMessage` | 스킬 키 | SPEC-017, SPEC-018, SPEC-019, SPEC-020, SPEC-021, SPEC-022, SPEC-025, SPEC-026, SPEC-027, SPEC-028, SPEC-033, SPEC-040, SPEC-041, SPEC-046, SPEC-049, SPEC-056, SPEC-057, SPEC-066, SPEC-068, SPEC-069, SPEC-013, SPEC-014, SPEC-016, SPEC-008, SPEC-072 | 200 · 401 · 422 · default |
| API-071 | 손님 확인 카드 버튼(카카오 오픈빌더 스킬) | `POST /kakao/skills/card` | `pressConfirmCard` | 스킬 키 | SPEC-069, SPEC-029, SPEC-030, SPEC-033, SPEC-041, SPEC-046, SPEC-058, SPEC-063, SPEC-015, SPEC-032, SPEC-040, SPEC-072 | 200 · 401 · 422 · default |
| API-072 | 후기 수신(카카오 오픈빌더 스킬) | `POST /kakao/skills/review` | `submitReview` | 스킬 키 | SPEC-062, SPEC-019, SPEC-061, SPEC-008 | 200 · 401 · 422 · default |
| API-073 | 먼저 보내는 안내 보이기(카카오 Event API가 부르는 스킬) | `POST /kakao/skills/event` | `showNotice` | 스킬 키 | SPEC-066, SPEC-008 | 200 · 401 · 422 · default |
| API-074 | 가게 기록 목록(가린 값) | `GET /operator/shops/{shopId}/records` | `listShopRecords` | 운영자 | SPEC-073, SPEC-074 | 200 · 401 · 404 · 422 · default |
| API-075 | 상담 하나(가린 값) | `GET /operator/shops/{shopId}/consultations/{consultationId}` | `getShopConsultation` | 운영자 | SPEC-073, SPEC-074 | 200 · 401 · 404 · 422 · default |
| API-076 | 주문 하나(가린 값) | `GET /operator/shops/{shopId}/orders/{orderId}` | `getShopOrder` | 운영자 | SPEC-073, SPEC-074 | 200 · 401 · 404 · default |
| API-077 | 원래 값·보관 기록 열기(사유) | `POST /operator/shops/{shopId}/originals` | `openOriginal` | 운영자 | SPEC-073, SPEC-074 | 200 · 401 · 404 · 409 · 422 · default |
<!-- END generated:operations -->

## 5. 공통 규칙

- **오류 형식**(DEC-01·02): 모든 오류는 `application/problem+json`의 Problem(`type`·`title`·`status`·`detail`·`instance`·`code`·`traceId`)입니다. 입력 오류는 모두 422 `validation_failed`이고 필드마다 `errors[{field, code}]`로 위치와 사유 코드만 포함합니다. 넣은 값과 서버 안 내용은 포함하지 않습니다. 없는 ID·다른 가게 ID·형식이 틀린 ID는 같은 404이고, 403은 쓰지 않습니다.
- **같은 상태로 가는 명령**(DEC-03): 이미 그 상태면 200과 `outcome: unchanged`, 다른 결정이 먼저 남았으면 409 `already_decided`입니다.
- **요청 키**(DEC-04): 사장님·운영자의 쓰기 명령은 `Idempotency-Key` 헤더를 꼭 보냅니다. 같은 키로 다시 오면 처음 결과와 `Idempotency-Replayed: true`가 갑니다. 로그인·로그아웃·사진 올리기·구글 권한 요청 시작은 받지 않습니다.
- **동시 변경**(DEC-05): 고칠 수 있는 기록은 `revision`을 포함하고, 명령은 화면이 본 `baseRevision`을 보냅니다. 다르면 409 `version_conflict`이고, 화면은 지금 상태를 다시 읽습니다(409에 지금 상태를 포함하지 않음).
- **확인이 필요한 저장**(DEC-06): 409 `confirmation_required`와 `confirm` 목록이 오면 화면이 말을 보이고, 사장님이 확인하면 같은 요청에 `confirm`을 담아 새 요청 키로 다시 보냅니다.
- **카카오 스킬**(DEC-07·08): 처리한 모든 경우에 200과 스킬 응답입니다. HTTP 오류는 스킬 키가 틀림(401)과 스킬 요청 형식이 아님(422)뿐입니다. 키는 가게 연결마다 다르고 사장님 채널 연결 화면에만 보입니다.
- **파일·로그인·목록·형식**(DEC-09·10·11·14·15): 사진은 먼저 올리고 `uploadId`로 씁니다. 사장님 로그인은 카카오 인가 코드를 서버가 바꾸고 토큰은 남기지 않습니다. 목록은 `cursor`·`limit`, 돈은 원 단위 정수, 시각은 가게 시간대 오프셋(+09:00)을 붙입니다.
- **노출**(DEC-19, G6): 성공 응답 스키마는 모두 닫혀 있어(`additionalProperties: false`) 계약 밖 필드가 나가면 계약 테스트가 실패합니다. 손님·공개 응답에는 주문번호 밖의 내부 ID가 없습니다.
- **보관 기록**(SPEC-065, REQ-187, 05단계 4절 A22): 끝나고 30일이 지나 보관 기록이 된 주문과 그 결제 안내·결제·환불·변경 요청·문제 신고는 사장님 API의 목록에 나오지 않고, 하나를 읽거나 명령을 보내면 없는 ID와 같은 404 `not_found`입니다. 손님의 내 주문(API-070)과 AI 도구도 읽지 않습니다. 30일은 잠정입니다(02단계 5-2 질문 7).
- **운영자가 보는 손님 기록**(SPEC-073, REQ-194·195, DEC-19): 운영자 API는 손님 이름(첫 글자 밖은 *), 연락처·계좌번호(끝 4자리 밖은 *), 대화 속 번호(플레이스홀더와 끝 4자리), 알레르기 답(답이 있는지만)처럼 가린 값만 돌려주고 사진은 수만 보입니다. 원래 값과 보관 기록은 운영자가 대상과 사유(5~200자)를 보내는 API-077의 응답에만 하나씩 있습니다. 원래 값을 두지 않는 카드번호·긴 숫자는 409 `original_not_kept`, 지우기 작업이 비운 값은 409 `original_erased`입니다.
- **접속기록**(SPEC-074, REQ-196, 05단계 A24): 손님 개인정보를 돌려주거나 바꾸는 사장님 API(API-040~066)와 운영자의 가게 기록 API(API-074~077)는 응답과 같은 트랜잭션에서 접속기록 한 행을 남기고, 남기지 못하면 500 `internal`로 개인정보를 돌려주지 않습니다. 접속기록에는 값 없이 ID·API 번호·경로만 넣고 쿼리 문자열은 넣지 않습니다. 가게 설정 API·카카오 스킬·서버 안의 일은 남기지 않습니다(10절).
- **계좌번호**(SPEC-006, SPEC-049, REQ-191, 05단계 E20): 가게 계좌와 환불 계좌의 형식(숫자와 '-', 숫자만 10~16자리)은 API가 확인하고, 데이터베이스에는 앱이 암호화한 값과 끝 4자리만 둡니다. 그래서 두 계좌번호 필드에는 `x-corthex-column`을 달지 않습니다.
- **케이스 유형**: API마다 `x-corthex.kinds`에 04단계와 같은 12가지 종류(접근·입력·대상·상태·반복·동시·한도·외부·노출·빈·끊김·화면·AI)별로 그 경우를 보여 주는 응답이나 예시를 적었습니다. 화면 상태는 08단계에서 응답마다 잇습니다.

## 6. 오류 코드

<!-- BEGIN generated:errors -->
| 코드 | 상태 | 뜻 | 화면에 보이는 말 | 화면이 할 일 | 근거 | 쓰는 API |
| --- | --- | --- | --- | --- | --- | --- |
| `validation_failed` | 422 | 입력 필드가 계약의 한도나 형식에 맞지 않음. 필드마다 errors에 위치와 사유 코드 | 입력한 내용을 확인해 주세요 | errors의 필드 옆에 사유를 보이고 넣은 값은 그대로 둠(G7 필드 오류) | G7 | 50개 |
| `idempotency_key_reused` | 422 | 같은 요청 키로 다른 명령이나 다른 내용을 보냄 | 다시 시도해 주세요 | 새 요청 키를 만들어 다시 보냄(화면의 잘못이라 로그에 남김) | G2 | 30개 |
| `consent_required` | 422 | 개인정보 처리 위탁·재위탁 조건에 동의하지 않음. 넣은 값도 남기지 않음 | 개인정보 처리 위탁 조건에 동의해야 가게를 등록할 수 있어요 | 동의 체크박스를 보이고 넣은 값은 화면에만 둠(G7 동의 필요) | SPEC-002 | API-008 |
| `google_authorization_failed` | 422 | 구글 인가 코드가 틀렸거나 지났거나 시트 권한이 빠짐 | 구글 연결을 다시 해 주세요 | 구글 권한 요청을 처음부터 다시 하게 함 | SPEC-009 | API-035 |
| `sheet_not_accessible` | 422 | 고른 구글 시트나 탭을 받은 권한으로 열 수 없음 | 그 시트를 열 수 없어요. 주소와 탭 이름을 확인해 주세요 | 시트 주소 필드 옆에 사유를 보임 | SPEC-009 | API-035 |
| `unauthenticated` | 401 | 로그인(세션 쿠키)이 없거나 만료됨 | 다시 로그인해 주세요 | 로그인으로 보내고 로그인 뒤 원래 화면으로 돌아옴(SPEC-001) | SPEC-001 | 67개 |
| `kakao_login_failed` | 401 | 카카오 인가 코드가 틀렸거나 지났거나 사장님이 동의를 거부함. 우리 쪽 기록은 남기지 않음 | 카카오 로그인을 다시 해 주세요 | 카카오 로그인 버튼을 다시 보임 | SPEC-001 | API-001 |
| `operator_login_failed` | 401 | 운영자 이메일·비밀번호·2단계 인증 번호 가운데 맞지 않는 것이 있음(어느 것인지 알리지 않음) | 로그인 정보가 맞지 않아요 | 입력 필드를 비우고 다시 받음 | SPEC-001 | API-004 |
| `skill_key_invalid` | 401 | 카카오 스킬 요청의 스킬 키 헤더가 없거나 맞지 않음 | (손님에게 보이지 않음) | 오픈빌더 스킬 설정의 헤더 값을 확인(사장님 채널 연결 화면의 안내) | SPEC-008 | API-070, API-071, API-072, API-073 |
| `not_found` | 404 | 경로의 기록이 없거나, 다른 가게 것이거나, ID 형식이 틀림. 셋을 구분하지 않음 | 찾을 수 없어요 | 목록으로 돌아가는 링크를 보임(G7 찾을 수 없음) | G1 | 34개 |
| `shop_not_registered` | 404 | 로그인한 사장님에게 아직 가게가 없음 | 가게를 먼저 등록해 주세요 | 가게 등록 화면으로 보냄 | SPEC-001 | 29개 |
| `not_set` | 404 | 아직 정하지 않은 설정(결제 수단·영업 캘린더·카카오톡 채널·장부) | 아직 정하지 않았어요 | 빈 입력 화면을 보임 | SPEC-006 | 9개 |
| `method_not_allowed` | 405 | 경로는 있지만 그 방법(GET·POST 등)은 계약에 없음. Allow 헤더에 되는 방법을 포함함 | 지원하지 않는 요청이에요 | 화면 코드의 잘못이라 추적 ID와 함께 로그에 남김 | G7 | 계약에 없는 방법으로 호출한 모든 경로(DEC-02) |
| `version_conflict` | 409 | 화면이 본 뒤에 그 기록이 바뀜(baseRevision이 지금과 다름). 아무것도 바꾸지 않음 | 그 사이 바뀌었어요. 지금 상태를 확인해 주세요 | 지금 상태를 다시 읽어(GET) 보이고 다시 고르게 함(G7 이미 바뀜) | G3 | 24개 |
| `invalid_state` | 409 | 지금 상태에서는 할 수 없는 명령(상태 머신 1-1~1-8이 허용하지 않음) | 지금 상태에서는 할 수 없어요 | detail을 보이고 지금 상태를 다시 읽음(G7 그 상태에서는 할 수 없음) | G7 | 13개 |
| `already_decided` | 409 | 다른 결정이 이미 남음(이미 처리됨·이미 답함) | 이미 처리됐어요 | 먼저 남은 결정을 다시 읽어 보임(G7 이미 처리됨) | G3 | 10개 |
| `order_cancelled` | 409 | 그 사이 손님이나 가게가 주문을 취소함 | 그 사이 주문이 취소됐어요 | 주문을 다시 읽어 취소된 상태를 보임 | SPEC-031 | API-046, API-063 |
| `confirmation_required` | 409 | 확인을 받아야 저장하는 일. confirm에 확인할 것 목록. 아무것도 바꾸지 않음 | 저장하기 전에 확인해 주세요 | confirm의 말을 보이고, 사장님이 확인하면 같은 요청에 confirm 값을 담아 새 요청 키로 다시 보냄 | SPEC-005 | 9개 |
| `already_registered` | 409 | 이 카카오 계정에 이미 가게가 있음(계정 하나에 가게 하나, R2) | 이미 등록한 가게가 있어요 | 내 가게 조회(API-009)를 엶 | SPEC-002 | API-008 |
| `channel_setup_incomplete` | 409 | 카드 버튼이 부를 블록 ID 넷 가운데 빈 것이 있어 연결 확인을 시작하지 않음(REQ-179). 아무것도 바꾸지 않음 | 버튼 블록 ID 4개를 모두 넣어 주세요 | 빈 블록 ID 필드를 보이고 채널 연결 입력(API-031)으로 보냄 | SPEC-008 | API-032 |
| `channel_linked_elsewhere` | 409 | 그 오픈빌더 봇이 이미 다른 가게에 연결됨. 묶지 않고 운영자에게 알림 | 이미 다른 가게에 연결된 채널이에요 | 다른 채널을 고르게 하고 우리 서비스 채널로 문의하게 함(G7 이미 다른 가게) | SPEC-008 | API-031 |
| `slot_released` | 409 | 결제 기한이 지나 자리가 풀린 결제 안내라 '입금됨'을 받지 않음(R14) | 자리가 풀린 주문이에요. 먼저 '결제 기한 연장'으로 자리를 다시 잡아 주세요 | 결제 기한 지난 주문의 결제 기한 연장 화면으로 보냄 | SPEC-034 | API-059 |
| `stale_change` | 409 | 이전 버전을 보고 만든 변경이라 반영하지 않음. 변경 요청은 '오래된 버전이라 받지 않음'으로 닫힘 | 그 사이 주문이 바뀌어 이 변경은 반영할 수 없어요 | 변경 요청과 지금 주문 버전을 다시 읽어 보임 | SPEC-045 | API-063 |
| `undo_window_passed` | 409 | 표시한 지 5분이 지나 되돌릴 수 없음 | 5분이 지나 되돌릴 수 없어요 | 제작 기록을 다시 읽어 보임 | SPEC-051 | API-053 |
| `photo_consent_missing` | 409 | 손님이 게시에 동의하지 않았거나 동의를 철회한 사진 | 손님이 게시에 동의한 사진만 올릴 수 있어요 | 그 사진의 동의 상태를 보임 | SPEC-063 | API-068 |
| `payment_account_missing` | 409 | 결제 계좌가 등록되지 않은 가게라 영업 신고 확인됨을 남기지 않음(REQ-197). 보류는 남길 수 있음. 아무것도 바꾸지 않음 | 결제 계좌 등록을 기다리고 있어요. 사장님이 계좌를 등록하면 확인할 수 있어요 | '결제 계좌 등록 기다림'을 보이고 '확인됨'을 막음. 보류는 그대로 고를 수 있음 | SPEC-003 | API-014 |
| `holder_not_verified` | 409 | 영업 신고가 확인된 가게에서 새 예금주가 확인된 대표자·상호나 운영자가 확인한 예금주와 다름(REQ-199). 저장하지 않고 결제 안내의 계좌도 그대로 | 확인된 예금주와 다른 계좌로는 바꿀 수 없어요. 우리 서비스 채널로 문의해 주세요 | 예금주 필드 옆에 사유와 문의 방법을 보이고 넣은 값은 그대로 둠 | SPEC-006 | API-025 |
| `original_not_kept` | 409 | 원래 값을 두지 않는 값(카드번호의 끝 4자리 밖, 주민등록번호처럼 보이는 숫자와 무엇인지 모르는 긴 숫자, REQ-192)이라 열 수 없음. 접속기록에 열기 행을 남기지 않음 | 원래 값을 두지 않아요 | 그 값 옆에 '원래 값을 두지 않아요'를 보이고 열기를 막음 | SPEC-073 | API-077 |
| `original_erased` | 409 | 지우기 작업이 그 값을 이미 비움(끝나고 30일 지난 주문의 주문자 이름·연락처와 환불 계좌, SPEC-065). 접속기록에 열기 행을 남기지 않음. 보관 기록이 된 주문의 주문자 이름은 보관 기록 열기로 봄 | 지워진 값이에요 | 그 값 옆에 '지워졌어요'를 보이고, 보관 기록이 된 주문이면 '보관 기록 열기'를 보임 | SPEC-073 | API-077 |
| `request_in_progress` | 409 | 같은 요청 키의 첫 요청을 아직 처리하는 중 | 처리하고 있어요. 잠시 뒤 다시 확인해 주세요 | 1초 뒤 같은 요청 키로 다시 보냄 | G2 | 30개 |
| `file_too_large` | 413 | 파일이 그 용도의 한도(신고증·도안 10MB, 완성 사진 20MB)를 넘음 | 사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요 | 파일 필드 옆에 한도를 보임 | SPEC-002 | API-007 |
| `rate_limited` | 429 | 같은 곳에서 너무 자주 호출함(예약 링크 페이지 1분 60번, 사장님 로그인 1분 10번) | 잠시 뒤 다시 시도해 주세요 | Retry-After 초 뒤에 다시 호출함 | SPEC-011 | API-001, API-038, API-039 |
| `too_many_attempts` | 429 | 운영자 로그인 실패가 15분에 5번을 넘음 | 잠시 뒤 다시 로그인해 주세요 | Retry-After 초 동안 로그인 버튼을 막음 | SPEC-001 | API-004 |
| `internal` | 500 | 예상하지 못한 서버 오류. 내용은 로그에만(마스킹한 값과 추적 ID) | 문제가 생겼어요. 다시 시도해 주세요 | 다시 시도 버튼과 추적 ID를 보임(G7 서버 실패) | G7 | 77개 |
| `kakao_unavailable` | 503 | 카카오 로그인 서버가 답하지 않음 | 카카오에 연결하지 못했어요. 잠시 뒤 다시 해 주세요 | 다시 시도 버튼 | SPEC-001 | API-001 |
| `google_unavailable` | 503 | 구글 서버가 답하지 않음 | 구글에 연결하지 못했어요. 잠시 뒤 다시 해 주세요 | 다시 시도 버튼 | SPEC-009 | API-035 |
| `storage_unavailable` | 503 | 사진 저장소에 쓰지 못함. 등록·저장 전체를 남기지 않음 | 사진을 저장하지 못했어요. 다시 올려 주세요 | 파일을 다시 고르게 함 | SPEC-002 | API-007, API-008 |
<!-- END generated:errors -->

필드 오류의 사유 코드(`errors[].code`):

<!-- BEGIN generated:field-codes -->
| 사유 코드 | 뜻 |
| --- | --- |
| `required` | 꼭 넣어야 함 |
| `too_short` | 글자 수나 개수가 모자람 |
| `too_long` | 글자 수가 넘침 |
| `bad_format` | 형식이 맞지 않음(전화번호·날짜·주소 등) |
| `not_allowed` | 고를 수 없는 값(예: 첫 버전에서 받지 않는 영업 종류, 받지 않는 파일 종류) |
| `out_of_range` | 숫자가 범위 밖 |
| `too_many` | 개수가 넘침 |
| `duplicate` | 같은 값이 중복됨 |
| `checksum_failed` | 검증 숫자가 맞지 않음(사업자등록번호) |
| `upload_not_found` | 올린 파일이 없거나 1시간이 지남 |
| `upload_wrong_purpose` | 다른 용도로 올린 파일 |
| `conflict` | 다른 행과 충돌함(같은 옵션 조합이 허용이자 금지) |
| `overlaps` | 단계별 환불 기간이 중복됨 |
| `gap` | 단계별 환불 기간 사이가 빔 |
| `exceeds_received` | 환불 금액이 받은 금액에서 이미 정한 환불을 뺀 값을 넘음 |
| `below_calculated` | 보상이 아닌 환불 금액이 환불 계산값보다 낮음(REQ-170) |
| `exceeds_card_limit` | 취소·환불 조문으로 만든 주문 요청 카드의 규정 글이 1,000자 글 둘에 들어가지 않음(REQ-184) |
| `in_past` | 지난 날짜나 시각 |
| `outside_window` | 허용된 시간 밖(08:00~20:50, 60일 안 등) |
| `not_after_start` | 끝이 시작보다 앞섬 |
| `unknown_field` | 계약에 없는 필드 |
| `bad_json` | JSON으로 읽을 수 없음 |
<!-- END generated:field-codes -->

확인할 것(`confirm[].kind`, DEC-06):

<!-- BEGIN generated:confirmations -->
| 확인할 것 | API | 뜻 | 화면에 보이는 말 | 근거 |
| --- | --- | --- | --- | --- |
| `lowered_refund` | API-021 | 제작 전 취소 환불을 전액보다 낮춤(REQ-032) | 제작 전 취소 환불을 전액보다 낮추면 분쟁 때 가게에 불리할 수 있어요(약관법 제8조, 한국소비자원 조정 사례). 그래도 저장할까요? | SPEC-005 |
| `closed_day_with_orders` | API-027, API-029 | 확정 주문이 있는 날을 휴무로 바꿈. 주문과 자리는 그대로 남음(REQ-041) | 이날 확정 주문 {count}건은 그대로 남아요. 휴무로 바꿀까요? | SPEC-007 |
| `overbooking` | API-046, API-047, API-063 | 하루 최대 개수에 닿은 날에 마감 후 추가 수락(R10). 그날은 다른 손님에게 계속 마감 | 그날 남은 자리가 없어요. 추가로 받을까요? | SPEC-031 |
| `not_pickup_day` | API-054 | 픽업 날짜 전에 인도를 기록함 | 오늘이 픽업 날이 아니에요. 그래도 인도를 기록할까요? | SPEC-054 |
| `closed_day` | API-065 | 휴무일을 재제작 픽업 날로 정함 | 휴무일이에요. 이날로 정할까요? | SPEC-060 |
| `holder_mismatch` | API-025 | 예금주가 등록한 상호·대표자와 다름. 사장님 답을 남김 | 예금주가 상호·대표자와 달라요. 가게 명의 계좌가 맞나요? | SPEC-006 |
<!-- END generated:confirmations -->

## 7. 카카오 스킬 결과

손님에게 가는 말은 뼈대이고 08단계에서 다듬습니다. '에스컬레이션 건'은 그 결과가 사장님께 에스컬레이션 건을 남길 때의 이유입니다.

<!-- BEGIN generated:skill-outcomes -->
| 결과 | API | 뜻 | 손님에게 가는 말 | 에스컬레이션 건 | 근거 |
| --- | --- | --- | --- | --- | --- |
| `answered` | API-070 | AI 답이 4초 안에 준비되어 스킬 응답으로 바로 답함 | (AI가 만든 답, 서버 확인을 지남) |  | SPEC-020 |
| `callback_pending` | API-070 | 4초 안에 답이 준비되지 않아 콜백으로 답한다고 응답함. 답은 콜백으로 감 | 답을 준비하고 있어요 |  | SPEC-017 |
| `handed_over` | API-070 | AI가 답하지 않고 사장님께 에스컬레이션함(먹어도 되는지·답할 수 없음·마감된 날·법·의료·손님 요청·다른 사용자·받기 전 문제·조문 없음·빈 답 두 번) | 사장님 확인 뒤 답드릴게요 | AI 출력의 handoff 사유나 서버가 정한 사유 | SPEC-022 |
| `ai_unavailable` | API-070 | AI 모델이 오류를 냄(5xx·연결 실패). 한 번 다시 한 뒤에도 실패해 에스컬레이션함(R7) | 사장님 확인 뒤 답드릴게요 | ai_failure | SPEC-017 |
| `ai_timeout` | API-070 | 콜백 기한(콜백 유효 시간 - 5초)까지 AI 답이 없어 에스컬레이션함. 콜백으로 감 | 사장님 확인 뒤 답드릴게요 | callback_timeout | SPEC-017 |
| `ai_key_missing` | API-070 | 서버에 AI 모델 키가 없거나 거절됨. AI를 호출하지 못해 에스컬레이션함 | 사장님 확인 뒤 답드릴게요 | ai_failure | SPEC-017 |
| `ai_limit_reached` | API-070 | 모델 회사의 사용 한도(429)에 닿아 에스컬레이션함 | 사장님 확인 뒤 답드릴게요 | ai_failure | SPEC-017 |
| `ai_cost_limit_reached` | API-070 | 가게의 하루 AI 비용 한도(REQ-163, 기본 5,000원)에 닿아 AI 없이 에스컬레이션함 | 사장님 확인 뒤 답드릴게요 | ai_cost_limit | SPEC-017 |
| `masking_failed` | API-070 | 번호 마스킹이 실패해 AI를 호출하지 않고 에스컬레이션함 | 사장님 확인 뒤 답드릴게요 | masking_failed | SPEC-021 |
| `ai_output_rejected` | API-070 | AI 답이나 제안이 서버 확인(금액·날짜 판정·확정이라 말함·조문·플레이스홀더·광고·카드 대상)을 지나지 못해 그 부분을 버리고 정해진 문장으로 답함. 버린 제안은 쓰지 않음 | (계산값으로 만든 정해진 문장) |  | SPEC-020 |
| `card_shown` | API-070 | 서버가 저장된 값으로 확인 카드(주문 요청·입금 알리기·변경 요청·취소·신고·동의 철회)를 보임. 주문 요청 카드는 그 버전의 취소·환불 규정 글(하나나 둘)을 먼저, 요약 카드를 끝에 둠(SPEC-028, DEC-22) | (주문 요청 카드: 규정 글과 청약철회 제한 문장, 요약과 버튼) |  | SPEC-069 |
| `photo_received` | API-070 | 참고·신고 사진을 받아 초안이나 신고 내용에 붙임. AI 모델로 보내지 않음 | 사진을 받았어요 |  | SPEC-019 |
| `photo_rejected` | API-070 | 사진 한도(상담마다 10장, 장당 20MB)를 넘었거나 사진이 아닌 파일 | 사진은 한 장 20MB, 한 상담에 10장까지 받을 수 있어요 |  | SPEC-019 |
| `unsupported_message` | API-070 | 음성·파일·이모티콘만 온 메시지 | 글이나 사진으로 말씀해 주세요 |  | SPEC-017 |
| `rate_limited` | API-070 | 한 손님이 1분에 20개를 넘게 보냄. 기록만 하고 AI를 호출하지 않음. 그 1분 안 첫 번째에만 이 말 | 잠시 뒤 다시 말씀해 주세요 |  | SPEC-017 |
| `duplicate` | API-070, API-072 | 같은 카카오 요청이 다시 옴. 처음 결과를 다시 보내고 기록·AI 호출·명령을 다시 하지 않음(REQ-132) | (처음 결과와 같은 말) |  | SPEC-017 |
| `not_accepting` | API-070, API-071, API-072 | 연결되지 않은 채널이거나 예약 링크를 내기 전 가게. 상담을 열지 않음 | 아직 상담을 받지 않아요. 가게로 연락해 주세요: {가게 연락처} |  | SPEC-017 |
| `channel_test_card` | API-070 | 연결 확인 중인 채널의 테스트 메시지를 받아 그 사용자를 시험 사용자로 남기고 첫 시험 버튼(그 가게가 넣은 블록 ID)을 보임(REQ-179) | 테스트 메시지를 받았어요. 시험 버튼 4개를 하나씩 눌러 주세요 |  | SPEC-008 |
| `server_error` | API-070, API-071, API-072 | 스킬을 처리하다 서버 오류가 남. 손님에게 오류 내용을 보이지 않음(G6), 로그에는 추적 ID | 잠시 뒤 다시 말씀해 주세요 |  | SPEC-017 |
| `orderer_saved` | API-071 | 주문자 정보 블록의 이름·연락처가 형식에 맞아 초안에 남기고 주문 요청 카드(규정 글을 먼저, DEC-22)를 보냄. 이 값은 AI로 보내지 않음(REQ-175, REQ-178) | (주문 요청 확인 카드: 규정 글, 요약에 주문자 이름·연락처) |  | SPEC-072 |
| `order_requested` | API-071 | 주문 요청을 한 트랜잭션으로 남김. 기본 디자인이면 자리와 결제 안내까지 | 주문을 요청했어요(주문번호 {orderNo}). 결제가 확인되면 확정돼요 |  | SPEC-029 |
| `payment_claimed` | API-071 | 결제 안내를 '확인 요청됨'으로 두고 사장님께 결제 확인을 요청함 | 사장님께 알렸어요. 확인되면 알려 드릴게요 |  | SPEC-033 |
| `change_requested` | API-071 | 변경 요청을 남기고 사장님께 알림 | 변경을 요청했어요. 사장님이 보고 알려 드려요 |  | SPEC-041 |
| `order_cancelled` | API-071 | 주문을 '손님이 취소함'으로 두고 자리를 풂. 확인된 결제가 있으면 사장님께 환불 정할 일 | 주문을 취소했어요. 환불은 사장님이 정한 뒤 알려 드려요 |  | SPEC-046 |
| `issue_reported` | API-071 | 문제 신고를 남기고 사장님께 알림(기한 뒤면 '기한 뒤'로) | 신고를 받았어요. 사장님이 보시고 정하실 거예요 |  | SPEC-058 |
| `consent_withdrawn` | API-071 | 사진 게시 동의를 철회하고 그 사진을 포트폴리오와 예약 링크 페이지에서 내림(5분 이내) | 사진 게시 동의를 철회했어요. 곧 사진이 내려가요 |  | SPEC-063 |
| `declined` | API-071 | 손님이 카드의 '안 할래요'를 누름. 아무것도 남기지 않음 | 알겠어요. 더 궁금한 것이 있으면 말씀해 주세요 |  | SPEC-069 |
| `input_invalid` | API-071 | 주문자 정보·입금자 이름 블록의 값이 형식에 맞지 않음(이름 1~30자, 연락처 숫자와 '-' 8~14자). 아무것도 남기지 않고 같은 블록 버튼으로 다시 물음(SPEC-033, SPEC-072) | 이름은 1~30자, 연락처는 숫자와 '-'로 8~14자로 넣어 주세요 |  | SPEC-072 |
| `card_stale` | API-071 | 카드에 묶인 버전(초안 고친 번호·주문 버전·환불 금액)이 지금과 달라 거절하고 새 카드를 보임(G9). 쓴 것 없음 | 내용이 바뀌었어요. 새 카드를 확인해 주세요 |  | SPEC-069 |
| `card_expired` | API-071 | 카드의 30분 기한이 지나 거절하고 새 카드를 보임(G9). 쓴 것 없음 | 시간이 지나 새 카드를 보내 드려요 |  | SPEC-069 |
| `card_not_yours` | API-071 | 카드를 받은 사용자가 아닌 사람이 누름(A7). 쓴 것 없음 | 이 버튼은 카드를 받은 분만 누를 수 있어요 |  | SPEC-069 |
| `card_used` | API-071 | 이미 누른 카드를 다시 누름. 처음 결과를 다시 보냄(G2) | (처음 결과와 같은 말) |  | SPEC-069 |
| `day_full` | API-071 | 기본 디자인 주문의 자리를 같은 트랜잭션에서 잡지 못해 주문 요청도 남기지 않음(R11). 가까운 날 최대 3개 | 그 사이 그날이 다 찼어요. 이날은 어떠세요? |  | SPEC-029 |
| `retry_needed` | API-071 | 한 트랜잭션의 쓰기 가운데 하나가 실패해 하나도 남기지 않음(REQ-054) | 다시 눌러 주세요 |  | SPEC-029 |
| `not_allowed_now` | API-071 | 지금 상태에서는 그 명령을 받지 않음(열린 결제 안내 없음, 받은 주문의 취소, 결제 전 주문의 변경 등). 지금 상태를 알림 | 지금은 할 수 없어요: {지금 상태} |  | SPEC-033 |
| `block_verified` | API-071, API-072 | 연결 확인 중에 시험 사용자가 누른 시험 버튼이 우리 스킬에 닿아 그 블록을 확인됨으로 남기고 다음 시험 버튼을 보임. 주문·카드·후기는 남기지 않음(REQ-179) | {블록} 블록이 닿았어요({n}/4). 다음 시험 버튼을 눌러 주세요 |  | SPEC-008 |
| `channel_linked` | API-071, API-072 | 시험 버튼으로 버튼 블록 넷이 모두 닿아 채널을 가게에 묶음. 이어서 시험 사용자에게 시험 안내를 Event API로 한 번 보냄(REQ-179, REQ-180) | 버튼 블록 4개가 모두 닿아 연결됐어요. 곧 이 채널로 시험 안내를 하나 보내 드려요 |  | SPEC-008 |
| `review_saved` | API-072 | 받은 주문의 후기와 사진, 사진마다 게시 동의(기본 동의 안 함)를 남김 | 후기를 남겨 주셔서 고마워요 |  | SPEC-062 |
| `review_not_allowed` | API-072 | 받은 주문이 아니거나 그 주문을 요청한 사용자가 아님. 남기지 않음 | 받으신 주문에만 후기를 남길 수 있어요 |  | SPEC-062 |
| `review_invalid` | API-072 | 후기 글이 1~1,000자 밖이거나 사진이 5장을 넘음 | 후기는 1,000자, 사진은 5장까지 남길 수 있어요 |  | SPEC-062 |
| `photo_download_failed` | API-072 | 카카오 사진 주소에서 한 번 다시 받아도 실패함 | 사진을 받지 못했어요. 다시 보내 주세요 |  | SPEC-019 |
| `notice_shown` | API-073 | Event API가 넘긴 안내 키로 저장된 안내의 글과 버튼을 보임(템플릿, AI 없음, 광고 없음) | (그 안내의 글: 확정 안내, 결제 결과·변경 결과·취소·환불·전날·후기 부탁 안내 등) |  | SPEC-066 |
| `notice_test` | API-073 | 채널을 연결한 뒤 시험 사용자에게 보낸 시험 안내를 보임. 발송 결과로 먼저 보내기 됨·안 됨을 정함(REQ-180) | 시험 안내예요. 이 안내가 보이면 손님에게 안내를 먼저 보낼 수 있어요 |  | SPEC-008 |
| `notice_gone` | API-073 | 안내 키가 없거나 그 가게 것이 아님. 짧은 글만 보임 | 지금은 전할 안내가 없어요 |  | SPEC-066 |
<!-- END generated:skill-outcomes -->

## 8. 결정 사항

계약서가 정하라고 한 경계(입력 오류는 400인지 422인지, 같은 상태로 가는 명령은 성공인지 등)와 이 계약에서 선택한 것입니다. 처음에는 계약서와 앞 단계 기록에 기대어 Claude가 골라 추천했고, 그 가운데 3개(DEC-12·13·18)는 제품 동작이 달라져 따로 확인 요청했습니다. 2026-11-12 14:01 체크포인트에서 동희님이 19개 모두 추천대로 확정하셨습니다(14절). '상태' 열이 그 기록입니다.

<!-- BEGIN generated:decisions -->
| ID | 결정 사항 | 선택안 | 사유 | 대안 | 상태 |
| --- | --- | --- | --- | --- | --- |
| DEC-01 | 입력 오류는 모두 422 | 입력 필드가 맞지 않으면 모든 API가 422 `validation_failed`를 반환함. 400은 쓰지 않음. 필드마다 `errors[{field, code}]`로 위치와 사유 코드만 포함하고 넣은 값은 되돌려 보내지 않음. JSON으로 읽을 수 없는 본문은 field `/`·code `bad_json`, 받지 않는 Content-Type은 field `header:Content-Type`·code `not_allowed`, 글자 필드의 NUL 문자는 `bad_format`으로 같은 422 | G7의 '필드 오류(필드마다 이유)'를 한 형식으로. 계약서가 400·422 가운데 하나를 고르라 함 | 400: JSON 형식 오류와 값 오류를 나눌 수 있지만 화면이 두 분기를 다뤄야 함 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-02 | 없는 ID·다른 가게 ID·형식이 틀린 ID는 같은 404 | 경로의 ID가 없거나, 다른 가게 것이거나, 형식이 틀리면(100자를 넘는 것 포함) 모두 404 `not_found`, 같은 본문. 계약에 없는 경로도 같은 404. 경로는 있지만 방법이 없으면 405 `method_not_allowed`와 `Allow` 헤더. 403은 쓰지 않음(역할마다 세션 쿠키와 경로가 나뉨) | G1: 다른 가게 기록이 있는지조차 알리지 않음. SPEC-068 수락 기준 | 형식이 틀린 ID는 422: 화면 개발에는 친절하지만 G1의 '구분하지 않음'과 어긋남 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-03 | 같은 상태로 가는 명령은 성공, 다른 결정이 있으면 409 | 이미 그 상태인 명령(이미 마감된 날 마감, 확인된 가게 확인, 같은 '입금됨')은 200과 `outcome: unchanged`, 아무것도 바꾸지 않음. 다른 결정이 먼저 남았으면 409 `already_decided` | 상태 머신 1-2의 '같은 상태로 가는 명령은 지금 상태를 반환함'과 G3의 '먼저 온 쓰기가 이김' | 같은 상태도 409: 두 번 누른 사장님께 오류가 보임 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-04 | 사장님·운영자 명령은 요청 키를 꼭 가짐 | 사장님·운영자의 쓰기 명령은 `Idempotency-Key` 헤더(16~64자, 영문·숫자·`_`·`-`)가 꼭 있어야 하고, 빼면 422 `validation_failed`(header:Idempotency-Key, required). 같은 키가 다시 오면 처음 결과를 그대로 반환하고 `Idempotency-Replayed: true`를 붙임. 같은 키에 다른 내용은 422 `idempotency_key_reused`, 첫 요청을 처리하는 중이면 409 `request_in_progress`. 로그인·로그아웃, 사진 올리기(다시 해도 새 uploadId가 하나 더 생길 뿐), 구글 권한 요청 시작(기록을 바꾸지 않음)은 받지 않음. 카카오 스킬은 카카오 요청으로 만든 키(OPEN-1)와 카드 키를 씀 | G2(화면 버튼은 화면이 만든 키)와 TBL-050 request_keys | 키 없이 버전 비교만: 네트워크가 끊겨 다시 보낸 요청이 두 번 남을 수 있음 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-05 | 동시 변경은 revision 비교 | 고칠 수 있는 기록은 응답에 `revision`(서버가 만든 값)을 포함하고, 명령은 `baseRevision`을 보냄. 다르면 409 `version_conflict`이고 아무것도 바꾸지 않음. 409에는 지금 상태를 포함하지 않고 화면이 다시 읽음(GET). 처음 저장(가격표·운영규정·결제 수단·영업 캘린더·채널·장부)은 `baseRevision: null`. 주문·변경 요청의 revision은 쓸 때마다 하나 오르는 잠금 번호(05단계 `lock_version`, 4절 A6·5절 E15)로 만들고, 결제 안내는 `payment_requests.version`으로 만듦(2026-11-13 설계 재검토 H12) | G3(먼저 온 쓰기가 이기고 뒤는 '이미 바뀜'). 주문 내용 버전(`version`)은 상태만 바꾸는 쓰기(결제 확인·취소·받음)에서 오르지 않아 같은 버전을 읽은 결제 확인과 손님 취소가 둘 다 통과했음(RC-01). 그래서 revision은 쓸 때마다 바뀌는 값으로 둠. 오류 응답을 Problem 한 형식으로 두고, 지금 상태는 늘 같은 읽기 API에서 옴. 버전이 없는 기록(상태만 있는 결제 기한 결정 등)도 같은 방법으로 | If-Match 헤더: HTTP 표준이지만 어긋남이 412라 계약서의 409와 다르고, 목록의 행마다 값을 포함할 곳이 없음 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-06 | 확인이 필요한 저장은 409 confirmation_required | 제작 전 취소 환불 낮춤·확정 주문이 있는 날 휴무·마감 후 추가 수락·픽업 날이 아닌 인도·휴무일 재제작·예금주 다름은 아무것도 바꾸지 않고 409 `confirmation_required`와 `confirm` 목록을 반환함. 화면이 말을 보이고, 사장님이 확인하면 같은 요청에 `confirm` 값을 담아 다시 보냄 | SPEC-005·007·031·038·054·060·006의 '먼저 보이고 확인받음'을 한 형식으로 | 화면이 미리 계산해 묻기: 그 사이 상태가 바뀌면 확인 없이 저장될 수 있음 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-07 | 카카오 스킬은 늘 200과 스킬 응답 | 카카오 스킬 API는 서버가 처리한 모든 경우에 200과 스킬 응답을 반환하고, 결과는 `Siljang-Outcome` 헤더와 이름 붙은 예시로 구분함. HTTP 오류는 스킬 키가 틀림(401)과 스킬 요청 형식이 아님(422)뿐. AI 실패·느림·키 없음·사용 한도·가게 비용 한도는 모두 에스컬레이션 응답(R7) | G6(손님에게 오류 내용을 보이지 않음). 200이 아니면 카카오가 손님에게 자기 오류 말을 보임 | AI 실패를 503으로: HTTP 쪽은 깔끔하지만 손님은 카카오 오류 말만 봄 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-08 | 카카오 스킬 인증은 오픈빌더 헤더 값 | 오픈빌더 스킬 설정의 헤더 값(공식 문서 2026-11-12 확인: '헤더값 입력, 테스트 헤더값 입력')에 가게 연결마다 다른 스킬 키를 넣음. 헤더 이름 `Siljang-Skill-Key`. 키는 서버 시크릿과 연결 ID로 만들어 DB에 두지 않음(REQ-135) | 문서에 요청 서명·IP 목록이 없음. 봇 ID만으로는 남이 요청을 꾸밀 수 있음 | 주소에 비밀 경로: 로그와 오픈빌더 화면에 그대로 보임 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-09 | 파일은 먼저 올리고 ID로 씀 | 신고증·도안·완성 사진은 `POST /owner/uploads`로 먼저 올리고(용도별 한도), 명령에는 `uploadId`만 씀(1시간 안). 응답의 사진은 15분 사는 서명 주소로만 보이고 저장 위치는 보이지 않음 | 명령을 JSON 하나로 두고 사진 실패를 명령 전에 알림(SPEC-002 '사진 저장이 실패하면 등록 전체를 남기지 않음') | 명령마다 multipart: 필드 오류와 파일 오류가 섞임 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-10 | 사장님 로그인은 인가 코드를 서버가 바꿈 | 화면이 카카오 로그인으로 받은 인가 코드를 `POST /owner/session`으로 보내면 서버가 토큰으로 바꿔 카카오 회원번호만 남기고 토큰은 버림. 세션은 HttpOnly·Secure 쿠키. 운영자는 이메일·비밀번호·6자리 번호로 `POST /operator/session` | SPEC-001(카카오 토큰을 남기지 않음), R2. 쿠키라 화면 코드가 세션 값을 만지지 않음 | 토큰을 화면에 줌: 화면 저장소가 털리면 세션도 털림 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-11 | 운영자 아닌 사람에게 운영자 API는 401 | 운영자 API는 운영자 세션이 없으면 401. SPEC-001의 '운영자 화면은 운영자 계정이 아니면 찾을 수 없음'은 운영자 기록을 0건 보인다는 뜻으로 읽고, 그 화면 디자인은 08단계에서 정함 | 사장님 세션과 운영자 세션은 다른 쿠키라 섞이지 않음. 계약서가 로그인이 필요한 API에 401을 요구함 | 세션이 없으면 404: 운영자 주소를 숨기지만 운영자도 세션이 만료되면 '찾을 수 없음'을 봄 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-12 | 예약 링크 조건에 '결제 수단'을 더함 | 가격표·운영규정·영업 캘린더·영업 신고 확인·채널 연결에 더해 결제 수단(가게 계좌)이 있어야 예약 링크를 냄. `GET /owner/booking-link`의 `missing`에 `payment_destination`. 요구사항 버전 4 REQ-164로 더함 | 결제 안내는 가게 계좌를 꼭 참조함(TBL-031 payment_account_id NOT NULL, E6). 계좌 없이 링크가 나가면 기본 디자인 주문 요청이 한 트랜잭션을 마칠 수 없음. 03단계 FL-001 기본 경로도 링크 전에 계좌를 등록함 | REQ-105 글자대로(조건 다섯): 계좌가 없는 가게의 주문 요청이 실패함 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-13 | 픽업 장소는 예약 링크를 막지 않음 | 픽업 장소(E14)가 비어도 예약 링크를 냄. `GET /owner/booking-link`의 `recommended`에 `pickup_address`로 보이고, 비었으면 전날 안내에서 위치 문구를 빼고 가게 연락처만 포함함 | 05단계 E14가 06단계로 전달한 질문. 조건을 늘리지 않고 사장님께 알림 | 픽업 장소도 조건으로: 전날 안내가 늘 위치를 포함하지만 SPEC-010이 바뀜 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-14 | 목록은 커서 방식 | 목록은 `cursor`와 `limit`(1~100, 기본 20)로 나눠 받고 `nextCursor`가 없으면 끝 | 할 일·주문이 쌓여도 같은 속도. 행이 끼어도 중복되거나 빠지지 않음 | 쪽 번호: 화면은 쉽지만 새 행이 생기면 중복됨 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-15 | 돈·시각·날짜의 형식 | 돈은 원 단위 정수. 시각은 가게 시간대 오프셋을 붙인 RFC 3339(예: 2026-11-20T14:00:00+09:00), 날짜는 가게 시간대의 YYYY-MM-DD(G8) | DB와 같음(돈 integer, 시각 timestamptz, 자리 날짜 date) | UTC로만: 화면이 늘 바꿔야 함 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-16 | 요청 빈도 한도 | 예약 링크 페이지는 같은 주소에서 1분 60번(SPEC-011), 사장님 로그인은 1분 10번, 운영자 로그인 실패는 15분 5번을 넘으면 429와 `Retry-After`. 손님 메시지의 1분 20번(SPEC-017)은 스킬 응답 `rate_limited` | SPEC-011의 긁어 가기 막기와 로그인 무차별 대입 막기 | 한도 없음: 첫 버전 가게 1~3곳이라 버틸 수 있지만 운영자 계정이 위험 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-17 | AI-1 출력 스키마를 이 계약에 확정함 | AI-1이 '06단계에서 확정'으로 전달한 출력 스키마를 `components.schemas.AiTurnOutput`으로 둠(HTTP로 오가지 않는 서버 안 구조화 출력). SPEC-049의 환불 계좌를 받는 필드 `refund_account_patch`를 더함 | AI-1 출력 목록에 환불 계좌 필드가 없어 SPEC-049를 할 수 없었음 | 환불 계좌는 사장님이 상담을 보고 손으로 넣음: AI 필드는 줄지만 사장님 일이 늘어남 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-18 | 후기는 카카오 '후기' 블록의 스킬로 받음 | 후기는 후기 부탁 안내의 버튼이 여는 오픈빌더 블록이 `POST /kakao/skills/review`로 보냄(글, 보안 이미지 플러그인 사진 5장까지, 게시 동의). 게시 동의는 후기 하나에 한 번 묻고 그 답을 사진마다 남김(기본 동의 안 함) | AI-1이 후기를 다루지 않음(SPEC-062는 AI 없음). 카카오 대화에서 사진마다 따로 묻기는 번거로움 | 사진마다 묻기: SPEC-062 글자 그대로지만 손님 단계가 사진 수만큼 늘어남 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-19 | 응답에 포함하는 것 | 손님·공개 응답에는 주문번호 밖의 ID(uuid)를 포함하지 않음. 사장님·운영자 응답은 uuid ID를 씀. 마스킹 원본 값은 에스컬레이션 건·상담 대화·환불 화면에만, 계좌는 결제 수단과 환불 화면에만. 운영자 응답에는 가린 값(이름은 첫 글자, 번호는 끝 4자리)만 두고, 원래 값은 운영자가 사유를 적은 원래 값 열기(API-077)의 응답에만 하나씩 둠. 원래 값을 두지 않는 카드번호·긴 숫자는 사장님 화면에도 플레이스홀더와 끝 4자리만(2026-11-13 설계 재검토 H4) | G6, REQ-193, REQ-194, REQ-195, R19 | 모든 응답에 같은 형식: 손님 응답에 내부 ID가 섞일 수 있음 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-20 | 손님 안내는 가게 봇의 Event API를 우리 앱 키와 우리 월렛으로 | 가게 채널을 우리 카카오 디벨로퍼스 앱(비즈니스 인증, 카카오 로그인 활성화)에 연결하고, 가게 봇마다 우리 월렛 하나를 연결함(월렛은 '연결대기'일 때 봇 하나에만 연결됨). 우리 서버가 우리 앱의 REST API 키로 `POST https://bot-api.kakao.com/v2/bots/{botId}/talk`(이벤트 이름 `siljang_notice`, 받는 사람은 손님의 봇 사용자 키, params에는 안내 키만)를 부르고, 가게 봇의 '안내' 블록이 안내 스킬(API-073)을 불러 우리 기록의 글과 버튼을 보임. 카카오가 요청을 받으면(taskId) '확인 중'으로 두고 `GET https://bot-api.kakao.com/v1/tasks/{taskId}`로 1분·5분·30분 뒤 발송 결과를 조회해 닿았을 때만 '보냄'. 메시지 비용(닿은 건당 15원, 부가세 별도)은 우리가 내고 요금에 넣음. 연결한 뒤 시험 안내를 한 번 보내 먼저 보내기 됨·안 됨을 가게마다 남기고, 안 되는 가게의 손님 안내는 다음 대화 때 전함. 안내 스킬이 안내를 만들지 못하면 200 대신 500을 반환해 카카오가 보내지 않게 함(DEC-07의 예외) | 가게마다 앱과 월렛을 만들게 하면 사장님 일이 크게 늘고 우리가 가게의 키를 맡아야 함(RD-01, RA-10). Event API는 채널 친구에게만 가고 요청 성공은 받았다는 뜻일 뿐이라 결과 조회로만 닿았는지 앎(카카오 비즈니스 도움말 Event API, 2026-11-13 다시 읽음) | 가게마다 자기 앱·월렛: 비용은 가게가 내지만 등록이 어렵고 가게의 키를 맡아야 함. 먼저 보내기 없이 다음 대화 때만 전함: 확정 안내와 결제 결과가 늦게 감(먼저 보내기가 안 되는 가게와 OPEN-9가 안 될 때의 대안으로 남김) | 확정(2026-11-13 20:59 동희님 결정 카드 '추천안대로 (추천)', 설계 재검토 H7) |
| DEC-21 | 사장님 알림은 우리 서비스 채널 봇이 카카오 로그인 사용자 번호로 | 우리 서비스 채널(우리 앱에 연결)의 봇이 Event API로 사장님의 카카오 로그인 사용자 번호(appUserId, 05단계 `owners.kakao_account_id`)에 할 일 종류와 목록 주소를 보냄. 우리 봇의 알림 블록은 이벤트 data의 글을 그대로 보여 스킬이 없음. 친구인지는 카카오 로그인 때 채널 추가 상태 동의(`plusfriends`)와 채널 관계 조회(`GET https://kapi.kakao.com/v2/api/talk/channels`)로 보고, 친구가 아니라고 남은 동안 사장님 화면을 열면 마지막으로 본 지 1분이 지났을 때 우리 앱의 Admin 키로 다시 조회함(API-001, API-002). 발송 결과가 '채널 친구 아님'(101)이면 친구 아님으로 고침. 05단계 `alert_user_key`를 지움(E17) | 우리 채널의 사용자 키를 알 길이 없어 사장님 알림이 하나도 가지 못했음(RD-10). appUserId는 로그인 때 이미 받는 값이고 앱에 연결한 채널의 봇은 appUserId로 보낼 수 있음(앱이 연결되지 않으면 errorType 302) | 사장님이 우리 채널에 코드를 보내 사용자 키를 이음: 할 일과 스킬 API가 늘어남. 채널 추가·차단 웹훅으로 친구 여부를 받음: 받는 API가 하나 더 필요해 첫 버전은 조회와 발송 결과로 | 확정(2026-11-13 20:59 동희님 결정 카드 '추천안대로 (추천)', 설계 재검토 H7) |
| DEC-22 | 주문 요청 카드는 규정 글과 요약 카드를 나눠 보냄 | 주문 요청 확인 카드(API-070 card_shown, API-071 orderer_saved·card_stale·card_expired)는 한 응답의 출력으로 그 버전의 취소·환불 규정 글(simpleText 하나나 둘)을 먼저, 요약 카드(textCard: 요약과 사진 게시 동의 '동의 안 함', 버튼 셋)를 끝에 둠. 규정 글은 '취소·환불 규정(운영규정 버전 N)' 줄, 취소·환불 조문마다 '· 제목: 조건 → 효과' 한 줄, 끝에 '주문제작이라 청약철회가 제한될 수 있어요'. 1,000자를 넘으면 조문 사이에서 나눠 첫 줄 끝에 1/2·2/2를 붙이고 청약철회 문장은 둘째 글 끝에 둠. 자르지 않고, 글 둘에 들어가지 않는 운영규정은 저장 때 422 `exceeds_card_limit`(API-021) | 카드 설명은 400자라 규정을 다 담지 못하고 손님이 잘린 규정에 동의하게 됨(RD-03). 카카오 응답의 출력은 3개까지라 글 둘과 카드 하나가 한도(카카오 응답 형식 문서) | 규정은 링크로: 카카오 안에서 동의할 글이 보이지 않음. 규정을 줄여 카드에 넣음: 동의한 글이 저장된 버전과 달라짐 | 확정(2026-11-13 20:59 동희님 결정 카드 '추천안대로 (추천)', 설계 재검토 H9) |
<!-- END generated:decisions -->

따로 확인 요청한 3개(모두 추천대로 정하심):

- **DEC-12 예약 링크 조건에 '결제 수단'을 더함.** REQ-105는 조건을 다섯(가격표·운영규정·영업 캘린더·영업 신고 확인·채널 연결)으로 적었지만, 결제 안내는 가게 계좌를 꼭 참조해서(05단계 TBL-031) 계좌 없이 링크가 나가면 기본 디자인 주문 요청이 마지막에 실패합니다. 대안은 REQ-105 글자대로 두고 계좌가 없을 때 주문 요청을 막는 것이었습니다. 이 조건은 요구사항 버전 4 REQ-164(결제 수단이 없는 동안 예약 링크를 내지 않음)로 더했고, 기능 명세 SPEC-010에도 이었습니다.
- **DEC-13 픽업 장소는 예약 링크를 막지 않음.** 05단계 E14가 전달한 질문입니다. 비어 있으면 '넣으면 좋은 것'으로만 알리고 전날 안내에서 위치 문구를 뺍니다. 대안은 픽업 장소도 링크 조건으로 넣는 것이었습니다.
- **DEC-18 후기는 카카오 '후기' 블록의 스킬로 받고, 사진 게시 동의는 후기 하나에 한 번 물음.** SPEC-062는 사진마다 묻는다고 읽힐 수 있습니다. 카카오 대화에서 사진마다 따로 묻는 길도 있지만 손님 단계가 사진 수만큼 늘어납니다.

## 9. 열린 질문

계약 안에서는 그 API나 스키마 설명의 `Open:` 문장으로 적었습니다. 모두 개발 전에 실제 요청이나 테스트로 닫습니다.

<!-- BEGIN generated:open -->
| ID | 자리 | 내용 |
| --- | --- | --- |
| OPEN-1 | API-070 | 카카오 메시지 ID: 스킬 요청 문서(2026-11-12 확인)에 요청·메시지 ID가 없음. 같은 요청 거르기 키는 실제 요청에 쓸 ID가 있으면 그것, 없으면 (봇 ID, 사용자 키, 블록 ID, 발화, 받은 시각을 2초로 내린 값)의 해시로 둠. 카카오가 같은 요청을 다시 보내는지와 함께 개발 전 실제 요청으로 확인 |
| OPEN-2 | API-070 | 콜백 유효 시간: 콜백 문서 본문은 5분, 같은 문서의 오류 표는 '1분 이내'라 어긋남. AI-1 전체 기한(유효 시간 - 5초)은 개발 전 테스트로 정함 |
| OPEN-3 | API-070 | 사진 메시지가 스킬 요청에 어떻게 오는지(발화에 주소인지, params인지) 문서에 없음. 개발 전 실제 요청으로 확인. 보안 이미지 플러그인(문서 확인)은 후기·신고 사진에 쓸 수 있음 |
| OPEN-4 | API-070 | 빈 응답(답을 보내지 않기)이 되는지 문서에 없음. 될 때까지 같은 메시지 반복과 한도 넘은 메시지에는 정해진 짧은 말을 다시 보냄 |
| OPEN-5 | API-001, API-004 | 세션 길이: 사장님 30일(쓰면 늘어남), 운영자 12시간을 첫 값으로 제안. 개발 전에 정함 |
| OPEN-6 | API-004 | 운영자 인증 서비스(비밀번호·2단계 인증 키를 맡길 곳)는 개발 전에 고름. 고른 서비스가 자기 로그인 화면을 쓰면 이 API를 그 플로우로 바꿈(운영자 화면만 씀) |
| OPEN-7 | components.schemas.AiTurnOutput | AI 모델 회사·모델은 개발 전(10단계 전)에 고름. 고르는 날 그 회사의 지금 약관·데이터 방침을 확인하고 처리방침의 국외 이전 항목을 채움(AI-1) |
| OPEN-8 | API-031 | 사장님이 오픈빌더 봇 ID를 찾는 곳(봇 설정 화면이나 주소)을 07·08단계 연결 안내에서 정함. 봇 ID 형식은 첫 테스트 메시지에서 확인 |
| OPEN-9 | API-032, API-073 | 먼저 보내기에 가게가 우리에게 줄 권한과 절차: 가게 채널을 우리 카카오 디벨로퍼스 앱에 연결하는 방법(채널은 가게가, 앱은 우리가 가짐), 우리 서비스 계정이 월렛 작업 권한이 있는 봇 작업자로 초대받아 우리 월렛을 가게 봇에 연결할 수 있는지, 다른 사람 채널의 봇에 우리 앱 키로 Event API를 보낼 수 있는지, 이벤트로 부른 스킬 요청의 모양(utterance, userRequest.params). 10단계 WBS의 선행 일로 개발 전에 시험 채널로 확인하고, 안 되면 먼저 보내기 없이 '다음 대화 때 전함'으로만 시작(REQ-181, 02단계 1-3 가정) |
<!-- END generated:open -->

## 10. 서버 안의 일

호출하는 API 없이 정해진 시각이나 이벤트로 서버가 하는 일입니다. 그 결과가 계약의 어느 응답에 보이는지 적었습니다.

<!-- BEGIN generated:jobs -->
| SPEC | 서버가 하는 일 | 계약에서 보이는 곳 |
| --- | --- | --- |
| SPEC-024 | 사장님 답 기다림 타이머: 기다리는 시간이 지나면 지연 안내 한 번과 다시 알림 한 번(답하는 시간 안에서만 셈) | API-040(할 일의 waitStatus), API-042(답하면 멈춤), API-010(기다리는 시간 설정) |
| SPEC-025 | 문의 끊김과 상담 끝남: 마지막 손님 메시지 뒤 가게가 정한 시간이 지나면 상담을 닫음. 다룬 주문이 없으면 문의 끊김(다시 말하면 이어감), 다룬 주문이 모두 끝났으면 상담 끝남(다음 말은 새 상담, REQ-189) | API-070(이어가기, 새 상담의 AI 상담 고지), API-010(끊김 시간 설정), API-043(status dropped·ended) |
| SPEC-037 | 결제 기한 처리: 기한이 지난 결제 안내의 자리를 풀고 사장님께 고를 일을 남김 | API-040(할 일), API-044(status=payment_overdue), API-047(고르기) |
| SPEC-044 | 차액 결제 기한 처리: 변경 요청을 '차액 없어 닫힘'으로 | API-062 |
| SPEC-052 | 전날 안내: 다음 날 픽업할 손님에게 가게가 정한 시각(08:00~20:50)에 한 번 | API-027(시각 설정) |
| SPEC-061 | 후기 부탁: 인도한 다음 날 가게가 정한 시각에 한 번(신고가 있으면 보내지 않음) | API-027(시각 설정), API-072(버튼이 여는 후기 블록) |
| SPEC-064 | 장부 쓰기와 다시 적기(1분·5분·30분·2시간·6시간, 그 뒤 하루 한 번), 24시간 실패 알림 | API-033(못 적은 쓰기 수), API-035(다시 연결하면 다시 적음) |
| SPEC-065 | 지난 기록 지우기: 하루 한 번 03:00, 05단계 README 6절의 여섯 차례. 끝나고 30일 지난 주문의 개인정보를 지우고 보관 기록으로 나눔, 닫히고 30일 지난 상담의 대화·사진·초안을 지움, 3년 지난 신고 설명·사진과 5년 지난 보관 기록을 지움, 상담과 주문이 모두 지워진 손님의 카카오 사용자 키를 지움, 2년 지난 접속기록을 지움(접속기록을 지키는 트리거가 2년이 지나지 않은 행의 지우기를 막음, REQ-196). 30일·3년·5년은 잠정(REQ-185~190) | API-043(지운 상담은 status deleted), API-044·045(보관 기록이 된 주문은 목록에 없고 하나를 읽으면 404), API-077(지운 값은 409 original_erased) |
| SPEC-066 | 손님에게 먼저 보내는 안내: 가게의 먼저 보내기가 되고 손님이 친구면 우리 앱 키로 가게 봇의 Event API(siljang_notice, 안내 키)를 부름. 요청이 SUCCESS면 taskId와 함께 '확인 중'으로 두고 1분·5분·30분 뒤 발송 결과 조회(GET /v1/tasks/{taskId}): 닿음은 '보냄', 채널 친구 아님(101)은 다음 대화 때와 손님 친구 아님, 스킬·카카오 오류(201~205·301·999)는 다시 보내기, 발송 제한(401~407)은 다음 대화 때와 운영자 알림, 30분 뒤에도 모름은 다음 대화 때. 요청이 FAIL이면 채널 연결·이벤트 이름·월렛 없음은 가게의 먼저 보내기 '안 됨'과 사장님 알림, 월렛 잔액 없음은 운영자 알림, 그 밖은 다시 보내기. 먼저 보내기가 안 되는 가게와 친구가 아닌 손님은 다음 대화 때 먼저(DEC-20) | API-073(안내 스킬), API-070(먼저 전함), API-030(먼저 보내기 상태), API-042 |
| SPEC-067 | 사장님 알림: 우리 서비스 채널 봇이 Event API로 사장님의 카카오 로그인 사용자 번호(appUserId)에 할 일 종류와 목록 주소(1분 안 같은 종류는 묶음). 발송 결과 조회는 손님 안내와 같고, 채널 친구 아님(101)이면 사장님을 친구 아님으로 고치고 할 일 목록에만(DEC-21) | API-040(할 일), API-002(채널 친구가 아니면 안내) |
| SPEC-008 | 채널 연결 확인: 10분이 지나도 테스트 메시지와 시험 버튼 넷이 다 닿지 않으면 '연결 안 됨'과 사유 후보. 연결되면 시험 사용자에게 시험 안내를 Event API로 보내고 발송 결과로 먼저 보내기 됨·안 됨(사유)을 남김(DEC-20) | API-030(verifiedBlocks, eventStatus), API-032(다시 시험), API-073(시험 안내) |
| SPEC-074 | 접속기록 남기기: 손님 개인정보(이름·연락처·대화·원래 값·계좌·알레르기 답·사진)를 돌려주거나 바꾸는 사장님 API(할 일·에스컬레이션 건·상담·주문·제작·결제 안내·환불·변경 요청·문제 신고·후기, API-040~066)와 운영자의 가게 기록 API(API-074~077)는 응답과 같은 트랜잭션에서 접속기록 한 행(누가·언제·접속지·가게·손님 ID·API 번호·경로, 연 경우의 대상·사유)을 남기고, 남기지 못하면 500 internal로 개인정보를 돌려주지 않음. 가게 설정 API·카카오 스킬·서버 안의 일은 남기지 않음. 접속기록은 넣기만 하고 2년 동안 고치거나 지우지 못함(05단계 A24) | API-040~066, API-074~077(운영자, 원래 값 열기는 사유와 함께) |
| SPEC-047 | 환불 보내기 다시 알림: 정한 뒤 24시간이 지나도 '보냄'이 없으면 사장님께 한 번 다시 알림(REQ-173) | API-040(할 일 refund_send), API-061(보냄이면 닫힘) |
<!-- END generated:jobs -->

## 11. 깨지는 변화

2026-11-13 설계 재검토 H1·H2(15절)로 응답 스키마에 꼭 있는 필드 7개를 더했습니다: `PaymentRequest.arrivedAmount`·`arrivedAt`, `Payment.voidedAt`·`voidReason`, `RefundPreview.confirmedAmount`·`unconfirmedAmount`·`minAmount`. 응답에만 더한 필드라 보내는 요청은 그대로이고, A13이 '꼭 넣을 필드 더함'으로 찾으므로 `components.x-corthex.breakingChanges`에 7개를 사유·결정(동희님 2026-11-13 20:59 결정 카드 '추천안대로 (추천)')과 함께 적었습니다(원본은 `api_catalog.py`의 `BREAKING_CHANGES`, PR마다 더하고 지난 항목은 지우지 않음). 고를 값을 더한 것(할 일 종류 `refund_send`·`arrival_check`, 환불 원인 `over_received`, 입금 대조 결과 `arrived`·`void`)과 넣지 않아도 되는 요청 필드(`RefundInput.paymentRequestId`, `ReconciliationInput.arrivedAmount`·`voidReason`)는 깨지는 변화가 아닙니다.

같은 재검토의 H6·H11·H12(15절)로 바꾼 것 가운데 A13이 찾지 않는 것 3개도 목록에 적었습니다: 제작 목록 요약(`ProductionDay.items[].summary`)에 꼭 있는 필드 5개를 더함(안쪽 필드라 A13이 찾지 않음), AI 출력 `draft_patch`에서 주문자 이름·연락처를 뺌(HTTP 계약 밖), 주문·변경 요청의 `revision` 값의 원본을 잠금 번호로 바꿈(화면은 받은 값을 그대로 보내므로 바꿀 것 없음). 스킬 결과 `orderer_saved`·`input_invalid`와 넣지 않아도 되는 스킬 블록 파라미터 `customer_name`·`customer_phone`·`depositor_name`은 깨지는 변화가 아닙니다.

같은 재검토의 H7·H8·H9(15절)로 꼭 있는 필드 8개를 더했습니다: 요청 `KakaoChannelInput.blockIds`(카드 버튼이 부를 블록 ID 넷), 응답 `SkillSetup.eventSkillUrl`·`eventName`, `KakaoChannel.blockIds`·`verifiedBlocks`·`eventStatus`·`eventCheckedAt`·`eventFailReason`. 요청에 더한 `blockIds`는 채널 연결 화면(SCR-041)이 함께 보내야 하는 바꿈입니다. A13이 찾지 않는 것 3개도 목록에 적었습니다: 스킬 결과 `channel_linked`를 API-070에서 API-071·072로 옮기고 API-070은 `channel_test_card`를 줌, 주문 요청 확인 카드의 응답 구성(규정 글을 먼저, DEC-22), `Owner.alertChannelFriend`를 고치는 곳이 늘어남. 새 API-073, 오류 코드 `channel_setup_incomplete`, 필드 오류 사유 `exceeds_card_limit`, 스킬 결과 5개(`channel_test_card`·`block_verified`·`notice_shown`·`notice_test`·`notice_gone`), 넣지 않아도 되는 스킬 요청 값(`userRequest.params.noticeKey`·`check`, `clientExtra.check`)과 연결 안 됨의 사유 후보에 더한 고를 값은 깨지는 변화가 아닙니다.

같은 재검토의 H3(15절)으로 A13이 찾지 않는 것 1개를 목록에 적었습니다: 끝나고 30일이 지나 보관 기록이 된 주문은 주문 목록(API-044)에 나오지 않고, 주문 상세(API-045)와 그 주문의 하위 기록을 읽으면 404 `not_found`입니다(5절 '보관 기록'). 상담 상태에 고를 값 `ended`(`ConsultationMessagePage.status`)를 더한 것은 깨지는 변화가 아닙니다.

같은 재검토의 H4(15절)로 응답 스키마에 꼭 있는 필드 1개를 더했습니다: `ReviewShopDetail.paymentAccount`(운영자가 보는 결제 계좌의 은행·예금주·끝 4자리, 없으면 null). A13이 찾지 않는 것 2개도 목록에 적었습니다: 환불 '보냄'의 환불 계좌 번호 형식을 숫자 10~16자리로 좁힘(`RefundSentInput.refundAccount.accountNumber`), 사장님 화면의 손님 말과 상담 대화에서 카드번호는 플레이스홀더와 끝 4자리, 긴 숫자는 플레이스홀더만 보임. 새 API-074~077, 오류 코드 4개(`payment_account_missing`·`holder_not_verified`·`original_not_kept`·`original_erased`)와 그것을 API-014·025에 더한 것은 깨지는 변화가 아닙니다.

첫 버전(2026-11-12)에는 앞 계약이 없어 깨지는 변화가 없었습니다. 다음 버전부터 `check_api.py`의 A13이 main의 `api/openapi.yaml`과 견줘 API·응답·오류 코드·필드·고를 값을 없애거나, 타입을 바꾸거나, 꼭 넣을 필드를 더한 것을 찾고, 그것이 목록에 있고 동희님이 정했는지 봅니다.

## 12. 검사

2026-11-14 05:48 KST, 설계 재검토 H4를 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A2·A4 API 77개, A3 SPEC 74개 모두 API가 있음, A5 예시 776개·성공 응답 시각 647개, A6 오류 예시 440개, A7 테이블.컬럼 91개(136자리. 가게·환불 계좌번호 2개를 빼고 접속기록의 대상 종류·사유 2개를 더함), A9 말로만 적은 근거 60개, A12 API ID 77개, A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 1개가 모두 목록에 있음(11절), D1 테이블.컬럼 91개에 값 5041개(글자 수 CHECK가 있는 컬럼 32개), M1 목 서버 요청 852개입니다. A10 열린 질문 9개와 A11 결정 사항 22개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 04:16 KST, 설계 재검토 H3을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. A13은 main의 `api/openapi.yaml`과 견준 깨지는 변화 0개입니다(바꾼 것은 고를 값 `ended`를 더함과 이미 있는 404를 쓰는 응답 바뀜이라 A13이 찾지 않고, 뒤의 것은 11절 목록에 적음). 나머지 숫자(A5 예시 730개·성공 응답 시각 607개, A6 오류 예시 418개, A7 테이블.컬럼 91개(135자리), A9 말로만 적은 근거 48개, D1 값 5097개, M1 목 서버 요청 806개)는 H7·H8·H9를 고친 뒤와 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 01:53 KST, 설계 재검토 H7·H8·H9를 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A2·A4 API 73개, A5 예시 730개·성공 응답 시각 607개, A6 오류 예시 418개, A7 테이블.컬럼 91개(135자리), A9 말로만 적은 근거 48개, A10 열린 질문 9개, A11 결정 사항 22개, A12 API ID 73개, A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 8개가 모두 목록에 있음(11절), D1 테이블.컬럼 91개에 값 5097개(글자 수 CHECK가 있는 컬럼 31개), M1 목 서버 요청 806개입니다. A3 SPEC 72개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-13 23:40 KST, 설계 재검토 H6·H11·H12를 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A3 SPEC 72개 모두 API가 있음, A5 예시 711개(성공 응답 시각 595개는 같음), A9 말로만 적은 근거 42개, A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 0개(바꾼 것 셋은 A13이 찾지 않는 안쪽 필드·HTTP 계약 밖·값의 원본이라 11절 목록에 적음), M1 목 서버 요청 788개입니다. A6 오류 예시 414개, A7 테이블.컬럼 87개(128자리), D1 값 4845개(글자 수 CHECK가 있는 컬럼 27개)는 같습니다.

2026-11-13 22:42 KST, 설계 재검토 H1·H2를 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A3 SPEC 71개 모두 API가 있음, A5 예시 707개·성공 응답 시각 595개, A7 테이블.컬럼 87개(128자리), A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 7개가 모두 목록에 있음(11절), D1 테이블.컬럼 87개에 값 4845개(글자 수 CHECK가 있는 컬럼 27개), M1 목 서버 요청 786개입니다. A6 오류 예시 414개와 A9 말로만 적은 근거 41개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다. 아래 12-1 표는 2026-11-12의 결과로 남깁니다.

검사는 2026-11-12에 이 버전으로 돌렸습니다. 숫자는 각 명령의 출력에서 옮겼습니다. 체크포인트 뒤(14:10 무렵) 결정 사항의 상태 열과 REQ-164 연결을 더한 버전으로 `check_api.py`를 다시 돌려도 17개 모두 통과했고 아래 숫자가 같았습니다. 도구 버전: Python 3.13.18, openapi-spec-validator 0.9.0, jsonschema 4.26.0, hypothesis 6.170.15, hypothesis-jsonschema 0.23.2, PostgreSQL 16.15, Prism 5.14.2(Node 22.23.4), Schemathesis 4.33.2.

### 12-1. `check_api.py`: 검사 17개 모두 통과

| 검사 | 무엇을 봄 | 결과 |
| --- | --- | --- |
| A0 | `build_api.py`로 다시 만들어도 계약 파일과 이 문서의 표가 그대로 | 통과 |
| A1 | OpenAPI 3.1 문서로 맞음(openapi-spec-validator) | 통과 |
| A2 | API마다 API ID(API-001~072 차례대로)·operationId·SPEC ID, SPEC ID는 04단계에 있는 것 | 통과 |
| A3 | SPEC-001~069가 모두 API에 연결됨 | 통과(69개 모두 API가 있고, 서버 안의 일 10개는 10절에 따로) |
| A4 | 응답 목록(성공·422·401·403·404·409·default)을 포함하거나 뺀 이유를 적음, 경로에 ID가 있으면 404, 입력이 있으면 422, 400은 안 씀 | 통과(API 72개) |
| A5 | 모든 예시가 스키마(날짜·시각·uuid·주소 형식 포함)에 맞음, 내용이 있는 응답마다 예시, 성공 응답의 시각은 +09:00, 스킬 200의 예시 이름 = 결과 목록 = `Siljang-Outcome` 값 | 통과(예시 701개, 시각 536개) |
| A6 | 오류 예시는 Problem 형식, status·code·type·title이 목록과 같음, 필드 오류의 필드가 그 요청에 있음, 422 첫 예시는 `validation_failed`, 401 첫 예시는 `unauthenticated`(스킬은 `skill_key_invalid`), 429는 `Retry-After` | 통과(오류 예시 414개) |
| A7 | 요청 필드마다 한도, 열린 객체는 카카오 스킬 요청 안에만, `x-corthex-column`의 테이블.컬럼이 스키마에 있음 | 통과(테이블.컬럼 85개, 126자리) |
| A8 | API마다 security, 로그인이 꼭 필요한 API는 401 | 통과(누구나 여는 API 4개, 로그인 없어도 되는 로그아웃 2개) |
| A9 | 케이스 유형 근거가 모두 계약에 있음, 근거가 있으면 종류를 적음, 목록 API는 빈 목록 예시, AI를 호출하는 API-070은 모델 실패·느림·키 없음·사용 한도·쓰기 전 확인 실패가 저마다 결과 코드 | 통과(말로만 적은 근거 41개는 응답으로 보일 수 없는 서버 동작이라 따로 셈) |
| A10 | 열린 질문 8개가 그 자리 설명에 `Open:`으로 있음 | 통과 |
| A11 | 결정 사항 19개가 계약에 쓰이고, 계약의 DEC ID가 모두 목록에 있음 | 통과 |
| A12 | 계약에 나온 API ID가 모두 있는 API | 통과 |
| A13 | 앞 계약과 견준 깨지는 변화가 목록에 있음 | 통과(main에 앞 계약이 없는 첫 버전) |
| A14 | 성공 응답 스키마가 모두 닫힘, 손님·공개 응답에 uuid 없음, 시크릿 같은 이름의 필드 없음 | 통과 |
| D1 | 빈 DB에 `db/schema.sql`을 적용하고, 계약이 허용하는 값을 만들어 그 컬럼의 타입·CHECK에 넣어 봄(고르게 만든 값과 가장 긴·짧은 글자, 가장 작은·큰 수, 고를 값 모두) | 통과(테이블.컬럼 85개에 값 4,709개, 막힌 값 0. 글자 수 CHECK가 있는 컬럼 26개는 끝값을 바로 견줌) |
| M1 | 목 서버에 API마다 맞는 요청·로그인 없는 요청·틀린 입력, 응답·예시마다 `Prefer` 요청 | 통과(요청 783개 모두 계약대로) |

검사 도구가 실제로 잡는지 보려고 일부러 오류를 넣어 봤습니다(고칠 수 없는 고를 값·계약 밖 필드, 시각 형식, 다른 상태의 오류 코드, 빠진 뺀 이유, 요청에 없는 필드 오류, 닫히지 않은 스키마, 한도 없는 필드, DB보다 긴 글자 한도와 DB가 막는 글자). 모두 실패로 잡혔습니다.

D1의 참고: `operators.email`·`kakao_channels.bot_id`·`ledger_links.spreadsheet_id`·`refunds.refund_account_number`(설계 재검토 H4에서 지운 컬럼)는 형식(정규식)이 있는 필드라 '가장 긴' 값을 만들지 못했습니다. 이 필드들은 DB에 글자 수 CHECK가 없어 길이로 막히는 일이 없고, 형식은 고르게 만든 값으로 견줬습니다. NUL 문자와 줄바꿈으로 끝나는 값은 DB에 넣을 수 없거나 파이썬 정규식만의 차이라 뺐고, 서버가 422로 막습니다(13절).

### 12-2. 계약 테스트 도구 Schemathesis를 목 서버에 돌림

`schemathesis run api/openapi.yaml --url http://127.0.0.1:4010 --checks all --phases examples,coverage,fuzzing -n 25 --seed 20261112 --generation-codec ascii`로 API 72개에 요청 1,323개를 만들었습니다.

- **예시 단계 통과**: 계약의 요청 예시로 호출한 응답이 모두 계약의 상태·형식·스키마에 맞았습니다.
- **실패 128개는 모두 목 서버의 한계**입니다. 계약 쪽 실패는 없었습니다.

| 실패 | 수 | 사유 | 실제 서버(11단계)에서 |
| --- | --- | --- | --- |
| ST401 틀린 인증을 수락함 | 59 | Prism은 쿠키·헤더가 있는지만 보고 값은 확인하지 못함 | 세션과 스킬 키 값을 확인해 401 |
| ST204 계약에 없는 방법에 `Allow` 없음 | 61 | Prism의 405에 `Allow` 헤더가 없음 | 405 `method_not_allowed`와 `Allow`(DEC-02) |
| ST105 계약에 없는 형식 | 8 | JSON으로 읽을 수 없는 본문에 Prism이 자기 400(`application/json`)으로 답함 | 422 `validation_failed`(`/`, `bad_json`, DEC-01) |

- 경고: API 9개는 Schemathesis가 만든 쿠키·헤더 값이 모두 401을 받아 성공 응답을 보지 못했습니다. 이 API들도 M1에서 맞는 요청이 성공하는 것은 봤습니다.
- 처음에는 ASCII 밖 글자로 돌렸는데, 요청 필드 이름에 그런 글자가 들어가면 Prism이 오류 헤더를 쓰다 멈췄습니다(Prism 5.14.2의 문제). 그래서 `--generation-codec ascii`로 돌렸습니다. 실제 서버 테스트는 이 옵션 없이 돌립니다.
- 목 서버는 계약의 예시를 반환하므로 대부분의 검사를 일부러 통과합니다. 계약을 서버가 지키는지는 11단계에서 개발·스테이징 서버에 같은 명령을 돌려야 압니다.

## 13. 다음 단계로 전달하는 것

- **07·08단계(사이트맵·화면 상태)**: 화면 상태는 응답에서 시작합니다. 오류 코드마다 '화면에 보이는 말'과 '화면이 할 일', 카카오 스킬 결과마다 '손님에게 가는 말'이 08단계가 다듬을 뼈대입니다. 사장님이 오픈빌더 봇 ID를 찾는 안내는 OPEN-8입니다. 채널 연결 화면은 블록 ID 넷, 시험 버튼으로 닿은 블록, 먼저 보내기 상태와 사유를 보입니다(API-030, 15절). 화면이 더 필요한 API가 나오면 이 계약에 먼저 더하고 깨지는 변화인지 봅니다.
- **10·11단계(개발)**: 서버는 이 계약을 따릅니다. 목 서버로는 볼 수 없어 실제 서버에서 지켜야 하는 것이 있습니다: 세션 쿠키와 스킬 키의 값을 실제로 확인하기, JSON으로 읽을 수 없는 본문도 422 `validation_failed`(`/`, `bad_json`)로 답하기, 계약에 없는 방법은 405 `method_not_allowed`와 `Allow` 헤더, 글자 필드의 NUL 문자는 `bad_format`. 계약 테스트는 개발·스테이징 서버에 `schemathesis run api/openapi.yaml --url <서버>`로 돌리고 운영 서버에는 돌리지 않습니다.
- **12단계(QA)**: 응답 하나(`API-001#401` 꼴)마다 테스트 사례를 하나씩 만듭니다. 4절 표의 '응답' 열이 그 목록입니다.
- **개발 전에 정할 것**: 9절 열린 질문 9개. 먼저 보내기에 가게가 줄 권한(OPEN-9)은 10단계 WBS의 선행 일로 시험 채널에서 확인하고, 안 되면 모든 가게를 '다음 대화 때 전함'만으로 시작합니다(REQ-181). 세션 길이(OPEN-5)와 운영자 인증 서비스(OPEN-6), AI 모델 회사(OPEN-7)는 고르는 날 계약과 처리방침을 함께 고칩니다.

## 14. 체크포인트

계약서의 체크포인트는 "구현 전에 응답 하나씩 계약을 보고, 깨지는 변화마다 정함"입니다. 첫 버전이라 깨지는 변화는 없었습니다.

- 질문(2026-11-12 13:50, 이 작업 대화의 결정 카드): "API 계약(작업 72개)과 정한 것 19개를 추천대로 굳힐까요?" 고를 것은 추천대로 굳힘, DEC-12·13·18 다르게, 고칠 것 말씀이었습니다.
- 결정: 2026-11-12 14:01 동희님이 '추천대로 굳힘'을 고르셨습니다. 4절의 API 72개와 응답, 8절의 DEC-01~19(따로 확인 요청한 DEC-12·13·18 포함)를 이대로 확정합니다. 확인 요청한 뒤 PR #7에 댓글과 리뷰는 없었습니다.
- 확정한 뒤: DEC-12의 조건을 요구사항 버전 4 REQ-164(결제 수단이 없는 동안 예약 링크를 내지 않음)로 더하고, 기능 명세 SPEC-010의 조건과 수락 기준에 이었습니다. 다음은 07단계(사이트맵)입니다. 계약을 바꿀 때는 목록을 고친 뒤 `build_api.py . --write`로 다시 만들고, 화면이 이미 보이는 데이터나 보내는 요청을 깨는 바꿈은 다시 확인 요청합니다.

기록은 Notion 최근 업데이트 DB의 06단계 기록 행(<https://app.notion.com/p/416bf16cc3ec81bc8e55c85d0f194ccf>)에 있고, API·오류 코드·결정 사항 표를 이 문서에서 옮겨 두었습니다. 둘이 다르면 이 문서와 원본 계약이 맞습니다.

## 15. 확정한 뒤 고친 것

2026-11-13 설계 독립 재검토의 높음 묶음 H1(RB-01, RC-05, RD-02, RA-15)과 H2(RA-01, RE-02, RE-03, RE-04)를 동희님 2026-11-13 20:59 결정 카드 '추천안대로 (추천)'에 따라 고쳤습니다. 요구사항 버전 5(REQ-165~174), 04단계 SPEC-070·071, 05단계 마이그레이션 0002를 따릅니다. 원본 `api_schemas.py`·`api_ops.py`·`api_examples.py`·`api_catalog.py`를 고치고 `build_api.py . --write`로 다시 만들었습니다(`build_api.py`는 깨지는 변화 목록을 `api_catalog.py`에서 읽게만 바꿈).

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| `PaymentRequest`, API-057·058 | 들어온 금액·남긴 시각(`arrivedAmount`·`arrivedAt`) | REQ-165, SPEC-071 |
| API-059 입금 대조 | 결과 `arrived`(닫힘·기한 지남 결제 안내에 들어온 입금, `arrivedAmount`)와 `void`(제작 전 결제 확인 취소, `voidReason`). 예시 `arrived`·`voided`. `paid_after_cancel`은 들어온 금액을 남김 | REQ-166, REQ-167, REQ-169, SPEC-070, SPEC-071 |
| `Payment` | 결제 확인 취소 시각·사유(`voidedAt`·`voidReason`). 취소한 결제는 받은 금액에 들지 않음 | REQ-169 |
| API-049 환불 미리보기 | 받은 금액 = 결제 안내의 들어온 금액 합, 나눠 보기(`confirmedAmount`·`unconfirmedAmount`), 가장 작은 금액 `minAmount` = 계산값. 원인 `over_received`와 `paymentRequestId` | REQ-165, REQ-170, SPEC-071 |
| API-050 환불 결정 | 계산값보다 낮으면 422 `below_calculated`, 높으면 사유. 환불 없음은 계산값이 0원일 때만. 할 일 '환불 보내기'를 열고 24시간 뒤 다시 알림, 손님 계좌 묻기. 예시 `none`·`over_received` | REQ-170, REQ-171, REQ-173 |
| API-061 환불 '보냄' | 할 일을 닫고 손님에게 보냄 안내를 한 번(`customerNotice` `sent`·`deferred`), 장부 쓰기. 08단계 SCR-026의 결과 문구와 계약이 맞음 | REQ-172(RE-03) |
| API-040 할 일, `OwnerTask` | 종류 `refund_send`(subject `refund`)·`arrival_check`(subject `payment_request`), 예시 2개. 설명의 `paid_after_cancel` 이름은 '취소 뒤 들어온 입금' | REQ-167, REQ-173 |
| API-048 가게 사정 취소 | 받은 금액(REQ-165), 결제 확인 요청 중이었으면 들어온 입금 대조 할 일 | SPEC-071 |
| 서버 안의 일(10절) | 환불 보내기 다시 알림(정한 뒤 24시간) | REQ-173 |

- 깨지는 변화 7개는 11절. 오류 코드는 그대로(32개)이고 필드 오류 사유 `below_calculated`를 더했습니다.
- 검사: 12절의 2026-11-13 결과. Schemathesis(12-2)는 이번에 다시 돌리지 않았습니다.

2026-11-13 같은 재검토의 높음 묶음 H11(RB-02, RD-16), H12(RC-01), H6(RD-08)도 같은 결정 카드에 따라 고쳤습니다. 요구사항 REQ-175~178, 04단계 SPEC-072, 05단계 마이그레이션 0003을 따릅니다.

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-070 손님 메시지 | 주문서 초안이 다 찼는데 주문자 이름·연락처가 없으면 주문 요청 카드 대신 주문자 정보 카드(`card_shown`). 버튼 '이름·연락처 넣기'가 AI를 거치지 않는 '주문자 정보' 블록을 엶. 주문 요청 카드 요약에 주문자 이름·연락처 | REQ-175, SPEC-027, SPEC-028, SPEC-072 |
| API-071 카드 버튼, `SkillPayload` | '주문자 정보'·'입금자 이름' 블록이 이 스킬로 옴. 블록 파라미터 `customer_name`·`customer_phone`·`depositor_name`(AI로 보내지 않음). 결과 `orderer_saved`(주문 요청 카드를 보냄)와 `input_invalid`(형식이 틀려 다시 물음)를 더해 카드 결과 18개. 요청 예시 `orderer_info`·`depositor_name` | REQ-175, REQ-176, REQ-178, SPEC-033, SPEC-072 |
| AI-1 출력 `draft_patch` | `customer_name`·`customer_phone`을 뺌. 주문자 이름·연락처는 블록으로만 받음 | REQ-178, SPEC-021 |
| API-051 제작 목록, `ProductionDay` | 요약에 디자인 옵션·더하는 옵션·알레르기 답·빼야 할 재료·참고 사진 수 | REQ-177, SPEC-050 |
| `Order`·`OrderSummary`·`ChangeRequest`의 `revision`, DEC-05 | 쓸 때마다 하나 오르는 잠금 번호(05단계 `lock_version`)로 만듦. 결제 확인과 손님 취소가 같은 값을 읽고 보내면 늦은 쪽은 409 `version_conflict` | 설계 재검토 H12(RC-01), 05단계 4절 A6·5절 E15 |

- 깨지는 변화 목록에 3개를 더했습니다(11절). A13이 찾는 깨지는 변화는 0개입니다. 스킬 결과는 37개에서 39개가 되었습니다.
- 검사: 12절의 2026-11-13 결과.

2026-11-13 같은 재검토의 높음 묶음 H7(RD-01, RD-10, RA-10), H8(RD-04), H9(RD-03)도 같은 결정 카드에 따라 고쳤습니다. 요구사항 REQ-179~184(REQ-115는 REQ-183으로 바꿈), 04단계 SPEC-001·005·008·028·066·067, 05단계 마이그레이션 0004를 따릅니다. 원본 네 파일을 고치고 `build_api.py . --write`로 다시 만들었습니다(`build_api.py`는 계약 파일 `info.description`에 적힌 API ID 범위 글자만 API-001~073으로 바꿈).

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-073 안내 스킬(새) | 우리 서버가 우리 앱 키로 가게 봇의 Event API(`siljang_notice`, params에는 안내 키만)를 부르면 가게 봇의 '안내' 블록이 부르는 스킬. 결과 `notice_shown`·`notice_test`·`notice_gone`. 안내를 만들지 못하면 500으로 카카오가 보내지 않게 하고 다음 대화 때 전함(DEC-07의 예외) | REQ-180, REQ-181, SPEC-066, DEC-20, OPEN-9 |
| API-030·031·032 채널 연결, `KakaoChannelInput`·`KakaoChannel`·`SkillSetup` | 블록 ID 넷(`blockIds`), 시험 버튼으로 닿은 블록(`verifiedBlocks`), 먼저 보내기 상태(`eventStatus`·`eventCheckedAt`·`eventFailReason`), 안내 스킬 주소와 이벤트 이름. 사유 후보에 닿지 않은 블록 넷. 블록 ID가 비면 409 `channel_setup_incomplete`. 같은 봇의 블록 ID만 바꾸면 그 연결을 다시 확인하고, 연결됨에서 누른 '연결 확인'은 시험 안내를 다시 보냄. 예시 `blocks_changed`·`event_recheck`·`event_checking`·`event_unavailable` | REQ-179, REQ-180, SPEC-008, DEC-20 |
| API-070·071·072 스킬, `SkillPayload`·버튼 | API-070은 테스트 메시지에 첫 시험 버튼(`channel_test_card`). API-071·072는 시험 버튼(`clientExtra.check`)에 `block_verified`, 넷째에 `channel_linked`. 카드·후기 버튼은 가게가 넣은 블록 ID를 부름 | REQ-179, SPEC-008 |
| 주문 요청 확인 카드(API-070 `card_shown`, API-071 `orderer_saved`·`card_stale`·`card_expired`) | 출력 셋 안에서 그 버전의 취소·환불 규정 글(조문마다 한 줄, 끝에 '주문제작이라 청약철회가 제한될 수 있어요')을 먼저, 요약 카드를 끝에. 1,000자를 넘으면 조문 사이에서 나눠 글 둘 | REQ-184, SPEC-028, DEC-22 |
| API-021 운영규정 | 규정 글이 글 둘에 들어가지 않으면 422(`/clauses`, `exceeds_card_limit`) | REQ-184, SPEC-005 |
| API-001·002 로그인, `Owner.alertChannelFriend` | 로그인 때 채널 관계 조회(`plusfriends` 동의)로 친구 여부를 남기고, 친구가 아니라고 남은 동안 1분이 지나면 Admin 키로 다시 조회. 사장님 알림은 카카오 로그인 사용자 번호(appUserId)로 | REQ-183, SPEC-001, SPEC-067, DEC-21 |
| 서버 안의 일(10절) | 손님 안내와 사장님 알림을 Event API로 보내고 taskId로 1분·5분·30분 뒤 발송 결과를 조회한 뒤에만 '보냄'. 채널 연결의 시험 안내와 10분 기한(SPEC-008) | REQ-182, SPEC-066, SPEC-067, DEC-20, DEC-21 |

- 깨지는 변화 8개와 A13이 찾지 않는 3개는 11절. 오류 코드 33개(`channel_setup_incomplete`), 필드 오류 사유 22개(`exceeds_card_limit`), 스킬 결과 44개(5개를 더하고 `channel_linked`는 뜻을 고쳐 옮김), 결정 사항 22개(DEC-20~22), 열린 질문 9개(OPEN-9), 서버 안의 일 12개입니다.
- 결정 카드의 '월렛 하나'는 카카오 월렛 문서(연결 대기 상태의 월렛만 봇 하나에 연결)에 맞춰 가게 봇마다 우리 월렛 하나로 적었습니다(DEC-20). RA-10의 둘째(결제 기한을 안내가 닿은 때부터 셀지)는 중간 묶음 M2에서 고칩니다.
- 검사: 12절의 2026-11-14 01:53 KST 결과.

2026-11-13 같은 재검토의 높음 묶음 H3(RB-09, RC-02, RA-06, RC-04, RC-03)도 같은 결정 카드에 따라 고쳤습니다. 요구사항 REQ-185~190(REQ-143·144는 제외), 04단계 SPEC-065·025·017·040, 05단계 마이그레이션 0005와 앱 규칙 A22를 따릅니다. 원본 `api_schemas.py`·`api_ops.py`·`api_catalog.py`를 고치고 `build_api.py . --write`로 계약 파일과 표를 새로 썼습니다(`build_api.py`는 그대로).

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-043 상담 대화, `ConsultationMessagePage` | 상태에 `ended`(상담 끝남): 다룬 주문이 모두 끝나 닫힌 상담. 대화는 지우기 전까지 그대로 보이고, 그 손님의 다음 말은 새 상담에 남음. 지워진 상담은 그대로 `deleted`와 빈 `items` | REQ-189, SPEC-025 |
| API-044 주문 목록, API-045 주문 하나, 공통 규칙(5절) | 끝나고 30일이 지나 보관 기록이 된 주문과 그 하위 기록은 목록에 없고, 하나를 읽거나 명령을 보내면 404 `not_found` | REQ-187, SPEC-065, SPEC-040, 05단계 A22 |
| 서버 안의 일(10절) | SPEC-025에 상담 끝남, SPEC-065를 다섯 차례(끝나고 30일 지난 주문, 닫히고 30일 지난 상담, 3년 지난 신고 기록, 5년 지난 보관 기록, 손님의 카카오 사용자 키)로 | REQ-185~190 |

- 깨지는 변화 목록에 A13이 찾지 않는 1개를 더했습니다(11절). API·오류 코드·스킬 결과 수는 그대로입니다.
- 검사: 12절의 2026-11-14 04:16 KST 결과.

2026-11-13 같은 재검토의 높음 묶음 H4(RC-10, RC-09, RA-16)도 같은 결정 카드에 따라 고쳤습니다. 요구사항 REQ-191~199(REQ-137은 REQ-193으로 바꿈), 04단계 SPEC-073·074와 SPEC-003·006·021·032·049·065·067, 05단계 마이그레이션 0006과 앱 규칙 A23~A25·결정 E20·E21을 따릅니다. 원본 `api_catalog.py`·`api_schemas.py`·`api_examples.py`·`api_ops.py`를 고치고 `build_api.py . --write`로 다시 만들었습니다(`build_api.py`는 계약 파일 `info.description`의 SPEC·API ID 범위와 태그 '운영자'의 설명만 바꿈).

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-074 가게 기록 목록(새) | 운영자가 가게의 주문·상담을 가린 값(이름 첫 글자, 연락처 끝 4자리)으로 찾음. 보관 기록이 된 주문은 주문번호·끝난 날·보관 기간과 `keptRecordId`만 | REQ-194, SPEC-073 |
| API-075 상담 하나(새) | 대화는 플레이스홀더 그대로, 플레이스홀더마다 끝 4자리와 열 수 있는지(`originalKept`), 사진은 수만. 지운 상담은 `deleted` | REQ-192, REQ-194, SPEC-073 |
| API-076 주문 하나(새) | 주문자 이름·연락처와 환불 계좌는 가린 값, 알레르기 답과 빼야 할 재료는 답이 있는지만, 참고 사진은 수만. 보관 기록이 된 주문은 404 | REQ-194, SPEC-073 |
| API-077 원래 값·보관 기록 열기(새) | 대상(대화 속 전화번호·계좌번호, 주문자 이름·연락처, 환불 계좌, 보관 기록)과 사유 5~200자를 보내면 그 값 하나만 엶. 접속기록(열기·사유)을 같은 트랜잭션에서 남기고 못 남기면 500. 원래 값이 없는 값은 409 `original_not_kept`, 지운 값은 409 `original_erased` | REQ-195, REQ-196, SPEC-073, SPEC-074 |
| API-013·014 영업 신고 확인, `ReviewShopDetail` | 결제 계좌의 은행·예금주·끝 4자리와 예금주가 대표자·상호와 같은지(`paymentAccount`). 확인됨이면 예금주를 확인한 운영자·시각도 남기고, 계좌가 없으면 409 `payment_account_missing`(보류는 됨). 예시 `no_account`·`holder_different` | REQ-197, SPEC-003 |
| API-024·025 결제 수단 | 계좌번호 형식은 API가 확인하고 앱이 암호화해 끝 4자리와 함께 남김(`x-corthex-column`을 뺌). 확인된 가게가 다른 예금주로 바꾸면 409 `holder_not_verified`. 보류된 가게가 바꾸면 다시 확인 기다림, 바꾸면 사장님 카카오 알림 한 번, 바꾼 뒤 결제 안내부터 새 계좌 | REQ-191, REQ-198, REQ-199, SPEC-006, SPEC-067 |
| API-041·043 손님 말과 상담 대화 | 전화번호·계좌번호는 원래 값으로 되돌리고, 카드번호는 플레이스홀더와 끝 4자리, 긴 숫자는 플레이스홀더만 | REQ-192, SPEC-021 |
| API-060·061 환불, AI 출력 `refund_account_patch` | 환불 계좌는 앱이 암호화해 끝 4자리와 함께 남김. '보냄'의 계좌 번호는 숫자 10~16자리 | REQ-191, SPEC-049 |
| API-073 안내 스킬 | 결제 안내 글에는 계좌 자리만 두고 보일 때 복호화해 채움 | REQ-191, SPEC-032 |
| DEC-19, 공통 규칙(5절), 서버 안의 일(10절) | 운영자 응답은 가린 값만, 원래 값은 API-077에만(DEC-19의 근거 REQ-137을 REQ-193~195로). 접속기록 남기기(SPEC-074)와 지우기 여섯째 차례(2년 지난 접속기록) | REQ-193~196, SPEC-065, SPEC-074 |

- 깨지는 변화 1개와 A13이 찾지 않는 2개는 11절. 오류 코드 37개(4개를 더함), 서버 안의 일 13개(SPEC-074), 스키마 137개입니다. 결정 사항·열린 질문·스킬 결과 수는 그대로입니다.
- 원래 값 열기(API-077)도 운영자의 쓰기 명령처럼 요청 키를 받습니다(DEC-04). 요청 키 기록에는 ID와 상태만 두므로(05단계 TBL-050) 같은 키로 다시 오면 다시 열어 같은 응답을 돌려주고 접속기록도 한 행 더 남깁니다(SPEC-074의 반복).
- 결정 카드의 '접속기록 1년 이상'은 알레르기 답이 민감정보일 때를 대비해 2년으로 두었고(05단계 A24), 사장님의 손님 기록 읽기도 남깁니다(REQ-196). 접속기록을 보는 화면은 첫 버전에 없습니다.
- 검사: 12절의 2026-11-14 05:48 KST 결과.
