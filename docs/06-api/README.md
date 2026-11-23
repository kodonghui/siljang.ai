# 06단계 API 계약: 수제케이크 주문제작 API

상태: 확정(2026-11-12 14:01 동희님 '추천대로 굳힘', 14절). 원본은 [`api/openapi.yaml`](../../api/openapi.yaml)(OpenAPI 3.1)이고, 사람이 보는 곳은 Swagger UI 페이지 [Siljang API 계약](https://claude.ai/artifact/EKihED8HYG5vXWT3YQfUom)입니다(`truth: source`, 3절). 계약 파일과 이 문서의 표는 [`research/cake-api-2026-11/`](../../research/cake-api-2026-11/)의 목록에서 `build_api.py`가 함께 만들어서, 둘이 어긋나지 않습니다. 계약 파일은 손으로 고치지 않습니다.

## 1. 한눈에

<!-- BEGIN generated:counts -->
API 83개 · 응답 418개 · 오류 코드 38개 · 필드 오류 사유 24개 · 확인할 것 9개 · 스킬 결과 50개 · 결정 사항 30개 · 열린 질문 1개 · 서버 안의 일 13개 · 스키마 153개
<!-- END generated:counts -->

- 사장님 화면이 호출하는 API가 64개(로그인 시작·로그인·로그아웃 포함), 운영자 화면이 13개, 손님이 여는 예약 링크 페이지가 2개, 카카오 오픈빌더가 호출하는 스킬이 4개입니다(4절. 안내 스킬 API-073은 우리 서버가 부른 카카오 Event API를 거쳐 옴). 기능 명세 SPEC-001~079가 모두 API 하나 이상에 이어집니다.
- API마다 응답 목록(성공·422·401·403·404·409·default)을 포함하거나, 포함하지 않는 사유를 `x-corthex.omit`에 적었습니다. 응답 하나는 `API-001#401`처럼 부르고, 모든 응답에 이름 붙은 예시가 있습니다. 예시는 지어낸 가게 '달빛케이크'의 값입니다.
- 오류는 한 형식(RFC 9457 Problem Details에 `code`·`traceId`를 더함)이고 오류 코드는 목록 하나(6절)에만 있습니다. 화면이 보일 말과 할 일도 코드마다 적었습니다.
- 카카오 스킬은 늘 200과 스킬 응답을 반환하고, 결과는 `Siljang-Outcome` 헤더와 예시 이름으로 나눕니다(DEC-07, 7절). AI 모델 실패·느림·키 없음·사용 한도·가게 비용 한도는 저마다 결과 코드를 갖고, 손님에게는 모두 "사장님 확인 뒤 답드릴게요"로 에스컬레이션합니다(AI-1).
- 요청 필드에는 05단계 테이블.컬럼의 한도를 달았습니다. 검사 도구가 계약이 허용하는 값을 만들어 실제 DB 컬럼의 타입과 CHECK에 넣어 보고, 막히는 값이 없음을 확인했습니다(12절).
- 목 서버 Prism이 계약을 읽어 모든 응답 예시를 그대로 반환하고, 계약 테스트 도구 Schemathesis도 계약을 읽어 예시 단계를 통과했습니다(12절).
- 체크포인트: 2026-11-12 14:01 동희님이 API 72개와 결정 사항 19개(8절)를 추천대로 확정하셨습니다(14절). DEC-12의 조건은 요구사항 버전 4 REQ-164가 되었습니다. 2026-11-13 설계 재검토(환불 길)로 응답에 필드 7개를 더한 깨지는 변화가 있습니다(11절, 15절). 같은 재검토의 H6·H11·H12로 스킬 결과 2개(`orderer_saved`·`input_invalid`)와 제작 목록 요약 필드를 더하고, 주문·변경 요청의 `revision`을 쓸 때마다 오르는 잠금 번호로 만들었습니다(15절). H7·H8·H9로 안내 스킬 API-073, 채널 연결의 버튼 블록 ID·시험 버튼·먼저 보내기 상태, 주문 요청 카드의 규정 글을 더하고(DEC-20~22, OPEN-9), 요청과 응답에 꼭 있는 필드 8개를 더한 깨지는 변화가 있습니다(11절, 15절). H3으로 상담 상태 `ended`(상담 끝남)를 더하고, 끝나고 30일이 지나 보관 기록이 된 주문은 목록에서 빼고 하나를 읽으면 404로 하는 공통 규칙을 더했습니다(5절, 15절). H4로 운영자의 가게 기록 보기(API-074~076, 가린 값)와 사유를 적은 원래 값 열기(API-077), 접속기록(SPEC-074), 결제 계좌의 암호화와 예금주 확인(API-013·014·024·025)을 더하고, 응답에 꼭 있는 필드 1개를 더한 깨지는 변화가 있습니다(5절, 11절, 15절). H5·H10으로 주문 요청 카드 앞의 알레르기 정보 카드와 AI를 거치지 않는 알레르기 답 블록(버튼 블록 다섯), 완성 사진·후기 사진마다의 게시 동의를 더하고 주문 요청 때의 사진 게시 동의를 뺐으며, 응답 필드 1개를 없애고 1개를 더한 깨지는 변화가 있습니다(11절, 15절. 잠정, 5-2 질문 4·6의 답으로 다시 봄). M1·M2·M3·M9·M10으로 사장님 답 기다림의 끝('답 없어 닫힘'), 결제 안내가 손님에게 전해진 시각과 결제 기한 상한, 확인할 것 `past_cutoff`와 사장님이 고르는 날의 휴무일·다 찬 날 확인을 더하고, 응답에 꼭 있는 필드 4개를 더하고 고를 값 1개(`parked`)를 없앤 깨지는 변화가 있습니다(11절, 15절). Codex 후속(2026-11-14)으로 더 들어온 금액의 환불 계산값을 넘은 몫으로 고치고(API-049) 환불 금액 한도를 1억 원으로 넓혔으며, 운영자의 상담 보기에서 대화 글을 빼고 사유를 적어 여는 대상 `consultation_text`를 더해 응답 필드 1개를 없애고 2개를 더한 깨지는 변화가 있습니다(11절, 15절). M4·M13으로 환불 계산의 차례와 근거(바탕에서 뺀 금액·쓴 제작 전 비율·기준 픽업 일시·재제작 주문), 금액이 내려간 변경의 차액 돌려주기, 단계별 환불의 규칙을 적고 재제작 주문의 환불을 원래 주문에 남기며(재제작 주문의 변경은 금액이 그대로일 때만), 응답 필드 4개를 더하고 요청 필드 1개를 없앤 깨지는 변화가 있습니다(11절, 15절). M5·M6으로 사장님이 손님이 본 금액보다 높게 정한 맞춤 주문과 금액이 오르는 변경은 손님이 새 금액 확인 카드에서 확인한 뒤에 계좌를 보이고(SPEC-076, 스킬 결과 `amount_confirmed`·`amount_declined`), '부터'·'범위' 견적의 요청한 금액과 정한 금액(아래 끝 이상), 가격표 버전마다 사장님이 정하는 기본 디자인 범위(`inStandard`), 맞추는 중인 차액 결제의 '변경 닫기'를 더하고, 변경 요청의 금액 차이를 방향과 양수로 받게 했으며(DEC-23), 닿지 않던 변경 상태 '오래된 버전'과 오류 코드 `stale_change`를 없애, 응답 필드 1개를 없애고 5개를 더하고 요청 필드 1개와 오류 코드 1개, 고를 값 `stale`·`stale_change`를 없앤 깨지는 변화가 있습니다(11절, 15절). M11·M14로 가게 신원 정보(사업장 주소·전자우편주소·통신판매업 신고를 받은 기관)를 가게 등록·가게 설정·예약 링크 페이지·운영자의 영업 신고 확인에 더하고, 가게 설정에서 바로 고치는 값과 '가게가 정한' 값을 쓰는 때(REQ-243·244), 상호·대표자·사업자등록번호의 변경 요청과 운영자의 반영·보류(API-080~082, 오류 코드 `identity_change_pending`), 규정 글 끝의 미성년자 취소 고지와 확정 안내의 결제가 확인된 금액·가게 신원을 더해, 요청에 꼭 넣을 필드 2개와 응답에 꼭 있는 필드 8개를 더한 깨지는 변화가 있습니다(11절, 15절). M12로 보상을 정할 때 사장님이 고르는 문제 종류(상함·변질·이물·그 밖), 상함·변질이나 이물의 보상 없음 앞의 소비자분쟁해결기준 확인과 사유(확인할 것 `no_compensation_standard`), 그 밖의 보상(사장님이 직접 처리, 환불·장부 쓰기 없음), 기한 뒤 신고를 막지 않는 말, 같은 카카오 사용자에게서만 받는 변경·취소·신고와 다른 사용자에게 주는 같은 답, 에스컬레이션 건에서 문제 신고로 남기기(API-083, DEC-24)를 더해, 요청에 꼭 넣을 필드 1개와 응답에 꼭 있는 필드 7개를 더한 깨지는 변화가 있습니다(11절, 15절).

## 2. 읽은 것과 만든 것

| 읽은 것 | 버전 | 쓴 것 |
| --- | --- | --- |
| [`docs/04-functional-spec/spec.md`](../04-functional-spec/spec.md) | 04단계 확정(2026-11-12), 커밋 af62db2 | SPEC-001~069의 주 플로우·예외·수락 기준, 공통 규칙 G1~G9, 상태 머신 1-1~1-8, AI-1(상담 답 만들기) |
| [`db/schema.sql`](../../db/schema.sql) | 05단계 확정(2026-11-12 11:56), 커밋 af62db2 | 요청 필드의 한도(TBL-001~051의 컬럼), 상태 값, 응답에 포함하는 필드 |
| [`docs/02-prd/requirements.md`](../02-prd/requirements.md) | 버전 3(REQ-001~163). 지금 설명의 번호는 버전 5(REQ-001~266)를 따름(설계 재검토 낮음 K2에서 K1이 바꾼 REQ-118→259·REQ-183→260을 고침, 깨지는 변화 목록의 지난 항목은 그대로) | 설명에 단 REQ 번호 |
| [`docs/01-domain/domain.md`](../01-domain/domain.md) | TERM-001~074 | 이름 |
| 카카오 비즈니스 공식 문서: [스킬 만들기](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/make_skill), [응답 형식](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/answer_json_format), [콜백](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/ai_chatbot_callback_guide), [플러그인 값](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/apply_skill_to_plugin), [이벤트 API](https://kakaobusiness.gitbook.io/main/tool/chatbot/main_notions/event-api) | 2026-11-12에 읽음 | 스킬 요청·응답의 필드와 한도, 헤더 값 인증(DEC-08), 콜백, 보안 이미지 플러그인. 문서에 없는 것은 9절 열린 질문 |
| 카카오 비즈니스 [이벤트 API](https://kakaobusiness.gitbook.io/main/tool/chatbot/main_notions/event-api)(발송 결과 조회 포함)와 [월렛](https://kakaobusiness.gitbook.io/main/tool/chatbot/main_notions/wallet), 카카오 디벨로퍼스 [카카오톡 채널 REST API](https://developers.kakao.com/docs/ko/kakaotalk-channel/rest-api) | 2026-11-13에 다시 읽음(설계 재검토 H7) | Event API 요청과 taskId, 발송 결과 조회와 errorType, 월렛 연결 조건, 채널 관계 조회(DEC-20, DEC-21). 문서로 확인되지 않은 권한은 OPEN-9 |

빠진 입력: 계약서는 화면이 있으면 사이트맵(SCR)도 읽으라 합니다. 사이트맵은 이 뒤의 07단계라 아직 없어서, API는 플로우(FL)와 SPEC에서 화면이 할 일을 읽어 만들었습니다. 07·08단계에서 화면이 더 필요한 API가 나오면 계약에 더합니다(13절).

| 만든 것 | 무엇 |
| --- | --- |
| [`api/openapi.yaml`](../../api/openapi.yaml) | 원본 계약. API마다 `operationId`와 `x-corthex`(API ID, SPEC ID, 뺀 응답과 사유, 케이스 유형 근거), 응답마다 예시. `components.x-corthex`에 오류 코드·필드 오류 사유·확인할 것·스킬 결과·결정 사항·열린 질문·서버 안의 일·깨지는 변화 |
| [`research/cake-api-2026-11/`](../../research/cake-api-2026-11/) | `api_catalog.py`(오류 코드·결과·결정 사항·열린 질문), `api_schemas.py`(스키마), `api_examples.py`(예시), `api_ops.py`(API 83개), `build_api.py`(계약 파일과 이 문서의 표를 만듦), `check_api.py`(검사), `requirements.txt`(검사 도구 버전), `build_viewer.py`와 `viewer.html`(검토 도구 Swagger UI 페이지를 만듦, 3절) |

다시 만들고 검사하는 법(저장소 맨 위에서):

```sh
python3 -B research/cake-api-2026-11/build_api.py . --write
python -m venv .venv-api && .venv-api/bin/pip install -r research/cake-api-2026-11/requirements.txt
.venv-api/bin/python -B research/cake-api-2026-11/check_api.py . --db "host=… port=… user=…" --mock http://127.0.0.1:4010
```

`--db`는 검사용 PostgreSQL 서버입니다. 검사용 DB `api_check_schema`를 만들고 끝나면 지우니 운영 서버에는 쓰지 않습니다. `--mock`은 아래 목 서버 주소입니다.

## 3. 보는 법

- **Swagger UI 페이지(바로 보기)**: [Siljang API 계약](https://claude.ai/artifact/EKihED8HYG5vXWT3YQfUom)에서 설치 없이 봅니다. 동희님 계정의 비공개 페이지라 다른 사람은 공유해야 열립니다. 원본을 그대로 보여 주고, API 이름 앞의 API ID와 설명 끝의 '반환하지 않는 응답'만 `x-corthex`에서 옮겨 붙였습니다. 계약이 바뀌면 `build_viewer.py`로 다시 만들어(아래) 같은 주소에 올립니다. 작업 계정을 옮길 때마다(2026-11-12 밤, 2026-11-13) 새 주소로 다시 올렸고, 옛 주소의 페이지는 더 고치지 않습니다. 2026-11-15 14:57 KST에 설계 재검토를 모두 고친 main(`e4067ce`)의 계약으로 다시 만들어 같은 주소에 올렸습니다(버전 `1794722233-42e3`). 2026-11-16 12:34 KST에 일의 끝에 한 번 올리기(2026-11-15 동희님 지시, [진행 기록](../records/progress.md))로 main `0e3ff83`의 계약(PR #48(`220f09d`)과 [PR #61](https://github.com/kodonghui/siljang.ai/pull/61)에서 바뀐 계약 포함)으로 다시 만들어 같은 주소에 올렸고(버전 `1794800056-dbf8`), 올린 파일을 다시 받아 원본과 같음을 봤습니다. 계약은 그 뒤 `d301608`까지 바뀌지 않았습니다.
- **Swagger UI(내 컴퓨터)**: `docker run --rm -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml -v "$PWD/api:/api" swaggerapi/swagger-ui`를 돌리고 http://localhost:8080 을 엽니다. 도커가 없으면 https://editor.swagger.io 에 `api/openapi.yaml`을 끌어 놓아도 됩니다. API는 태그(로그인·가게·주문 …)로 묶여 있고, 응답마다 예시를 골라 볼 수 있습니다.
- **목 서버**(화면 개발과 QA가 서버 없이 쓰는 곳): `npx @stoplight/prism-cli@5.14.2 mock api/openapi.yaml`을 돌리면 http://127.0.0.1:4010 에서 계약대로 답합니다. 맞는 요청은 성공 응답의 첫 예시, 로그인 없는 요청은 401의 첫 예시, 틀린 입력은 422의 첫 예시(`validation_failed`)를 받습니다. 다른 응답은 헤더로 고릅니다.

```sh
curl -H 'Cookie: siljang_owner=example' http://127.0.0.1:4010/owner/orders/68598d4e-7858-598f-aa63-2b51daa7d590
curl -X POST -H 'Cookie: siljang_owner=example' -H 'Idempotency-Key: ui-0123456789abcdef' \
     -H 'Prefer: code=409, example=version_conflict' -H 'Content-Type: application/json' \
     -d '{"baseRevision":"x","decision":"accept"}' \
     http://127.0.0.1:4010/owner/orders/68598d4e-7858-598f-aa63-2b51daa7d590/custom-decision
```

페이지 재생성: `npm pack swagger-ui-dist@5.17.14`로 받은 꾸러미의 `package/swagger-ui.css`를 넣어 `python3 -B research/cake-api-2026-11/build_viewer.py . 나갈_폴더 --css package/swagger-ui.css`를 돌리면 `siljang-api-contract.html`과 `openapi.json`이 나옵니다. 스타일시트는 버전이 섞이지 않게 SHA-256을 확인합니다. 페이지 머리말의 계약 버전과 숫자(API·응답·오류 코드·결정 사항·열린 질문)는 원본 계약에서 세어 넣고, '고침' 날짜는 `api/openapi.yaml`을 마지막으로 바꾼 커밋의 날짜(KST)입니다.

## 4. API 목록

'호출하는 쪽'의 사장님·운영자는 세션 쿠키(`siljang_owner`, `siljang_operator`), 스킬 키는 오픈빌더 헤더 값(`Siljang-Skill-Key`)입니다. '응답'은 그 API가 반환할 수 있는 상태 전부입니다.

<!-- BEGIN generated:operations -->
| ID | API | 방법·경로 | operationId | 호출하는 쪽 | SPEC | 응답 |
| --- | --- | --- | --- | --- | --- | --- |
| API-001 | 사장님 로그인(카카오 인가 코드) | `POST /owner/session` | `createOwnerSession` | 누구나 | SPEC-001, SPEC-068 | 200 · 401 · 422 · 429 · 503 · default |
| API-002 | 로그인한 사장님과 가게, 상단 배너 | `GET /owner/me` | `getOwnerMe` | 사장님 | SPEC-001, SPEC-067 | 200 · 401 · default |
| API-003 | 사장님 로그아웃 | `DELETE /owner/session` | `deleteOwnerSession` | 사장님(없어도 됨) | SPEC-001 | 204 · default |
| API-004 | 운영자 로그인(이메일·비밀번호·2단계 인증) | `POST /operator/session` | `createOperatorSession` | 누구나 | SPEC-001 | 200 · 401 · 422 · 429 · 503 · default |
| API-005 | 로그인한 운영자 | `GET /operator/me` | `getOperatorMe` | 운영자 | SPEC-001 | 200 · 401 · default |
| API-006 | 운영자 로그아웃 | `DELETE /operator/session` | `deleteOperatorSession` | 운영자(없어도 됨) | SPEC-001 | 204 · default |
| API-007 | 사진 업로드(신고증·도안·완성 사진) | `POST /owner/uploads` | `createUpload` | 사장님 | SPEC-002, SPEC-004, SPEC-053 | 201 · 401 · 413 · 422 · 429 · 503 · default |
| API-008 | 가게 등록 | `POST /owner/shop` | `registerShop` | 사장님 | SPEC-002, SPEC-068 | 201 · 401 · 409 · 422 · 503 · default |
| API-009 | 내 가게 조회 | `GET /owner/shop` | `getShop` | 사장님 | SPEC-002, SPEC-003, SPEC-009, SPEC-077, SPEC-078 | 200 · 401 · 404 · default |
| API-010 | 가게 설정 수정 | `PATCH /owner/shop` | `updateShop` | 사장님 | SPEC-077, SPEC-009, SPEC-017, SPEC-024, SPEC-025, SPEC-052 | 200 · 401 · 404 · 409 · 422 · default |
| API-011 | 보류된 영업 신고 재업로드 | `PUT /owner/shop/license` | `resubmitLicense` | 사장님 | SPEC-003 | 200 · 401 · 404 · 409 · 422 · default |
| API-012 | 영업 신고 확인할 가게 목록 | `GET /operator/shops` | `listReviewShops` | 운영자 | SPEC-003, SPEC-002 | 200 · 401 · 422 · default |
| API-013 | 영업 신고 확인할 가게 하나 | `GET /operator/shops/{shopId}` | `getReviewShop` | 운영자 | SPEC-003, SPEC-078 | 200 · 401 · 404 · default |
| API-014 | 영업 신고 확인·보류 | `POST /operator/shops/{shopId}/license-review` | `reviewLicense` | 운영자 | SPEC-003, SPEC-078 | 200 · 401 · 404 · 409 · 422 · default |
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
| API-041 | 에스컬레이션 건 하나 | `GET /owner/handoffs/{handoffId}` | `getHandoff` | 사장님 | SPEC-022, SPEC-023, SPEC-021, SPEC-079 | 200 · 401 · 404 · default |
| API-042 | 에스컬레이션 건 답변 | `POST /owner/handoffs/{handoffId}/answer` | `answerHandoff` | 사장님 | SPEC-023, SPEC-024, SPEC-066, SPEC-029 | 200 · 401 · 404 · 409 · 422 · default |
| API-043 | 상담 대화 조회 | `GET /owner/consultations/{consultationId}/messages` | `listConsultationMessages` | 사장님 | SPEC-021, SPEC-019, SPEC-068, SPEC-065 | 200 · 401 · 404 · 422 · default |
| API-044 | 주문 목록 | `GET /owner/orders` | `listOrders` | 사장님 | SPEC-031, SPEC-037, SPEC-068 | 200 · 401 · 404 · 422 · default |
| API-045 | 주문 하나 | `GET /owner/orders/{orderId}` | `getOrder` | 사장님 | SPEC-031, SPEC-013, SPEC-045, SPEC-068 | 200 · 401 · 404 · default |
| API-046 | 맞춤 주문 검토(수락·금액 변경 수락·거절) | `POST /owner/orders/{orderId}/custom-decision` | `decideCustomOrder` | 사장님 | SPEC-031, SPEC-015, SPEC-032, SPEC-076 | 200 · 401 · 404 · 409 · 422 · default |
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
| API-059 | 입금 대조(입금됨·미입금·금액 불일치·대조 완료·들어옴·결제 확인 취소·변경 닫기) | `POST /owner/payment-requests/{paymentRequestId}/reconciliation` | `reconcilePaymentRequest` | 사장님 | SPEC-034, SPEC-035, SPEC-036, SPEC-045, SPEC-015, SPEC-064, SPEC-070, SPEC-071, SPEC-044, SPEC-076 | 200 · 401 · 404 · 409 · 422 · default |
| API-060 | 환불 하나(손님 환불 계좌 포함) | `GET /owner/refunds/{refundId}` | `getRefund` | 사장님 | SPEC-047, SPEC-049, SPEC-021 | 200 · 401 · 404 · default |
| API-061 | 환불 '보냄' 표시 | `POST /owner/refunds/{refundId}/sent` | `markRefundSent` | 사장님 | SPEC-047, SPEC-049, SPEC-066, SPEC-064, SPEC-067 | 200 · 401 · 404 · 409 · 422 · default |
| API-062 | 변경 요청 하나 | `GET /owner/change-requests/{changeRequestId}` | `getChangeRequest` | 사장님 | SPEC-042, SPEC-041, SPEC-043, SPEC-044 | 200 · 401 · 404 · default |
| API-063 | 변경 요청 응답(수락·거절) | `POST /owner/change-requests/{changeRequestId}/decision` | `decideChangeRequest` | 사장님 | SPEC-042, SPEC-043, SPEC-045, SPEC-015, SPEC-032, SPEC-076 | 200 · 401 · 404 · 409 · 422 · default |
| API-064 | 문제 신고 하나 | `GET /owner/issue-reports/{issueReportId}` | `getIssueReport` | 사장님 | SPEC-058, SPEC-059, SPEC-057, SPEC-079 | 200 · 401 · 404 · default |
| API-065 | 보상 결정(문제 종류와 재제작·일부 환불·전액 환불·그 밖의 보상·없음) | `POST /owner/issue-reports/{issueReportId}/compensation` | `decideCompensation` | 사장님 | SPEC-059, SPEC-060, SPEC-047, SPEC-015 | 200 · 401 · 404 · 409 · 422 · default |
| API-066 | 후기와 사진 게시 동의 | `GET /owner/reviews` | `listReviews` | 사장님 | SPEC-062, SPEC-063 | 200 · 401 · 404 · 422 · default |
| API-067 | 포트폴리오와 올릴 수 있는 사진 | `GET /owner/portfolio` | `getPortfolio` | 사장님 | SPEC-063 | 200 · 401 · 404 · default |
| API-068 | 포트폴리오 게시 | `POST /owner/portfolio/items` | `addPortfolioItem` | 사장님 | SPEC-063 | 201 · 200 · 401 · 409 · 422 · default |
| API-069 | 포트폴리오 게시 취소 | `DELETE /owner/portfolio/items/{portfolioItemId}` | `removePortfolioItem` | 사장님 | SPEC-063 | 200 · 401 · 404 · 409 · 422 · default |
| API-070 | 손님 메시지 수신(카카오 오픈빌더 스킬) | `POST /kakao/skills/message` | `receiveCustomerMessage` | 스킬 키 | SPEC-017, SPEC-018, SPEC-019, SPEC-020, SPEC-021, SPEC-022, SPEC-025, SPEC-026, SPEC-027, SPEC-028, SPEC-033, SPEC-040, SPEC-041, SPEC-046, SPEC-049, SPEC-056, SPEC-057, SPEC-066, SPEC-068, SPEC-069, SPEC-013, SPEC-014, SPEC-016, SPEC-008, SPEC-072, SPEC-075, SPEC-076 | 200 · 401 · 422 · default |
| API-071 | 손님 확인 카드 버튼(카카오 오픈빌더 스킬) | `POST /kakao/skills/card` | `pressConfirmCard` | 스킬 키 | SPEC-069, SPEC-029, SPEC-030, SPEC-033, SPEC-041, SPEC-046, SPEC-058, SPEC-063, SPEC-015, SPEC-032, SPEC-040, SPEC-072, SPEC-075, SPEC-053, SPEC-076, SPEC-044 | 200 · 401 · 422 · default |
| API-072 | 후기 수신(카카오 오픈빌더 스킬) | `POST /kakao/skills/review` | `submitReview` | 스킬 키 | SPEC-062, SPEC-019, SPEC-061, SPEC-008 | 200 · 401 · 422 · default |
| API-073 | 먼저 보내는 안내 보이기(카카오 Event API가 부르는 스킬) | `POST /kakao/skills/event` | `showNotice` | 스킬 키 | SPEC-066, SPEC-008, SPEC-053, SPEC-076, SPEC-036 | 200 · 401 · 422 · default |
| API-074 | 가게 기록 목록(가린 값) | `GET /operator/shops/{shopId}/records` | `listShopRecords` | 운영자 | SPEC-073, SPEC-074 | 200 · 401 · 404 · 422 · default |
| API-075 | 상담 하나(가린 값) | `GET /operator/shops/{shopId}/consultations/{consultationId}` | `getShopConsultation` | 운영자 | SPEC-073, SPEC-074 | 200 · 401 · 404 · 422 · default |
| API-076 | 주문 하나(가린 값) | `GET /operator/shops/{shopId}/orders/{orderId}` | `getShopOrder` | 운영자 | SPEC-073, SPEC-074 | 200 · 401 · 404 · default |
| API-077 | 원래 값·보관 기록·대화 글 열기(사유) | `POST /operator/shops/{shopId}/originals` | `openOriginal` | 운영자 | SPEC-073, SPEC-074 | 200 · 401 · 404 · 409 · 422 · default |
| API-078 | 사장님 로그인 시작(state) | `POST /owner/session/authorization` | `startOwnerLogin` | 누구나 | SPEC-001 | 200 · 422 · 429 · default |
| API-079 | 스킬 키 바꾸기 | `POST /owner/kakao-channel/skill-key` | `regenerateSkillKey` | 사장님 | SPEC-008, SPEC-017 | 200 · 401 · 404 · 409 · 422 · default |
| API-080 | 사업자 정보 변경 요청(상호·대표자·사업자등록번호) | `POST /owner/shop/identity-changes` | `requestIdentityChange` | 사장님 | SPEC-078 | 201 · 200 · 401 · 404 · 409 · 422 · 503 · default |
| API-081 | 사업자 정보 변경 요청 목록 | `GET /operator/identity-changes` | `listIdentityChanges` | 운영자 | SPEC-078 | 200 · 401 · 422 · default |
| API-082 | 사업자 정보 변경 반영·보류 | `POST /operator/identity-changes/{changeId}/review` | `reviewIdentityChange` | 운영자 | SPEC-078, SPEC-003 | 200 · 401 · 404 · 409 · 422 · default |
| API-083 | 에스컬레이션 건에서 문제 신고로 남기기 | `POST /owner/handoffs/{handoffId}/issue-report` | `reportIssueFromHandoff` | 사장님 | SPEC-079, SPEC-058, SPEC-059 | 201 · 200 · 401 · 404 · 409 · 422 · default |
<!-- END generated:operations -->

## 5. 공통 규칙

- **오류 형식**(DEC-01·02): 모든 오류는 `application/problem+json`의 Problem(`type`·`title`·`status`·`detail`·`instance`·`code`·`traceId`)입니다. 입력 오류는 모두 422 `validation_failed`이고 필드마다 `errors[{field, code}]`로 위치와 사유 코드만 포함합니다. 넣은 값과 서버 안 내용은 포함하지 않습니다. 없는 ID·다른 가게 ID·형식이 틀린 ID는 같은 404이고, 403은 쓰지 않습니다.
- **같은 상태로 가는 명령**(DEC-03): 이미 그 상태면 200과 `outcome: unchanged`, 다른 결정이 먼저 남았으면 409 `already_decided`입니다.
- **요청 키**(DEC-04): 사장님·운영자의 쓰기 명령은 `Idempotency-Key` 헤더를 꼭 보냅니다. 같은 키로 다시 오면 처음 결과의 상태 코드와 그 기록의 지금 상태, `Idempotency-Replayed: true`가 갑니다. 같은 키에 다른 내용은 422 `idempotency_key_reused`, 첫 요청을 처리하는 중이면 409 `request_in_progress`이고, 입력 검사 실패(422)와 서버 오류(5xx)는 남지 않아 같은 키로 다시 보낼 수 있습니다. 로그인이 필요함(401), 확인이 필요함(409 `confirmation_required`), 요청이 너무 많음(429)도 명령을 처리하지 않은 결과라 남지 않습니다(구현하며 좁힌 해석, 2026-11-15). 서버가 스스로 하는 결제 안내·환불·알림은 05단계 4절 A33의 이벤트 키로 한 번만 남습니다. 로그인·로그아웃·사진 올리기·구글 권한 요청 시작은 받지 않습니다.
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
| `validation_failed` | 422 | 입력 필드가 계약의 한도나 형식에 맞지 않음. 필드마다 errors에 위치와 사유 코드 | 입력한 내용을 확인해 주세요 | errors의 필드 옆에 사유를 보이고 넣은 값은 그대로 둠(G7 필드 오류) | G7 | 56개 |
| `idempotency_key_reused` | 422 | 같은 요청 키로 다른 명령이나 다른 내용을 보냄(서버가 요청 지문으로 가림, DEC-04) | 다시 시도해 주세요 | 새 요청 키를 만들어 다시 보냄(화면의 잘못이라 로그에 남김) | G2 | 34개 |
| `consent_required` | 422 | 개인정보 처리 위탁·재위탁 조건에 동의하지 않음. 넣은 값도 남기지 않음 | 개인정보 처리 위탁 조건에 동의해야 가게를 등록할 수 있어요 | 동의 체크박스를 보이고 넣은 값은 화면에만 둠(G7 동의 필요) | SPEC-002 | API-008 |
| `google_authorization_failed` | 422 | 구글 인가 코드가 틀렸거나 지났거나 시트 권한이 빠짐 | 구글 연결을 다시 해 주세요 | 구글 권한 요청을 처음부터 다시 하게 함 | SPEC-009 | API-035 |
| `sheet_not_accessible` | 422 | 고른 구글 시트나 탭을 받은 권한으로 열 수 없음 | 그 시트를 열 수 없어요. 주소와 탭 이름을 확인해 주세요 | 시트 주소 필드 옆에 사유를 보임 | SPEC-009 | API-035 |
| `unauthenticated` | 401 | 로그인(세션 쿠키)이 없거나 만료됨 | 다시 로그인해 주세요 | 로그인으로 보내고 로그인 뒤 원래 화면으로 돌아옴(SPEC-001) | SPEC-001 | 72개 |
| `kakao_login_failed` | 401 | 카카오 인가 코드가 틀렸거나 지났거나 사장님이 동의를 거부함. 또는 state가 로그인 시작(API-078)의 서명·10분·로그인 시작 쿠키와 맞지 않음(이때는 카카오를 호출하지 않음, DEC-10). 우리 쪽 기록은 남기지 않음 | 카카오 로그인을 다시 해 주세요 | 카카오 로그인 버튼을 다시 보이고, 누르면 로그인 시작(API-078)부터 다시 함 | SPEC-001 | API-001 |
| `operator_login_failed` | 401 | 운영자 이메일·비밀번호·2단계 인증 번호 가운데 맞지 않는 것이 있음(어느 것인지 알리지 않음) | 로그인 정보가 맞지 않아요 | 입력 필드를 비우고 다시 받음 | SPEC-001 | API-004 |
| `skill_key_invalid` | 401 | 카카오 스킬 요청의 스킬 키 헤더가 없거나, 그 연결의 지금 버전 키도 바꾼 뒤 24시간 안의 앞 버전 키도 아님(DEC-08, REQ-237) | (손님에게 보이지 않음) | 오픈빌더 스킬 설정의 헤더 값을 확인(사장님 채널 연결 화면의 안내). 키를 잃었으면 채널 연결 화면에서 스킬 키를 바꿔 새 키를 넣음(API-079) | SPEC-008 | API-070, API-071, API-072, API-073 |
| `not_found` | 404 | 경로의 기록이 없거나, 다른 가게 것이거나, ID 형식이 틀림. 셋을 구분하지 않음 | 찾을 수 없어요 | 목록으로 돌아가는 링크를 보임(G7 찾을 수 없음) | G1 | 35개 |
| `shop_not_registered` | 404 | 로그인한 사장님에게 아직 가게가 없음 | 가게를 먼저 등록해 주세요 | 가게 등록 화면으로 보냄 | SPEC-001 | 31개 |
| `not_set` | 404 | 아직 정하지 않은 설정(결제 수단·영업 캘린더·카카오톡 채널·장부) | 아직 정하지 않았어요 | 빈 입력 화면을 보임 | SPEC-006 | 10개 |
| `method_not_allowed` | 405 | 경로는 있지만 그 방법(GET·POST 등)은 계약에 없음. Allow 헤더에 되는 방법을 포함함 | 지원하지 않는 요청이에요 | 화면 코드의 잘못이라 추적 ID와 함께 로그에 남김 | G7 | 계약에 없는 방법으로 호출한 모든 경로(DEC-02) |
| `version_conflict` | 409 | 화면이 본 뒤에 그 기록이 바뀜(baseRevision이 지금과 다름). 아무것도 바꾸지 않음 | 그 사이 바뀌었어요. 지금 상태를 확인해 주세요 | 지금 상태를 다시 읽어(GET) 보이고 다시 고르게 함(G7 이미 바뀜) | G3 | 28개 |
| `invalid_state` | 409 | 지금 상태에서는 할 수 없는 명령(상태 머신 1-1~1-8이 허용하지 않음) | 지금 상태에서는 할 수 없어요 | detail을 보이고 지금 상태를 다시 읽음(G7 그 상태에서는 할 수 없음) | G7 | 16개 |
| `already_decided` | 409 | 다른 결정이 이미 남음(이미 처리됨·이미 답함) | 이미 처리됐어요 | 먼저 남은 결정을 다시 읽어 보임(G7 이미 처리됨) | G3 | 11개 |
| `order_cancelled` | 409 | 그 사이 손님이나 가게가 주문을 취소함 | 그 사이 주문이 취소됐어요 | 주문을 다시 읽어 취소된 상태를 보임 | SPEC-031 | API-046, API-063 |
| `confirmation_required` | 409 | 확인을 받아야 저장하는 일. confirm에 확인할 것 목록. 아무것도 바꾸지 않음 | 저장하기 전에 확인해 주세요 | confirm의 말을 보이고, 사장님이 확인하면 같은 요청에 confirm 값을 담아 새 요청 키로 다시 보냄 | SPEC-005 | 9개 |
| `already_registered` | 409 | 이 카카오 계정에 이미 가게가 있음(계정 하나에 가게 하나, R2) | 이미 등록한 가게가 있어요 | 내 가게 조회(API-009)를 엶 | SPEC-002 | API-008 |
| `channel_setup_incomplete` | 409 | 카드 버튼이 부를 블록 ID 다섯 가운데 빈 것이 있어 연결 확인을 시작하지 않음(REQ-206). 아무것도 바꾸지 않음 | 버튼 블록 ID 5개를 모두 넣어 주세요 | 빈 블록 ID 필드를 보이고 채널 연결 입력(API-031)으로 보냄 | SPEC-008 | API-032 |
| `channel_linked_elsewhere` | 409 | 그 오픈빌더 봇이 이미 다른 가게에 연결됨. 묶지 않고 운영자에게 알림 | 이미 다른 가게에 연결된 채널이에요 | 다른 채널을 고르게 하고 우리 서비스 채널로 문의하게 함(G7 이미 다른 가게) | SPEC-008 | API-031, API-032 |
| `slot_released` | 409 | 결제 기한이 지나 자리가 풀린 결제 안내라 '입금됨'을 받지 않음(R14) | 자리가 풀린 주문이에요. 먼저 '결제 기한 연장'으로 자리를 다시 잡아 주세요 | 결제 기한 지난 주문의 결제 기한 연장 화면으로 보냄 | SPEC-034 | API-059 |
| `undo_window_passed` | 409 | 표시한 지 5분이 지나 되돌릴 수 없음 | 5분이 지나 되돌릴 수 없어요 | 제작 기록을 다시 읽어 보임 | SPEC-051 | API-053 |
| `photo_consent_missing` | 409 | 손님이 게시에 동의하지 않았거나 동의를 철회한 사진 | 손님이 게시에 동의한 사진만 올릴 수 있어요 | 그 사진의 동의 상태를 보임 | SPEC-063 | API-068 |
| `payment_account_missing` | 409 | 결제 계좌가 등록되지 않은 가게라 영업 신고 확인됨을 남기지 않음(REQ-197). 보류는 남길 수 있음. 아무것도 바꾸지 않음 | 결제 계좌 등록을 기다리고 있어요. 사장님이 계좌를 등록하면 확인할 수 있어요 | '결제 계좌 등록 기다림'을 보이고 '확인됨'을 막음. 보류는 그대로 고를 수 있음 | SPEC-003 | API-014 |
| `holder_not_verified` | 409 | 영업 신고가 확인된 가게에서 새 예금주가 확인된 대표자·상호나 운영자가 확인한 예금주와 다름(REQ-199). 저장하지 않고 결제 안내의 계좌도 그대로 | 확인된 예금주와 다른 계좌로는 바꿀 수 없어요. 우리 서비스 채널로 문의해 주세요 | 예금주 필드 옆에 사유와 문의 방법을 보이고 넣은 값은 그대로 둠 | SPEC-006 | API-025 |
| `identity_change_pending` | 409 | 확인을 기다리는 사업자 정보 변경 요청이 있음(가게마다 하나, SPEC-078). 사장님의 새 변경 요청은 남기지 않고, 운영자의 영업 신고 확인됨은 그 요청을 먼저 반영·보류해야 남김(SPEC-003). 아무것도 바꾸지 않음 | 확인을 기다리는 변경 요청이 있어요 | 그 변경 요청을 보임(사장님은 영업 신고 화면의 identityChange, 운영자는 pendingIdentityChange로 가는 링크) | SPEC-078 | API-080, API-014 |
| `original_not_kept` | 409 | 원래 값을 두지 않는 값(카드번호의 끝 4자리 밖, 주민등록번호처럼 보이는 숫자와 무엇인지 모르는 긴 숫자, REQ-192)이라 열 수 없음. 접속기록에 열기 행을 남기지 않음 | 원래 값을 두지 않아요 | 그 값 옆에 '원래 값을 두지 않아요'를 보이고 열기를 막음 | SPEC-073 | API-077 |
| `original_erased` | 409 | 지우기 작업이 그 값을 이미 비움(끝나고 30일 지난 주문의 주문자 이름·연락처와 환불 계좌, 닫히고 30일 지난 상담의 대화 글, SPEC-065). 접속기록에 열기 행을 남기지 않음. 보관 기록이 된 주문의 주문자 이름은 보관 기록 열기로 봄 | 지워진 값이에요 | 그 값 옆에 '지워졌어요'를 보이고, 보관 기록이 된 주문이면 '보관 기록 열기'를 보임 | SPEC-073 | API-077 |
| `request_in_progress` | 409 | 같은 요청 키의 첫 요청을 아직 처리하는 중(받은 뒤 60초가 지나도 끝나지 않으면 다음 요청이 이어받음, DEC-04) | 처리하고 있어요. 잠시 뒤 다시 확인해 주세요 | 1초 뒤 같은 요청 키로 다시 보냄 | G2 | 34개 |
| `file_too_large` | 413 | 파일이 그 용도의 한도(신고증·도안 10MB, 완성 사진 20MB)를 넘음 | 사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요 | 파일 필드 옆에 한도를 보임 | SPEC-002 | API-007 |
| `rate_limited` | 429 | 같은 곳에서 너무 자주 호출함(예약 링크 페이지 1분 60번, 사장님 로그인 1분 10번) | 잠시 뒤 다시 시도해 주세요 | Retry-After 초 뒤에 다시 호출함 | SPEC-011 | API-078, API-001, API-007, API-038, API-039 |
| `too_many_attempts` | 429 | 운영자 로그인 실패가 15분에 5번을 넘음 | 잠시 뒤 다시 로그인해 주세요 | Retry-After 초 동안 로그인 버튼을 막음 | SPEC-001 | API-004 |
| `internal` | 500 | 예상하지 못한 서버 오류. 내용은 로그에만(마스킹한 값과 추적 ID) | 문제가 생겼어요. 다시 시도해 주세요 | 다시 시도 버튼과 추적 ID를 보임(G7 서버 실패) | G7 | 83개 |
| `kakao_unavailable` | 503 | 카카오 로그인 서버가 답하지 않음 | 카카오에 연결하지 못했어요. 잠시 뒤 다시 해 주세요 | 다시 시도 버튼 | SPEC-001 | API-001 |
| `google_unavailable` | 503 | 구글 서버가 답하지 않음 | 구글에 연결하지 못했어요. 잠시 뒤 다시 해 주세요 | 다시 시도 버튼 | SPEC-009 | API-035 |
| `storage_unavailable` | 503 | 사진 저장소에 쓰지 못함. 등록·저장 전체를 남기지 않음 | 사진을 저장하지 못했어요. 다시 올려 주세요 | 파일을 다시 고르게 함 | SPEC-002 | API-007, API-008, API-080 |
| `auth_unavailable` | 503 | 운영자 인증 서비스(Supabase Auth)가 답하지 않음(DEC-27) | 로그인 서비스에 연결하지 못했어요. 잠시 뒤 다시 해 주세요 | 다시 시도 버튼 | SPEC-001 | API-004 |
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
| `upload_not_found` | 올린 파일이 없거나, 1시간이 지났거나, 다른 사장님이 올린 것. 셋을 구분하지 않음(DEC-02, DEC-09) |
| `upload_wrong_purpose` | 다른 용도로 올린 파일 |
| `reference_not_found` | 본문·쿼리가 가리킨 다른 기록(도안·변경 요청·결제 안내·사진 등)이 없거나 이 가게·주문 것이 아님. 둘을 구분하지 않음(DEC-02) |
| `conflict` | 다른 행과 충돌함(같은 옵션 조합이 허용이자 금지) |
| `overlaps` | 단계별 환불 기간이 중복됨 |
| `gap` | 단계별 환불 기간 사이가 빔 |
| `exceeds_received` | 환불 금액이 받은 금액에서 이미 정한 환불을 뺀 값을 넘음 |
| `below_calculated` | 보상이 아닌 환불 금액이 환불 계산값보다 낮음(REQ-170) |
| `below_quote_min` | 정한 금액이 '부터'·'범위' 견적의 아래 끝보다 낮음(REQ-230) |
| `exceeds_card_limit` | 취소·환불 조문으로 만든 주문 요청 카드의 규정 글(끝의 청약철회 제한 문장과 미성년자 취소 고지까지)이 1,000자 글 둘에 들어가지 않음(REQ-184, REQ-240) |
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
| `closed_day_with_orders` | API-027, API-029 | 잡힌 자리나 확정 주문이 있는 날을 휴무로 바꿈. 주문과 자리는 그대로 남음(REQ-041, REQ-261) | 잡힌 자리와 확정 주문 {count}건은 그대로 남아요. 휴무로 바꿀까요? | SPEC-007 |
| `capacity_below_held` | API-027, API-029 | 잡힌 자리나 확정 자리보다 하루 최대 개수를 낮춤. 저장 전에 관련 주문을 보이고 확인받음(REQ-261) | 이미 잡힌 자리 {count}개는 그대로 남아요. 하루 최대 개수를 줄일까요? | SPEC-007 |
| `overbooking` | API-046, API-047, API-063, API-065 | 하루 최대 개수에 닿은 날에 사장님이 고르는 주문(맞춤 주문 수락·날짜 변경 수락·결제 기한 연장·재제작)을 마감 후 추가 수락(R10, REQ-226). 그날은 다른 손님에게 계속 마감 | 그날 남은 자리가 없어요. 추가로 받을까요? | SPEC-031 |
| `not_pickup_day` | API-054 | 픽업 날짜 전에 인도를 기록함 | 오늘이 픽업 날이 아니에요. 그래도 인도를 기록할까요? | SPEC-054 |
| `closed_day` | API-046, API-047, API-063, API-065 | 휴무일에 사장님이 고르는 주문(맞춤 주문 수락·날짜 변경 수락·결제 기한 연장·재제작)의 자리를 잡음. 마감 후 추가 수락으로 남음(REQ-221) | 휴무일이에요. 이날로 정할까요? | SPEC-060 |
| `past_cutoff` | API-047 | 그 픽업 날짜의 주문 마감이 지난 주문의 결제 기한을 연장함. 새 결제 기한은 픽업 일시까지(REQ-218) | 주문 마감이 지난 날이에요(새 결제 기한은 픽업 일시까지). 결제 기한을 연장할까요? | SPEC-038 |
| `holder_mismatch` | API-025 | 예금주가 등록한 상호·대표자와 다름. 사장님 답을 남김 | 예금주가 상호·대표자와 달라요. 가게 명의 계좌가 맞나요? | SPEC-006 |
| `no_compensation_standard` | API-065 | 상함·변질이나 이물 신고에 보상 없음. 소비자분쟁해결기준(제빵류: 교환 또는 환급)과 위험을 보이고 사유(noCompensationReason)를 받음. 사장님이 '그래도 보상 없이 닫기'를 누른 선택을 그 신고에 남김(REQ-248) | 상함·변질이나 이물은 소비자분쟁해결기준(공정위 고시 제2025-14호 별표, 제빵류)이 교환이나 환급을 정해요. 보상 없이 닫으면 분쟁 때 가게에 불리할 수 있어요. 사유를 남기고 그래도 보상 없이 닫을까요? | SPEC-059 |
<!-- END generated:confirmations -->

## 7. 카카오 스킬 결과

손님에게 가는 말은 뼈대이고 참고용입니다. 손님에게 실제로 가는 문구의 출처는 08단계 README 5절 한 곳이고, 08단계가 다섯 곳(인도 끝남 `handed_over`, 주문 요청 `order_requested`, 주문 취소 `order_cancelled`, 동의 철회 `consent_withdrawn`, 마감된 날 `day_full`)을 다듬었습니다(08단계 W5). 이 표와 계약의 예시 글은 08단계 검사 C10이 견주는 뼈대라 그대로 둡니다(설계 재검토 M8, RE-15). '에스컬레이션 건'은 그 결과가 사장님께 에스컬레이션 건을 남길 때의 이유입니다.

<!-- BEGIN generated:skill-outcomes -->
| 결과 | API | 뜻 | 손님에게 가는 말 | 에스컬레이션 건 | 근거 |
| --- | --- | --- | --- | --- | --- |
| `answered` | API-070 | AI 답이 4초 안에 준비되어 스킬 응답으로 바로 답함 | (AI가 만든 답, 서버 확인을 지남) |  | SPEC-020 |
| `callback_pending` | API-070 | 4초 안에 답이 준비되지 않아 콜백으로 답한다고 응답함. 답은 콜백으로 감 | 답을 준비하고 있어요 |  | SPEC-017 |
| `handed_over` | API-070 | AI가 답하지 않고 사장님께 에스컬레이션함(먹어도 되는지·답할 수 없음·마감된 날·법·의료·손님 요청·다른 사용자(남의 주문을 두고 사정을 말함, REQ-253)·받기 전 문제·조문 없음·빈 답 두 번) | 사장님 확인 뒤 답드릴게요 | AI 출력의 handoff 사유나 서버가 정한 사유 | SPEC-022 |
| `ai_unavailable` | API-070 | AI 모델이 오류를 냄(5xx·연결 실패). 한 번 다시 한 뒤에도 실패해 에스컬레이션함(R7) | 사장님 확인 뒤 답드릴게요 | ai_failure | SPEC-017 |
| `ai_timeout` | API-070 | 전체 기한(받은 때부터 55초, AI-1. 콜백 문서의 유효 시간은 5분, DEC-29)까지 AI 답이 없어 에스컬레이션함. 콜백으로 감 | 사장님 확인 뒤 답드릴게요 | callback_timeout | SPEC-017 |
| `ai_key_missing` | API-070 | 서버에 AI 모델 키가 없거나 거절됨. AI를 호출하지 못해 에스컬레이션함 | 사장님 확인 뒤 답드릴게요 | ai_failure | SPEC-017 |
| `ai_limit_reached` | API-070 | 모델 회사의 사용 한도(429)에 닿았거나 한 차례의 모델 호출이 상한(8번, AI-1)에 닿아 에스컬레이션함 | 사장님 확인 뒤 답드릴게요 | ai_failure | SPEC-017 |
| `ai_cost_limit_reached` | API-070 | 가게의 하루 AI 비용 한도(REQ-163, 기본 5,000원)에 닿아 AI 없이 에스컬레이션함 | 사장님 확인 뒤 답드릴게요 | ai_cost_limit | SPEC-017 |
| `masking_failed` | API-070 | 번호 마스킹이 실패해 AI를 호출하지 않고 에스컬레이션함 | 사장님 확인 뒤 답드릴게요 | masking_failed | SPEC-021 |
| `ai_output_rejected` | API-070 | AI 답이나 제안이 서버 확인(금액·날짜 판정·확정이라 말함·조문·플레이스홀더·광고·카드 대상)을 지나지 못해 그 부분을 버리고 정해진 문장으로 답함. 버린 제안은 쓰지 않음 | (계산값으로 만든 정해진 문장) |  | SPEC-020 |
| `card_shown` | API-070 | 서버가 저장된 값으로 확인 카드(알레르기 정보·주문자 정보·주문 요청·입금 알리기·변경 요청·취소·신고·동의 철회)를 보임. 주문서 초안이 다 차면 알레르기 정보 카드(SPEC-075)와 주문자 정보 카드(SPEC-072)를 주문 요청 카드 앞에 보냄. 주문 요청 카드는 그 버전의 취소·환불 규정 글(하나나 둘)을 먼저, 요약 카드를 끝에 둠(SPEC-028, DEC-22). 새 금액 확인이 필요한데 손님이 아직 확인하지 않은 결제 안내에 입금했다고 하면 입금 알리기 카드 대신 새 금액 확인 카드를 다시 보임(SPEC-033, SPEC-076) | (알레르기 정보 카드: 쓰는 목적·받는 항목·보는 사람·지우는 때와 버튼 '동의하고 알려 주기'·'동의 안 함'. 주문 요청 카드: 규정 글과 청약철회 제한 문장, 요약과 버튼) |  | SPEC-069 |
| `photo_received` | API-070 | 참고·신고 사진을 받아 초안이나 신고 내용에 붙임. AI 모델로 보내지 않음 | 사진을 받았어요 |  | SPEC-019 |
| `photo_rejected` | API-070 | 사진 한도(상담마다 10장, 장당 20MB)를 넘었거나 사진이 아닌 파일 | 사진은 한 장 20MB, 한 상담에 10장까지 받을 수 있어요 |  | SPEC-019 |
| `unsupported_message` | API-070 | 음성·파일·이모티콘만 온 메시지 | 글이나 사진으로 말씀해 주세요 |  | SPEC-017 |
| `rate_limited` | API-070 | 한 손님이 1분에 20개를 넘게 보냄. 기록만 하고 AI를 호출하지 않음. 그 1분 안 첫 번째에만 이 말 | 잠시 뒤 다시 말씀해 주세요 |  | SPEC-017 |
| `duplicate` | API-070, API-072 | 같은 카카오 요청이 다시 옴. API-070은 빈 출력으로 답하고 기록·AI 호출·명령을 다시 하지 않음(REQ-132, DEC-29). 카드·후기 스킬은 기존 응답 계약을 적용 | (메시지 스킬은 말풍선 없음) |  | SPEC-017 |
| `not_accepting` | API-070, API-071, API-072 | 연결되지 않은 채널이거나 예약 링크를 내기 전 가게, 또는 연결 확인 중인 채널에 연결 문구가 아닌 말이 옴. 상담을 열지 않음 | 아직 상담을 받지 않아요. 가게로 연락해 주세요: {가게 연락처} |  | SPEC-017 |
| `channel_test_card` | API-070 | 연결 확인 중인 채널에 그 연결의 연결 문구(사장님 화면에만 보임, API-032)가 와서 그 사용자를 시험 사용자로 남기고 첫 시험 버튼(그 가게가 넣은 블록 ID)을 보임(REQ-206, REQ-238) | 연결 문구를 받았어요. 시험 버튼 5개를 하나씩 눌러 주세요 |  | SPEC-008 |
| `server_error` | API-070, API-071, API-072 | 스킬을 처리하다 서버 오류가 남. 손님에게 오류 내용을 보이지 않음(G6), 로그에는 추적 ID | 잠시 뒤 다시 말씀해 주세요 |  | SPEC-017 |
| `allergy_saved` | API-071 | 알레르기 정보 카드의 '동의하고 알려 주기'가 연 알레르기 답 블록의 답(1~200자, '없음'도 답)이 맞아 동의(동의 글 버전·시각)와 답을 초안에 남기고, 주문자 이름·연락처가 없으면 주문자 정보 카드를, 있으면 주문 요청 카드를 보냄. 알레르기 답은 AI로 보내지 않음(REQ-201, REQ-202, REQ-204, 설계 재검토 H5, 잠정, 5-2 질문 4의 답으로 다시 봄) | (주문자 정보 카드나 주문 요청 확인 카드) |  | SPEC-075 |
| `allergy_declined` | API-071 | 알레르기 정보 카드의 '동의 안 함'을 누름. 거부와 동의 글 버전·시각을 초안에 남기고 알레르기는 묻지 않고 빼야 할 재료만으로 다음 카드를 보냄. 제작 목록에는 '알레르기 정보 동의 안 함'(REQ-203) | 알겠어요. 알레르기는 묻지 않고 빼야 할 재료만으로 주문을 이어갈게요 + (주문자 정보 카드나 주문 요청 확인 카드) |  | SPEC-075 |
| `orderer_saved` | API-071 | 주문자 정보 블록의 이름·연락처가 형식에 맞아 초안에 남기고 주문 요청 카드(규정 글을 먼저, DEC-22)를 보냄. 이 값은 AI로 보내지 않음(REQ-175, REQ-178) | (주문 요청 확인 카드: 규정 글, 요약에 주문자 이름·연락처) |  | SPEC-072 |
| `order_requested` | API-071 | 주문 요청을 한 트랜잭션으로 남김. 기본 디자인이면 자리와 결제 안내까지 | 주문을 요청했어요(주문번호 {orderNo}). 결제가 확인되면 확정돼요 |  | SPEC-029 |
| `payment_claimed` | API-071 | 결제 안내를 '확인 요청됨'으로 두고 사장님께 결제 확인을 요청함 | 사장님께 알렸어요. 확인되면 알려 드릴게요 |  | SPEC-033 |
| `amount_confirmed` | API-071 | 새 금액 확인 카드에서 '이 금액으로 할게요'(맞춤 주문)나 '바꿀게요'(변경)를 누름. 그 시각을 결제 안내의 손님 확인이자 전해진 시각으로 남기고, 그때부터 운영규정의 결제 기한(결제 기한 상한까지)을 정해 가게 계좌·카드 결제 링크와 함께 보임(REQ-232, REQ-218) | 새 금액을 확인했어요 + 결제 안내(가게 계좌·금액·결제 기한) |  | SPEC-076 |
| `amount_declined` | API-071 | 새 금액 확인 카드에서 '안 할래요'(맞춤 주문)나 '그대로 둘래요'(변경)를 누름. 그 시각을 남기고 결제 안내를 닫음. 맞춤 주문은 '손님이 취소함'으로 두고 자리를 바로 풀고 장부 쓰기를 남김(받은 금액이 없어 환불 없음). 변경은 변경 요청을 '차액 없어 닫힘'으로 두고 원래 주문대로 감(차액을 기다리며 잡아 둔 새 날 자리는 풂, REQ-234). 어느 쪽이든 사장님께 알림(REQ-233) | 맞춤 주문: 알겠어요. 주문을 취소했어요 / 변경: 알겠어요. 바꾸지 않고 원래 주문대로 할게요 |  | SPEC-076 |
| `change_requested` | API-071 | 변경 요청을 남기고 사장님께 알림 | 변경을 요청했어요. 사장님이 보고 알려 드려요 |  | SPEC-041 |
| `order_cancelled` | API-071 | 주문을 '손님이 취소함'으로 두고 자리를 풂. 확인된 결제가 있으면 사장님께 환불 정할 일 | 주문을 취소했어요. 환불은 사장님이 정한 뒤 알려 드려요 |  | SPEC-046 |
| `issue_reported` | API-071 | 문제 신고를 남기고 사장님께 알림. 그 주문을 요청한 같은 카카오 사용자만(REQ-251). 기한 뒤면 사장님 화면에만 '기한 뒤'로 표시하고 손님에게 가는 말은 같음(REQ-250) | 신고를 받았어요. 사장님이 보시고 정하실 거예요 |  | SPEC-058 |
| `photo_consent_saved` | API-071 | 완성 사진 안내의 사진 게시 동의 카드에서 누른 답('올려도 돼요'·'안 돼요')을 그 안내의 사진마다 남김. 누르지 않은 사진은 동의 안 함이고, 동의한 뒤 바꾸려면 동의 철회(REQ-207, 설계 재검토 H10, 잠정, 5-2 질문 6의 답으로 다시 봄) | 알려 주셔서 고마워요. 사진 게시 동의는 언제든 철회할 수 있어요 |  | SPEC-053 |
| `consent_withdrawn` | API-071 | 완성 사진·후기 사진의 게시 동의를 철회함. 그 사진의 올라 있는 포트폴리오 항목을 먼저 내린 뒤 철회를 남기고 예약 링크 페이지에서 5분 안에 사라짐(REQ-098, REQ-209) | 사진 게시 동의를 철회했어요. 곧 사진이 내려가요 |  | SPEC-063 |
| `declined` | API-071 | 손님이 카드의 '안 할래요'를 누름. 아무것도 남기지 않음 | 알겠어요. 더 궁금한 것이 있으면 말씀해 주세요 |  | SPEC-069 |
| `input_invalid` | API-071 | 주문자 정보·알레르기 답·입금자 이름 블록의 값이 형식에 맞지 않음(이름 1~30자, 연락처 숫자와 '-' 8~14자, 알레르기 답 1~200자). 아무것도 남기지 않고 같은 블록 버튼으로 다시 물음(SPEC-033, SPEC-072, SPEC-075) | 이름은 1~30자, 연락처는 숫자와 '-'로 8~14자로 넣어 주세요 |  | SPEC-072 |
| `card_stale` | API-071 | 카드에 묶인 버전(초안 고친 번호·주문 버전·환불 금액)이 지금과 달라 거절하고 새 카드를 보임(G9). 쓴 것 없음 | 내용이 바뀌었어요. 새 카드를 확인해 주세요 |  | SPEC-069 |
| `card_expired` | API-071 | 카드의 30분 기한이 지나 거절하고 새 카드를 보임(G9). 쓴 것 없음 | 시간이 지나 새 카드를 보내 드려요 |  | SPEC-069 |
| `card_not_yours` | API-071 | 카드를 받은 사용자가 아닌 사람이 누름(A7). 쓴 것 없음 | 이 버튼은 카드를 받은 분만 누를 수 있어요 |  | SPEC-069 |
| `card_used` | API-071 | 이미 누른 카드를 다시 누름. 처음 결과를 다시 보냄(G2) | (처음 결과와 같은 말) |  | SPEC-069 |
| `day_full` | API-071 | 기본 디자인 주문의 자리를 같은 트랜잭션에서 잡지 못해 주문 요청도 남기지 않음(R11). 가까운 날 최대 3개 | 그 사이 그날이 다 찼어요. 이날은 어떠세요? |  | SPEC-029 |
| `order_limit_reached` | API-071 | 기본 디자인 주문 요청인데 이 가게의 그 손님 결제 기다림 주문이 가게가 정한 한도(기본 2건, 0이면 한도 없음)에 닿음. 주문 요청과 자리를 남기지 않고 사유 order_limit로 사장님께 에스컬레이션함(REQ-263). 사장님이 한도를 넘겨 받으면 새 주문 요청 확인 카드가 감(SPEC-023, REQ-264) | 사장님이 확인한 뒤 알려 드릴게요 |  | SPEC-029 |
| `retry_needed` | API-071 | 한 트랜잭션의 쓰기 가운데 하나가 실패해 하나도 남기지 않음(REQ-054) | 다시 눌러 주세요 |  | SPEC-029 |
| `not_allowed_now` | API-071 | 지금 상태에서는 그 명령을 받지 않음(열린 결제 안내 없음, 받은 주문의 취소, 결제 전 주문의 변경 등). 지금 상태를 알림 | 지금은 할 수 없어요: {지금 상태} |  | SPEC-033 |
| `block_verified` | API-071, API-072 | 연결 확인 중에 시험 사용자가 누른 시험 버튼이 우리 스킬에 닿아 그 블록을 확인됨으로 남기고 다음 시험 버튼을 보임. 주문·카드·후기는 남기지 않음(REQ-206) | {블록} 블록이 닿았어요({n}/5). 다음 시험 버튼을 눌러 주세요 |  | SPEC-008 |
| `channel_linked` | API-071, API-072 | 시험 버튼으로 버튼 블록 다섯이 모두 닿아 채널을 가게에 묶음. 무료 MVP는 실제 발신을 건너뛰고 손님 안내를 다음 대화 때 전함. 시험 사용자에게 Event API로 한 번 보내는 확인은 TASK-167에서 진행(REQ-206, REQ-180, DEC-20) | 시험 버튼 다섯이 모두 닿아 연결됐어요. 손님 안내는 다음 대화 때 전해요. |  | SPEC-008 |
| `review_saved` | API-072 | 받은 주문의 후기와 사진, 사진마다 게시 동의(그 사진들을 포트폴리오와 예약 링크 페이지에 올려도 되는지 한 문장으로 물은 답, 기본 동의 안 함)를 남김(REQ-208, 설계 재검토 H10, 잠정, 5-2 질문 6의 답으로 다시 봄) | 후기를 남겨 주셔서 고마워요 |  | SPEC-062 |
| `review_not_allowed` | API-072 | 받은 주문이 아니거나 그 주문을 요청한 사용자가 아님. 남기지 않음 | 받으신 주문에만 후기를 남길 수 있어요 |  | SPEC-062 |
| `review_invalid` | API-072 | 후기 글이 1~1,000자 밖이거나 사진이 5장을 넘음 | 후기는 1,000자, 사진은 5장까지 남길 수 있어요 |  | SPEC-062 |
| `photo_download_failed` | API-072 | 카카오 사진 주소에서 한 번 다시 받아도 실패함 | 사진을 받지 못했어요. 다시 보내 주세요 |  | SPEC-019 |
| `notice_shown` | API-073 | Event API가 넘긴 안내 키로 저장된 안내의 글과 버튼을 보임(템플릿, AI 없음, 광고 없음). 확정 안내는 주문 내용·픽업 일시·결제가 확인된 금액·가게의 상호·대표자·사업장 주소·전화번호를 담은 글과 그 주문의 취소·환불 규정 글(SPEC-036, REQ-242). 완성 사진 안내는 사진과 사진 게시 동의 카드(버튼 '올려도 돼요'·'안 돼요', SPEC-053). 새 금액 확인이 필요한 결제 안내는 계좌 대신 새 금액 확인 카드(맞춤 주문은 요청한 견적·정한 금액·사유, 변경은 바뀌는 내용·지금 금액과 새 금액·차액·변경 마감, SPEC-076) | (그 안내의 글: 확정 안내, 결제 결과·변경 결과·취소·환불·전날·후기 부탁 안내 등) |  | SPEC-066 |
| `notice_test` | API-073 | 채널을 연결한 뒤 시험 사용자에게 보낸 시험 안내를 보임. 발송 결과로 먼저 보내기 됨·안 됨을 정함(REQ-180) | 시험 안내예요. 이 안내가 보이면 손님에게 안내를 먼저 보낼 수 있어요 |  | SPEC-008 |
| `notice_gone` | API-073 | 안내 키가 없거나 그 가게 것이 아님. 짧은 글만 보임 | 지금은 전할 안내가 없어요 |  | SPEC-066 |
<!-- END generated:skill-outcomes -->

## 8. 결정 사항

계약서가 정하라고 한 경계(입력 오류는 400인지 422인지, 같은 상태로 가는 명령은 성공인지 등)와 이 계약에서 선택한 것입니다. 처음에는 계약서와 앞 단계 기록에 기대어 Claude가 골라 추천했고, 그 가운데 3개(DEC-12·13·18)는 제품 동작이 달라져 따로 확인 요청했습니다. 2026-11-12 14:01 체크포인트에서 동희님이 19개 모두 추천대로 확정하셨습니다(14절). '상태' 열이 그 기록입니다.

<!-- BEGIN generated:decisions -->
| ID | 결정 사항 | 선택안 | 사유 | 대안 | 상태 |
| --- | --- | --- | --- | --- | --- |
| DEC-01 | 입력 오류는 모두 422 | 입력 필드가 맞지 않으면 모든 API가 422 `validation_failed`를 반환함. 400은 쓰지 않음. 필드마다 `errors[{field, code}]`로 위치와 사유 코드만 포함하고 넣은 값은 되돌려 보내지 않음. JSON으로 읽을 수 없는 본문은 field `/`·code `bad_json`, 받지 않는 Content-Type은 field `header:Content-Type`·code `not_allowed`, 글자 필드의 NUL 문자는 `bad_format`으로 같은 422 | G7의 '필드 오류(필드마다 이유)'를 한 형식으로. 계약서가 400·422 가운데 하나를 고르라 함 | 400: JSON 형식 오류와 값 오류를 나눌 수 있지만 화면이 두 분기를 다뤄야 함 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-02 | 없는 ID·다른 가게 ID·형식이 틀린 ID는 구분하지 않음(경로는 404, 본문·쿼리는 422) | 경로의 ID가 없거나, 다른 가게 것이거나, 형식이 틀리면(100자를 넘는 것 포함) 모두 404 `not_found`, 같은 본문. 계약에 없는 경로도 같은 404. 경로는 있지만 방법이 없으면 405 `method_not_allowed`와 `Allow` 헤더. 403은 쓰지 않음(역할마다 세션 쿠키와 경로가 나뉨). 본문·쿼리가 가리킨 다른 기록의 ID(도안·변경 요청·결제 안내·사진·운영자가 여는 대상 등)가 없거나 이 가게·주문 것이 아니면 422 `validation_failed`와 그 필드의 `reference_not_found`, 같은 본문(없음과 남의 것을 구분하지 않음). 올린 파일 ID(`uploadId`)는 올린 사장님만 쓰고, 없거나 1시간이 지났거나 다른 사장님 것이면 같은 `upload_not_found`(2026-11-13 설계 재검토 M18) | G1: 다른 가게 기록이 있는지조차 알리지 않음. SPEC-068 수락 기준. 본문·쿼리의 ID는 경로가 아닌 입력이라 G7의 필드 오류로 어느 필드인지 알림(설계 재검토 RD-09) | 형식이 틀린 ID는 422: 화면 개발에는 친절하지만 G1의 '구분하지 않음'과 어긋남 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-03 | 같은 상태로 가는 명령은 성공, 다른 결정이 있으면 409 | 이미 그 상태인 명령(이미 마감된 날 마감, 확인된 가게 확인, 같은 '입금됨')은 200과 `outcome: unchanged`, 아무것도 바꾸지 않음. 다른 결정이 먼저 남았으면 409 `already_decided` | 상태 머신 1-2의 '같은 상태로 가는 명령은 지금 상태를 반환함'과 G3의 '먼저 온 쓰기가 이김' | 같은 상태도 409: 두 번 누른 사장님께 오류가 보임 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-04 | 사장님·운영자 명령은 요청 키를 꼭 가짐 | 사장님·운영자의 쓰기 명령은 `Idempotency-Key` 헤더(16~64자, 영문·숫자·`_`·`-`)가 꼭 있어야 하고, 빼면 422 `validation_failed`(header:Idempotency-Key, required). 서버는 (누른 사람, 키)마다 명령·경로의 ID·본문으로 만든 요청 지문(HMAC-SHA256)과 처리 상태를 남김(05단계 TBL-050 `request_keys`, 5절 E27). 같은 키에 지문이 다르면 422 `idempotency_key_reused`, 첫 요청을 처리하는 중(받은 뒤 60초 안)이면 409 `request_in_progress`이고, 60초가 지나도 끝나지 않은 요청(서버가 멈춤)은 같은 키·같은 지문의 다음 요청이 이어받아 처음부터 처리함. 끝난 요청에 같은 키가 다시 오면 처음 결과와 같은 상태 코드·결과 종류에, 처음 결과가 가리킨 기록을 지금 다시 읽은 본문을 반환하고 `Idempotency-Replayed: true`를 붙임(처음 본문은 이름·연락처 같은 개인정보가 있어 남기지 않음). 입력 검사 실패(422)와 서버 오류(5xx)는 남기지 않아 같은 키로 다시 보낼 수 있음. 로그인이 필요함(401), 확인이 필요함(409 `confirmation_required`), 요청이 너무 많음(429)도 명령을 처리하지 않은 결과라 남기지 않음. 남기면 로그인한 뒤, 확인을 받은 뒤, 한도가 풀린 뒤에 같은 키로 다시 보내도 처음의 거절만 돌아가기 때문(구현하며 좁힌 해석, 2026-11-15, 10단계 TASK-018). 요청 키는 24시간 뒤 지움(SPEC-065). 결제 안내·환불·가예약·할 일·알림·손님 안내·장부 쓰기처럼 서버가 스스로 하는 일은 요청 키가 아니라 05단계 4절 A33의 이벤트 키(`pay:{대상 ID}:{결제 종류}`, `refund:{대상 ID}:{사유}`, `hold:{주문 ID}:{결제 안내 ID}` 등)로 가게마다 한 번만 남기고, 환불은 대상(취소한 주문·변경 요청·문제 신고·결제 안내)마다 하나(2026-11-14 설계 재검토 M7). 로그인·로그아웃, 사진 올리기(다시 해도 새 uploadId가 하나 더 생길 뿐), 구글 권한 요청 시작(기록을 바꾸지 않음)은 받지 않음. 카카오 스킬은 카카오 요청으로 만든 키(DEC-28)와 카드 키를 씀 | G2(화면 버튼은 화면이 만든 키)와 TBL-050 request_keys. 요청 지문과 처리 상태가 없으면 같은 키의 다른 내용과 처리 중을 가릴 수 없고, 처음 본문을 남기면 개인정보가 지우기 밖에 남음. 이벤트 키의 형식과 대상이 정해지지 않으면 같은 환불·결제 안내가 다른 키로 두 번 남을 수 있음(설계 재검토 M7, RC-16·RD-05·RC-06) | 키 없이 버전 비교만: 네트워크가 끊겨 다시 보낸 요청이 두 번 남을 수 있음. 처음 응답 본문을 그대로 남김: 같은 바이트를 돌려주지만 이름·연락처가 요청 키에 남고 지우기 차례가 늘어남 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-05 | 동시 변경은 revision 비교 | 고칠 수 있는 기록은 응답에 `revision`(서버가 만든 값)을 포함하고, 명령은 `baseRevision`을 보냄. 다르면 409 `version_conflict`이고 아무것도 바꾸지 않음. 409에는 지금 상태를 포함하지 않고 화면이 다시 읽음(GET). 처음 저장(가격표·운영규정·결제 수단·영업 캘린더 공통 설정·채널·장부)은 `baseRevision: null`. 날짜별 API-029는 행이 없어도 API-028 GET의 revision을 그대로 보냄. null은 현재 값과 달라 409이고 다시 조회한 문자열을 보내야 함. 주문·변경 요청의 revision은 쓸 때마다 하나 오르는 잠금 번호(05단계 `lock_version`, 4절 A6·5절 E15)로 만들고, 결제 안내는 `payment_requests.version`으로 만듦(2026-11-13 설계 재검토 H12) | G3(먼저 온 쓰기가 이기고 뒤는 '이미 바뀜'). 주문 내용 버전(`version`)은 상태만 바꾸는 쓰기(결제 확인·취소·받음)에서 오르지 않아 같은 버전을 읽은 결제 확인과 손님 취소가 둘 다 통과했음(RC-01). 그래서 revision은 쓸 때마다 바뀌는 값으로 둠. 오류 응답을 Problem 한 형식으로 두고, 지금 상태는 늘 같은 읽기 API에서 옴. 버전이 없는 기록(상태만 있는 결제 기한 결정 등)도 같은 방법으로 | If-Match 헤더: HTTP 표준이지만 어긋남이 412라 계약서의 409와 다르고, 목록의 행마다 값을 포함할 곳이 없음 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-06 | 확인이 필요한 저장은 409 confirmation_required | 제작 전 취소 환불 낮춤·확정 주문이 있는 날 휴무·마감 후 추가 수락·픽업 날이 아닌 인도·휴무일 재제작·예금주 다름은 아무것도 바꾸지 않고 409 `confirmation_required`와 `confirm` 목록을 반환함. 화면이 말을 보이고, 사장님이 확인하면 같은 요청에 `confirm` 값을 담아 다시 보냄 | SPEC-005·007·031·038·054·060·006의 '먼저 보이고 확인받음'을 한 형식으로 | 화면이 미리 계산해 묻기: 그 사이 상태가 바뀌면 확인 없이 저장될 수 있음 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-07 | 카카오 스킬은 늘 200과 스킬 응답 | 카카오 스킬 API는 서버가 처리한 모든 경우에 200과 스킬 응답을 반환하고, 결과는 `Siljang-Outcome` 헤더와 이름 붙은 예시로 구분함. HTTP 오류는 스킬 키가 틀림(401)과 스킬 요청 형식이 아님(422)뿐. AI 실패·느림·키 없음·사용 한도·가게 비용 한도는 모두 에스컬레이션 응답(R7) | G6(손님에게 오류 내용을 보이지 않음). 200이 아니면 카카오가 손님에게 자기 오류 말을 보임 | AI 실패를 503으로: HTTP 쪽은 깔끔하지만 손님은 카카오 오류 말만 봄 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-08 | 카카오 스킬 인증은 오픈빌더 헤더 값 | 오픈빌더 스킬 설정의 헤더 값(공식 문서 2026-11-12 확인: '헤더값 입력, 테스트 헤더값 입력')에 가게 연결마다 다른 스킬 키를 넣음. 헤더 이름 `Siljang-Skill-Key`. 키는 서버 시크릿과 연결 ID·키 버전으로 만들어 저장하지 않음(해시도 두지 않음, REQ-135). 키 값은 연결을 만들 때(API-031 created)와 바꿀 때(API-079)의 응답에만 한 번 보이고, 연결 상태(API-030)에는 버전과 만든 시각만 보임. 바꾸면 새 버전이 되고 앞 버전은 바꾼 때부터 24시간 받거나(keep_24h, 기본: 오픈빌더의 헤더 값을 바꾸고 배포하는 동안 손님 메시지가 끊기지 않게) 바로 끊음(revoke_now, 키가 샜을 때). 그 전 버전은 늘 거절(REQ-237). 연결 확인은 사장님 화면에만 보인 연결 문구('연결 ' 뒤에 숫자 6자리. 서버 시크릿과 연결 ID·연결 확인 시작 시각으로 만들어 저장하지 않음)가 그 채널 대화창에서 와야 시작하고, '연결 확인 중' 연결은 저장이나 연결 확인 시작에서 30분 동안 그 봇을 잡으며 그 뒤 다른 가게가 같은 봇을 넣으면 풀림(REQ-238). 봇 ID와 키를 아는 사람이 꾸민 요청과 카카오의 요청을 가를 수단(요청 출처)은 OPEN-10(2026-11-13 설계 재검토 M18) | 문서에 요청 서명·IP 목록이 없음. 봇 ID만으로는 남이 요청을 꾸밀 수 있음 | 주소에 비밀 경로: 로그와 오픈빌더 화면에 그대로 보임 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-09 | 파일은 먼저 올리고 ID로 씀 | 신고증·도안·완성 사진은 `POST /owner/uploads`로 먼저 올리고(용도별 한도), 명령에는 `uploadId`만 씀(1시간 안). 응답의 사진은 15분 사는 서명 주소로만 보이고 저장 위치는 보이지 않음 예외: 예약 링크 페이지의 포트폴리오 사진은 같은 150초 구간에 같은 주소이고, 기한은 구간 끝 뒤 150초(주소 수명 150~300초, 최대 5분)임. 공개 캐시는 남은 기한까지만 허용함(SPEC-063, 앞선 결정 PR #186 댓글 7090984075, 2026-11-23 후속 체크포인트 `msg_844ba4f4203d`) | 명령을 JSON 하나로 두고 사진 실패를 명령 전에 알림(SPEC-002 '사진 저장이 실패하면 등록 전체를 남기지 않음') | 명령마다 multipart: 필드 오류와 파일 오류가 섞임 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-10 | 사장님 로그인은 인가 코드를 서버가 바꿈 | 사장님 로그인은 `POST /owner/session/authorization`(API-078)으로 시작함: 서버가 일회용 nonce를 로그인 시작 쿠키 `siljang_login`(HttpOnly·Secure·SameSite=Lax, 10분)에 두고, nonce와 만료 시각을 서버 시크릿으로 서명한 state와 nonce로 만든 PKCE code_verifier의 S256 code_challenge를 담은 카카오 인가 주소를 줌(둘 다 저장하지 않음, PC 카드로 S256 검증 완료, PKCE 없이 토큰이 나오는 경우에도 제품은 S256을 함께 사용). 화면이 카카오 로그인으로 받은 인가 코드와 state를 `POST /owner/session`으로 보내면 서버는 state가 서명·10분·쿠키의 nonce와 맞을 때만 토큰으로 바꿔(아니면 카카오를 호출하지 않고 401 `kakao_login_failed`) 카카오 로그인 사용자 번호만 남기고 토큰은 버림. 세션은 HttpOnly·Secure 쿠키. 세션 쿠키로 쓰는 명령은 Origin 헤더가 우리 화면 주소일 때만 받고, 아니면 세션이 없는 것과 같은 401(2026-11-13 설계 재검토 M18). 운영자는 이메일·비밀번호·6자리 번호로 `POST /operator/session` | SPEC-001(카카오 토큰을 남기지 않음), R2. 쿠키라 화면 코드가 세션 값을 만지지 않음 | 토큰을 화면에 줌: 화면 저장소가 털리면 세션도 털림 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-11 | 운영자 아닌 사람에게 운영자 API는 401 | 운영자 API는 운영자 세션이 없으면 401. SPEC-001의 '운영자 화면은 운영자 계정이 아니면 찾을 수 없음'은 운영자 기록을 0건 보인다는 뜻으로 읽고, 그 화면 디자인은 08단계에서 정함 | 사장님 세션과 운영자 세션은 다른 쿠키라 섞이지 않음. 계약서가 로그인이 필요한 API에 401을 요구함 | 세션이 없으면 404: 운영자 주소를 숨기지만 운영자도 세션이 만료되면 '찾을 수 없음'을 봄 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-12 | 예약 링크 조건에 '결제 수단'을 더함 | 가격표·운영규정·영업 캘린더·영업 신고 확인·채널 연결에 더해 결제 수단(가게 계좌)이 있어야 예약 링크를 냄. `GET /owner/booking-link`의 `missing`에 `payment_destination`. 요구사항 버전 4 REQ-164로 더함 | 결제 안내는 가게 계좌를 꼭 참조함(TBL-031 payment_account_id NOT NULL, E6). 계좌 없이 링크가 나가면 기본 디자인 주문 요청이 한 트랜잭션을 마칠 수 없음. 03단계 FL-001 기본 경로도 링크 전에 계좌를 등록함 | REQ-105 글자대로(조건 다섯): 계좌가 없는 가게의 주문 요청이 실패함 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-13 | 픽업 장소는 예약 링크를 막지 않음 | 픽업 장소(E14)가 비어도 예약 링크를 냄. `GET /owner/booking-link`의 `recommended`에 `pickup_address`로 보이고, 비었으면 전날 안내에서 위치 문구를 빼고 가게 연락처만 포함함 | 05단계 E14가 06단계로 전달한 질문. 조건을 늘리지 않고 사장님께 알림 | 픽업 장소도 조건으로: 전날 안내가 늘 위치를 포함하지만 SPEC-010이 바뀜 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-14 | 목록은 커서 방식 | 목록은 `cursor`와 `limit`(1~100, 기본 20)로 나눠 받고 `nextCursor`가 없으면 끝. 목록을 주는 API는 설명의 '순서:'에 정렬 키를 적고, 같은 값이면 ID 순으로 끊어 쪽 사이에 겹침·빠짐이 없게 함(2026-11-15 설계 재검토 RD-13). 예외: 범위가 정해진 목록은 나누지 않고 한 번에 줌: 가격표·운영규정 버전(API-018·022, 저장할 때마다 하나라 1,000개까지), 영업 캘린더(API-028, 62일까지), 날짜별 제작 목록(API-051, 그날의 주문 100개까지), 포트폴리오(API-067, 올린 사진과 후보 각각 200개까지) | 할 일·주문이 쌓여도 같은 속도. 행이 끼어도 중복되거나 빠지지 않음. 순서가 없으면 화면과 서버가 따로 정하고 쪽 나누기 테스트를 쓸 수 없음(할 일은 지연된 것이 뒤로 밀리면 안 됨) | 쪽 번호: 화면은 쉽지만 새 행이 생기면 중복됨 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-15 | 돈·시각·날짜의 형식 | 돈은 원 단위 정수. 시각은 가게 시간대 오프셋을 붙인 RFC 3339(예: 2026-11-20T14:00:00+09:00), 날짜는 가게 시간대의 YYYY-MM-DD(G8) | DB와 같음(돈 integer, 시각 timestamptz, 자리 날짜 date) | UTC로만: 화면이 늘 바꿔야 함 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-16 | 요청 빈도 한도 | 예약 링크 페이지는 같은 주소에서 1분 60번(SPEC-011), 사장님 로그인은 1분 10번, 운영자 로그인 실패는 15분 5번을 넘으면 429와 `Retry-After`. 손님 메시지의 1분 20번(SPEC-017)은 스킬 응답 `rate_limited`. 사진 올리기(API-007)는 사장님마다 1분 30번, 쓰지 않은 올린 파일(1시간 안)은 50개까지이고 넘으면 429 `rate_limited`와 `Retry-After`(2026-11-15 설계 재검토 RD-18) 예외: 사진 읽기 경로는IP당1분600번(도안50장+포트폴리오100장 페이지 네 번)이며 넘으면429와 Retry-After. 공개/일반 사진이 같은 한도를 쓰고 원IP는 저장하지 않음(2026-11-23 체크포인트 승인, PR186 댓글7090984075) | SPEC-011의 긁어 가기 막기와 로그인 무차별 대입 막기. 사진 올리기는 가게 등록 전(신고증)에도 카카오 계정만으로 열려 있어 한 사람이 저장소를 채워 다른 가게의 등록을 막지 않게 함 | 한도 없음: 첫 버전 가게 1~3곳이라 버틸 수 있지만 운영자 계정이 위험 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-17 | AI-1 출력 스키마를 이 계약에 확정함 | AI-1이 '06단계에서 확정'으로 전달한 출력 스키마를 `components.schemas.AiTurnOutput`으로 둠(HTTP로 오가지 않는 서버 안 구조화 출력). SPEC-049의 환불 계좌를 받는 필드 `refund_account_patch`를 더함 | AI-1 출력 목록에 환불 계좌 필드가 없어 SPEC-049를 할 수 없었음 | 환불 계좌는 사장님이 상담을 보고 손으로 넣음: AI 필드는 줄지만 사장님 일이 늘어남 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-18 | 후기는 카카오 '후기' 블록의 스킬로 받음 | 후기는 후기 부탁 안내의 버튼이 여는 오픈빌더 블록이 `POST /kakao/skills/review`로 보냄(글, 보안 이미지 플러그인 사진 5장까지, 게시 동의). 게시 동의는 후기 하나에 한 번 묻고 그 답을 사진마다 남김(기본 동의 안 함). 묻는 말은 그 사진들을 가게 포트폴리오와 예약 링크 페이지에 올려도 되는지와 언제든 철회할 수 있음을 한 문장으로(2026-11-13 설계 재검토 H10, REQ-208) | AI-1이 후기를 다루지 않음(SPEC-062는 AI 없음). 카카오 대화에서 사진마다 따로 묻기는 번거로움 | 사진마다 묻기: SPEC-062 글자 그대로지만 손님 단계가 사진 수만큼 늘어남 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-19 | 응답에 포함하는 것 | 손님·공개 응답에는 주문번호 밖의 ID(uuid)를 포함하지 않음. 사장님·운영자 응답은 uuid ID를 씀. 마스킹 원본 값은 에스컬레이션 건·상담 대화·환불 화면에만, 계좌는 결제 수단과 환불 화면에만. 운영자 응답에는 가린 값(이름은 첫 글자, 번호는 끝 4자리)만 두고, 원래 값은 운영자가 사유를 적은 원래 값 열기(API-077)의 응답에만 하나씩 둠. 원래 값을 두지 않는 카드번호·긴 숫자는 사장님 화면에도 플레이스홀더와 끝 4자리만(2026-11-13 설계 재검토 H4) | G6, REQ-193, REQ-194, REQ-195, R19 | 모든 응답에 같은 형식: 손님 응답에 내부 ID가 섞일 수 있음 | 확정(2026-11-12 14:01 동희님 '추천대로 굳힘') |
| DEC-20 | 손님 안내는 가게 봇의 Event API를 우리 앱 키와 우리 월렛으로 | 가게 채널을 우리 카카오 디벨로퍼스 앱(비즈니스 인증, 카카오 로그인 활성화)에 연결하고, 가게 봇마다 우리 월렛 하나를 연결함(월렛은 '연결대기'일 때 봇 하나에만 연결됨). 우리 서버가 우리 앱의 REST API 키로 `POST https://bot-api.kakao.com/v2/bots/{botId}/talk`(이벤트 이름 `siljang_notice`, 받는 사람은 손님의 봇 사용자 키, params에는 안내 키만)를 부르고, 가게 봇의 '안내' 블록이 안내 스킬(API-073)을 불러 우리 기록의 글과 버튼을 보임. 카카오가 요청을 받으면(taskId) '확인 중'으로 두고 `GET https://bot-api.kakao.com/v1/tasks/{taskId}`로 1분·5분·30분 뒤 발송 결과를 조회해 닿았을 때만 '보냄'. 메시지 비용(닿은 건당 15원, 부가세 별도)은 우리가 내고 요금에 넣음. 연결한 뒤 시험 안내를 한 번 보내 먼저 보내기 됨·안 됨을 가게마다 남기고, 안 되는 가게의 손님 안내는 다음 대화 때 전함. 무료 MVP의 발신은 다음 대화 때 진행하고 권한·월렛과 실제 발신은 출시 검토 TASK-167에서 시험함. 안내 스킬이 안내를 만들지 못하면 200 대신 500을 반환해 카카오가 보내지 않게 함(DEC-07의 예외) | 가게마다 앱과 월렛을 만들게 하면 사장님 일이 크게 늘고 우리가 가게의 키를 맡아야 함(RD-01, RA-10). Event API는 채널 친구에게만 가고 요청 성공은 받았다는 뜻일 뿐이라 결과 조회로만 닿았는지 앎(카카오 비즈니스 도움말 Event API, 2026-11-13 다시 읽음) | 가게마다 자기 앱·월렛: 비용은 가게가 내지만 등록이 어렵고 가게의 키를 맡아야 함. 먼저 보내기 없이 다음 대화 때만 전함: 확정 안내와 결제 결과가 늦게 감(무료 MVP와 먼저 보내기가 안 되는 가게에서 사용) | 확정(2026-11-13 20:59 동희님 결정 카드 '추천안대로 (추천)', 설계 재검토 H7) |
| DEC-21 | 사장님 알림은 우리 서비스 채널 봇이 카카오 로그인 사용자 번호로 | MVP에서 미룸(동희님 2026-11-22 15:57 결정 카드): 사장님 카카오 알림·plusfriends 동의·채널 친구 확인은 출시 검토 때 다시 켠다. MVP 기본 로그인은 scope를 생략하고 채널 조회·친구 여부 기록·재조회·채널 배너를 끈다. 동의 항목은 설정으로 두고 plusfriends를 명시한 경우 아래 조회/발신 조건을 적용한다. 우리 서비스 채널(우리 앱에 연결)의 봇이 Event API로 사장님의 카카오 로그인 사용자 번호(appUserId, 05단계 `owners.kakao_account_id`)에 할 일 종류와 목록 주소를 보냄. 우리 봇의 알림 블록은 이벤트 data의 글을 그대로 보여 스킬이 없음. 친구인지는 카카오 로그인 때 채널 추가 상태 동의(`plusfriends`)와 채널 관계 조회(`GET https://kapi.kakao.com/v2/api/talk/channels`)로 보고, 친구가 아니라고 남은 동안 사장님 화면을 열면 마지막으로 본 지 1분이 지났을 때 우리 앱의 Admin 키로 다시 조회함(API-001, API-002). 발송 결과가 '채널 친구 아님'(101)이면 친구 아님으로 고침. 05단계 `alert_user_key`를 지움(E17) | 우리 채널의 사용자 키를 알 길이 없어 사장님 알림이 하나도 가지 못했음(RD-10). appUserId는 로그인 때 이미 받는 값이고 앱에 연결한 채널의 봇은 appUserId로 보낼 수 있음(앱이 연결되지 않으면 errorType 302) | 사장님이 우리 채널에 코드를 보내 사용자 키를 이음: 할 일과 스킬 API가 늘어남. 채널 추가·차단 웹훅으로 친구 여부를 받음: 받는 API가 하나 더 필요해 첫 버전은 조회와 발송 결과로 | 확정(2026-11-13 20:59 동희님 결정 카드 '추천안대로 (추천)', 설계 재검토 H7) |
| DEC-22 | 주문 요청 카드는 규정 글과 요약 카드를 나눠 보냄 | 주문 요청 확인 카드(API-070 card_shown, API-071 orderer_saved·card_stale·card_expired)는 한 응답의 출력으로 그 버전의 취소·환불 규정 글(simpleText 하나나 둘)을 먼저, 요약 카드(textCard: 요약과 알레르기 답이나 '알레르기 정보 동의 안 함', 버튼 둘. 2026-11-13 설계 재검토 H5·H10으로 사진 게시 동의 줄과 버튼을 빼고 알레르기 정보 카드를 앞에 둠)를 끝에 둠. 규정 글은 '취소·환불 규정(운영규정 버전 N)' 줄, 취소·환불 조문마다 '· 제목: 조건 → 효과' 한 줄, 끝에 '주문제작이라 청약철회가 제한될 수 있어요'와 '미성년자가 법정대리인의 동의 없이 한 주문은 본인이나 법정대리인이 취소할 수 있어요'(2026-11-14 설계 재검토 M11로 더함, REQ-240). 1,000자를 넘으면 조문 사이에서 나눠 첫 줄 끝에 1/2·2/2를 붙이고 청약철회 문장과 미성년자 취소 고지는 둘째 글 끝에 둠. 자르지 않고, 글 둘에 들어가지 않는 운영규정은 저장 때 422 `exceeds_card_limit`(API-021) | 카드 설명은 400자라 규정을 다 담지 못하고 손님이 잘린 규정에 동의하게 됨(RD-03). 카카오 응답의 출력은 3개까지라 글 둘과 카드 하나가 한도(카카오 응답 형식 문서) | 규정은 링크로: 카카오 안에서 동의할 글이 보이지 않음. 규정을 줄여 카드에 넣음: 동의한 글이 저장된 버전과 달라짐 | 확정(2026-11-13 20:59 동희님 결정 카드 '추천안대로 (추천)', 설계 재검토 H9) |
| DEC-23 | 변경 요청의 금액 차이는 방향과 양수로 받음 | 변경 요청 응답(API-063)은 금액 차이를 부호 있는 수 하나로 받지 않고 `amountDirection`(same 그대로·up 올라감·down 내려감)과 `amountDifference`(올라감·내려감만, 1원~1,000만 원의 양수)로 받음. 서버가 부호를 붙여 응답의 `amountDelta`(올라감 +, 내려감 -, 그대로 0)로 남김. 수락인데 방향이 없으면 422 `/amountDirection` required, 그대로·거절에 차이 금액을 보내면 `/amountDifference` not_allowed | 화면에서 '-'를 빠뜨리면 금액이 내려가는 변경이 차액 결제 안내로 가는 잘못을 막음(설계 재검토 M5 RE-17의 고치는 방향 '증감을 명시적으로 고름') | 부호 있는 amountDelta 그대로: 사장님이 부호를 넣어야 해 빠뜨릴 수 있음. 새 총액을 받음: 화면이 그 사이 바뀐 지금 금액과 견줘야 하고 금액 그대로를 고르기 어려움 | 확정(2026-11-13 20:59 동희님 결정 카드 '모두 지금 고침 (추천)', 설계 재검토 M5) |
| DEC-24 | 에스컬레이션 건에서 남긴 문제 신고의 안내와 기한 | 사장님이 에스컬레이션 건에서 남긴 문제 신고(API-083, reportedBy owner_from_handoff)는 보상을 정해도(API-065) 보상 안내를 보내지 않는다. 신고한 사람에게는 사장님이 그 건에 답해(API-042) 결과를 전하고, 환불은 결제한 주문자에게 돌아가 지금 환불 안내 규칙(SPEC-047)대로 주문자에게 알린다. 재제작이면 재제작 주문의 안내도 주문자에게 간다. 신고 기한은 그 에스컬레이션 건이 생긴 시각으로 보고, 할 일 '문제 신고'는 올리되 사장님 알림과 문제 신고의 지연 안내(SPEC-024)는 보내지 않는다(그 건의 기다림과 7일 '답 없어 닫힘'이 그대로 돎) | 주문자가 아닌 사람에게 주문 내용·금액을 알리지 않으면서(REQ-252) 선물로 받은 사람의 문제도 같은 보상 정하기로 다룸. 설계 재검토 M12 RB-15의 고치는 방향 '주문자에게 무엇을 알릴지는 지금 환불 안내 규칙을 따름' | 신고한 사람에게 보상 안내를 보냄: 주문자가 아닌 사람에게 환불 금액과 보상이 알려짐. 주문자에게 '선물 받은 분의 신고' 안내를 새로 보냄: 새 안내 글과 받는 사람 규칙이 필요하고, 환불이면 환불 안내로 이미 알게 됨 | 확정(2026-11-13 20:59 동희님 결정 카드 '모두 지금 고침 (추천)', 설계 재검토 M12. RB-15는 Claude 추천이라 동희님 확인 요청. 2026-11-15 14:19 동희님 결정 카드 '지금대로 둠 (추천)'으로 확정함) |
| DEC-25 | AI 모델 회사는 두 회사를 시험해 평가로 고름 | AI 모델 호출은 서버의 한 곳(모델 호출 모듈)만 거치고 배포 설정으로 고른 한 회사(Anthropic이나 OpenAI의 유료 API)의 모델만 부른다(REQ-266, SPEC-021). 같은 평가 세트(12단계, REQ-145)를 설정만 바꿔 두 회사의 모델에 돌리고, 평가를 지나는 것 가운데 가장 싼 모델을 고르며 호출마다 ai_calls.model에 남긴다. AI 출력(AiTurnOutput)과 HTTP 계약은 회사와 상관없이 같다. 개발 전에 두 회사 모두에 보관 안 함(Zero Data Retention)을 신청하고, 허가되기 전에는 처리방침의 국외 이전 항목(API-039 overseasTransfers)에 30일 보관을 적는다 | 한 회사에 묶이지 않고 같은 평가로 품질과 비용을 견줘 고름. 두 회사 모두 유료 API의 입력을 학습에 쓰지 않고 보관 기간을 숫자(30일)로 적으며, 보관 안 함(Zero Data Retention)을 따로 맺거나 허가함(04단계 AI-1 '데이터 다루기', 각 회사 공식 문서 2026-11-14 확인) | 한 회사만 먼저 고름: 평가 전에 정해야 하고 바꾸면 호출 코드와 평가를 다시 함. Google 유료 API도 후보로 둠: 보관 기간을 숫자로 적지 않아 처리방침에 적을 수 없어 뺌(04단계 AI-1) | 확정(2026-11-15 14:19 동희님 결정 카드 '둘 다 시험해 평가로 고름 (추천)', 06단계 OPEN-7을 닫음) |
| DEC-26 | 로그인 유지 시간: 사장님 30일(쓰면 늘어남), 운영자 12시간 | 사장님 세션(쿠키 `siljang_owner`, API-001)은 마지막으로 쓴 때부터 30일 동안 유지하고 쓸 때마다 다시 30일로 늘린다. 운영자 세션(쿠키 `siljang_operator`, API-004)은 로그인한 때부터 12시간이 지나면 끝나 다시 로그인한다(쓴다고 늘지 않음). 로그인 때 보내는 쿠키의 Max-Age는 사장님 2592000초(30일)·운영자 43200초(12시간)이고, 쓸 때마다 늘리는 방법(같은 쿠키를 다시 보내는 때)은 사장님 로그인 작업(10단계 TASK-020)에서 정한다 | 사장님은 휴대폰 카카오톡의 알림 링크로 자주 들어오므로 쓸 때마다 늘려 다시 로그인하는 일을 줄이고, 30일 동안 쓰지 않으면 끝낸다. 운영자는 여러 가게의 손님 개인정보와 원래 값(API-074~077)을 보므로 쓰더라도 하루 안에 끊는다. 06단계 OPEN-5가 첫 값으로 제안한 길이 | 사장님도 로그인한 때부터 정한 날수에 끝냄: 할 일 알림 링크를 열 때 다시 로그인하는 일이 잦아짐. 운영자도 쓰면 늘어남: 켜 둔 운영자 화면이 날을 넘겨 열려 있게 됨 | 확정(2026-11-15 17시 무렵 동희님 결정 카드 '제안대로 (추천)', 06단계 OPEN-5를 닫음) |
| DEC-27 | 운영자 인증은 Supabase Auth(이메일·비밀번호와 TOTP 2단계 인증) | 운영자 로그인(API-004)은 서버가 한 요청 안에서 Supabase Auth에 이메일·비밀번호 로그인과 TOTP 2단계 인증(challenge·verify, aal2)을 하고, 모두 맞고 운영자 표(05단계 operators)에 막히지 않고 2단계 인증을 켠 운영자로 있을 때만 우리 세션 쿠키 `siljang_operator`를 줌. Supabase가 준 토큰은 우리 세션에 쓰지 않고 확인한 뒤 끝냄. 세션은 05단계 operator_sessions(TBL-059)에 쿠키 값의 SHA-256만 두고 로그아웃(API-006)·계정 막기로 끝냄. 로그인 실패는 05단계 operator_login_failures(TBL-060)에 이메일의 HMAC으로 세어 15분에 5번(DEC-16). Origin 헤더가 우리 화면 주소가 아니면 인증 서비스에 묻지 않고 401 `operator_login_failed`(DEC-10의 M18과 같은 이유). Supabase가 답하지 않으면(연결 실패·시간 초과·5xx·429) 503 `auth_unavailable`이고, 비밀번호 단계부터 답이 없었으면 실패로 세지 않음. 가입은 Supabase 대시보드에서 막고, 운영자 사용자는 대시보드에서 만들며 TOTP 등록과 운영자 표 맞추기는 등록 도구(11단계 app/server의 `operator:enroll`)로 함 | 운영자는 몇 명뿐이고 비밀번호·2단계 인증 키를 우리 데이터베이스에 두지 않음(REQ-135). Supabase Auth는 이메일·비밀번호와 TOTP를 HTTP API로 주어 서버가 부를 수 있고 우리 로그인 화면(SCR-046)을 그대로 씀(Supabase 문서 'Multi-Factor Authentication (TOTP)'·'Understanding API keys'와 Auth OpenAPI, 2026-11-18 확인). 세션을 우리 표에 두면 로그아웃·계정 막기 때 서버가 바로 끊음(OWASP Session Management Cheat Sheet, 2026-11-18 확인) | Cloudflare Access: 반복 0 안내서 4-3의 반론이었고 고르지 않음. Supabase 토큰을 세션으로 씀: 12시간 고정(DEC-26)을 토큰 갱신과 따로 지켜야 하고 로그아웃·막기를 Supabase에 맡김. 서명한 쿠키만 씀(표 없음): 로그아웃한 쿠키도 12시간까지 쓰임 | 확정(2026-11-16 17:01 무렵 동희님 Claude Code 채팅 답 '추천 모두 승인', 10단계 TASK-003, 06단계 OPEN-6을 닫음) |
| DEC-28 | 카카오 스킬의 수신 키·채널 친구·사진·봇 ID | 메시지별 ID가 없는 카카오 스킬은 정규화한 봇 ID, userRequest.user.id, userRequest.block.id, 발화, 수신 시각의 고정 2초 구간으로 HMAC-SHA256을 만들어 messages.kakao_message_id에 저장한다. 같은 가게의 같은 키는 한 번만 처리한다. isFriend가 true면 채널 친구, 없거나 false면 친구 아님이다. 일반 사진 주소는 userRequest.utterance에서 받고 안전한 카카오 HTTPS 주소와 이미지 형식을 확인한 뒤 내려받는다. 봇 설정의 기본 정보에서 본 16진수 24자와 스킬 수신 값의 끝 느낌표 하나를 제거한 ID를 대조한다. 보안 이미지 사진은 TASK-167에서 확인한다. | K-01에서 채널 추가 후에만 isFriend가 왔고, K-02에서 같은 2초 구간의 키가 일치했다. 구간을 넘은 재전송은 같은 키로 판별할 수 없다. K-03b의 단일 요청은 자동 재전송의 부재를 보장하지 않는다. K-06 일반 이미지와 K-09 봇 ID의 PC 시험 결과를 반영했다. | 사용자 키만으로 같은 요청을 거르면 사용자의 서로 다른 메시지가 합쳐진다. 스킬의 봇 ID를 그대로 저장하면 설정 화면의 기본 ID와 맞지 않는다. | 확정(2026-11-19 개발 채널 TASK-009, 앞의 OPEN-1·3·8을 닫음) |
| DEC-29 | 카카오 콜백 기한과 빈 메시지 응답 | 콜백을 쓸 때 먼저 4초 안에 콜백 응답을 보내고 AI 응답은 수신 후 55초 안에 처리한다. 콜백 주소의 공식 5분과 한 번 사용을 기준으로 한다. API-070에서 중복 요청과 분당 한도 안내 이후 요청에는 HTTP 200, version 2.0, template.outputs 빈 배열을 반환한다. 분당 한도에 처음 걸린 요청에는 기존 안내를 보낸다. | K-03a 4.5초 응답 도착, K-03b 6초 응답 미표시, K-04 빈 출력 미표시를 확인했다. K-05 개발 채널에서 321.1초 발신도 성공했지만 제품 기한에 쓰지 않는다. | 중복에서 기존 답을 다시 보내면 같은 답이 사용자에게 반복된다. HTTP 204도 PC에서 말풍선이 없었지만 API-070의 JSON 응답을 사용한다. | 확정(2026-11-19 개발 채널 TASK-009, 앞의 OPEN-2·4를 닫음) |
| DEC-30 | 후기 버튼의 주문번호 | 후기 최종 스킬 요청의 clientExtra.orderNo로 해당 주문을 찾고 같은 사용자와 인도 상태를 확인한다. 값이 없으면 그 사용자에게 가장 최근에 보낸 후기 부탁의 주문으로 같은 조건을 확인한다. 보안 이미지 플러그인 사진이 포함된 폰 시험은 TASK-167에서 별도로 확인한다. | K-08에서 사진이 선택인 PC 블록으로 글·동의를 거친 최종 요청의 번호가 카드에 넣은 번호와 일치했다. | 항상 최신 안내로 연결하면 사용자가 예전 후기 카드에 답했을 때 다른 주문에 연결될 수 있다. | 확정(2026-11-19 개발 채널 TASK-009, 앞의 OPEN-12를 닫음) |
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
| OPEN-10 | API-031, API-032, API-070 | 스킬 요청의 출처: 오픈빌더 문서(2026-11-12 확인)에 요청 서명·출처 IP가 없어, 봇 ID와 스킬 키를 아는 사람이 꾸민 요청과 카카오의 요청을 서버가 가를 수 없음(연결 문구는 화면을 본 사장님만 알지만 채널 대화창에서 왔는지는 증명하지 못함). 11단계 전에 카카오에 스킬 요청의 출처 IP나 서명을 문의함. 남이 봇 ID를 먼저 넣어 막힌 가게(channel_linked_elsewhere)는 운영자가 확인하고 그 '연결 확인 중' 연결을 풀고, 키가 샌 가게는 스킬 키를 바로 끊고 바꿈(API-079 revoke_now, 설계 재검토 RD-06) |
<!-- END generated:open -->

## 10. 서버 안의 일

호출하는 API 없이 정해진 시각이나 이벤트로 서버가 하는 일입니다. 그 결과가 계약의 어느 응답에 보이는지 적었습니다.

<!-- BEGIN generated:jobs -->
| SPEC | 서버가 하는 일 | 계약에서 보이는 곳 |
| --- | --- | --- |
| SPEC-024 | 사장님 답 기다림 타이머: 기다리는 시간이 지나면 지연 안내 한 번과 다시 알림 한 번(답하는 시간 안에서만 셈, 결제 확인 요청·맞추는 중·환불 결정도, REQ-215). 닫는 때(하루 내내 셈)가 오면 맞춤 주문 요청은 그 픽업 날짜의 주문 마감에 주문을 '답 없어 닫힘'으로, 변경 요청은 변경 마감에, 에스컬레이션 건은 남긴 지 7일에 '답 없어 닫힘'으로 닫고 손님에게 한 번 알림(REQ-213, REQ-214, REQ-216). 결제 확인 요청은 결제 기한 상한에 결제 기한 지남으로(SPEC-037). 맞추는 중·환불 결정·문제 신고는 닫지 않음(1-7) | API-040(할 일의 waitStatus), API-041(status closed_no_answer), API-042(답하면 멈춤, 닫힌 건은 409 invalid_state), API-045(cancelKind no_answer), API-062(status closed_no_answer), API-010(기다리는 시간 설정) |
| SPEC-025 | 문의 끊김과 상담 끝남: 마지막 손님 메시지 뒤 가게가 정한 시간이 지나면 상담을 닫음. 열린 에스컬레이션 건과 다룬 주문이 없으면 문의 끊김(다시 말하면 이어감, REQ-211), 다룬 주문이 모두 끝났으면 상담 끝남(다음 말은 새 상담, REQ-189). 닫힌 상담의 손님에게도 결제 안내·사장님 답·전날 안내 같은 주문과 에스컬레이션 건의 안내는 보냄(REQ-212) | API-070(이어가기, 새 상담의 AI 상담 고지), API-010(끊김 시간 설정), API-043(status dropped·ended) |
| SPEC-037 | 결제 기한 처리: 결제 기한(전해진 때부터 세고 결제 기한 상한을 넘지 않음, REQ-218)이 지난 결제 안내의 자리를 풀고 사장님께 고를 일을 남김. 확인 요청됨은 결제 기한 상한에, 맞추는 중은 하지 않음(REQ-223). 새 금액 확인이 필요한 결제 안내는 손님이 확인하기 전에는 결제 기한 상한이 결제 기한(REQ-232). 사장님이 픽업 일시까지 고르지 않으면 결제 없어 취소하고 손님에게 한 번 알림(REQ-217) | API-040(할 일), API-044(status=payment_overdue, paymentNotice), API-045(paymentRequests의 deliveredAt·dueCapAt), API-047(고르기) |
| SPEC-044 | 차액 결제 기한 처리: 기한이 지난 차액 결제 안내를 기한 지남으로, 변경 요청을 '차액 없어 닫힘'으로 두고 차액을 기다리며 잡아 둔 새 날 자리를 풀고 손님과 사장님께 한 번 알림(REQ-233, REQ-234). 손님이 새 금액을 확인하기 전의 기한은 변경 마감(REQ-232). 확인 요청됨인 차액 결제는 결제 기한 상한(변경 마감)까지 닫지 않고(REQ-223), 맞추는 중인 차액 결제는 닫지 않음(사장님의 '대조 완료'나 '변경 닫기'로만 끝남, REQ-235) | API-062, API-059(변경 닫기), API-071(amount_declined) |
| SPEC-052 | 전날 안내: 다음 날 픽업할 손님에게 가게가 정한 시각(08:00~20:50)에 한 번 | API-027(시각 설정) |
| SPEC-061 | 후기 부탁: 인도한 다음 날 가게가 정한 시각에 한 번. 보내기 직전에 다시 보고 문제 신고가 한 번이라도 들어온 주문(닫힌 신고 포함)과 재제작 주문에는 보내지 않음 | API-027(시각 설정), API-072(버튼이 여는 후기 블록) |
| SPEC-064 | 장부 쓰기와 다시 적기(1분·5분·30분·2시간·6시간, 그 뒤 하루 한 번), 24시간 실패 알림. 재제작 주문은 행을 두지 않고 원래 주문 행에 '재제작'으로 적음 | API-033(못 적은 쓰기 수), API-035(다시 연결하면 다시 적음) |
| SPEC-065 | 지난 기록 지우기: 하루 한 번 03:00, 05단계 README 6절의 여덟 차례. 끝나고 30일 지난 주문(끝나지 않은 재제작 주문이 있는 원래 주문은 끝나지 않은 주문, SPEC-060)의 개인정보를 지우고 보관 기록으로 나눔(알레르기 답은 지우고 알레르기 정보 동의의 답·동의 글 버전·시각은 남김), 닫히고 30일 지난 상담의 대화·사진·초안(더하는 옵션 포함)과 덧붙은 질문을 지움, 3년 지난 신고 설명·사진과 5년 지난 보관 기록을 지움, 상담과 주문이 모두 지워진 손님의 카카오 사용자 키를 지움, 2년 지난 접속기록을 지움(접속기록을 지키는 트리거가 2년이 지나지 않은 행의 지우기를 막음, REQ-196), 24시간 지난 화면 요청 키를 지움(DEC-04), 30일 지난 AI 도구 호출 기록을 상담이 열려 있어도 지움(AI-1, 05단계 E11). 참고 사진·신고 사진 행을 지우는 트랜잭션에서 그 파일의 저장 위치를 지울 파일(05단계 TBL-054)에 함께 남기고, 저장소에서 지운 뒤에만 그 행을 뺌(실패하거나 작업이 멈추면 다음 날 다시 지우고, 지운 수와 남은 수는 운영 기록에). 30일·3년·5년은 잠정(REQ-185~190) | API-043(지운 상담은 status deleted), API-044·045(보관 기록이 된 주문은 목록에 없고 하나를 읽으면 404), API-077(지운 값과 지운 상담의 대화 글은 409 original_erased) |
| SPEC-066 | 손님에게 먼저 보내는 안내: 가게의 먼저 보내기가 되고 손님이 친구면 우리 앱 키로 가게 봇의 Event API(siljang_notice, 안내 키)를 부름. 요청이 SUCCESS면 taskId와 함께 '확인 중'으로 두고 1분·5분·30분 뒤 발송 결과 조회(GET /v1/tasks/{taskId}): 닿음은 '보냄', 채널 친구 아님(101)은 다음 대화 때와 손님 친구 아님, 스킬·카카오 오류(201~205·301·999)는 다시 보내기, 발송 제한(401~407)은 다음 대화 때와 운영자 알림, 30분 뒤에도 모름은 다음 대화 때. 요청이 FAIL이면 채널 연결·이벤트 이름·월렛 없음은 가게의 먼저 보내기 '안 됨'과 사장님 알림, 월렛 잔액 없음은 운영자 알림, 그 밖은 다시 보내기. 먼저 보내기가 안 되는 가게와 친구가 아닌 손님은 다음 대화 때 먼저(DEC-20). 결제 안내가 닿았다고 확인되거나 다음 대화 때 보인 때를 그 결제 안내의 전해진 시각으로 남기고 결제 기한을 그때부터 셈(REQ-218) | API-073(안내 스킬), API-070(먼저 전함), API-030(먼저 보내기 상태), API-042 |
| SPEC-067 | 사장님 알림: 우리 서비스 채널 봇이 Event API로 사장님의 카카오 로그인 사용자 번호(appUserId)에 할 일 종류와 목록 주소(1분 안 같은 종류는 묶음). 발송 결과 조회는 손님 안내와 같고, 채널 친구 아님(101)이면 사장님을 친구 아님으로 고치고 할 일 목록에만(DEC-21) | API-040(할 일), API-002(채널 친구가 아니면 안내) |
| SPEC-008 | 채널 연결 확인: 10분이 지나도 연결 문구와 시험 버튼 다섯이 다 닿지 않으면 '연결 안 됨'과 사유 후보. 연결되면 시험 사용자에게 시험 안내를 Event API로 보내고 발송 결과로 먼저 보내기 됨·안 됨(사유)을 남김(DEC-20) | API-030(verifiedBlocks, eventStatus), API-032(다시 시험), API-073(시험 안내) |
| SPEC-074 | 접속기록 남기기: 손님 개인정보(이름·연락처·대화·원래 값·계좌·알레르기 답·사진)를 돌려주거나 바꾸는 사장님 API(할 일·에스컬레이션 건·상담·주문·제작·결제 안내·환불·변경 요청·문제 신고·후기, API-040~066)와 운영자의 가게 기록 API(API-074~077)는 응답과 같은 트랜잭션에서 접속기록 한 행(누가·언제·접속지·가게·손님 ID·API 번호·경로, 연 경우의 대상·사유)을 남기고, 남기지 못하면 500 internal로 개인정보를 돌려주지 않음. 가게 설정 API·카카오 스킬·서버 안의 일은 남기지 않음. 접속기록은 넣기만 하고 2년 동안 고치거나 지우지 못함(05단계 A24) | API-040~066, API-074~077(운영자, 원래 값 열기는 사유와 함께) |
| SPEC-047 | 환불 보내기 다시 알림: 정한 뒤 24시간이 지나도 '보냄'이 없으면 사장님께 한 번 다시 알림(REQ-173) | API-040(할 일 refund_send), API-061(보냄이면 닫힘) |
<!-- END generated:jobs -->

## 11. 깨지는 변화

2026-11-13 설계 재검토 H1·H2(15절)로 응답 스키마에 꼭 있는 필드 7개를 더했습니다: `PaymentRequest.arrivedAmount`·`arrivedAt`, `Payment.voidedAt`·`voidReason`, `RefundPreview.confirmedAmount`·`unconfirmedAmount`·`minAmount`. 응답에만 더한 필드라 보내는 요청은 그대로이고, A13이 '꼭 넣을 필드 더함'으로 찾으므로 `components.x-corthex.breakingChanges`에 7개를 사유·결정(동희님 2026-11-13 20:59 결정 카드 '추천안대로 (추천)')과 함께 적었습니다(원본은 `api_catalog.py`의 `BREAKING_CHANGES`, PR마다 더하고 지난 항목은 지우지 않음). 고를 값을 더한 것(할 일 종류 `refund_send`·`arrival_check`, 환불 원인 `over_received`, 입금 대조 결과 `arrived`·`void`)과 넣지 않아도 되는 요청 필드(`RefundInput.paymentRequestId`, `ReconciliationInput.arrivedAmount`·`voidReason`)는 깨지는 변화가 아닙니다.

같은 재검토의 H6·H11·H12(15절)로 바꾼 것 가운데 A13이 찾지 않는 것 3개도 목록에 적었습니다: 제작 목록 요약(`ProductionDay.items[].summary`)에 꼭 있는 필드 5개를 더함(안쪽 필드라 A13이 찾지 않음), AI 출력 `draft_patch`에서 주문자 이름·연락처를 뺌(HTTP 계약 밖), 주문·변경 요청의 `revision` 값의 원본을 잠금 번호로 바꿈(화면은 받은 값을 그대로 보내므로 바꿀 것 없음). 스킬 결과 `orderer_saved`·`input_invalid`와 넣지 않아도 되는 스킬 블록 파라미터 `customer_name`·`customer_phone`·`depositor_name`은 깨지는 변화가 아닙니다.

같은 재검토의 H7·H8·H9(15절)로 꼭 있는 필드 8개를 더했습니다: 요청 `KakaoChannelInput.blockIds`(카드 버튼이 부를 블록 ID 넷), 응답 `SkillSetup.eventSkillUrl`·`eventName`, `KakaoChannel.blockIds`·`verifiedBlocks`·`eventStatus`·`eventCheckedAt`·`eventFailReason`. 요청에 더한 `blockIds`는 채널 연결 화면(SCR-041)이 함께 보내야 하는 바꿈입니다. A13이 찾지 않는 것 3개도 목록에 적었습니다: 스킬 결과 `channel_linked`를 API-070에서 API-071·072로 옮기고 API-070은 `channel_test_card`를 줌, 주문 요청 확인 카드의 응답 구성(규정 글을 먼저, DEC-22), `Owner.alertChannelFriend`를 고치는 곳이 늘어남. 새 API-073, 오류 코드 `channel_setup_incomplete`, 필드 오류 사유 `exceeds_card_limit`, 스킬 결과 5개(`channel_test_card`·`block_verified`·`notice_shown`·`notice_test`·`notice_gone`), 넣지 않아도 되는 스킬 요청 값(`userRequest.params.noticeKey`·`check`, `clientExtra.check`)과 연결 안 됨의 사유 후보에 더한 고를 값은 깨지는 변화가 아닙니다.

같은 재검토의 H3(15절)으로 A13이 찾지 않는 것 1개를 목록에 적었습니다: 끝나고 30일이 지나 보관 기록이 된 주문은 주문 목록(API-044)에 나오지 않고, 주문 상세(API-045)와 그 주문의 하위 기록을 읽으면 404 `not_found`입니다(5절 '보관 기록'). 상담 상태에 고를 값 `ended`(`ConsultationMessagePage.status`)를 더한 것은 깨지는 변화가 아닙니다.

같은 재검토의 H4(15절)로 응답 스키마에 꼭 있는 필드 1개를 더했습니다: `ReviewShopDetail.paymentAccount`(운영자가 보는 결제 계좌의 은행·예금주·끝 4자리, 없으면 null). A13이 찾지 않는 것 2개도 목록에 적었습니다: 환불 '보냄'의 환불 계좌 번호 형식을 숫자 10~16자리로 좁힘(`RefundSentInput.refundAccount.accountNumber`), 사장님 화면의 손님 말과 상담 대화에서 카드번호는 플레이스홀더와 끝 4자리, 긴 숫자는 플레이스홀더만 보임. 새 API-074~077, 오류 코드 4개(`payment_account_missing`·`holder_not_verified`·`original_not_kept`·`original_erased`)와 그것을 API-014·025에 더한 것은 깨지는 변화가 아닙니다.

같은 재검토의 H5·H10(15절)으로 A13이 찾는 깨지는 변화 2개를 목록에 적었습니다: 응답에서 `Order.photoConsent`를 없앰(주문 요청 때의 사진 게시 동의를 없애고 완성 사진·후기 사진마다 받음), 응답 `OrderDetailsVersion.allergyConsent`(알레르기 정보 동의의 답)를 꼭 있는 필드로 더함. A13이 찾지 않는 것 7개도 목록에 적었습니다: 요청 `KakaoChannelInput.blockIds.allergyAnswer`(채널 연결 화면 SCR-041이 함께 보냄), 응답 `KakaoChannel.blockIds.allergyAnswer`와 `verifiedBlocks`·`failureHints`에 더한 값, `ProductionDay.items[].summary.allergyConsent`, `Production.completionPhotos[].consent`, 고를 값 `confirm_with_photo_consent`를 없앰, AI 출력 `draft_patch`에서 `allergy_answer`를 뺌, 주문 요청 확인 카드의 응답 구성(알레르기 정보 카드를 앞에, 요약 카드의 버튼 둘). 스킬 결과 3개(`allergy_saved`·`allergy_declined`·`photo_consent_saved`), 넣지 않아도 되는 스킬 블록 파라미터 `allergy_answer`, 요청 예시 `allergy_answer`·`photo_consent`·`add_completion`은 깨지는 변화가 아닙니다.

같은 재검토의 중간 묶음 M1·M2·M3·M9·M10(15절)으로 A13이 찾는 깨지는 변화 5개를 목록에 적었습니다: 할 일의 기다림 상태(`OwnerTask.waitStatus`)에서 '할 일에 남음' `parked`를 없애 '지연'에 합치고 '답 없어 닫힘' `closed_no_answer`를 더함, 응답에 꼭 있는 필드 `Handoff.closedAt`·`PaymentRequest.deliveredAt`·`PaymentRequest.dueCapAt`·`OrderSummary.paymentNotice`를 더함. A13이 찾지 않는 것 4개도 목록에 적었습니다: 고를 값 '답 없어 닫힘'(`Order.cancelKind`의 `no_answer`, 변경 요청·에스컬레이션 건 상태의 `closed_no_answer`)을 더함, 답 없어 닫힌 건에 답하면 409 `invalid_state`(API-042·046·063), 확인할 것 `closed_day`·`past_cutoff`·`overbooking`을 API-046·047·063·065에 더함(주문 마감이 지난 주문의 결제 기한 연장은 409 `invalid_state` 대신 확인 뒤 됨), `PaymentRequest.dueAt`과 스킬 요청 `isFriend`의 뜻이 바뀜. 새 확인할 것 `past_cutoff`와 응답 예시를 더한 것은 깨지는 변화가 아닙니다.

2026-11-14 Codex 후속(15절)으로 A13이 찾는 깨지는 변화 3개를 목록에 적었습니다: 운영자가 보는 상담 메시지에서 번호만 가린 대화 글 `OperatorMessage.textMasked`를 없앰, 그 자리에 글자 수 `OperatorMessage.textLength`를 꼭 있는 필드로 더함, 사유를 적어 연 대화 글 한 페이지 `OriginalValue.consultationText`를 꼭 있는 필드로 더함(다른 대상을 열면 null). 결정은 설계 재검토 H4의 결정(동희님 2026-11-13 20:59 결정 카드 '추천안대로 (추천)': 운영자에게는 가린 값만)이고 가게 기록 보기(SCR-050)가 함께 바뀝니다(08단계 12절). 요청 `OriginalOpenInput`에 넣지 않아도 되는 `cursor`와 고를 값 `consultation_text`를 더한 것(응답의 `targetKind`는 보낸 값을 그대로 돌려줌), 환불 금액(`RefundInput.amount`·`CompensationInput.refundAmount`와 응답의 환불 금액·계산값·가장 작은·큰 금액)의 한도를 1,000만 원에서 1억 원으로 넓힌 것은 보내던 요청이 그대로 맞고 화면은 금액을 보이기만 하므로 깨지는 변화로 보지 않았습니다.

같은 재검토의 중간 묶음 M4·M13(15절)으로 A13이 찾는 깨지는 변화 5개를 목록에 적었습니다: 환불 계산 근거(`RefundBasis`)에 꼭 있는 필드 `excludedAmount`(받은 금액에서 빼 바탕을 만든 금액)·`preProductionRefundPct`(쓴 제작 전 취소 비율)·`pickupBasisAt`(단계별 환불의 기준 픽업 일시)·`remakeOrder`(재제작 주문의 일이면 그 재제작 주문)를 더함, 보상 결정 요청의 다르게 정한 사유 `CompensationInput.refundOverrideReason`을 없앰(보상은 고른 금액이 계산값). A13이 찾지 않는 것 4개도 목록에 적었습니다: 금액이 내려간 변경의 환불 결정은 `partial`만(`full`이면 422 `not_allowed`), 재제작 주문의 변경 요청은 금액이 그대로일 때만 수락(`amountDelta`가 0이 아니면 422 `not_allowed`), 운영규정의 단계별 환불은 0시간부터 끝없음까지 빈 구간·겹침 없이 이어지고 단계별 환불 조문과 함께 있음(422 `gap`·`overlaps`·`required`), 재제작 주문에 들어온 신고의 `IssueReport.paidAmount`와 재제작 주문의 환불 미리보기·환불의 `order`가 원래 주문의 것. 결정은 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'(검토자의 고치는 방향대로)이고 변경 요청(SCR-024)·환불 결정(SCR-025)·문제 신고(SCR-027)·운영규정(SCR-038)이 함께 바뀝니다(08단계 12절). 응답 예시 2개(API-049 `after_start`·`remake_cancel`)와 설명만 고친 필드는 깨지는 변화가 아닙니다.

같은 재검토의 중간 묶음 M5·M6(15절)으로 A13이 찾는 깨지는 변화 12개를 목록에 적었습니다: 오류 코드 `stale_change`를 없앰(고를 값 `Problem.code`에서도 빠짐), 닿지 않던 변경 상태 '오래된 버전'(`stale`)을 `ChangeRequest.status`·`ChangeRequestSummary.status`에서, 할 일 종류 `stale_change`(이전 버전 변경)를 `OwnerTask.kind`에서 없앰, 변경 요청 응답(API-063)의 요청 필드 `ChangeDecisionInput.amountDelta`(부호 있는 금액 차이)를 없앰(방향 `amountDirection`과 양수 `amountDifference`로 받음, DEC-23), 결제 안내의 `PaymentRequest.requestedAmount`를 없애고 견적의 표시 방식·금액·위 끝을 담은 `requestedQuote`와 새 금액 확인의 `needsAmountConfirm`·`amountConfirmedAt`·`amountDeclinedAt`을 꼭 있는 필드로 더함, 변경 요청에 지금 주문 금액 `ChangeRequest.orderAmount`를 꼭 있는 필드로 더함(변경 요청 화면이 수락 전 결과 한 줄에 새 금액을 보임). A13이 찾지 않는 것 5개도 목록에 적었습니다: '부터'·'범위' 견적의 맞춤 주문은 `accept`를 받지 않고 견적의 아래 끝보다 낮은 금액은 422 `below_quote_min`(API-046), '부터'·'범위' 값의 옵션과 기본 디자인 범위 밖 옵션에 이은 도안은 기본 디자인 범위에 넣지 못함(API-017 `inStandard` `not_allowed`), 변경 요청 응답의 방향·차이 금액의 조건과 변경 마감이 지난 변경 요청의 409 `invalid_state`(API-063), 새 금액 확인이 필요한 결제 안내의 `deliveredAt`·`dueAt`의 뜻(손님이 확인한 때가 전해진 시각, 확인 전의 결제 기한은 결제 기한 상한), `QuoteView.orderKind`의 뜻(그 가격표 버전의 기본 디자인 범위로 가름). 결정은 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'(검토자의 고치는 방향대로)이고 결제 안내(SCR-005)·할 일 목록(SCR-016)·주문 상세(SCR-021)·맞춤 주문 검토(SCR-022)·결제 기한 지난 주문(SCR-023)·변경 요청(SCR-024)·입금 대조 목록(SCR-028)·입금 대조(SCR-029)·가격표와 도안(SCR-036)이 함께 바뀝니다(08단계 12절). 입금 대조 요청의 고를 값 `close_change`(변경 닫기), 스킬 결과 2개(`amount_confirmed`·`amount_declined`)와 그 `Siljang-Outcome` 값, 필드 오류 사유 `below_quote_min`, 응답·요청 예시(API-058 `awaiting_amount_confirm`, API-059 `close_change`·`change_closed`, API-071 `amount_confirm`·`amount_confirmed`·`amount_declined`)를 더한 것은 보내던 요청이 그대로 맞고 화면이 새 값을 다루도록 08단계를 함께 고쳐 깨지는 변화로 보지 않았습니다.

같은 재검토의 중간 묶음 M7·M17(15절)로 A13이 찾는 깨지는 변화 3개를 목록에 적었습니다: 에스컬레이션 건의 손님 말마다 사유와 관련 주문(`CustomerLine.reason`·`CustomerLine.order`)과 추가 수락을 쓴 주문 요청(`Handoff.dayUsedOrder`)을 꼭 있는 필드로 더함(응답에만 더한 필드). A13이 찾지 않는 것 3개도 목록에 적었습니다: AI 출력 `draft_patch`의 픽업 일시 `pickup_at`을 날짜 `pickup_day`와 시각 `pickup_time`으로 나눔(HTTP 계약 밖), 마감된 날 질문은 열린 건에 덧붙지 않고 상담과 날짜마다 따로 건이 됨(`Handoff.customerLines`·`requestedDay`의 뜻), 같은 요청 키로 다시 온 요청의 본문은 처음 결과가 가리킨 기록을 지금 다시 읽은 것(`Idempotency-Replayed`, DEC-04). 결정은 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'(검토자의 고치는 방향대로)이고 에스컬레이션 건(SCR-017)이 함께 바뀝니다(08단계 12절). 요청 키의 지문·처리 상태·24시간 보관과 오류 코드 `idempotency_key_reused`·`request_in_progress`의 설명을 더한 것은 화면이 보내는 요청과 받는 응답의 모양을 바꾸지 않아 깨지는 변화가 아닙니다.

같은 재검토의 중간 묶음 M16·M18(15절)로 A13이 찾는 깨지는 변화 9개를 목록에 적었습니다: 사장님 로그인 요청에 꼭 넣을 `OwnerSessionInput.state`를 더함, 스킬 설정 값에서 스킬 키 값 `SkillSetup.headerValue`를 없앰, 그 자리에 꼭 있는 필드 `SkillSetup.keyVersion`·`keyIssuedAt`·`previousKeyValidUntil`을 더함, 새 키를 한 번 보이는 `KakaoChannelResult.skillKey`와 연결 확인의 `KakaoChannel.proofPhrase`·`claimExpiresAt`을 더함, 포트폴리오 게시(API-068)의 404 응답을 없앰. A13이 찾지 않는 것 4개도 목록에 적었습니다: 본문·쿼리의 다른 기록 ID가 없거나 남의 것이면 같은 422(DEC-02), 필드 오류 코드 `reference_not_found`를 더함, `skill_key_invalid`·`test_message_missing`·`channel_test_card`의 뜻이 키 버전과 연결 문구 기준으로 바뀜, API-070 `ai_timeout`·`ai_limit_reached`의 뜻이 55초 기한과 호출 8번 상한으로 바뀜.

같은 재검토의 중간 묶음 M11·M14(15절)로 A13이 찾는 깨지는 변화 10개를 목록에 적었습니다: 가게 등록 요청에 꼭 넣을 `ShopRegistration.businessAddress`·`contactEmail`을 더함(가게 등록 화면 SCR-015가 함께 보냄), 응답에 꼭 있는 필드 `Shop.businessAddress`·`contactEmail`·`mailOrderAuthority`·`identityChange`와 `ReviewShopDetail.businessAddress`·`contactEmail`·`mailOrderAuthority`·`pendingIdentityChange`를 더함. A13이 찾지 않는 것 4개도 목록에 적었습니다: 예약 링크 페이지의 `BookingPage.shop`에 꼭 있는 안쪽 필드 `businessAddress`·`contactEmail`·`mailOrderAuthority`를 더함, 주문 요청 확인 카드의 규정 글 끝에 미성년자 취소 고지 한 줄(API-070 `card_shown`, API-071 `orderer_saved`·`card_stale`·`card_expired`), API-073 `notice_shown`의 확정 안내에 결제가 확인된 금액과 가게 신원을 담음, 확인을 기다리는 사업자 정보 변경 요청이 있으면 영업 신고 확인됨(API-014)이 409 `identity_change_pending`. 결정은 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'(검토자의 고치는 방향대로)이고 예약 링크 페이지(SCR-001)·주문 요청 카드(SCR-004)·손님 알림(SCR-011)·가게 등록(SCR-015)·가게 설정(SCR-034)·영업 신고(SCR-035)·영업 신고 확인(SCR-048)이 함께 바뀝니다(08단계 12절). 새 API-080~082, 오류 코드 `identity_change_pending`, 가게 설정 요청 `ShopUpdate`에 넣지 않아도 되는 필드 5개(`businessAddress`·`contactEmail`·`mailOrderRegNo`·`mailOrderAuthority`·`mailOrderExemption`), 운영규정 확정(API-021)의 글 한도에 미성년자 취소 고지를 함께 셈, 내 주문 카드에 더한 내용과 응답·요청 예시는 깨지는 변화가 아닙니다.

같은 재검토의 중간 묶음 M12(15절)로 A13이 찾는 깨지는 변화 8개를 목록에 적었습니다: 보상 결정 요청에 꼭 넣을 `CompensationInput.problemKind`(문제 종류, 문제 신고 화면 SCR-027이 함께 보냄)를 더함, 응답에 꼭 있는 필드 `IssueReport.problemKind`·`noCompensationReason`·`otherCompensationNote`·`otherCompensationAmount`·`reportedBy`·`handoff`와 `Handoff.issueReport`를 더함. A13이 찾지 않는 것 4개도 목록에 적었습니다: 보상에 고를 값 `other_compensation`(그 밖의 보상)을 더함, 상함·변질이나 이물의 보상 없음이 409 `confirmation_required`(`no_compensation_standard`)를 받음, API-070의 `handed_over`와 다른 사용자의 주문 질문의 뜻(같은 사용자에게서만 받고, 다른 사용자에게는 없는 주문번호와 같은 답, 사정을 말하면 에스컬레이션), API-071 `issue_reported`의 뜻(기한 뒤 신고도 같은 말). 결정은 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'(RA-13은 검토자의 고치는 방향대로, RB-15는 Claude 추천이라 동희님 확인 요청. 2026-11-15 14:19 동희님 결정 카드 '지금대로 둠 (추천)'으로 확정함)이고 내 주문 보기(SCR-007)·문제 신고 카드(SCR-010)·손님 알림(SCR-011)·에스컬레이션 건(SCR-017)·문제 신고(SCR-027)·운영규정(SCR-038)이 함께 바뀝니다(08단계 12절). 새 API-083, 확인할 것 `no_compensation_standard`, DEC-24, 보상 결정 요청에 넣지 않아도 되는 필드 3개(`noCompensationReason`·`otherCompensationNote`·`otherCompensationAmount`), 응답·요청 예시를 더한 것은 깨지는 변화가 아닙니다.

같은 재검토가 남긴 빈 곳(PR J2, 15절)으로 A13이 찾지 않는 것 4개를 목록에 적었습니다(A13이 찾는 것은 0개): 응답의 안쪽 필드 `OrderSummary.paymentNotice.awaitingAmountConfirm`을 꼭 있게 더함(주문 목록 SCR-020의 '손님 확인 기다림'), API-059 들어옴(`arrived`)의 뜻이 바뀜(확인된 결제 안내에도 남기고, 다시 남기면 들어온 금액에 더함), API-049 계산값과 API-050 409 `already_decided`의 뜻이 바뀜(환불을 정한 뒤 같은 결제 안내에 또 들어온 입금은 새로 들어온 몫만 새 환불로), API-059 결제 확인 취소(`void`)가 409 `invalid_state`를 받는 경우를 더함(들어온 금액이 안내 금액보다 많음).

같은 재검토의 낮음 K2(15절)로 A13이 찾지 않는 것 5개를 목록에 적었습니다(A13이 찾는 것은 0개): 상담 대화(API-043)가 그 상담의 손님 안내를 섞어 주며 `ConsultationMessage.author`에 사장님 답 `owner`·그 밖의 안내 `notice`를, `delivery`에 보내는 중 `sending`·먼저 보냄 `event_api`를 더함, 글 한도 `ConsultationMessage.text`·`CustomerLine.text`를 4,000자에서 받는 한도와 같은 100,000자로 넓힘(API-041·043), 주문번호(`orderNo` 등)의 형식을 6~12자에서 6~8자로 좁힘(04단계 SPEC-029, 05단계 CHECK), 스킬 응답 카드 이미지의 대체 글(`simpleImage.altText`)을 1~1,000자에서 1~50자로 좁힘(카카오 응답 형식, API-070~072), 사진 올리기(API-007)에 429 `rate_limited`를 더함(DEC-16). 결정은 동희님 2026-11-13 20:59 결정 카드 '높음·중간 뒤에 따로 고침 (추천)'이고, 'Claude 추천'이 없어 검토자의 고치는 방향대로입니다. 화면이 함께 바뀌는 것은 상담 대화(SCR-018)의 '사장님 답'·'안내' 라벨과 긴 글입니다(08단계).

2026-11-15 동희님 결정 반영(15절)으로 A13이 찾는 깨지는 변화 5개를 목록에 적었습니다: 응답에 꼭 있는 필드 `Shop.awaitingPaymentLimit`(한 손님의 결제 기다림 주문 한도)과 `Handoff.limitDecision`·`limitAcceptExpiresAt`·`limitUsedOrder`·`awaitingPaymentOrders`를 더함(응답에만 더한 필드). A13이 찾지 않는 것 3개도 목록에 적었습니다: 에스컬레이션 건 사유(`Handoff.reason`·`CustomerLine.reason`)에 고를 값 `order_limit`을 더함, API-071 주문 요청이 한도에 닿으면 새 결과 `order_limit_reached`로 남기지 않음(`order_requested`의 뜻이 바뀜), 요청 `HandoffAnswerInput`에 넣지 않아도 되는 `limitDecision`을 더함. 결정은 동희님 2026-11-15 14:19 결정 카드 '가게가 한도를 정함'(설계 재검토 RB-25)입니다. 요청 `ShopUpdate.awaitingPaymentLimit`(넣지 않아도 되는 필드)와 AI 모델 회사의 결정(DEC-25, 계약의 모양은 그대로)은 깨지는 변화가 아닙니다.

첫 버전(2026-11-12)에는 앞 계약이 없어 깨지는 변화가 없었습니다. 다음 버전부터 `check_api.py`의 A13이 main의 `api/openapi.yaml`과 견줘 API·응답·오류 코드·필드·고를 값을 없애거나, 타입을 바꾸거나, 꼭 넣을 필드를 더한 것을 찾고, 그것이 목록에 있고 동희님이 정했는지 봅니다.

## 12. 검사

2026-11-18 23:36 KST, TASK-021 운영자 로그인(DEC-27, OPEN-6을 닫음)을 반영한 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과(`bash tools/stage-checks.sh task021`의 api 검사): 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A5 예시 893개 → 894개, A6 오류 예시 491개 → 492개, A10 열린 질문 10개 → 9개(OPEN-6을 닫음), A11 결정 사항 26개 → 27개(DEC-27), A13 main(`0ed4ad4`)의 `api/openapi.yaml`과 견준 깨지는 변화 0개입니다. A2·A4·A12 API 83개, A3 SPEC 79개, A7 테이블.컬럼 106개(159자리), A8 누구나 쓰는 API 5개, A9 말로만 적은 근거 88개, D1 테이블.컬럼 106개에 값 5905개는 그대로입니다.

2026-11-16 01:24 KST, 구현하며 좁힌 해석(DEC-04, 요청 키에 남기지 않는 결과)을 반영한 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과(`bash tools/stage-checks.sh task019`의 api 검사, 9개 모두 종료 코드 0): 검사 17개: 통과 17, 실패 0, 미확인 0. A13 main(`a5b66cf`)의 `api/openapi.yaml`과 견준 깨지는 변화 0개입니다. A2·A4·A12 API 83개, A3 SPEC 79개, A5 예시 893개·성공 응답 시각 940개·성공 응답 예시 261개, A6 오류 예시 491개, A7 테이블.컬럼 106개(159자리), A8 누구나 쓰는 API 5개, A9 말로만 적은 근거 88개, A10 열린 질문 10개, A11 결정 사항 26개, D1 테이블.컬럼 106개에 값 5905개(글자 수 CHECK가 있는 컬럼 42개), M1 목 서버 요청 961개는 앞 결과와 같습니다. 그 뒤에는 12·15절의 손으로 쓴 글만 고쳤습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-15 17:55 KST, 동희님 결정 반영(로그인 유지 시간)을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A10 열린 질문 10개(OPEN-5를 닫음), A11 결정 사항 26개(DEC-26), A13 main(`2f175c3`)의 `api/openapi.yaml`과 견준 깨지는 변화 0개입니다. A2·A4·A12 API 83개, A3 SPEC 79개, A5 예시 893개·성공 응답 시각 940개·성공 응답 예시 261개, A6 오류 예시 491개, A7 테이블.컬럼 106개(159자리), A8 누구나 쓰는 API 5개, A9 말로만 적은 근거 88개, D1 테이블.컬럼 106개에 값 5905개(글자 수 CHECK가 있는 컬럼 42개), M1 목 서버 요청 961개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-15 15:40 KST, PR #48을 합친 main(`220f09d`)의 계약으로 12-2의 Schemathesis를 다시 돌렸습니다(아래 12-2). 이때 `check_api.py`는 다시 돌리지 않았습니다.

2026-11-15 15:01 KST, 동희님 결정 반영을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A5 예시 893개·성공 응답 시각 940개·성공 응답 예시 261개(새 예시 5개: API-010 요청 `order_limit`, API-041 `order_limit`, API-042 요청 `accept_limit`·응답 `limit_accepted`, API-071 결과 `order_limit_reached`), A7 테이블.컬럼 106개(159자리. `shops.awaiting_payment_limit`·`handoffs.limit_decision`을 더함), A10 열린 질문 11개(OPEN-7을 닫음), A11 결정 사항 25개(DEC-25), A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 5개가 모두 목록에 있음(11절), D1 테이블.컬럼 106개에 값 5905개, M1 목 서버 요청 961개입니다. A2·A4·A12 API 83개, A3 SPEC 79개, A6 오류 예시 491개, A8 누구나 쓰는 API 5개, A9 말로만 적은 근거 88개, D1의 글자 수 CHECK가 있는 컬럼 42개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-15 04:52 KST, 설계 재검토 낮음 K2를 고친 뒤(15절, 그 PR의 Codex 의견을 고친 뒤 05:10에 다시 돌려도 출력이 같음) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A5 예시 888개·성공 응답 시각 934개와 새로 보는 성공 응답 예시 258개 안의 같은 기록, 확정 시각이 있는 주문의 결제, 명령 결과의 위쪽 기록과 주문 목록(RD-12), A6 오류 예시 491개, A10 열린 질문 12개, A11 목록을 주는 API 14개의 정렬 순서와 DEC-14의 예외(RD-13), M1 목 서버 요청 958개입니다. A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 0개(A13이 찾지 않는 5개는 11절 목록에 적음), A2·A4·A12 API 83개, A3 SPEC 79개, A7 테이블.컬럼 104개(157자리), A8 누구나 쓰는 API 5개, A9 말로만 적은 근거 88개, A11 결정 사항 24개, D1 테이블.컬럼 104개에 값 5885개(글자 수 CHECK가 있는 컬럼 42개)는 같습니다. 새 검사가 잡는지 보려고 같은 A5·A11을 고치기 전 main(`0709e8e`)의 계약에 돌리면 A5가 예시 15곳(API-048 1, API-059 10, API-063 4), A11이 '순서:'가 없는 목록 14개와 DEC-14의 예외에 없는 커서 없는 목록 5개를 실패로 잡습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-15 03:17 KST, 설계 재검토 M8을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 0개(바뀐 것은 10절 SPEC-065 작업의 글뿐)이고, A2·A4·A12 API 83개, A3 SPEC 79개, A5 예시 886개·성공 응답 시각 902개, A6 오류 예시 490개, A11 결정 사항 24개, M1 목 서버 요청 956개는 01:52 검사와 같습니다.

2026-11-15 01:52 KST, 설계 재검토가 남긴 빈 곳을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A5 예시 886개·성공 응답 시각 902개, A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 0개(A13이 찾지 않는 4개는 11절 목록에 적음), M1 목 서버 요청 956개입니다. A2·A4·A12 API 83개, A3 SPEC 79개, A6 오류 예시 490개, A7 테이블.컬럼 104개(157자리), A8 누구나 쓰는 API 5개, A9 말로만 적은 근거 88개, A10 열린 질문 11개, A11 결정 사항 24개, D1 테이블.컬럼 104개에 값 5885개(글자 수 CHECK가 있는 컬럼 42개)는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 22:53 KST, 설계 재검토 M12를 고친 뒤(15절, 그 PR의 Codex 의견을 고친 뒤 23:42에 다시 돌려도 출력이 같음) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A2·A4·A12 API 83개(API-083 에스컬레이션 건에서 문제 신고로 남기기), A3 SPEC 79개(SPEC-079 에스컬레이션 건에서 문제 신고로 남기기), A5 예시 881개·성공 응답 시각 876개, A6 오류 예시 490개, A7 테이블.컬럼 104개(157자리), A9 말로만 적은 근거 88개, A11 결정 사항 24개(DEC-24), A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 8개가 모두 목록에 있음(11절), D1 테이블.컬럼 104개에 값 5885개(글자 수 CHECK가 있는 컬럼 42개), M1 목 서버 요청 953개입니다. A8 누구나 쓰는 API 5개, A10 열린 질문 11개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 21:00 KST, 설계 재검토 M11·M14를 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A2·A4·A12 API 82개(API-080 사업자 정보 변경 요청, API-081 사업자 정보 변경 요청 목록, API-082 사업자 정보 변경 반영·보류), A3 SPEC 78개(SPEC-077 가게 정보와 설정 바꾸기, SPEC-078 사업자 정보 변경 요청과 운영자 확인), A5 예시 860개·성공 응답 시각 852개, A6 오류 예시 480개, A7 테이블.컬럼 99개(151자리), A9 말로만 적은 근거 84개, A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 10개가 모두 목록에 있음(11절), D1 테이블.컬럼 99개에 값 5605개(글자 수 CHECK가 있는 컬럼 39개), M1 목 서버 요청 933개입니다. A8 누구나 쓰는 API 5개, A10 열린 질문 11개, A11 결정 사항 23개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 19:47 KST, 설계 재검토 M16·M18을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A2·A4·A12 API 79개(API-078 사장님 로그인 시작, API-079 스킬 키 바꾸기), A5 예시 820개·성공 응답 시각 825개, A6 오류 예시 457개, A7 테이블.컬럼 92개(137자리), A8 누구나 쓰는 API 5개(API-078을 더함), A9 말로만 적은 근거 75개, A10 열린 질문 11개(OPEN-10·11을 더함), A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 9개가 모두 목록에 있음(11절), M1 목 서버 요청 891개입니다. A3 SPEC 76개, A11 결정 사항 23개, D1 테이블.컬럼 92개에 값 5106개(글자 수 CHECK가 있는 컬럼 33개)는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 18:05 KST, 설계 재검토 M7·M17을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 3개가 모두 목록에 있음(11절)입니다. A2·A4·A12 API 77개, A3 SPEC 76개, A5 예시 801개·성공 응답 시각 797개, A6 오류 예시 446개, A7 테이블.컬럼 92개(136자리), A9 말로만 적은 근거 62개, A10 열린 질문 9개, A11 결정 사항 23개, D1 테이블.컬럼 92개에 값 5106개(글자 수 CHECK가 있는 컬럼 33개), M1 목 서버 요청 872개는 같습니다. A7·D1은 API 요청 스키마의 테이블.컬럼만 세므로 AI 출력에 더한 `order_drafts.pickup_time`은 세지 않습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 15:12 KST, 설계 재검토 M5·M6을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A3 SPEC 76개(SPEC-076 손님이 새 금액 확인하기), A5 예시 801개·성공 응답 시각 797개(새 예시 6개는 API-058 `awaiting_amount_confirm`, API-059 요청 `close_change`·응답 `change_closed`, API-071 요청 `amount_confirm`·결과 `amount_confirmed`·`amount_declined`이고 뺀 예시 2개는 API-046 요청 `accept`와 API-063의 409 `stale_change`. 새 시각은 결제 안내 예시의 확인한 시각·받지 않은 시각과 새 예시의 시각), A6 오류 예시 446개(409 `stale_change`를 뺌), A9 말로만 적은 근거 62개, A11 결정 사항 23개(DEC-23), A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 12개가 모두 목록에 있음(11절), M1 목 서버 요청 872개입니다. A2·A4·A12 API 77개, A7 테이블.컬럼 92개(136자리), A10 열린 질문 9개, D1 테이블.컬럼 92개에 값 5106개(글자 수 CHECK가 있는 컬럼 33개)는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 12:46 KST, 설계 재검토 M4·M13과 그 PR의 Codex 의견을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A5 예시 797개·성공 응답 시각 763개(새 예시 2개는 API-049 `after_start`·`remake_cancel`, 새 시각 4곳은 `after_start`의 취소·맞춤 재료 주문·기준 픽업 일시와 `remake_cancel`의 취소), A7 테이블.컬럼 92개(136자리. 보상 결정 요청의 다르게 정한 사유 자리를 뺌), A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 5개가 모두 목록에 있음(11절), M1 목 서버 요청 869개입니다. A2·A4·A12 API 77개, A3 SPEC 75개, A6 오류 예시 447개, A9 말로만 적은 근거 61개, A10 열린 질문 9개, A11 결정 사항 22개, D1 테이블.컬럼 92개에 값 5106개(글자 수 CHECK가 있는 컬럼 33개)는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 10:45 KST, Codex 후속을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A5 예시 795개·성공 응답 시각 759개(새 예시 3개는 API-049 `over_received`와 API-077 요청·응답 `consultation_text`, 새 시각 7곳은 운영자 상담 예시에 더한 메시지 하나와 연 대화 글 예시), A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 3개가 모두 목록에 있음(11절), D1 값 5106개, M1 목 서버 요청 867개입니다. A2·A4·A12 API 77개, A3 SPEC 75개, A6 오류 예시 447개, A7 테이블.컬럼 92개(137자리), A9 말로만 적은 근거 61개, A10 열린 질문 9개, A11 결정 사항 22개, D1 테이블.컬럼 92개(글자 수 CHECK가 있는 컬럼 33개)는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 09:46 KST, 설계 재검토 M1·M2·M3·M9·M10을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A5 예시 792개·성공 응답 시각 752개(결제 안내의 전해진 시각 `deliveredAt` 44곳과 결제 기한 상한 `dueCapAt` 42곳이 새로 들어가고, 새 예시의 시각 19곳), A6 오류 예시 447개(확인할 것 `closed_day` 3개·`past_cutoff` 1개·`overbooking` 1개의 409 예시와 닫힌 기다림에 답할 때의 409 `invalid_state` 2개), A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 5개가 모두 목록에 있음(11절), M1 목 서버 요청 865개입니다. A2·A4·A12 API 77개, A3 SPEC 75개, A7 테이블.컬럼 92개(137자리), A9 말로만 적은 근거 61개, A10 열린 질문 9개, A11 결정 사항 22개, D1 테이블.컬럼 92개에 값 5104개(글자 수 CHECK가 있는 컬럼 33개)는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 07:38 KST, 설계 재검토 H5·H10을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A3 SPEC 75개 모두 API가 있음, A5 예시 782개(성공 응답 시각 647개는 같음), A7 테이블.컬럼 92개(137자리. 알레르기 답 블록 ID를 더함), A9 말로만 적은 근거 61개, A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 2개가 모두 목록에 있음(11절), D1 테이블.컬럼 92개에 값 5104개(글자 수 CHECK가 있는 컬럼 33개), M1 목 서버 요청 855개입니다. A2·A4·A12 API 77개, A6 오류 예시 440개, A10 열린 질문 9개, A11 결정 사항 22개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 05:48 KST, 설계 재검토 H4를 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A2·A4 API 77개, A3 SPEC 74개 모두 API가 있음, A5 예시 776개·성공 응답 시각 647개, A6 오류 예시 440개, A7 테이블.컬럼 91개(136자리. 가게·환불 계좌번호 2개를 빼고 접속기록의 대상 종류·사유 2개를 더함), A9 말로만 적은 근거 60개, A12 API ID 77개, A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 1개가 모두 목록에 있음(11절), D1 테이블.컬럼 91개에 값 5041개(글자 수 CHECK가 있는 컬럼 32개), M1 목 서버 요청 852개입니다. A10 열린 질문 9개와 A11 결정 사항 22개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 04:16 KST, 설계 재검토 H3을 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. A13은 main의 `api/openapi.yaml`과 견준 깨지는 변화 0개입니다(바꾼 것은 고를 값 `ended`를 더함과 이미 있는 404를 쓰는 응답 바뀜이라 A13이 찾지 않고, 뒤의 것은 11절 목록에 적음). 나머지 숫자(A5 예시 730개·성공 응답 시각 607개, A6 오류 예시 418개, A7 테이블.컬럼 91개(135자리), A9 말로만 적은 근거 48개, D1 값 5097개, M1 목 서버 요청 806개)는 H7·H8·H9를 고친 뒤와 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-14 01:53 KST, 설계 재검토 H7·H8·H9를 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개: 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A2·A4 API 73개, A5 예시 730개·성공 응답 시각 607개, A6 오류 예시 418개, A7 테이블.컬럼 91개(135자리), A9 말로만 적은 근거 48개, A10 열린 질문 9개, A11 결정 사항 22개, A12 API ID 73개, A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 8개가 모두 목록에 있음(11절), D1 테이블.컬럼 91개에 값 5097개(글자 수 CHECK가 있는 컬럼 31개), M1 목 서버 요청 806개입니다. A3 SPEC 72개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다.

2026-11-13 23:40 KST, 설계 재검토 H6·H11·H12를 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A3 SPEC 72개 모두 API가 있음, A5 예시 711개(성공 응답 시각 595개는 같음), A9 말로만 적은 근거 42개, A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 0개(바꾼 것 셋은 A13이 찾지 않는 안쪽 필드·HTTP 계약 밖·값의 원본이라 11절 목록에 적음), M1 목 서버 요청 788개입니다. A6 오류 예시 414개, A7 테이블.컬럼 87개(128자리), D1 값 4845개(글자 수 CHECK가 있는 컬럼 27개)는 같습니다.

2026-11-13 22:42 KST, 설계 재검토 H1·H2를 고친 뒤(15절) `check_api.py . --db ... --mock ...`를 다시 돌린 결과: 검사 17개 통과 17, 실패 0, 미확인 0. 바뀐 숫자는 A3 SPEC 71개 모두 API가 있음, A5 예시 707개·성공 응답 시각 595개, A7 테이블.컬럼 87개(128자리), A13 main의 `api/openapi.yaml`과 견준 깨지는 변화 7개가 모두 목록에 있음(11절), D1 테이블.컬럼 87개에 값 4845개(글자 수 CHECK가 있는 컬럼 27개), M1 목 서버 요청 786개입니다. A6 오류 예시 414개와 A9 말로만 적은 근거 41개는 같습니다. 12-2의 Schemathesis는 이번에 다시 돌리지 않았습니다. 아래 12-1 표는 2026-11-12의 결과로 남깁니다.

12-1의 검사는 2026-11-12에 이 버전으로 돌렸습니다(12-2의 Schemathesis는 2026-11-15에 `220f09d`로 다시 돌림). 숫자는 각 명령의 출력에서 옮겼습니다. 체크포인트 뒤(14:10 무렵) 결정 사항의 상태 열과 REQ-164 연결을 더한 버전으로 `check_api.py`를 다시 돌려도 17개 모두 통과했고 아래 숫자가 같았습니다. 도구 버전: Python 3.13.18, openapi-spec-validator 0.9.0, jsonschema 4.26.0, hypothesis 6.170.15, hypothesis-jsonschema 0.23.2, PostgreSQL 16.15, Prism 5.14.2(Node 22.23.4), Schemathesis 4.33.2.

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

2026-11-15 15:40 KST, PR #48을 합친 main(`220f09d`)의 계약에 `schemathesis run api/openapi.yaml --url http://127.0.0.1:4010 --checks all --phases examples,coverage,fuzzing -n 25 --seed 20261112 --generation-codec ascii`를 돌려 API 83개에 테스트 사례 1,875개를 만들었습니다(14.51초, 종료 코드 1은 아래 실패 때문). 목 서버는 다른 검사와 겹치지 않게 4019번 포트에 띄웠고, 결과는 포트와 상관없습니다. 도구 버전은 위와 같습니다.

- **예시 단계 통과**: 계약에 요청 예시가 있는 API 65개를 그 예시로 부른 응답이 모두 계약의 상태·형식·스키마에 맞았습니다. 요청 예시가 없는 18개(조회 15개, 로그아웃 2개, 사진 업로드 1개)는 건너뛰었습니다.
- **실패 151개는 모두 목 서버의 한계**입니다. 계약 쪽 실패는 없었습니다. 커버리지·퍼징 단계의 실패도 모두 아래 세 가지이고, 응답 스키마나 계약에 없는 상태 번호로 실패한 것은 0개입니다.

| 실패 | 수 | 사유 | 실제 서버(11단계)에서 |
| --- | --- | --- | --- |
| ST401 틀린 인증을 수락함 | 71 | Prism은 쿠키·헤더가 있는지만 보고 값은 확인하지 못함 | 세션과 스킬 키 값을 확인해 401 |
| ST204 계약에 없는 방법에 `Allow` 없음 | 72 | 경로마다 보낸 TRACE에 Prism이 `Allow` 헤더 없는 405로 답함 | 405 `method_not_allowed`와 `Allow`(DEC-02) |
| ST105 계약에 없는 형식 | 8 | JSON으로 읽을 수 없는 본문에 Prism이 자기 400(`application/json; charset=utf-8`)으로 답함 | 422 `validation_failed`(`/`, `bad_json`, DEC-01) |

- **한계: 로그인이 꼭 필요한 API는 맞는 로그인으로 성공 응답을 보지 못했습니다.** Schemathesis에 세션 쿠키나 스킬 키를 주지 않았기 때문입니다.
  - 로그인이 꼭 필요한 API 76개 가운데 71개는 Schemathesis가 만든 아무 값에도 Prism이 성공으로 답해 위 ST401로 잡혔고, 5개(카카오 스킬 셋 `POST /kakao/skills/event`·`message`·`review`, 환불 `POST /owner/orders/{orderId}/refunds`, 장부 연결 `PUT /owner/ledger`)는 401·403만 받아 경고로 남았습니다.
  - 예시 단계만 따로 돌리면(`--phases examples`, 같은 seed) 테스트 사례 210개가 모두 통과했지만, 응답 205개가 401이었고 API 60개가 401·403만 받았습니다. 성공 응답 5개는 로그인이 필요 없는 API 5개(로그인 3개, 공개 페이지 2개)에서만 나왔습니다.
  - 맞는 요청이 성공 응답을 받는 것은 `check_api.py`의 M1(위 15:01, 목 서버 요청 961개)에서 봤습니다. 실제 세션과 스킬 키로 성공 응답을 보는 일은 11단계에서 개발·스테이징 서버에 같은 명령을 돌려 합니다.
- 2026-11-12(API 72개)에는 요청 1,323개, 실패 128개(ST401 59, ST204 61, ST105 8), 경고 API 9개였습니다.
- 처음에는 ASCII 밖 글자로 돌렸는데, 요청 필드 이름에 그런 글자가 들어가면 Prism이 오류 헤더를 쓰다 멈췄습니다(Prism 5.14.2의 문제). 그래서 `--generation-codec ascii`로 돌렸습니다. 실제 서버 테스트는 이 옵션 없이 돌립니다.
- 목 서버는 계약의 예시를 반환하므로 대부분의 검사를 일부러 통과합니다. 계약을 서버가 지키는지는 11단계에서 개발·스테이징 서버에 같은 명령을 돌려야 압니다.

## 13. 다음 단계로 전달하는 것

- **07·08단계(사이트맵·화면 상태)**: 화면 상태는 응답에서 시작합니다. 오류 코드마다 '화면에 보이는 말'과 '화면이 할 일', 카카오 스킬 결과마다 '손님에게 가는 말'이 08단계가 다듬을 뼈대입니다. 사장님이 오픈빌더 봇 ID를 찾는 안내는 OPEN-8입니다. 채널 연결 화면은 블록 ID 넷, 시험 버튼으로 닿은 블록, 먼저 보내기 상태와 사유를 보입니다(API-030, 15절). 화면이 더 필요한 API가 나오면 이 계약에 먼저 더하고 깨지는 변화인지 봅니다.
- **10·11단계(개발)**: 서버는 이 계약을 따릅니다. 목 서버로는 볼 수 없어 실제 서버에서 지켜야 하는 것이 있습니다: 세션 쿠키와 스킬 키의 값을 실제로 확인하기, JSON으로 읽을 수 없는 본문도 422 `validation_failed`(`/`, `bad_json`)로 답하기, 계약에 없는 방법은 405 `method_not_allowed`와 `Allow` 헤더, 글자 필드의 NUL 문자는 `bad_format`. 계약 테스트는 개발·스테이징 서버에 `schemathesis run api/openapi.yaml --url <서버>`로 돌리고 운영 서버에는 돌리지 않습니다.
- **12단계(QA)**: 응답 하나(`API-001#401` 꼴)마다 테스트 사례를 하나씩 만듭니다. 4절 표의 '응답' 열이 그 목록입니다.
- **공식 답변 대기**. 카카오 스킬 요청 출처를 확인할 수 있는 IP 목록 또는 서명(OPEN-10, TASK-010)입니다. 카카오 시험 결과는 DEC-28~30과 아래 변경 기록에 반영했습니다. 무료 MVP에서 손님 안내는 다음 대화에 전하고, 먼저 보내기와 휴대폰 보안 이미지 시험은 TASK-167에서 확인합니다.
- **개발에 적용할 결정**. 세션 길이는 DEC-26으로 정했고, 운영자 인증 서비스는 DEC-27로 정했습니다. AI 모델 회사는 DEC-25로 정했고, 10단계 WBS의 선행 일로 두 회사(Anthropic·OpenAI) 모두에 보관 안 함(Zero Data Retention)을 신청하고, 같은 평가 세트를 두 회사의 모델에 돌려 12단계 평가를 지나는 것 가운데 가장 싼 모델을 고르고, 고른 회사의 이름·나라·보유 기간을 처리방침의 국외 이전 항목(API-039)에 채웁니다. 보관 안 함이 허가되기 전에는 처리방침에 30일 보관을 적습니다.

## 14. 체크포인트

계약서의 체크포인트는 "구현 전에 응답 하나씩 계약을 보고, 깨지는 변화마다 정함"입니다. 첫 버전이라 깨지는 변화는 없었습니다.

- 질문(2026-11-12 13:50, 이 작업 대화의 결정 카드): "API 계약(작업 72개)과 정한 것 19개를 추천대로 굳힐까요?" 고를 것은 추천대로 굳힘, DEC-12·13·18 다르게, 고칠 것 말씀이었습니다.
- 결정: 2026-11-12 14:01 동희님이 '추천대로 굳힘'을 고르셨습니다. 4절의 API 72개와 응답, 8절의 DEC-01~19(따로 확인 요청한 DEC-12·13·18 포함)를 이대로 확정합니다. 확인 요청한 뒤 PR #7에 댓글과 리뷰는 없었습니다.
- 확정한 뒤: DEC-12의 조건을 요구사항 버전 4 REQ-164(결제 수단이 없는 동안 예약 링크를 내지 않음)로 더하고, 기능 명세 SPEC-010의 조건과 수락 기준에 이었습니다. 다음은 07단계(사이트맵)입니다. 계약을 바꿀 때는 목록을 고친 뒤 `build_api.py . --write`로 다시 만들고, 화면이 이미 보이는 데이터나 보내는 요청을 깨는 바꿈은 다시 확인 요청합니다.

기록은 Notion 최근 업데이트 DB의 06단계 기록 행(<https://app.notion.com/p/416bf16cc3ec81bc8e55c85d0f194ccf>)에 있고, API·오류 코드·결정 사항 표를 이 문서에서 옮겨 두었습니다. 둘이 다르면 이 문서와 원본 계약이 맞습니다.

## 15. 확정한 뒤 고친 것

2026-11-23 TASK-041 리뷰 후속: API-029의 빈 날짜도 GET revision을 보내며 null은409라는 현재 동작을 스키마 설명/DEC-05에 명시했습니다. 입력 형식과 상태 코드는 그대로입니다. 여러 날짜 확인 예시는 API 번호 대신 operation의 multi_day_confirm 속성으로 선택합니다.

2026-11-23 TASK-041 후속: 확인 예시의 capacity_below_held에 개수를 더해 빈 숫자 문구를 고쳤습니다. API-027은 여러 날짜에 걸친 확인이라 day를 빼고 API-029에는 날짜를 유지합니다. 응답 스키마는 그대로이며 생성 원본으로 다시 만듭니다.

2026-11-23 TASK-041: 기존 확정 요구 REQ-261에 맞춰 capacity_below_held 확인과 저장 전 conflicts를 더했습니다. 관련 주문은 주문번호·상태·픽업 일시를 보입니다. 휴무 확인은 가예약도 포함하며 원본 생성 뒤 main 대비 깨지는 변화는 0개입니다.

2026-11-22 MVP 로그인 결정 반영입니다. 응답 필드와 상태 코드는 유지하며 기본 인가/채널 확인 동작을 바꿉니다.

| 고친 곳 | 고친 것 | 근거 |
| --- | --- | --- |
| Shop 응답 licenseReviewedAt | 기존 판정 시각을 선택 필드로 반환하고 확인 중/재제출 뒤는 null | SCR-035 확인됨 시각, TASK-048 |
| API-078·001·002, Owner.alertChannelFriend, DEC-21 | 기본 로그인은 scope를 생략하고 plusfriends·채널 조회·친구 기록·재조회·채널 배너를 끔. KAKAO_OWNER_LOGIN_SCOPES에 plusfriends를 명시한 경우만 기존 확인을 켬. 기존 친구 값은 보관하며 MVP에서 현재 관계 판단으로 쓰지 않음. API-002에 MVP 예시를 더함 | 동희님 2026-11-22 15:57 결정 카드 'MVP에선 빼기', TASK-020 |

### 2026-11-19 카카오 개발 채널 시험을 계약에 반영(TASK-011)

| 시험 | 확인한 결과와 적용 |
| --- | --- |
| K-01·K-02·K-09 | 채널 친구 전에는 `isFriend`가 없었고 추가 후 `true`였습니다. 요청에 메시지 ID가 없어 고정 2초 구간에서 수신 키를 만들고, 봇 ID 끝의 느낌표를 제거해 설정의 ID와 대조합니다(DEC-28). |
| K-03·K-04·K-05 | PC는 4.5초 스킬 답을 표시했고 6초에는 답이나 오류 말풍선이 없었습니다. 시험한 네 가지 빈 응답에 말풍선이 없었고, 계약은 빈 `outputs` 배열을 사용합니다. 콜백은 시험에서 321.1초에도 성공했습니다. 계약은 카카오 문서의 5분과 서비스 응답 목표 55초를 적용합니다(DEC-29). |
| K-06·K-07·K-08 | 일반 PNG 주소를 `userRequest.utterance`에서 받고 HTTP 200으로 읽었습니다. 사진 선택 PC 후기 블록에서 주문번호 `clientExtra.orderNo`가 글·동의 뒤에도 일치했습니다. 주문번호 누락 시 같은 손님에게 마지막으로 보낸 후기 부탁의 주문을 사용합니다(DEC-28·30). 원본 블록의 보안 이미지 시험은 TASK-167에서 확인합니다. |
| K-11 | PC 카드에서 연 인가의 S256은 200, 다른 verifier는 400, PKCE 생략은 200이었습니다. 제품은 S256만 사용합니다(DEC-10). |
| K-10·TASK-010 | 카카오 Event API 권한과 선제 발신은 TASK-167에서 확인합니다(DEC-20). 카카오 출처 검증의 공식 답변만 OPEN-10으로 남겼습니다. |

PC 화면과 Worker 기록은 [카카오 시험 대본](../10-wbs/kakao-test-script.md)에 있습니다.


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
| API-030·031·032 채널 연결, `KakaoChannelInput`·`KakaoChannel`·`SkillSetup` | 블록 ID 넷(`blockIds`), 시험 버튼으로 닿은 블록(`verifiedBlocks`), 먼저 보내기 상태(`eventStatus`·`eventCheckedAt`·`eventFailReason`), 안내 스킬 주소와 이벤트 이름. 사유 후보에 닿지 않은 블록 넷. 블록 ID가 비면 409 `channel_setup_incomplete`. 같은 봇의 블록 ID만 바꾸면 그 연결을 다시 확인하고, 연결됨에서 누른 '연결 확인'은 시험 안내를 다시 보냄(이 표의2026-11-13 설계). 무료 MVP의 연결됨은unchanged이며 event_recheck는 TASK-167 이후 기능으로 미룸. 예시 `blocks_changed`·`event_checking`·`event_unavailable` | REQ-179, REQ-180, SPEC-008, DEC-20 |
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

2026-11-13 같은 재검토의 높음 묶음 H5(RA-02)와 H10(RE-01, RA-14, RB-16, RC-11)도 같은 결정 카드에 따라 고쳤습니다. 요구사항 REQ-200~210(REQ-013·096·097·179는 제외), 04단계 SPEC-075와 SPEC-008·010·011·020·021·027·028·029·050·053·062·063·065·072, 05단계 마이그레이션 0007과 앱 규칙 A26·결정 E22를 따릅니다. H5는 잠정이라 5-2 질문 4의 답으로, H10은 잠정이라 5-2 질문 6의 답으로 다시 봅니다. 원본 `api_schemas.py`·`api_ops.py`·`api_examples.py`·`api_catalog.py`를 고치고 `build_api.py . --write`로 다시 만들었습니다(`build_api.py`는 계약 파일 `info.description`의 SPEC 범위 글자만 SPEC-001~075로 바꿈).

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-070 손님 메시지 | 초안의 빈 항목과 금액 확인이 끝났는데 알레르기 정보 동의의 답이 없으면 주문자 정보·주문 요청 카드 앞에 알레르기 정보 카드(쓰는 목적·받는 항목·보는 사람·지우는 때, 동의하지 않을 수 있음과 그 결과, 버튼 '동의하고 알려 주기'·'동의 안 함'). `card_shown` 예시가 이 카드. AI는 알레르기를 묻지 않고 대화 속 알레르기 말을 초안에 넣지 않음. 동의 단계를 끈 배포는 알레르기 답 블록 버튼만 | REQ-200, REQ-201, REQ-204, REQ-205, SPEC-027, SPEC-075 |
| API-071 카드 버튼, `SkillPayload` | '알레르기 답' 블록 파라미터 `allergy_answer`(1~200자, AI로 보내지 않음). 결과 `allergy_saved`(동의와 답을 한 트랜잭션으로 초안에 남기고 다음 카드)·`allergy_declined`(거부와 시각을 남기고 빼야 할 재료만으로)·`photo_consent_saved`(완성 사진 안내의 동의 카드, 사진마다)를 더해 카드 결과 23개. 주문 요청 때 초안의 알레르기 정보 동의를 주문 내용 버전에 옮기고, 답이 없으면 알레르기 정보 카드. 요청 예시 `allergy_answer`·`photo_consent` | REQ-201~204, REQ-207, SPEC-029, SPEC-053, SPEC-075 |
| 주문 요청 확인 카드(API-070·071) | 요약에 알레르기 답이나 '알레르기 정보 동의 안 함'. 사진 게시 동의 줄과 버튼 '사진 게시도 동의하고 요청'(`confirm_with_photo_consent`)을 빼 버튼 둘 | REQ-203, REQ-207, SPEC-028 |
| API-045 주문 하나, `Order`·`OrderDetailsVersion`·`Production` | `Order.photoConsent`를 뺌. 주문 내용 버전마다 `allergyConsent`(`agreed`·`declined`·`not_required`, 동의 안 함이면 알레르기 답 null). 완성 사진마다 `consent` | REQ-201, REQ-203, REQ-205, REQ-207 |
| API-051 제작 목록, `ProductionDay` | 요약에 `allergyConsent`. 동의 안 함이면 화면이 '알레르기: 동의 안 함(빼야 할 재료만 받음)' | REQ-203, SPEC-050 |
| API-052 완성, API-073 안내 스킬 | 완성 사진 안내는 사진과 한 문장의 사진 게시 동의 카드(그 사진을 가게 포트폴리오와 예약 링크 페이지에 올려도 되는지와 언제든 철회할 수 있음, 버튼 '올려도 돼요'·'안 돼요', 30분). 누른 답은 API-071로 와서 사진마다 남음 | REQ-207, SPEC-053 |
| API-072 후기 스킬 | `photo_consent`는 같은 한 문장으로 후기 하나에 한 번 물은 답(기본 동의 안 함, 사진마다 남김, DEC-18) | REQ-208, SPEC-062 |
| API-038 예약 링크, API-067·068 포트폴리오, `consent_withdrawn` | 손님이 그 사진의 게시에 동의하고 철회하지 않은 완성 사진·후기 사진만 올림(데이터베이스도 확인). 가게가 도안으로 올린 견본 사진은 동의 없이 가격표에. 철회는 완성 사진·후기 사진 모두이고 올라 있는 항목을 먼저 내린 뒤 남김. 요청 예시 `add_completion` | REQ-209, REQ-210, SPEC-011, SPEC-063 |
| API-030·031·032 채널 연결 | 블록 ID 다섯(`blockIds.allergyAnswer`), 시험 버튼 다섯(`clientExtra.check`의 `allergy_answer`), 사유 후보 `allergy_block`, 409 `channel_setup_incomplete`의 문구 '버튼 블록 ID 5개를 모두 넣어 주세요' | REQ-206, SPEC-008 |
| API-039 처리방침, AI-1 출력 `draft_patch` | 처리방침 항목에 알레르기 정보(따로 동의한 손님에게서만)를 적고 AI 모델 회사의 국외 이전 항목에는 넣지 않음. `draft_patch`에서 `allergy_answer`를 뺌 | REQ-204, SPEC-010, SPEC-020, SPEC-021 |
| 서버 안의 일(10절) | 끝나고 30일 지난 주문의 개인정보를 지울 때 알레르기 답은 지우고 알레르기 정보 동의의 답·동의 글 버전·시각은 남김 | REQ-201, SPEC-065 |

- 깨지는 변화 2개와 A13이 찾지 않는 7개는 11절. 스킬 결과 47개(3개를 더함)입니다. 오류 코드·필드 오류 사유·결정 사항·열린 질문·서버 안의 일·스키마 수는 그대로입니다.
- 결정과 다르게 한 것(가장 가까운 일관된 고침): SPEC-075는 '동의하고 알려 주기'를 누르면 동의를 남기고 블록을 연다고 적었지만, 카카오 블록 버튼은 블록을 열 뿐 우리 스킬을 따로 호출하지 않으므로 동의(동의 글 버전·시각)와 알레르기 답이 알레르기 답 블록의 스킬 호출 한 번(API-071)으로 와서 한 트랜잭션으로 남습니다. 답을 넣지 않고 나가면 동의도 남지 않고, 손님이 다시 주문하려 하면 알레르기 정보 카드를 다시 보냅니다.
- 동의 안 함(REQ-203)은 결정 카드의 추천안대로 주문을 이어갑니다(검토자 RA-02가 권한 '사장님께 넘김'이 아님). 동의하지 않은 완성 사진을 언제 지울지는 정하지 않았고 5-2 질문 6의 답으로 다시 봅니다.
- 검사: 12절의 2026-11-14 07:38 KST 결과.

2026-11-13 같은 재검토의 중간 묶음 M1(RB-03, RA-17), M2(RB-08, RE-08, RD-07), M3(RA-04, RA-11, RB-04, RB-05), M9(RB-19, RC-17, RB-20), M10(RA-03)도 같은 결정 카드('추천안대로 (추천)')에 따라 고쳤습니다. 요구사항 REQ-211~226(REQ-019·021·037·040·048·080·087·160은 제외), 04단계 SPEC과 상태 머신 1-1~1-8, 05단계 마이그레이션 0008과 앱 규칙 A3·A27·A28·결정 E23을 따릅니다. 원본 `api_schemas.py`·`api_ops.py`·`api_examples.py`·`api_catalog.py`와 `build_api.py`(확인할 것이 여럿인 API는 확인할 것마다 409 예시를 따로 만듦)를 고치고 `build_api.py . --write`로 다시 만들었습니다.

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-040 할 일 목록, `OwnerTask` | `waitStatus`는 기다림·지연·답함·답 없어 닫힘(`parked`를 지연에 합침). 결제 확인 요청·맞추는 중·환불 결정도 기다림이 있음(예시의 결제 확인 요청 할 일). `waitDueAt`은 지연 안내를 보낼 시각이고 닫는 때와 다름 | REQ-215, 1-7 |
| API-041·042 에스컬레이션 건, `Handoff` | 남긴 지 7일 동안 답이 없으면 `status` `closed_no_answer`와 `closedAt`(예시 `closed_no_answer`). 닫힌 건에 답하면 409 `invalid_state` | REQ-216, SPEC-024 |
| API-045·046 맞춤 주문 | 그 픽업 날짜의 주문 마감까지 답이 없으면 `cancelKind` `no_answer`(예시 `custom_no_answer`)이고 수락하면 409 `invalid_state`. 휴무일이면 409 `confirmation_required`(`closed_day`) | REQ-213, REQ-221, SPEC-031 |
| API-062·063 변경 요청 | 변경 마감까지 답이 없으면 `closed_no_answer`(예시)이고 응답하면 409 `invalid_state`. 새 날이 휴무일이면 `closed_day` | REQ-214, REQ-221, SPEC-041, SPEC-042 |
| API-047 결제 기한 지난 주문 | 휴무일이 됐으면 `closed_day`, 그 픽업 날짜의 주문 마감이 지났으면 `past_cutoff`(새 결제 기한은 픽업 일시까지)로 확인받음(전에는 409 `invalid_state`). 픽업 일시까지 고르지 않으면 서버가 결제 없어 취소 | REQ-217, REQ-218, REQ-221, SPEC-038, SPEC-039 |
| API-065 보상 결정 | 재제작 픽업 날이 다 찼으면 `overbooking`으로 확인받고 마감 후 추가 수락 | REQ-226, SPEC-060 |
| `PaymentRequest`, API-044 주문 목록 | `deliveredAt`(손님에게 전해진 시각, null이면 아직 못 전함)과 `dueCapAt`(결제 기한 상한)을 더하고, `dueAt`은 전해진 때부터 세되 상한을 넘지 않음. 주문 목록의 `paymentNotice`(가장 최근 결제 안내의 상태·전해진 시각·결제 기한, 예시 `overdue`에 아직 못 전한 주문) | REQ-218, REQ-223, SPEC-032, SPEC-037 |
| API-070 손님 메시지, `SkillPayload` | `isFriend`가 true가 아니면 친구 아님으로 고침. 닫힌 상담의 손님에게도 결제 안내·사장님 답·전날 안내를 막지 않음. 다음 대화 때 보인 결제 안내는 그때부터 결제 기한을 세고, 상한이 지난 결제 안내는 '결제 기한이 지나 사장님이 확인하고 있어요'만 보임 | REQ-212, REQ-218, REQ-219, SPEC-037, SPEC-066 |
| 서버 안의 일(10절) | SPEC-024 닫는 때와 결제 확인 요청·맞추는 중·환불 결정의 기다림, SPEC-025 열린 에스컬레이션 건이 있으면 닫지 않음과 꼭 가야 하는 안내, SPEC-037 결제 기한과 상한·픽업 일시의 결제 없어 취소, SPEC-044 확인 요청됨의 상한, SPEC-066 전해진 시각 | REQ-211~218, REQ-223 |

- 깨지는 변화 5개와 A13이 찾지 않는 4개는 11절. 확인할 것은 7개(`past_cutoff`를 더함)입니다. 오류 코드·스킬 결과·결정 사항·열린 질문·서버 안의 일·스키마 수는 그대로입니다.
- 결정과 다르게 하거나 더한 것(가장 가까운 일관된 고침): 답 없어 닫힌 건에 답하는 것은 새 오류 코드 대신 이미 있는 409 `invalid_state`(상태 머신이 허용하지 않음)로 두고 화면이 그 건을 다시 읽어 '답 없어 닫힘'을 보입니다. 결제 기한 지난 주문 목록이 전해진 시각을 보이도록(SPEC-037) `OrderSummary.paymentNotice`를 더했습니다. 확인할 것이 여럿인 API는 확인할 것마다 409 예시를 둡니다(`confirmation_required`, `confirmation_required_closed_day`, `confirmation_required_past_cutoff`, `confirmation_required_overbooking`).
- 검사: 12절의 결과.

2026-11-14 Codex 후속: 합친 PR에 남은 Codex 자동 검토 의견 넷을 지금 main의 원본과 다시 대조해 모두 맞음을 확인하고 고쳤습니다. 요구사항 REQ-227, 04단계 SPEC-016·065·073, 05단계 마이그레이션 0009(TBL-054, 4절 A29, 5절 E24)를 따릅니다. 원본 `api_schemas.py`·`api_ops.py`·`api_examples.py`·`api_catalog.py`를 고치고 `build_api.py . --write`로 다시 만들었습니다.

| 의견 | API·스키마 | 고친 것 | 근거 |
| --- | --- | --- | --- |
| [PR #27 의견 하나](https://github.com/kodonghui/siljang.ai/pull/27#discussion_r4564156224) | API-049 환불 미리보기, `RefundPreview.calculatedAmount` | 취소 뒤 들어온 입금·더 들어온 금액의 계산값은 그 결제 안내의 들어온 금액 전부가 아니라 결제로 확인하지 않은 몫(들어온 금액 - 결제 확인을 취소하지 않은 확인된 결제). 닫힘·기한 지남은 전액, 더 들어온 채 확인된 결제 안내는 넘은 몫만. 예시 `over_received`(차액 20,000원에 21,000원 → 1,000원) | SPEC-016, SPEC-071, 05단계 A29(트리거 `refunds_unconfirmed`) |
| [PR #27 의견 둘](https://github.com/kodonghui/siljang.ai/pull/27#discussion_r4564156241) | 요청 `RefundInput.amount`·`CompensationInput.refundAmount`, 응답 `Refund`·`RefundSummary`·`RefundPreview`·`OperatorOrder.refunds`·`KeptRecord.refunds`의 금액 | 환불 금액·계산값·가장 작은·큰 금액의 한도를 1,000만 원에서 들어온 금액의 한도와 같은 1억 원으로. 1,000만 원을 넘게 더 들어온 금액도 돌려줄 수 있음 | REQ-165, 05단계 `refunds.amount`·`calculated_amount` |
| [PR #30 의견](https://github.com/kodonghui/siljang.ai/pull/30#discussion_r4567801476) | 서버 안의 일 SPEC-065(10절) | 참고 사진·신고 사진 행을 지우는 트랜잭션에서 저장 위치를 지울 파일(05단계 TBL-054)에 남기고, 저장소에서 지운 뒤에만 뺌. 실패하거나 작업이 멈추면 다음 날 다시 지움 | SPEC-065, 05단계 E24 |
| [PR #31 의견](https://github.com/kodonghui/siljang.ai/pull/31#discussion_r4568849791) | API-075 상담 하나, API-077 열기, `OperatorMessage`·`OperatorMessageText`·`OriginalOpenInput`·`OriginalValue`, 오류 `original_erased` | 상담은 메시지마다 발신자·시각·종류·글자 수(`textLength`)·사진 수만 보이고 대화 글은 없음. 대화 글은 사유를 적어 `targetKind` `consultation_text`(상담 ID, 보고 있는 페이지의 `cursor`)로 한 페이지(20개까지)씩 열고 접속기록에 남김. 지운 상담의 대화 글은 409 `original_erased`. 예시에 손님의 알레르기 말을 넣어, 닫힌 상태에서는 글자 수만 보임을 보임 | REQ-227, SPEC-073, SPEC-074 |

- 깨지는 변화 3개는 11절. 스키마 138개(`OperatorMessageText`를 더함)이고, 오류 코드·필드 오류 사유·스킬 결과·결정 사항·열린 질문·서버 안의 일 수는 그대로입니다.
- 의견을 단 PR은 이미 합쳐져 있어 이 PR(Codex 후속)에서 고치고, 의견 스레드는 고친 뒤 해결로 닫습니다.
- 검사: 12절의 2026-11-14 10:45 KST 결과.

2026-11-14 같은 재검토의 중간 묶음 M4(RB-06, RC-18, RE-16, RC-14, RD-19)와 M13(RB-17)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 요구사항은 그대로이고, 04단계 SPEC-005·016·042·045~048·059~061·064와 05단계 마이그레이션 0010(4절 A14·A30·A31)을 따릅니다. 원본 `api_schemas.py`·`api_ops.py`·`api_examples.py`·`api_catalog.py`를 고치고 `build_api.py . --write`로 다시 만들었습니다.

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-049 환불 미리보기, `RefundBasis`, `RefundPreview` | 손님 취소의 계산 차례(바탕 = 받은 금액 - `excludedAmount` → 맞춤 재료 주문·제작 시작 전이면 제작 전 비율, 뒤면 기준 픽업 일시까지 남은 시간(1시간 미만 버림)이 든 단계의 비율 → 고정 취소 수수료를 먼저 뺌(바탕보다 크면 0원) → 비율을 곱하고 원 미만 버림 → 0원 이상 바탕 이하)를 설명에 적고, 근거에 `excludedAmount`·`preProductionRefundPct`·`pickupBasisAt`·`remakeOrder`를 더함. 예시 `after_start`((36,000 - 5,000) × 50% = 15,500원)와 `remake_cancel`(재제작 주문의 취소, `order`는 원래 주문) | SPEC-016, RB-06, RC-18 |
| API-050 환불 결정, `RefundInput`·`Refund` | 계산값과 다른 금액은 사유 1~200자가 꼭 있음(`/overrideReason` required, 보상이 아니면 높은 금액만 됨). 금액이 내려간 변경은 차액 돌려주기라 `partial`만(`full`이면 `/decision` not_allowed). 경로의 주문이 재제작 주문이면 원래 주문의 돈으로 셈해 원래 주문에 남김(`refund.order`) | SPEC-047, REQ-084, RC-14, RD-19, RB-06 |
| API-021 운영규정 확정, `OperatingRulesInput` | 고정 취소 수수료는 0원~1,000만 원만 보고 주문 금액과는 환불을 계산할 때 견줌. 단계별 환불은 `hoursBeforeMin` 차례로 놓으면 0시간부터 끝없음까지 빈 구간·겹침 없이(`gap`·`overlaps`), 단계별 환불 조문과 함께(`/refundTiers` required). 단계가 없는 버전은 제작 뒤 취소도 제작 전 비율(화면이 저장 전에 알리고 막지 않음). 기준일과 단계 경계(부터 포함, 까지 뺌)의 설명 | SPEC-005, SPEC-016, RE-16, RB-06 |
| API-048 가게 사정 취소 | 계산값은 받은 금액에서 이미 정한 환불과 따로 정할 환불을 뺀 바탕 전액. 보상 조문은 손님 안내에 글로만. 재제작 주문이면 원래 주문의 돈으로 셈하고 원래 주문에 남김 | SPEC-048, SPEC-060, RB-17 |
| API-065 보상 결정, `CompensationInput`, `IssueReport` | 보상 환불은 고른 금액이 계산값이라 다르게 정한 사유(`refundOverrideReason`)를 없앰. 재제작 주문에 들어온 신고는 원래 주문의 받은 금액이 한도(`paidAmount`)이고 환불은 원래 주문에, 다시 재제작도 원래 주문에 이음 | SPEC-059, SPEC-060, RB-17 |
| API-063 변경 요청 응답, `ChangeDecisionInput` | 재제작 주문의 변경 요청은 금액이 그대로일 때만 수락(`amountDelta`가 0이 아니면 `/amountDelta` not_allowed, 차액 결제·차액 돌려주기 없음). 변경 마감은 원래 주문이 받은 운영규정 버전으로 셈 | SPEC-042, SPEC-060, RB-17 |
| 서버 안의 일(10절) | SPEC-061 후기 부탁은 보내기 직전에 다시 보고 문제 신고가 들어온 주문(닫힌 신고 포함)과 재제작 주문에는 보내지 않음. SPEC-064 재제작 주문은 행을 두지 않고 원래 주문 행에 '재제작'으로 적음. SPEC-065 지우기는 끝나지 않은 재제작 주문이 있는 원래 주문을 끝나지 않은 주문으로 봄(05단계 트리거 `orders_remake_finish`, [PR #35 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/35#discussion_r4571233614)) | SPEC-061, SPEC-064, SPEC-065, RB-17 |

- 깨지는 변화 5개와 A13이 찾지 않는 4개는 11절. 스키마·오류 코드·필드 오류 사유·확인할 것·스킬 결과·결정 사항·열린 질문·서버 안의 일 수는 그대로입니다.
- 결정과 다르게 하거나 더한 것(가장 가까운 일관된 고침): 재제작 주문의 환불은 재제작 주문의 `orderId`로 미리 보고 정하되 원래 주문에 남기고(`order`는 원래 주문), 근거의 `remakeOrder`로 재제작 주문을 잇습니다. 단계별 환불이 없는 버전의 알림은 막지 않는 화면 알림이라 확인할 것(409)을 더하지 않았습니다. 단계 행은 서버가 `hoursBeforeMin` 차례로 놓고 보므로 보내는 차례는 그대로 받습니다.
- 검사: 12절의 2026-11-14 12:46 KST 결과.

2026-11-14 같은 재검토의 중간 묶음 M5(RB-07, RA-08, RE-17)와 M6(RA-07, RB-18)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 요구사항 REQ-228~235(REQ-155를 REQ-231로 바꿈), 04단계 SPEC-076(손님이 새 금액 확인하기)과 고친 SPEC-004·013·015·019·027~029·031~035·042~046·048·066·067·070·071, AI-1, 상태 머신 1-2~1-5, 05단계 마이그레이션 0011(4절 A32, 5절 E25·E26)을 따릅니다. 원본 `api_schemas.py`·`api_ops.py`·`api_examples.py`·`api_catalog.py`를 고치고 `build_api.py . --write`로 다시 만들었습니다(`build_api.py`는 계약 파일 `info.description`의 SPEC 범위 글자만 SPEC-001~076으로 바꿈).

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-017 가격표 새 버전 저장, `PriceOptionInput`·`DesignInput` | 기본 디자인 범위(`inStandard`)는 사장님이 고르고 가격표 버전과 함께 남음. '부터'·'범위' 값의 옵션과 범위 밖 옵션에 이은 도안은 범위에 넣지 못함(`/options/0/inStandard`·`/designs/0/inStandard` `not_allowed`) | REQ-228, SPEC-004, RA-07 |
| API-045 주문 하나, `QuoteView` | `orderKind`는 AI가 아니라 가게 규칙이 그 가격표 버전의 기본 디자인 범위로 가름(범위 밖 옵션·도안, 참고 사진, 빼야 할 재료가 있거나 표시 방식이 '확정'이 아니면 맞춤). `displayKind`의 설명 | REQ-229, SPEC-013, SPEC-027, RA-07 |
| API-046 맞춤 주문 검토, `CustomDecisionInput` | '수락'(`accept`)은 표시 방식이 '확정'인 견적에만. '부터'·'범위' 견적은 금액 변경 수락으로 최종 금액과 사유를 넣고(`accept`면 `/amount` required), 아래 끝보다 낮으면 `/amount` `below_quote_min`. 정한 금액이 손님이 본 금액(표시 방식이 '확정'이면 그 금액, '부터'는 아래 끝, '범위'는 위 끝)보다 높으면 결제 안내가 새 금액 확인을 기다림 | REQ-230, REQ-232, SPEC-031, SPEC-076, RB-18, RA-08 |
| API-047 결제 기한 지난 주문 | 다시 낸 결제도 손님이 요청한 견적(`requestedQuote`)을 보이고, 손님이 아직 확인하지 않은 결제 안내를 다시 내면 다시 낸 결제도 새 금액 확인이 필요함 | REQ-231, REQ-232, SPEC-038 |
| API-044·045·057·058 결제 안내, `PaymentRequest`, `OrderSummary.paymentNotice` | `requestedAmount`를 `requestedQuote`(표시 방식·금액·위 끝)로 바꾸고 `needsAmountConfirm`·`amountConfirmedAt`·`amountDeclinedAt`을 더함. 확인이 필요한 결제 안내는 손님이 확인한 때가 `deliveredAt`이고 확인 전의 `dueAt`은 결제 기한 상한. 예시 `awaiting_amount_confirm`(70,000원부터 견적에 75,000원) | REQ-231, REQ-232, SPEC-032, SPEC-076, RB-18 |
| API-059 입금 대조, `ReconciliationInput` | 확인 전의 결제 안내를 '입금됨'·'대조 완료'로 결제 확인하면 그 시각을 손님의 확인으로 함께 남김. '변경 닫기'(`close_change`)는 맞추는 중인 차액 결제에만: 변경 요청을 '차액 없어 닫힘'으로, 주문 내용·버전은 그대로, 차액을 기다리며 잡아 둔 새 날 자리를 풀고, 들어온 금액은 '더 들어온 금액'으로 환불 정할 일(예시 `close_change`·`change_closed`, 다르게 들어온 차액은 SPEC-035의 금액 불일치 길). 결제 확인 취소는 열리거나 반영된 변경 요청이나 정한 환불이 있어도 409 `invalid_state` | REQ-235, SPEC-035, SPEC-044, SPEC-070, SPEC-076, RE-17 |
| API-062·063 변경 요청, `ChangeDecisionInput`·`ChangeRequest` | 금액 차이를 방향(`amountDirection` same·up·down)과 양수(`amountDifference`)로 받고 서버가 부호를 붙여 `amountDelta`로 남김(DEC-23). 오르면 '차액 결제 기다림'과 새 금액 확인이 필요한 차액 결제. 기다리는 동안 주문 내용·버전과 옛 날의 확정된 자리는 그대로이고 날짜도 바뀌면 새 날 자리를 차액 결제 기한까지 잡음. 변경 마감이 지난 변경 요청은 409 `invalid_state`. 상태 '오래된 버전', 할 일 `stale_change`, 409 `stale_change`를 없앰(REQ-133은 변경 요청 카드와 데이터베이스가 지킴). 예시 `closed_no_difference`는 손님이 새 금액을 받지 않은 경우. 응답에 지금 주문 금액(`orderAmount`)을 더해 화면이 수락 전 결과 한 줄에 새 금액을 보임 | REQ-133, REQ-232~234, SPEC-041~045, 1-5, RB-07, RA-08 |
| API-070·071·073 카카오 스킬 | 새 금액 확인 카드: 맞춤 주문은 요청한 견적·정한 금액·사유와 '이 금액으로 할게요'·'안 할래요', 변경은 바뀌는 내용·지금 금액과 새 금액·차액·변경 마감과 '바꿀게요'·'그대로 둘래요'. 결과 `amount_confirmed`(그때부터 결제 기한을 세고 계좌를 보임)·`amount_declined`(맞춤 주문은 손님 취소, 변경은 '차액 없어 닫힘'으로 원래 주문대로). 확인 전에 입금했다고 하면 입금 알리기 카드 대신 이 카드를 다시 보임 | REQ-232, REQ-233, SPEC-033, SPEC-066, SPEC-076, RA-08 |
| 서버 안의 일(10절) | SPEC-037 확인 전의 결제 기한은 결제 기한 상한. SPEC-044 기한이 지난 차액 결제 안내를 기한 지남으로, 변경 요청을 '차액 없어 닫힘'으로 두고 새 날 자리를 풂. 확인 전의 기한은 변경 마감, 맞추는 중인 차액 결제는 닫지 않음 | REQ-232~235, SPEC-037, SPEC-044 |

- 깨지는 변화 12개와 A13이 찾지 않는 5개는 11절. 오류 코드 36개(`stale_change`를 없앰), 필드 오류 사유 23개(`below_quote_min`), 스킬 결과 49개(`amount_confirmed`·`amount_declined`), 결정 사항 23개(DEC-23)이고, 확인할 것·열린 질문·서버 안의 일·스키마 수는 그대로입니다.
- 결정과 다르게 하거나 더한 것(가장 가까운 일관된 고침): 손님의 확인은 정한 금액이 손님이 본 금액보다 높을 때만 받고(같거나 낮으면 바로 결제 안내), 아래 끝 규칙은 '부터'·'범위' 견적에만 둡니다. 닿지 않던 변경 상태 '오래된 버전'과 할 일·오류 코드 `stale_change`는 없앴습니다. 손님이 확인하기 전에 사장님이 '입금됨'·'대조 완료'를 고르면 그 시각을 손님의 확인으로 봅니다. 손님이 받지 않으면 맞춤 주문은 이미 있는 손님 취소, 변경은 이미 있는 '차액 없어 닫힘'으로 두어 새 상태를 만들지 않았습니다. 결제 확인 취소(SPEC-070)는 열리거나 반영된 변경 요청이나 정한 환불이 있으면 막습니다. API-046의 요청 예시 `accept`는 예시 견적이 '부터'라 뺐고, 맞춤 주문 예시는 손님이 11월 12일 15:00에 확인한 것으로 두어 결제 기한 11월 13일 03:00을 지켰습니다. 입금 대조 요청의 `close_change`와 새 스킬 결과는 고를 값을 넓힌 것이라 목록에 적지 않고 11절에 적었습니다. 변경 요청 응답에 지금 주문 금액(`orderAmount`)을 더했습니다(SPEC-042의 결과 한 줄이 새 금액을 보이려면 변경 요청 화면에 지금 금액이 있어야 함).
- 검사: 12절의 2026-11-14 15:12 KST 결과.

2026-11-14 같은 재검토의 중간 묶음 M7(RC-16, RD-05, RC-06)과 M17(RC-08, RC-13, RC-12)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 04단계에서 고친 SPEC-020·022·023·065와 05단계 마이그레이션 0012(4절 A33·A34, 5절 E27~E30)를 따릅니다. 원본 `api_schemas.py`·`api_ops.py`·`api_examples.py`·`api_catalog.py`와 `build_api.py`(요청 키 헤더의 설명)를 고치고 `build_api.py . --write`로 다시 만들었습니다.

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| 사장님·운영자의 쓰기 명령(DEC-04), 헤더 `Idempotency-Key`·`Idempotency-Replayed`, 오류 코드 `idempotency_key_reused`·`request_in_progress` | 서버가 (누른 사람, 키)마다 요청 지문(HMAC-SHA256)과 처리 상태를 남겨, 같은 키에 다른 내용은 422 `idempotency_key_reused`, 처리 중(받은 뒤 60초 안)은 409 `request_in_progress`, 60초가 지나도 끝나지 않은 요청은 같은 키·같은 지문의 다음 요청이 이어받음. 끝난 요청에 같은 키가 다시 오면 처음 결과와 같은 상태 코드·결과 종류에 처음 결과가 가리킨 기록을 지금 다시 읽은 본문. 입력 검사 실패(422)와 서버 오류(5xx)는 남기지 않음. 요청 키는 24시간 뒤 지움 | SPEC-065, 05단계 TBL-050·E27, RC-16 |
| 서버가 스스로 하는 일(DEC-04, 10절 SPEC-065) | 결제 안내·환불·가예약·할 일·알림·손님 안내·장부 쓰기는 05단계 4절 A33의 이벤트 키 형식(`pay:{대상 ID}:{결제 종류}`, `refund:{대상 ID}:{사유}`, `hold:{주문 ID}:{결제 안내 ID}` 등)으로 가게마다 한 번만 남기고, 환불은 대상(취소한 주문·변경 요청·문제 신고·결제 안내)마다 하나. 지우기는 일곱 차례(하루 지난 요청 키를 더함)이고 상담을 지울 때 덧붙은 질문과 초안의 더하는 옵션도 지움 | SPEC-065, 05단계 A33·E29, RD-05, RC-06 |
| API-041·042 에스컬레이션 건, `Handoff`·`CustomerLine` | 손님 말마다 사유(`reason`)와 관련 주문(`order`). 마감된 날 질문은 열린 건에 덧붙지 않고 상담과 날짜마다 따로 건. 추가 수락은 24시간 안에 그 날짜로 온 주문 요청 하나에만 쓰고 그 주문 요청을 `dayUsedOrder`로 보임 | SPEC-022, SPEC-023, 05단계 A34·E28, RC-08 |
| AI-1 출력 `AiTurnOutput.draft_patch` | 픽업 일시(`pickup_at`)를 날짜(`pickup_day`)와 시각(`pickup_time`, HH:MM)으로 나눔. 날짜만 들었으면 날짜만 넣고, 초안에 날짜가 없으면 시각만은 받지 않음 | SPEC-020, 05단계 E30, RC-13 |

- 깨지는 변화 3개와 A13이 찾지 않는 3개는 11절. 오류 코드 36개, 필드 오류 사유 23개, 스킬 결과 49개, 결정 사항 23개와 확인할 것·열린 질문·서버 안의 일·스키마 수는 그대로입니다.
- 결정과 다르게 하거나 더한 것(가장 가까운 일관된 고침): (1) '처음 결과를 그대로'는 상태 코드와 결과 종류만 처음과 같고, 본문은 처음 결과가 가리킨 기록을 지금 다시 읽은 것입니다(고치는 방향의 '다시 만들 만큼'. 처음 본문을 남기면 이름·연락처가 지우기 밖에 남음). (2) 처리 중의 기한은 60초이고, 지나면 같은 키·같은 지문의 다음 요청이 이어받습니다. (3) 더하는 옵션을 연결 테이블로 옮긴 것(RC-12)과 주문·상담의 손님이 같음을 데이터베이스가 보는 것은 요청·응답의 모양이 그대로라 계약을 바꾸지 않았습니다(주문 내용 버전의 `extras`는 지금도 옵션 ID와 이름 목록, 초안 쪽 AI 출력은 이름 목록). (4) 들어온 입금의 환불을 정한 뒤 같은 결제 안내에 또 들어온 금액을 돌려주는 길은 이번 고침 밖입니다(05단계 4절 A33의 열린 문제).
- 검사: 12절의 2026-11-14 18:05 KST 결과.

2026-11-14 같은 재검토의 중간 묶음 M16(RB-14, RD-15, RC-07)과 M18(RD-06, RD-09, RD-11)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 04단계에서 고친 AI-1·SPEC-001·008·017·020·021·068과 05단계 마이그레이션 0013(4절 A35·A36)을 따릅니다. 원본 `api_catalog.py`·`api_schemas.py`·`api_ops.py`·`api_examples.py`와 `build_api.py`(API 수, DEC-02 문장, 스킬 인증과 사장님 세션의 설명, 로그인 시작 쿠키)를 고치고 `build_api.py . --write`로 다시 만들었습니다.

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-078 사장님 로그인 시작(새), API-001 사장님 로그인, `OwnerLoginStartInput`·`OwnerLoginStart`, `OwnerSessionInput.state`, DEC-10 | 로그인 시작이 nonce를 HttpOnly·Secure·SameSite=Lax 쿠키 `siljang_login`(10분)에 두고, nonce와 만료 시각을 서명한 state와 카카오 인가 주소(PKCE S256의 `code_challenge` 포함)를 줌. API-001은 state의 서명·10분·로그인 시작 쿠키를 맞춰 보고 맞지 않으면 카카오를 호출하지 않고 401 `kakao_login_failed`, Origin이 우리 주소가 아니어도 401. 돌아올 주소는 서버 설정의 목록에 있는 것만(422 `not_allowed`) | SPEC-001, RD-11, OPEN-11 |
| API-079 스킬 키 바꾸기(새), API-030·031, `SkillSetup`·`SkillKey`·`KakaoChannelResult.skillKey`·`SkillKeyRegenerateInput`, DEC-08, 스킬 인증 | 스킬 키는 서버 시크릿·연결 ID·버전으로 만들어 저장하지 않고(해시도 두지 않음), 연결을 만든 응답(API-031 `created`)과 바꾼 응답(API-079)에만 한 번 보임. API-030은 버전·만든 시각·앞 버전 키를 받는 끝만 보임. 바꿀 때 앞 버전 키를 24시간 더 받거나(`keep_24h`) 바로 끊음(`revoke_now`). 그 전 버전은 늘 거절(`skill_key_invalid`) | SPEC-008, SPEC-017, REQ-237, 05단계 A36, RD-06 |
| API-031·032·070, `KakaoChannel.proofPhrase`·`claimExpiresAt`, 결과 `channel_test_card`·`not_accepting`, 사유 후보 `test_message_missing`, OPEN-8, OPEN-10(새) | 연결 확인은 사장님 화면에만 보인 연결 문구('연결 ' 뒤 숫자 6자리, 저장하지 않음)가 그 채널에서 와야 시작하고, 연결 확인 중인 채널의 다른 말은 `not_accepting`. '연결 확인 중' 선점은 저장이나 연결 확인 시작에서 30분이고, 지난 뒤 다른 가게가 같은 봇을 넣으면 풀림(409 `channel_linked_elsewhere`는 선점이 남은 봇에도). 요청이 카카오에서 왔는지는 증명하지 못해 OPEN-10으로 둠 | SPEC-008, REQ-238, 05단계 A36, RD-06 |
| 본문·쿼리의 다른 기록 ID(DEC-02), 필드 오류 코드 `reference_not_found`·`upload_not_found`, API-017·049·050·052·068·077 | 경로 ID는 그대로 404. 본문·쿼리의 ID가 없거나 다른 가게·다른 주문 것이면 422 `validation_failed`의 `reference_not_found`(둘을 구별하지 않음). 올린 파일 ID는 올린 사장님만 씀(`upload_not_found`). API-068의 404를 없앰 | SPEC-068, RD-09 |
| API-070 메시지 스킬, 결과 `ai_timeout`·`ai_limit_reached`, OPEN-2·OPEN-7 | AI 답의 전체 기한은 받은 때부터 55초(콜백 문서는 본문과 오류 표 모두 유효 시간 5분, 2026-11-14 다시 확인). 한 차례의 모델 호출이 8번에 닿으면 `ai_limit_reached`. 모델 회사는 AI-1의 데이터 다루기 후보를 보고 동희님이 10단계 전에 정함 | AI-1, SPEC-017, SPEC-020, 05단계 A35, RB-14, RD-15, RC-07 |

- 깨지는 변화 9개와 A13이 찾지 않는 4개는 11절. API 77개 → 79개, 응답 382개 → 391개, 필드 오류 사유 23개 → 24개(`reference_not_found`), 열린 질문 9개 → 11개(OPEN-10·11), 스키마 138개 → 142개. 오류 코드 36개, 확인할 것 7개, 스킬 결과 49개, 결정 사항 23개, 서버 안의 일 13개는 그대로입니다.
- 결정과 다르게 하거나 더한 것(가장 가까운 일관된 고침): (1) 본문·쿼리의 ID는 404가 아니라 422 필드 오류 `reference_not_found` 하나로 모았습니다(검토자의 고치는 방향. 경로 ID는 404). (2) 옛 키는 바꾼 뒤 24시간 받는 것을 기본으로 두고 바로 끊기를 고르게 했습니다(검토자의 '바로 거절'만 두면 배포하는 동안 손님 메시지가 끊김). (3) 스킬 키와 연결 문구는 해시로도 저장하지 않고 서버 시크릿에서 다시 만듭니다. (4) 카카오는 PKCE를 OIDC 디스커버리 문서에만 적고 REST API 매개변수 표에는 없어 OPEN-11로 두었고, 받지 않으면 state만 씁니다. (5) 연결 문구는 화면을 본 사장님만 알지만 그 요청이 카카오에서 왔는지는 증명하지 못해 OPEN-10으로 둡니다.
- 검사: 12절의 결과(M16·M18을 고친 뒤).

2026-11-14 같은 재검토의 중간 묶음 M11(RA-05)과 M14(RB-12)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 요구사항 REQ-239~245(REQ-106을 REQ-239로, REQ-108을 REQ-242로 바꿈), 04단계 SPEC-077(가게 정보와 설정 바꾸기)·SPEC-078(사업자 정보 변경 요청과 운영자 확인)과 고친 SPEC-002·003·005·011·028·036·040·066, 05단계 마이그레이션 0014(4절 A37, 5절 E31)를 따릅니다. 원본 `api_catalog.py`·`api_schemas.py`·`api_ops.py`·`api_examples.py`와 `build_api.py`(머리말의 SPEC·API 범위)를 고치고 `build_api.py . --write`로 다시 만들었습니다.

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-008 가게 등록, `ShopRegistration` | 사업장 주소(`businessAddress` 1~200자)와 전자우편주소(`contactEmail`)를 꼭 받고, 통신판매업 신고번호가 있으면 그 신고를 받은 기관(`mailOrderAuthority` 1~40자)도 받음(없으면 `/mailOrderAuthority` required) | REQ-239, SPEC-002, RA-05 |
| API-038 예약 링크 페이지, `BookingPage.shop` | 가게 신원 정보를 전자상거래법 제13조① 그대로 보임(사업장 주소·전자우편주소·신고를 받은 기관을 더함). 상호·대표자·사업자등록번호는 운영자가 확인한 값 | REQ-239, SPEC-011, RA-05 |
| API-009 내 가게 조회, `Shop`, `IdentityChange` | 가게 신원 정보 셋과 가장 최근의 사업자 정보 변경 요청(`identityChange`: 확인 기다림·반영함·보류, 새 값과 요청할 때의 값, 증빙 사진, 보류 이유). 예시 `identity_change_pending`·`identity_change_on_hold` | REQ-245, SPEC-078, RB-12 |
| API-010 가게 설정 수정, `ShopUpdate` | 전화번호·사업장 주소·전자우편주소·통신판매업 신고번호와 기관(또는 면제 사유)을 바로 고침(바꾼 뒤 값으로 신고번호와 기관은 함께 있거나 함께 없고, 신고번호와 면제 사유 가운데 하나는 늘 있음). 상호·대표자·사업자등록번호는 받지 않음. 사장님 답 기다리는 시간은 그 뒤 시작된 기다림부터, 문의 끊김 시간과 하루 AI 비용 한도는 저장한 때부터 씀. 요청 예시 `identity_contact`·`wait_minutes` | REQ-243, REQ-244, SPEC-077, 05단계 A37, RB-12 |
| API-080 사업자 정보 변경 요청(새), `IdentityChangeInput` | 상호·대표자·사업자등록번호의 새 값 셋과 증빙 사진을 '확인 기다림'으로 남기고 요청할 때의 확인된 값도 함께 남김. 운영자가 반영하기 전까지 가게 정보·예약 링크 페이지·확정 안내는 확인된 지금 값을 씀. 가게마다 확인 기다림은 하나(409 `identity_change_pending`), 세 값이 지금과 같으면 `unchanged` | REQ-245, SPEC-078, 05단계 E31, RB-12 |
| API-081 사업자 정보 변경 요청 목록(새), API-082 반영·보류(새), `IdentityChangeReview` | 운영자가 지금 값·새 값·증빙 사진과 결제 계좌의 예금주가 새 대표자·상호와 같은지(`holderMatchesNew`, 다르면 보이기만 하고 막지 않음)를 보고 반영·보류. 반영은 가게의 세 값이 요청할 때의 값과 같을 때만 새 값으로 바꾸고(아니면 409 `version_conflict`), 반영·보류를 사장님께 한 번 알림(알림 종류 둘은 05단계 A37) | REQ-197, REQ-199, REQ-245, SPEC-078 |
| API-013·014 영업 신고 확인, `ReviewShopDetail` | 가게 신원 정보 셋과 확인을 기다리는 변경 요청(`pendingIdentityChange`)을 보이고, 그 요청이 있으면 확인됨은 409 `identity_change_pending`(먼저 반영·보류, 보류는 남길 수 있음). 예시 `identity_change_pending` | SPEC-003, SPEC-078 |
| API-070·071 주문 요청 확인 카드, DEC-22, API-021 운영규정 확정 | 규정 글 끝에 '미성년자가 법정대리인의 동의 없이 한 주문은 본인이나 법정대리인이 취소할 수 있어요' 한 줄. 운영규정을 저장할 때 이 줄도 글 둘의 한도에 셈(`exceeds_card_limit`) | REQ-240, SPEC-005, SPEC-028, RA-05 |
| API-070 내 주문 | 손님이 자기 주문을 물으면 주문마다 상태·픽업 일시·주문 내용 요약·금액과 결제가 확인된 시각·정한 환불과 보낸 때를 저장된 값으로 보임 | REQ-241, SPEC-040, RA-05 |
| API-073 안내 스킬 `notice_shown` | 확정 안내에 주문 내용·픽업 일시·결제가 확인된 금액·가게의 상호·대표자·사업장 주소·전화번호(주문 확정 때의 확인된 값)를 담은 글과 그 주문의 취소·환불 규정 글 | REQ-242, SPEC-036, SPEC-066, RA-05 |
| API-027 영업 캘린더 | 바꾼 전날 안내·후기 부탁 시각은 아직 보내지 않은 안내부터 씀(이미 보낸 것은 다시 보내지 않음) | REQ-243, SPEC-052, SPEC-061 |

- 깨지는 변화 10개와 A13이 찾지 않는 4개는 11절. API 79개 → 82개, 응답 391개 → 409개, 오류 코드 36개 → 37개(`identity_change_pending`), 스키마 142개 → 148개. 필드 오류 사유 24개, 확인할 것 7개, 스킬 결과 49개, 결정 사항 23개, 열린 질문 11개, 서버 안의 일 13개는 그대로입니다.
- 결정과 다르게 하거나 더한 것(가장 가까운 일관된 고침): (1) 검토자가 적은 다섯째(확정 안내에 금액과 가게 신원이 없음)는 고치는 방향에 없었지만 같은 지적이라 `notice_shown`의 확정 안내 글에 담았습니다(REQ-242, 결과 이름과 응답 형식은 그대로). (2) 상호·대표자·사업자등록번호는 영업 신고 확인(REQ-197)과 계좌 예금주 규칙(REQ-199)이 기대는 값이라 가게 설정(API-010)에서 받지 않고 변경 요청(API-080)과 운영자의 반영·보류(API-081·082)로만 바꿉니다(REQ-245, Claude가 더함). (3) 변경 요청이 확인을 기다리는 동안 영업 신고 확인됨은 409로 막아 운영자가 그 요청을 먼저 정하게 했습니다(확인된 값과 영업 신고 확인이 어긋나지 않게). (4) REQ-239~242는 그대로 잠정입니다(5-2 질문 2·3·7).
- 검사: 12절의 2026-11-14 21:00 KST 결과.

2026-11-14 같은 재검토의 중간 묶음 M12(RA-13, RB-15)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 고쳤습니다. RA-13은 검토자의 고치는 방향대로이고(M12에는 Claude 추천이 없음), RB-15는 검토자가 사용자 결정으로 남긴 것을 Claude가 추천안으로 골라(되돌릴 수 있음) 'Claude 추천(RB-15), 동희님 확인 요청'으로 적었습니다(2026-11-15 14:19 동희님 결정 카드 '지금대로 둠 (추천)'으로 확정함). 요구사항 REQ-246~254(REQ-062·063·073을 바꿈), 04단계 SPEC-079(에스컬레이션 건에서 문제 신고로 남기기)와 고친 SPEC-005·022·023·040·046·057·058·059·065·069·076, 05단계 마이그레이션 0015(4절 A38, 5절 E32)를 따릅니다. 원본 `api_catalog.py`·`api_schemas.py`·`api_ops.py`·`api_examples.py`와 `build_api.py`(머리말의 SPEC·API 범위)를 고치고 `build_api.py . --write`로 다시 만들었습니다.

| API·스키마 | 고친 것 | 근거 |
| --- | --- | --- |
| API-065 보상 결정, `CompensationInput.problemKind`, `IssueReport.problemKind` | 문제 종류(상함·변질 `spoiled`, 이물 `foreign_matter`, 그 밖 `other`)를 보상과 함께 꼭 받음. 손님·AI는 고르지 않음 | REQ-246, REQ-247, SPEC-059, RA-13 |
| API-065, 확인할 것 `no_compensation_standard`, `noCompensationReason` | 상함·변질이나 이물에 보상 없음이면 저장하지 않고 409 `confirmation_required`로 소비자분쟁해결기준(공정위 고시 제2025-14호 별표, 제빵류: 교환 또는 환급)과 위험을 보이게 함. 확인해 다시 보낼 때 사유(1~200자)를 꼭 받고(없으면 422 `required`), 다른 때 사유를 보내면 422 `not_allowed` | REQ-248, SPEC-059, 05단계 A38 |
| API-065, 보상 `other_compensation`, `otherCompensationNote`·`otherCompensationAmount` | 그 밖의 보상(사장님이 직접 처리): 한 일(1~200자, 꼭)과 금액(0원~1억 원, 선택)만 남기고 환불·장부 쓰기를 만들지 않음. 손님에게는 '사장님이 직접 연락해 보상을 처리해 드려요' 한 번. 사유와 한 일은 사장님 화면에만 | REQ-249, SPEC-059, 05단계 A38 |
| API-064 문제 신고 하나, API-071 `issue_reported`, API-020, `OperatingRules.issueReportHours` | '기한 뒤'(`late`)는 사장님 화면에만 보이고 손님에게 가는 말은 기한 안의 신고와 같음. 신고 기한 조문 글은 '받은 뒤 24시간 안에 알려 주시면 빨리 확인할 수 있어요'처럼 기한 뒤 신고를 막지 않는 글(기본 24시간은 그대로) | REQ-250, SPEC-005, SPEC-058 |
| API-070 메시지 스킬, 결과 `handed_over` | 변경·취소·문제 신고는 그 주문을 요청한 같은 카카오 사용자에게서만 받음. 다른 사용자에게는 없는 주문번호와 같은 답을 주고, 선물로 받았다는 것처럼 사정을 말하면 사유 `other_user`로 에스컬레이션. 관련 주문이 있으면 그 말은 다른 열린 건에 덧붙지 않고 상담과 주문마다 따로 건(SPEC-022) | REQ-251, REQ-252, REQ-253, SPEC-022, SPEC-040, RB-15, [PR #40 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/40#discussion_r4573944173) |
| API-083 에스컬레이션 건에서 문제 신고로 남기기(새), `IssueFromHandoffInput`·`IssueFromHandoffResult`, API-041 `Handoff.issueReport`, `IssueReport.reportedBy`·`handoff` | 사유 `other_user`이고 관련 주문이 받은 주문인 열린 건에서 사장님이 설명(1~1,000자, 손님 말로 미리 채움)을 고쳐 그 주문에 신고를 남김. 한 건에 신고 하나(다시 누르면 200 `unchanged`로 처음 신고), 조건이 맞지 않으면 409 `invalid_state`. 할 일 '문제 신고'는 올리되 사장님 알림과 문제 신고의 지연 안내는 보내지 않고 건은 열린 채로 둠 | REQ-254, SPEC-079, 05단계 E32, RB-15 |
| DEC-24(새), API-065·042 | 에스컬레이션 건에서 남긴 신고는 보상 안내를 보내지 않음. 신고한 사람에게는 그 건의 답(API-042)으로 결과를 전하고, 환불은 결제한 주문자에게 지금 환불 안내 규칙대로 감. 신고 기한은 그 건이 생긴 시각으로 봄 | SPEC-059, SPEC-079, RB-15 |

- 깨지는 변화 8개와 A13이 찾지 않는 4개는 11절. API 82개 → 83개, 응답 409개 → 416개, 확인할 것 7개 → 8개(`no_compensation_standard`), 결정 사항 23개 → 24개(DEC-24), 스키마 148개 → 150개. 오류 코드 37개, 필드 오류 사유 24개, 스킬 결과 49개, 열린 질문 11개, 서버 안의 일 13개는 그대로입니다.
- 결정과 다르게 하거나 더한 것(가장 가까운 일관된 고침): (1) 검토자가 적은 이름 대신 용어집의 보상(TERM-033)을 써 '그 밖의 보상'(`other_compensation`)으로 적었습니다. (2) 손님에게 가는 그 밖의 보상 안내는 '사장님이 직접 연락해 보상을 처리해 드려요' 한 문장으로 두었습니다. (3) 에스컬레이션 건에서 남긴 신고의 기한은 그 건이 생긴 시각으로 보고, 할 일은 올리되 사장님 알림과 문제 신고의 지연 안내는 보내지 않습니다(그 건의 기다림이 이미 돎, DEC-24). (4) 남긴 신고를 에스컬레이션 건 응답의 `Handoff.issueReport`로 보여, 화면이 같은 건에서 다시 남기지 않고 그 신고로 가게 했습니다. (5) RB-15를 따른 것(REQ-251~254, API-083, DEC-24)은 Claude 추천이라 동희님 확인을 요청합니다(되돌릴 수 있음). 2026-11-15 14:19 동희님 결정 카드 '지금대로 둠 (추천)'으로 확정했습니다.
- [PR #40 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/40#discussion_r4573944173)을 같은 PR에서 고침: 다른 카카오 사용자의 사정이 다른 사유의 열린 건에 덧붙은 질문으로 남으면 API-083이 그 건의 사유로 409 `invalid_state`를 주어 신고로 남길 수 없었습니다. 04 SPEC-022와 05 인덱스 `handoffs_one_open_other_user_per_order`대로 관련 주문이 있는 그 사정은 상담과 주문마다 따로 건이 되게 API-041·070·083의 설명과 깨지는 변화 목록(`components.x-corthex.breakingChanges`)의 API-070 행을 고쳤습니다. 경로·스키마·응답 수는 그대로입니다.
- 검사: 12절의 2026-11-14 22:53 KST 결과.

2026-11-15 같은 재검토가 남긴 빈 곳(PR J2)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 고쳤습니다. 'Claude 추천'이 없어 조정 세션이 적은 방향(PR J2 지시)대로입니다.

| 고친 곳 | 고친 것 | 근거 |
| --- | --- | --- |
| API-059 입금 대조 `arrived`, `ReconciliationInput.arrivedAmount` | 확인된 결제 안내에도 결제 뒤 더 들어온 입금을 남기고, 이미 들어옴을 남긴 결제 안내에 그 결제 안내의 지금 revision으로 다시 남기면 들어온 금액에 더함(더한 합은 안내 금액의 10배까지). 그 결제 안내의 들어온 금액을 셈한 환불을 이미 정했으면 새로 들어온 몫의 '더 들어온 금액' 환불 정할 일을 새로 남김(예시 `arrived_again`) | SPEC-071, REQ-166 |
| API-049 환불 계산 미리보기, `RefundBasis.excludedAmount`, `RefundPreview.calculatedAmount` | 취소 뒤 들어온 입금·더 들어온 금액은 그 결제 안내에서 결제로 확인하지 않은 몫에서 앞 환불이 셈한 몫(`basis.excludedAmount`)을 뺀 값(예시 `over_received_again`: 1,000원을 정한 뒤 20,000원이 또 들어오면 20,000원) | SPEC-016, REQ-165 |
| API-050 환불 결정 | 새로 들어온 몫 없이 같은 결제 안내의 환불을 또 정하면 409 `already_decided`, 또 들어온 입금은 새 환불(요청 예시 `over_received_again`) | SPEC-047, SPEC-071 |
| API-059 결제 확인 취소 `void` | 들어온 금액이 안내 금액보다 많은 결제 안내는 409 `invalid_state`(취소하면 들어온 금액이 지워져 더 들어온 돈의 기록이 없어짐) | SPEC-070 |
| API-044 주문 목록, `OrderSummary.paymentNotice.awaitingAmountConfirm` | 새 금액 확인이 필요한 나감 결제 안내를 손님이 아직 확인하지 않았으면 true. 주문 목록(SCR-020)이 '아직 못 전함' 대신 '손님 확인 기다림'을 보임(예시 `awaiting_amount_confirm`) | SPEC-076, SPEC-037 |

- 깨지는 변화: A13이 찾지 않는 4개를 11절 목록에 적었습니다(안쪽 필드 하나, 뜻이 바뀐 것 셋). API 83개, 오류 코드, 결정 사항 24개는 그대로이고 예시 881개 → 886개입니다.
- 05단계 `refunds.counted_arrived_amount`(마이그레이션 0016)가 환불이 셈한 그 결제 안내의 들어온 금액을 남깁니다. 계약에는 따로 두지 않고 계산값과 `basis.excludedAmount`로 보입니다.
- 검사: 12절의 2026-11-15 01:52 KST 결과.

2026-11-15 같은 재검토의 중간 묶음 M8(RE-15, RC-15)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(이 묶음에는 Claude 추천이 없음).

- 손님 문구의 출처(RE-15): 손님에게 가는 문구의 출처를 08단계 README 5절 한 곳으로 정하고 7절 머리말에 적었습니다. 08단계가 다듬은 다섯 곳(인도 끝남 `handed_over`, 주문 요청 `order_requested`, 주문 취소 `order_cancelled`, 동의 철회 `consent_withdrawn`, 마감된 날 `day_full`)은 계약의 결과 표와 예시를 바꾸지 않습니다. 예시를 바꾸면 08단계 C10 검사가 견주는 06단계 뼈대가 바뀌고, 예시 글은 개발 때 08단계 문구로 채우기 때문입니다. 금액 불일치 안내(SPEC-035)의 글은 04단계와 08단계 SCR-011·SCR-029가 같습니다('보내신 금액이 안내와 달라 사장님이 연락드릴게요').
- 서버 안의 일(RC-15): 10절 SPEC-065 지우기를 05단계 README 6절의 여덟 차례로 맞추고, 30일 지난 AI 도구 호출 기록을 상담이 열려 있어도 지움(AI-1, 05단계 E11, 마이그레이션 0017). API·스키마·오류 코드·예시는 그대로이고 깨지는 변화는 없습니다.
- 검사: 12절의 2026-11-15 03:17 KST 결과.

2026-11-15 같은 재검토의 낮음 K2(05~06: RC-20, RC-21, RD-12, RD-13, RD-14, RD-17, RD-18, RD-20)를 동희님 2026-11-13 20:59 결정 카드 '높음·중간 뒤에 따로 고침 (추천)'대로 고쳤습니다. 'Claude 추천'이 없어 검토자의 고치는 방향대로입니다. 06단계에 걸리는 것은 RD-12·13·14·17·18·20이고, RC-20·21은 05단계(마이그레이션 0019, 6절)와 04단계 SPEC-018입니다. 원본 `api_schemas.py`·`api_ops.py`·`api_examples.py`·`api_catalog.py`와 `check_api.py`(A5·A11의 새 검사)를 고치고 `build_api.py . --write`로 다시 만들었습니다.

| 고친 곳 | 고친 것 | 근거 |
| --- | --- | --- |
| API-048·059·063 예시, A5 | 한 예시 안의 같은 기록을 같은 상태·revision으로 맞춤: 명령 결과의 위쪽 기록(결제 안내·결제·변경 요청)을 그 주문의 목록에도 같은 값으로 넣고, 결제 없이 닫힌 주문(`cancelled_unpaid`)은 확정 시각을 비움. A5가 성공 응답 예시마다 같은 ID의 status·revision, 확정 시각이 있는 주문(재제작 밖)의 확인된 결제, 명령 결과의 위쪽 기록이 같은 주문의 목록에 있는지 봄(고치기 전 main에서 15곳) | RD-12 |
| 목록을 주는 API 14개, DEC-14, A11 | 설명의 '순서:'에 정렬 키를 적고(같은 값이면 ID 순), 나누지 않는 목록 다섯(API-018·022의 버전, API-028, API-051, API-067)을 DEC-14의 예외로 적음. 할 일(API-040)·주문(API-044) 예시를 그 순서로. A11이 목록 API마다 '순서:'와 커서 없는 목록의 예외를 봄 | RD-13 |
| 스킬 응답 `simpleImage.altText` | 대체 글 1~1,000자 → 1~50자(카카오 응답 형식의 최대 50자). 접근성 때문에 꼭 넣는 값은 그대로 | RD-14 |
| API-043 상담 대화, `ConsultationMessage.author`·`delivery`·`text`, `CustomerLine.text` | 그 상담의 손님 안내(사장님 답 `owner`, 그 밖의 안내 `notice`)를 메시지와 시각 순으로 섞어 줌(예시 `with_owner_reply`). 전달 결과에 보내는 중 `sending`·먼저 보냄 `event_api`를 더함. 글 한도를 받는 한도와 같은 100,000자로(전에는 4,000자) | RD-17 |
| API-007 사진 업로드, DEC-16 | 사장님마다 1분 30번, 쓰지 않은 올린 파일(1시간 안) 50개를 넘으면 429 `rate_limited`와 `Retry-After` | RD-18 |
| API-072 후기 스킬, OPEN-12(새) | 여러 차례 묻는 후기 블록의 스킬 요청에도 후기 부탁 버튼의 extra(`clientExtra.orderNo`)가 남는다고 가정(확인 전 가정). 개발 전 시험 채널의 실제 후기 블록으로 확인하고, 남지 않으면 그 사용자에게 가장 최근에 보낸 후기 부탁의 주문에 붙임(13절) | RD-20 |
| 주문번호(`orderNo` 등) | 형식 6~12자 → 영문 대문자·숫자 6~8자(04단계 SPEC-029, 05단계 CHECK와 같게) | 낮음 K1이 넘긴 것(RB-24) |

- 깨지는 변화: A13이 찾지 않는 5개를 11절 목록에 적었습니다(A13이 찾는 것은 0개). 응답 416개 → 417개(API-007 429), 열린 질문 11개 → 12개(OPEN-12), 예시 886개 → 888개. API 83개, 오류 코드 37개, 결정 사항 24개, 스키마 150개는 그대로입니다.
- 05단계 RC-20의 고지한 처리방침 버전(`consultations.ai_disclosed_policy_version`)은 사장님 화면이 읽지 않아 계약에 두지 않았습니다. API-039 설명에 고지의 링크는 늘 가장 최근 버전을 보이고 고지 때 게시된 버전은 05단계에 남는다는 문장을 더했습니다([PR #46 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/46#discussion_r4575443540), 버전을 고르는 주소는 두지 않음). RC-21의 남는 기록과 11단계에 더할 인덱스는 05단계 README 6절입니다.
- K1이 바꾼 요구사항 번호 둘(REQ-118→259, REQ-183→260, 02단계 11절)을 지금 설명 네 곳(API-001 사장님 로그인과 API-002 내 정보의 사장님 알림, `Owner.alertChannelFriend`, `OwnerTask.waitDueAt`)과 2절 표에서 고쳤습니다. 깨지는 변화 목록의 지난 항목(설계 재검토 H7)은 그때 번호 그대로 둡니다.
- 검사: 12절의 2026-11-15 04:52 KST 결과.

2026-11-15 동희님 결정 반영: 설계 재검토 뒤 남은 결정 셋을 동희님이 2026-11-15 14:19 Claude Code 채팅의 결정 카드에서 정하셨습니다(02단계 11절). 06단계에 걸리는 것은 AI 모델 회사(OPEN-7)와 결제 전 주문으로 여러 날 자리를 붙잡는 한도(설계 재검토 RB-25)이고, 신고의 본인 확인(RB-15)은 '지금대로 둠 (추천)'이라 계약을 바꾸지 않고 DEC-24와 11·15절의 확인 요청 표시에 확정을 적었습니다.

| 고친 곳 | 고친 것 | 근거 |
| --- | --- | --- |
| DEC-25(새), OPEN-7(닫음), `AiTurnOutput` 설명, API-039 예시 | AI 모델 호출은 한 곳에서 배포 설정으로 고른 한 회사(Anthropic이나 OpenAI의 유료 API)로. 같은 평가 세트로 두 회사를 시험해 12단계 평가를 지나는 것 가운데 가장 싼 모델을 고름. 처리방침의 국외 이전 예시를 '평가로 고른 한 곳'과 '30일까지 보관(보관 안 함이 허가되면 보관하지 않음)'으로 고침 | 동희님 결정 카드 '둘 다 시험해 평가로 고름 (추천)', REQ-266, 04단계 AI-1 |
| API-009·010, `Shop.awaitingPaymentLimit`·`ShopUpdate.awaitingPaymentLimit` | 한 손님의 결제 기다림 주문 한도 0~10건(기본 2건, 0이면 한도 없음). 저장한 때부터 새 기본 디자인 주문 요청에 쓰고 지금 그보다 많은 결제 기다림 주문은 그대로 둠. 범위 밖은 422 `/awaitingPaymentLimit` `out_of_range` | 동희님 결정 카드 '가게가 한도를 정함', REQ-265, SPEC-077, 05단계 A40 |
| API-071 결과 `order_limit_reached`(새) | 기본 디자인 주문 요청이 한도에 닿으면 주문 요청과 자리를 남기지 않고 사유 `order_limit`의 에스컬레이션 건을 열고 '사장님이 확인한 뒤 알려 드릴게요'로 답함. 사장님이 한도를 넘겨 받은 24시간 안이면 그 상담의 주문 요청 하나가 남음. 맞춤 주문 요청은 막지 않음 | REQ-263, REQ-264, SPEC-029 |
| API-041·042, `Handoff.limitDecision`·`limitAcceptExpiresAt`·`limitUsedOrder`·`awaitingPaymentOrders`, `HandoffAnswerInput.limitDecision`, 사유 `order_limit` | 한도 건은 열린 건에 덧붙지 않고 상담마다 따로 건. 사장님은 그 손님의 결제 기다림 주문을 보고 한도를 넘겨 받기·받지 않음을 고름. 넘겨 받기면 손님에게 '사장님이 주문을 받기로 했어요'와 새 주문 요청 확인 카드, 받지 않음이면 '결제를 기다리는 주문을 결제하거나 취소하면 새 주문을 요청할 수 있어요'. 한도 건이 아닌 건의 `limitDecision`은 422 `not_allowed` | REQ-263, REQ-264, SPEC-022, SPEC-023, 05단계 E34 |

- 깨지는 변화: A13이 찾는 5개와 찾지 않는 3개를 11절 목록에 적었습니다. 스킬 결과 49개 → 50개(`order_limit_reached`), 결정 사항 24개 → 25개(DEC-25), 열린 질문 12개 → 11개(OPEN-7을 닫음), 예시 888개 → 893개. API 83개, 응답 417개, 오류 코드 37개, 필드 오류 사유 24개, 스키마 150개는 그대로입니다.
- 손님에게 가는 새 문구 셋('사장님이 확인한 뒤 알려 드릴게요', '사장님이 주문을 받기로 했어요', '결제를 기다리는 주문을 결제하거나 취소하면 새 주문을 요청할 수 있어요')의 출처는 08단계 README 5절입니다.
- 검사: 12절의 2026-11-15 15:01 KST 결과.

2026-11-15 동희님 결정 반영(로그인 유지 시간): 10단계 체크포인트에서 동희님이 2026-11-15 17시 무렵 Claude Code 채팅의 결정 카드로 세션 길이(OPEN-5)에 '제안대로 (추천)'을 고르셨습니다(10단계 README 9절). 원본 `api_catalog.py`·`api_ops.py`와 쿠키 헤더 설명을 만드는 `build_api.py`를 고치고 `build_api.py . --write`로 다시 만들었습니다.

| 고친 곳 | 고친 것 | 근거 |
| --- | --- | --- |
| DEC-26(새), OPEN-5(닫음) | 사장님 세션(`siljang_owner`)은 마지막으로 쓴 때부터 30일 동안 유지하고 쓸 때마다 다시 30일로 늘림. 운영자 세션(`siljang_operator`)은 로그인한 때부터 12시간이 지나면 끝나고 쓴다고 늘지 않음. 로그인 때 보내는 쿠키의 Max-Age는 사장님 2592000초·운영자 43200초 | 동희님 결정 카드 '제안대로 (추천)', OPEN-5가 제안한 첫 값 |
| API-001·004 설명 | 세션 길이 문장(DEC-26) | DEC-26 |
| API-001·004 응답의 `Set-Cookie` 헤더 설명 | '세션 길이는 OPEN-5' → '세션 길이는 DEC-26: 사장님 30일, 쓰면 늘어남'·'세션 길이는 DEC-26: 운영자 12시간' | DEC-26 |

- 깨지는 변화: 없음. 계약의 모양은 그대로이고 설명만 바뀌었습니다. 결정 사항 25개 → 26개(DEC-26), 열린 질문 11개 → 10개(OPEN-5를 닫음). API 83개, 응답 417개, 오류 코드 37개, 필드 오류 사유 24개, 스킬 결과 50개, 스키마 150개는 그대로입니다.
- 쓸 때마다 늘리는 방법(같은 쿠키를 다시 보내는 때)은 10단계 TASK-020에서 정합니다.
- 같은 날 15절의 앞 항목(설계 재검토 낮음 K2)에 같은 문장이 세 번 들어가 있던 것을 하나로 줄였습니다.
- 검사: 12절의 2026-11-15 17:55 KST 결과.

2026-11-16 구현하며 좁힌 해석 반영(요청 키에 남기지 않는 결과): 10단계 TASK-018(PR #60)이 요청 키를 만들면서, 명령을 처리하지 않고 돌려보낸 결과인 로그인이 필요함(401), 확인이 필요함(409 `confirmation_required`), 요청이 너무 많음(429)을 DEC-04의 422·5xx처럼 남기지 않았습니다. 남기면 로그인한 뒤, 확인을 받은 뒤, 한도가 풀린 뒤에 같은 키로 다시 보내도 처음의 거절만 계속 돌아가기 때문입니다. 계약을 구현과 맞추려고 TASK-019에서 원본 `api_catalog.py`의 DEC-04를 고치고 `build_api.py . --write`로 다시 만들었으며, 5절의 요청 키 문장도 같이 고쳤습니다.

| 고친 곳 | 고친 것 | 근거 |
| --- | --- | --- |
| DEC-04 | 로그인이 필요함(401), 확인이 필요함(409 `confirmation_required`), 요청이 너무 많음(429)도 명령을 처리하지 않은 결과라 남기지 않음과 그 까닭 | 구현하며 좁힌 해석, 2026-11-15(TASK-018의 `app/server/src/request-key.ts` `isStoredError`) |
| 5절 요청 키 | 같은 문장 | DEC-04 |

- 깨지는 변화: 없음. 계약의 모양은 그대로이고 결정 사항의 글만 바뀌었습니다.
- 405(`method_not_allowed`)는 명령에 닿기 전에 라우터가 돌려주므로 요청 키에 남을 일이 없고, 앱도 남기지 않습니다.
- 검사: 12절의 2026-11-16 01:24 KST 결과.

2026-11-18 TASK-021 운영자 로그인(OPEN-6을 닫음): 동희님이 2026-11-16 17:01 무렵 Claude Code 채팅에서 '추천 모두 승인'으로 운영자 인증을 Supabase Auth의 TOTP 2단계 인증으로 정하셨고(10단계 TASK-003, 반복 0 안내서 4-3의 추천안), 10단계 TASK-021이 그 결정을 계약에 옮기며 인증 서비스가 답하지 않을 때와 운영자 TOTP 등록을 정했습니다. 원본 `api_catalog.py`·`api_ops.py`·`api_schemas.py`를 고치고 `build_api.py --write`로 `api/openapi.yaml`과 이 문서의 표를 다시 만들었습니다.

| 고친 곳 | 고친 것 | 근거 |
| --- | --- | --- |
| DEC-27(새), OPEN-6(닫음) | 운영자 로그인은 서버가 한 요청 안에서 Supabase Auth에 비밀번호 로그인과 TOTP(challenge·verify, aal2)를 하고, 운영자 표에 막히지 않고 2단계 인증을 켠 운영자로 있을 때만 우리 세션 쿠키를 줌. Supabase 토큰은 확인한 뒤 끝내고 세션은 05단계 TBL-059에 둠. 실패는 TBL-060에 이메일의 HMAC으로 셈. 고르지 않은 셋(Cloudflare Access, Supabase 토큰을 세션으로, 표 없는 서명 쿠키)과 이유 | 동희님 2026-11-16 17:01 무렵 Claude Code 채팅 답, 10단계 TASK-003 |
| API-004 응답 503(새), 오류 코드 `auth_unavailable`(새) | Supabase Auth가 답하지 않으면(연결 실패, 5초 시간 초과, 5xx, 429, 넘겨주기, 형식이 맞지 않는 답) 503 `auth_unavailable`. 비밀번호 단계부터 답이 없었으면 실패로 세지 않음(운영자 잘못이 아니고, 세면 서비스 장애 동안 운영자가 15분 막힘). 비밀번호 단계가 답한 뒤에 끊기면 셈(틀린 비밀번호를 장애로 숨기지 못하게) | DEC-27, DEC-16 |
| API-004 설명 | 'Open: 운영자 인증 서비스는 개발 전에 고름 …(OPEN-6)' → DEC-27 문장. Origin이 우리 화면 주소가 아니면 인증 서비스에 묻지 않고 401 | DEC-27, DEC-10 |
| `OperatorSessionInput.password` 설명 | '인증 서비스로만 보내고 …(REQ-135, OPEN-6)' → '인증 서비스(Supabase Auth)로만 보내고 …(REQ-135, DEC-27)' | DEC-27 |

- 운영자 TOTP 등록은 API로 두지 않았습니다. 운영자가 몇 명뿐이고 등록 화면이 생기면 로그인 전 화면이 하나 더 열리므로, 대시보드에서 사용자를 만든 뒤 운영자가 자기 터미널에서 등록 도구(`npm run operator:enroll`, 11단계 `app/server/README.md`)를 한 번 돌립니다. 도구는 비밀 글자를 터미널에 한 번만 보이고 파일·로그에 남기지 않습니다.
- 깨지는 변화: 없음. 응답 하나(API-004 503)와 오류 코드 하나(`auth_unavailable`)를 더했고 없앤 것이 없습니다. 응답 417개 → 418개, 오류 코드 37개 → 38개, 결정 사항 26개 → 27개(DEC-27), 열린 질문 10개 → 9개(OPEN-6을 닫음). API 83개, 필드 오류 사유 24개, 스킬 결과 50개, 스키마 150개는 그대로입니다.
- 처리방침(API-039)은 바꾸지 않았습니다. Claude 판단이고 동희님 확인을 요청합니다: API-039는 가게가 손님에게 보이는 처리방침이고, Supabase Auth에 두는 것은 우리 운영자(직원)의 이메일·비밀번호·2단계 인증 키뿐입니다. Supabase는 이미 데이터베이스·사진을 맡긴 같은 회사의 같은 프로젝트라 손님 정보를 받는 곳이 늘지 않습니다.
- 07단계 사이트맵(운영자 접근 문구, SCR-046 메모)과 08단계 SCR-046(503 오류 상태, 케이스 유형 '외부'의 문장)을 같은 결정으로 고쳤습니다(07·08 README의 확정한 뒤 고친 것).
- 검사: 12절의 2026-11-18 결과.

### 2026-11-23 · TASK-045 공개 포트폴리오 주소 예외

- PR #186에서 공개 포트폴리오에 5분 예외를 처음 더했습니다. 사장님·운영자 사진과 공개 도안에는 15분 개인 캐시가 적용됩니다. [처음 결정](https://github.com/kodonghui/siljang.ai/pull/186#issuecomment-7090984075)
- 처음에는 같은 5분 구간과 저장 위치에 같은 주소를 내고 구간 끝에 만료했습니다. 현재 구간과 만료 규칙은 마지막 항목을 따릅니다. 사진 응답의 공개 캐시는 남은 정수 초까지만 허용하며 API-038 JSON은 `no-store`로 철회 사진을 다음 조회부터 제외합니다(SPEC-063, REQ-209).
- 계약 밖 사진 읽기 두 경로는 같은IP의1분600회 한도/429·Retry-After를 사용합니다(150장 페이지 네 번). DEC-16 원래 결정은 보존하고 승인한 예외를 추가했습니다. Worker 위치별 근사 한도인 점은 기존 어댑터와 같습니다.
- 공개 암호화·서명·IV용 키는 HKDF에서 일반 사진과 다른 용도로 파생합니다. 저장 위치와 만료 시각을 구분해 인코딩한 뒤 HMAC으로 96비트 IV를 만듭니다. 같은 저장 위치와 만료 시각에는 같은 암호문을 사용합니다.
- 후속 결정에서 같은 150초 구간에 같은 주소를 내고 구간 끝 뒤 150초에 만료하도록 바꿨습니다. 주소 수명은 150~300초이며 캐시는 남은 정수 초까지만 허용합니다. 저장 위치와 만료 시각으로 IV를 파생합니다. [PR #186 병합 후 검토](https://github.com/kodonghui/siljang.ai/pull/186#issuecomment-7092405123)

### 2026-11-23 · SCR-035 영업 신고 확인 시각

사장님 Shop 응답에 선택 필드 licenseReviewedAt을 더했습니다. 기존 shops.license_reviewed_at을 서울 시각으로 보내며 확인 중/재제출 뒤는 null입니다. 가게 전체 updatedAt을 확인 시각으로 대신하지 않습니다. 운영자 ID나 증빙 원문은 더 보내지 않습니다.
