# 07단계 사이트맵: 수제케이크 주문제작 화면

상태: 확인 지점 전(2026-11-12). 원본은 화면 나무 [`sitemap.yaml`](sitemap.yaml)과, 흐름 파일 끝 '화면 (07단계)' 표의 화면 칸입니다. 사람이 보는 곳은 보드·목록·슬라이드를 한 페이지에 그린 [`sitemap.html`](sitemap.html)입니다(`truth: source`, 3절). 화면을 바꿀 때는 원본만 고치고(사람이든 AI든, PR로), [`research/cake-sitemap-2026-11/build_sitemap.py`](../../research/cake-sitemap-2026-11/build_sitemap.py)가 원본에서 보기 페이지, 이 문서의 표, 흐름 표의 나머지 칸을 다시 그립니다. 그린 것은 손으로 고치지 않습니다.

## 1. 한눈에

<!-- 07-sitemap:counts:start -->
화면 49개: 손님 13, 사장님 32, 운영자 4. 화면이 나오는 흐름 13/14개, 화면에 이어진 API 72개, SPEC 69개.
<!-- 07-sitemap:counts:end -->

- 뿌리는 셋입니다. 손님은 예약 링크 페이지(SCR-001), 사장님은 사장님 로그인(SCR-014), 운영자는 운영자 로그인(SCR-046)에서 들어옵니다. 요구사항에 서비스 소개 페이지가 없어 셋을 잇는 첫 화면은 두지 않았습니다(S1).
- 손님 화면은 대부분 가게 카카오톡 채널 안에 있습니다. 주소가 없어 `kakao:shop/…`로 적었고, 사장님이 알림을 받는 우리 서비스 채널은 `kakao:service/…`입니다(S2).
- 화면 하나는 사람이 무엇을 보고 정하거나 하는 곳이고, 서버의 읽기 모델이나 API의 GET 하나와 맞습니다. 확인 창과 작은 입력은 그 화면의 부분이고, 같은 화면의 빈 목록·오류 같은 모습은 08단계에서 다룹니다(S3).
- 손님이 누르는 확인 카드 여섯 가지는 저마다 화면입니다(S4). 손님에게 먼저 가는 안내는 한 화면(SCR-011)으로 묶고, 돈을 보내는 결제 안내(SCR-005)만 따로 두었습니다(S5).
- 흐름 14개의 상자마다 그 순간 사람이 보는 화면을 흐름 파일 끝 표에 적었고, 화면이 없는 상자에는 까닭을 적었습니다(4절). 06단계 API 72개와 SPEC 69개가 모두 화면 하나 이상에 이어집니다(6절).
- 확인 지점: 이 화면 나무(내비게이션 구조)에 동의하시는지 여쭙니다(11절).

## 2. 읽은 것과 만든 것

| 읽은 것 | 판 | 쓴 것 |
| --- | --- | --- |
| [`docs/03-user-flow/`](../03-user-flow/) | 03단계 확정(2026-11-12 09:13) | 흐름 14개의 상자 291개(시작·끝 48, 단계 172, 갈림길 71). 흐름 잇기 상자 12개는 뺌 |
| [`docs/04-functional-spec/spec.md`](../04-functional-spec/spec.md) | 04단계 확정, SPEC-010은 06단계 뒤 고친 판(커밋 a3a7c90) | SPEC-001~069가 어느 화면에서 보이는지 |
| [`api/openapi.yaml`](../../api/openapi.yaml) | 06단계 확정(2026-11-12 14:01, 커밋 a3a7c90) | 화면마다 부르는 API, 할 일 종류·맨 위 안내가 여는 화면, 웹 경로 이름 |
| [`docs/01-domain/domain.md`](../01-domain/domain.md) | CTX-001~009, TERM-001~074 | 화면 이름과 `terms`, 피할 말 |
| [`docs/02-prd/requirements.md`](../02-prd/requirements.md) | 4판(REQ-001~164) | 화면 설명에 단 REQ 번호 |

| 만든 것 | 무엇 |
| --- | --- |
| [`sitemap.yaml`](sitemap.yaml) | 원본. 화면 나무(뿌리 셋). 화면마다 `id`·`name`·`path`·`access`·`status`·`flows`·`terms`·`specs`·`apis`·`note`, 있으면 `also_paths`·`opens`·`children`. 뿌리에는 `audience`, 흐름 상자가 없는 화면에는 `no_flow`(까닭), 할 일 목록에는 `opens_by_task`·`opens_by_banner` |
| `docs/03-user-flow/FL-0xx-*.md` 끝의 '화면 (07단계)' 표 | 원본(화면·까닭 칸). 흐름 상자마다 화면이나 화면이 없는 까닭. 내용 칸과 화면 이름은 그림 |
| [`sitemap.html`](sitemap.html) | 그림. 사람 보기 페이지: 보드(Mermaid)·목록·슬라이드와 그린 시각 |
| [`research/cake-sitemap-2026-11/`](../../research/cake-sitemap-2026-11/) | `build_sitemap.py`(그리기), `check_sitemap.py`(검사), `vocab.py`(볼 수 있는 사람·까닭·뿌리의 정한 말), `sitemap_page.html`(보기 페이지 틀) |

## 3. 보는 법

- 화면을 바꿀 때는 `sitemap.yaml`을 고치고, 흐름 상자의 화면이 바뀌면 그 흐름 파일 끝 표의 화면 칸도 고칩니다. 그다음 `python3 -B research/cake-sitemap-2026-11/build_sitemap.py . --write`로 다시 그리고 `python3 -B research/cake-sitemap-2026-11/check_sitemap.py .`로 봅니다. `--write` 없이 돌리면 어긋남만 봅니다. 흐름 그림에 상자가 새로 생기면 그리기 도구가 빈 줄을 더하고, 검사가 그 줄을 채우라고 알립니다.
- SCR ID는 나무 순서로 붙였고 다시 쓰거나 번호를 바꾸지 않습니다. 새 화면은 다음 번호를 받고, 없애는 화면은 `status: removed`로 둡니다.
- `flows`는 흐름 파일의 '화면 (07단계)' 표에서 그 화면을 적은 흐름과 같아야 합니다(검사 S9가 양쪽을 봄). 흐름 상자가 없는 화면은 `no_flow`에 까닭을 적습니다.
- 값은 CORTHEX 허브가 읽는 모양만 씁니다: 글은 큰따옴표, 목록은 `[a, b]`, 탭과 블록 글(`|`, `>`)은 쓰지 않습니다(검사 S2).
- `opens`는 자식이 아닌데 그 화면에서 바로 여는 화면입니다(할 일 목록이 여는 결정 화면 따위, 6절).
- 화면이 없는 읽기 모델(용어)은 원본 맨 위 `# without a screen:` 줄에 적었습니다: TERM-057(AI 상담이 보는 주문서 초안), TERM-058(AI 상담이 보는 가게 규칙 판정), TERM-070(전날 안내를 보낼 때 서버가 쓰는 내일 픽업 주문).
- 보기 페이지는 원본에서 그립니다. Artifact로 올린 페이지는 https://claude.ai/artifact/GribGncGMQWGkherDMGNj4 입니다(동희님 계정의 비공개 페이지, `.corthex/project.json`의 `07-sitemap.link`). 원본을 바꾸면 다시 그려 같은 주소에 올립니다.

볼 수 있는 사람(`access`)은 여섯 가운데 하나입니다.

<!-- 07-sitemap:access:start -->
| 볼 수 있는 사람 | 뜻 | 화면 수 |
| --- | --- | --- |
| 누구나 | 로그인 없이 누구나(예약 링크를 가진 사람, 로그인 전 사장님·운영자) | 4 |
| 손님 | 가게 카카오톡 채널에서 말을 건 카카오 사용자 | 3 |
| 주문한 손님 | 그 주문을 요청한 같은 카카오 사용자(SPEC-040) | 8 |
| 가게 없는 사장님 | 카카오로 로그인했지만 가게를 아직 등록하지 않은 사장님 | 1 |
| 사장님 | 가게를 등록한 사장님. 자기 가게 기록만 봄(SPEC-068) | 30 |
| 운영자 | 우리 서비스 쪽 사람. 운영자 로그인 뒤(OPEN-6) | 3 |
<!-- 07-sitemap:access:end -->

화면이 없는 흐름 상자의 까닭은 넷 가운데 하나입니다.

<!-- 07-sitemap:reasons:start -->
| 까닭 | 뜻 | 상자 수 |
| --- | --- | --- |
| 가름 | 서비스나 AI 상담이 가르는 갈림길이라 사람에게 보이는 것이 없음 | 43 |
| 안에서 | 서버 안에서만 일어나 화면에 보이지 않음 | 34 |
| 밖에서 | 우리 화면 밖(은행 앱·인스타그램·구글 시트 장부·가게 앞)에서 보거나 일어남 | 10 |
| 흐름 끝 | 결과만 적은 끝 상자 | 22 |

흐름 상자 291개 가운데 화면이 있는 상자 182개, 까닭을 적은 상자 109개입니다(흐름 잇기 상자 12개는 뺌).
<!-- 07-sitemap:reasons:end -->

## 4. 화면 목록

나무 순서입니다. 들여 쓴 화면은 위 화면의 자식입니다. 흐름 칸은 그 화면을 적은 흐름입니다.

<!-- 07-sitemap:screens:start -->
| ID | 화면 | 경로 | 볼 수 있는 사람 | 흐름 |
| --- | --- | --- | --- | --- |
| SCR-001 | 예약 링크 페이지 | `/s/:slug` | 누구나 | FL-001, FL-002, FL-003, FL-006, FL-007, FL-012 |
| SCR-002 | 　└ 가게 개인정보 처리방침 | `/s/:slug/privacy` | 누구나 | FL-001, FL-003 |
| SCR-003 | 　└ 가게 채널 상담 | `kakao:shop/chat` | 손님 | FL-003, FL-004, FL-005, FL-006, FL-007, FL-008, FL-009, FL-010, FL-011, FL-012 |
| SCR-004 | 　　└ 주문 요청 카드 | `kakao:shop/card/order_request` | 손님 | FL-006 |
| SCR-005 | 　　└ 결제 안내 | `kakao:shop/payment-request` | 주문한 손님 | FL-004, FL-007, FL-008 |
| SCR-006 | 　　└ 입금했다고 알리는 카드 | `kakao:shop/card/payment_claim` | 주문한 손님 | FL-007 |
| SCR-007 | 　　└ 내 주문 보기 | `kakao:shop/my-order` | 주문한 손님 | FL-008, FL-011 |
| SCR-008 | 　　　└ 변경 요청 카드 | `kakao:shop/card/change_request` | 주문한 손님 | FL-008 |
| SCR-009 | 　　　└ 취소 카드 | `kakao:shop/card/cancel` | 주문한 손님 | FL-009 |
| SCR-010 | 　　　└ 문제 신고 카드 | `kakao:shop/card/issue_report` | 주문한 손님 | FL-011 |
| SCR-011 | 　　└ 손님에게 가는 알림 | `kakao:shop/notice` | 손님 | FL-004, FL-005, FL-006, FL-007, FL-008, FL-009, FL-010, FL-011, FL-012 |
| SCR-012 | 　　└ 후기 남기기 | `kakao:shop/block/review` | 주문한 손님 | FL-012 |
| SCR-013 | 　　└ 사진 게시 동의 거두기 카드 | `kakao:shop/card/consent_withdrawal` | 주문한 손님 | FL-012 |
| SCR-014 | 사장님 로그인 | `/owner/login`<br>`/owner/login/callback` | 누구나 | FL-001 |
| SCR-015 | 　└ 가게 등록 | `/owner/shop/new` | 가게 없는 사장님 | FL-001 |
| SCR-016 | 　└ 할 일 목록 | `/owner` | 사장님 | FL-001, FL-002, FL-005, FL-006, FL-007, FL-008, FL-009, FL-011, FL-013 |
| SCR-017 | 　　└ 넘긴 질문 | `/owner/handoffs/:handoffId` | 사장님 | FL-005 |
| SCR-018 | 　　　└ 상담 대화 | `/owner/consultations/:consultationId` | 사장님 | FL-004 |
| SCR-019 | 　　└ 사장님 알림 | `kakao:service/chat` | 사장님 | FL-001, FL-005, FL-006, FL-007, FL-008, FL-009, FL-011 |
| SCR-020 | 　└ 주문 목록 | `/owner/orders` | 사장님 | 없음(5절) |
| SCR-021 | 　　└ 주문 상세 | `/owner/orders/:orderId` | 사장님 | FL-007, FL-009 |
| SCR-022 | 　　　└ 맞춤 주문 답하기 | `/owner/orders/:orderId/custom-decision` | 사장님 | FL-006 |
| SCR-023 | 　　　└ 결제 기한 지난 주문 | `/owner/orders/:orderId/overdue-decision` | 사장님 | FL-007 |
| SCR-024 | 　　　└ 변경 요청 | `/owner/change-requests/:changeRequestId` | 사장님 | FL-008 |
| SCR-025 | 　　　└ 환불 정하기 | `/owner/orders/:orderId/refund-decision` | 사장님 | FL-008, FL-009 |
| SCR-026 | 　　　└ 환불 보내기 | `/owner/refunds/:refundId` | 사장님 | FL-009, FL-011 |
| SCR-027 | 　　　└ 문제 신고 | `/owner/issue-reports/:issueReportId` | 사장님 | FL-011 |
| SCR-028 | 　└ 입금 대조 목록 | `/owner/payment-requests` | 사장님 | FL-007 |
| SCR-029 | 　　└ 입금 대조 | `/owner/payment-requests/:paymentRequestId` | 사장님 | FL-007 |
| SCR-030 | 　└ 제작 목록 | `/owner/production` | 사장님 | FL-008, FL-010 |
| SCR-031 | 　└ 픽업 목록 | `/owner/pickups` | 사장님 | FL-010 |
| SCR-032 | 　└ 영업 달력 | `/owner/calendar` | 사장님 | FL-001, FL-002, FL-006, FL-007 |
| SCR-033 | 　　└ 영업 달력 기준 | `/owner/calendar/settings` | 사장님 | FL-001, FL-002 |
| SCR-034 | 　└ 가게 설정 | `/owner/shop` | 사장님 | FL-001, FL-002 |
| SCR-035 | 　　└ 영업 신고 | `/owner/shop/license` | 사장님 | FL-001 |
| SCR-036 | 　　└ 가격표와 도안 | `/owner/price-list` | 사장님 | FL-001, FL-002 |
| SCR-037 | 　　　└ 가격표 판 기록 | `/owner/price-list/versions`<br>`/owner/price-list/versions/:version` | 사장님 | FL-002 |
| SCR-038 | 　　└ 운영규정 | `/owner/operating-rules` | 사장님 | FL-001, FL-002 |
| SCR-039 | 　　　└ 운영규정 판 기록 | `/owner/operating-rules/versions`<br>`/owner/operating-rules/versions/:version` | 사장님 | FL-002 |
| SCR-040 | 　　└ 결제 받을 곳 | `/owner/payment-destination` | 사장님 | FL-001 |
| SCR-041 | 　　└ 카카오톡 채널 연결 | `/owner/kakao-channel` | 사장님 | FL-001 |
| SCR-042 | 　　└ 장부 연결 | `/owner/ledger`<br>`/owner/ledger/callback` | 사장님 | FL-001, FL-013 |
| SCR-043 | 　　└ 예약 링크 | `/owner/booking-link` | 사장님 | FL-001 |
| SCR-044 | 　　└ 포트폴리오 | `/owner/portfolio` | 사장님 | FL-012 |
| SCR-045 | 　　└ 후기 | `/owner/reviews` | 사장님 | 없음(5절) |
| SCR-046 | 운영자 로그인 | `/operator/login` | 누구나 | 없음(5절) |
| SCR-047 | 　└ 영업 신고 확인 목록 | `/operator/shops` | 운영자 | 없음(5절) |
| SCR-048 | 　　└ 영업 신고 확인 | `/operator/shops/:shopId` | 운영자 | FL-001 |
| SCR-049 | 　└ 운영자 알림 | `/operator/alerts` | 운영자 | 없음(5절) |
<!-- 07-sitemap:screens:end -->

## 5. 흐름 상자가 없는 화면

<!-- 07-sitemap:noflow:start -->
| ID | 화면 | 왜 흐름 상자가 없나 |
| --- | --- | --- |
| SCR-020 | 주문 목록 | 주문 상세로 가는 목록. 흐름 상자는 그다음 화면(주문 상세와 그 아래)에 있음 |
| SCR-045 | 후기 | 06단계 API-066에서 온 화면. FL-012는 후기 사진을 포트폴리오 화면에서 고름 |
| SCR-046 | 운영자 로그인 | 운영자 화면으로 들어가는 길. FL-001의 운영자 상자는 영업 신고 확인에 있음 |
| SCR-047 | 영업 신고 확인 목록 | 영업 신고 확인으로 가는 목록 |
| SCR-049 | 운영자 알림 | 06단계 API-015에서 온 화면(채널 겹침·처리방침 빔·잦은 AI 실패). 03단계 흐름에 운영자 알림 상자가 없음 |
<!-- 07-sitemap:noflow:end -->

## 6. 화면마다 SPEC·API·용어

<!-- 07-sitemap:details:start -->
| ID | SPEC | API | 용어 | 여는 화면(자식 밖) |
| --- | --- | --- | --- | --- |
| SCR-001 | SPEC-011, SPEC-014, SPEC-063 | API-038 | CTX-001, TERM-056, TERM-042, TERM-052, TERM-047, TERM-048 |  |
| SCR-002 | SPEC-010, SPEC-011, SPEC-018 | API-039 | CTX-007, TERM-053 |  |
| SCR-003 | SPEC-013, SPEC-014, SPEC-017, SPEC-018, SPEC-019, SPEC-020, SPEC-022, SPEC-025, SPEC-026, SPEC-027, SPEC-049, SPEC-056, SPEC-057 | API-070 | CTX-001, TERM-046, TERM-045, TERM-041, TERM-013, TERM-019, TERM-003 |  |
| SCR-004 | SPEC-028, SPEC-029, SPEC-030, SPEC-069 | API-071 | CTX-003, TERM-061, TERM-040, TERM-010, TERM-009 |  |
| SCR-005 | SPEC-032, SPEC-066 | 없음(먼저 보내는 안내) | CTX-004, TERM-049, TERM-030, TERM-014 |  |
| SCR-006 | SPEC-033, SPEC-069 | API-071 | CTX-004, TERM-049 |  |
| SCR-007 | SPEC-040 | API-070 | CTX-003, TERM-065, TERM-072 |  |
| SCR-008 | SPEC-041, SPEC-069 | API-071 | CTX-003, TERM-066, TERM-005 |  |
| SCR-009 | SPEC-046, SPEC-016, SPEC-069 | API-071 | CTX-003, TERM-065, TERM-016 |  |
| SCR-010 | SPEC-057, SPEC-058, SPEC-069 | API-071 | CTX-003, TERM-031, TERM-032, TERM-072 |  |
| SCR-011 | SPEC-066, SPEC-023, SPEC-024, SPEC-036, SPEC-039, SPEC-044, SPEC-045, SPEC-047, SPEC-052, SPEC-053, SPEC-059, SPEC-061 | 없음(먼저 보내는 안내) | CTX-008, TERM-054, TERM-036 | SCR-012 |
| SCR-012 | SPEC-062, SPEC-061, SPEC-019 | API-072 | CTX-006, TERM-051 |  |
| SCR-013 | SPEC-063, SPEC-069 | API-071 | CTX-006, TERM-052, TERM-051 |  |
| SCR-014 | SPEC-001 | API-001 | CTX-007, TERM-044 |  |
| SCR-015 | SPEC-002, SPEC-068 | API-007, API-008 | CTX-007, TERM-053 |  |
| SCR-016 | SPEC-067, SPEC-024, SPEC-037 | API-040, API-002 | CTX-001, TERM-059, TERM-035, TERM-008 | SCR-022, SCR-023, SCR-024, SCR-025, SCR-027, SCR-029, SCR-032, SCR-035, SCR-042, SCR-043 |
| SCR-017 | SPEC-022, SPEC-023, SPEC-056 | API-041, API-042 | CTX-001, TERM-008, TERM-018 |  |
| SCR-018 | SPEC-021, SPEC-019, SPEC-065, SPEC-068 | API-043 | CTX-001, TERM-046, TERM-019 |  |
| SCR-019 | SPEC-067, SPEC-003, SPEC-024 | 없음(먼저 보내는 안내) | CTX-008, TERM-035, TERM-054 | SCR-016 |
| SCR-020 | SPEC-031, SPEC-037, SPEC-068 | API-044 | CTX-003, TERM-001, TERM-064 |  |
| SCR-021 | SPEC-045, SPEC-048, SPEC-068 | API-045, API-048 | CTX-003, TERM-001, TERM-004, TERM-005 |  |
| SCR-022 | SPEC-031 | API-045, API-046 | CTX-003, TERM-062, TERM-038, TERM-011 |  |
| SCR-023 | SPEC-037, SPEC-038, SPEC-039 | API-045, API-047 | CTX-003, TERM-064, TERM-037 |  |
| SCR-024 | SPEC-042, SPEC-043, SPEC-044, SPEC-045 | API-062, API-063 | CTX-003, TERM-066 |  |
| SCR-025 | SPEC-047, SPEC-016 | API-049, API-050 | CTX-004, TERM-067, TERM-016 |  |
| SCR-026 | SPEC-047, SPEC-049 | API-060, API-061 | CTX-004, TERM-049 |  |
| SCR-027 | SPEC-058, SPEC-059, SPEC-060 | API-064, API-065 | CTX-003, TERM-073, TERM-031, TERM-033, TERM-034 |  |
| SCR-028 | SPEC-034, SPEC-033, SPEC-035, SPEC-037 | API-057 | CTX-004, TERM-063 |  |
| SCR-029 | SPEC-034, SPEC-035, SPEC-036 | API-058, API-059 | CTX-004, TERM-063, TERM-049 |  |
| SCR-030 | SPEC-050, SPEC-051, SPEC-053, SPEC-060 | API-051, API-052, API-053, API-007 | CTX-005, TERM-068, TERM-050, TERM-022 |  |
| SCR-031 | SPEC-054, SPEC-055 | API-051, API-054, API-055, API-056 | CTX-005, TERM-069, TERM-024, TERM-025 |  |
| SCR-032 | SPEC-007, SPEC-012, SPEC-015 | API-028, API-029 | CTX-002, TERM-060, TERM-048, TERM-026, TERM-027 |  |
| SCR-033 | SPEC-007 | API-026, API-027 | CTX-002, TERM-048 |  |
| SCR-034 | SPEC-009, SPEC-017, SPEC-024, SPEC-025, SPEC-052 | API-009, API-010, API-003 | CTX-007, TERM-053 |  |
| SCR-035 | SPEC-003 | API-009, API-011, API-007 | CTX-007, TERM-053, TERM-074 |  |
| SCR-036 | SPEC-004 | API-016, API-017, API-007 | CTX-002, TERM-047, TERM-020, TERM-005 |  |
| SCR-037 | SPEC-004, SPEC-013 | API-018, API-019 | CTX-002, TERM-047, TERM-005 |  |
| SCR-038 | SPEC-005 | API-020, API-021 | CTX-002, TERM-017 |  |
| SCR-039 | SPEC-005, SPEC-016 | API-022, API-023 | CTX-002, TERM-017, TERM-005 |  |
| SCR-040 | SPEC-006 | API-024, API-025 | CTX-004, TERM-049 |  |
| SCR-041 | SPEC-008 | API-030, API-031, API-032 | CTX-007, TERM-053 |  |
| SCR-042 | SPEC-009, SPEC-064 | API-033, API-034, API-035, API-036 | CTX-009, TERM-028, TERM-055 |  |
| SCR-043 | SPEC-010 | API-037 | CTX-007, TERM-042 | SCR-035, SCR-036, SCR-038, SCR-040, SCR-041 |
| SCR-044 | SPEC-063 | API-067, API-068, API-069 | CTX-006, TERM-052, TERM-071 |  |
| SCR-045 | SPEC-062 | API-066 | CTX-006, TERM-051, TERM-071 |  |
| SCR-046 | SPEC-001 | API-004 | CTX-007, TERM-074 |  |
| SCR-047 | SPEC-003, SPEC-002 | API-012, API-005, API-006 | CTX-007, TERM-053, TERM-074 |  |
| SCR-048 | SPEC-003 | API-013, API-014 | CTX-007, TERM-053, TERM-074 |  |
| SCR-049 | SPEC-008, SPEC-010, SPEC-017 | API-015 | CTX-008, TERM-054, TERM-074 |  |
<!-- 07-sitemap:details:end -->

할 일 목록(SCR-016)에서 할 일을 누르면 그 할 일의 '열 화면'(`OwnerTask.subject`)이 열리고, 맨 위 안내를 누르면 그 설정 화면이 열립니다(API-040, API-002).

<!-- 07-sitemap:tasks:start -->
| 할 일 종류(kind) | 여는 화면 |
| --- | --- |
| `handoff` | SCR-017 넘긴 질문 |
| `custom_order` | SCR-022 맞춤 주문 답하기 |
| `change_request` | SCR-024 변경 요청 |
| `issue_report` | SCR-027 문제 신고 |
| `payment_claim` | SCR-029 입금 대조 |
| `payment_mismatch` | SCR-029 입금 대조 |
| `payment_overdue` | SCR-023 결제 기한 지난 주문 |
| `refund_decision` | SCR-025 환불 정하기 |
| `paid_after_cancel` | SCR-025 환불 정하기 |
| `stale_change` | SCR-024 변경 요청 |
| `ledger_relink` | SCR-042 장부 연결 |
| `license_on_hold` | SCR-035 영업 신고 |
| `calendar_conflict` | SCR-032 영업 달력 |

| 맨 위 안내(banners) | 여는 화면 |
| --- | --- |
| `add_alert_channel` | SCR-019 사장님 알림 |
| `license_pending` | SCR-035 영업 신고 |
| `license_on_hold` | SCR-035 영업 신고 |
| `booking_link_not_ready` | SCR-043 예약 링크 |
| `ledger_relink` | SCR-042 장부 연결 |
<!-- 07-sitemap:tasks:end -->

## 7. 정한 것

화면 나무를 세울 때 Claude가 정한 것입니다. 확인 지점(11절)에서 함께 여쭙니다.

| 번호 | 정한 것 | 까닭 | 다른 길과 그 결과 |
| --- | --- | --- | --- |
| S1 | 뿌리 셋: 손님 SCR-001 예약 링크 페이지, 사장님 SCR-014 사장님 로그인, 운영자 SCR-046 운영자 로그인 | 셋은 들어오는 곳과 볼 수 있는 것이 모두 다름. 요구사항에 서비스 소개 페이지가 없음 | 서비스 첫 화면 하나를 뿌리로: 요구사항에 없는 화면을 새로 만들어야 함 |
| S2 | 카카오톡 안의 화면은 `kakao:shop/…`(가게 채널)·`kakao:service/…`(우리 서비스 채널)로 적음 | 주소가 없지만 손님 흐름 대부분이 여기서 일어남. 경로가 겹치지 않아 검사할 수 있음 | 사이트맵에서 뺌: 손님 흐름 상자의 대부분이 화면 없이 남음 |
| S3 | 화면 하나 = 사람이 보고 정하거나 하는 곳이고 읽기 모델이나 API의 GET 하나와 맞음. 확인 창·작은 입력은 부분, 같은 화면의 다른 모습은 08단계 | 07단계 계약(같은 화면의 다른 상태는 합침). 08단계가 화면마다 상태를 적기 좋음 | 버튼·창마다 화면: 화면이 크게 늘고 08단계 상태와 겹침 |
| S4 | 손님 확인 카드 여섯(주문 요청·입금했다고 알리기·변경 요청·취소·문제 신고·사진 게시 동의 거두기)은 저마다 화면 | 카드마다 보는 것과 누르는 것이 다르고(SPEC-069), 30분 기한·옛 판 같은 상태도 카드마다 다름 | 상담 화면(SCR-003)의 상태로 둠: 카드 여섯의 문구와 상태가 한 화면에 몰림 |
| S5 | 손님에게 먼저 가는 안내는 한 화면(SCR-011), 결제 안내(SCR-005)만 따로 | 안내는 모양이 같고 종류만 다름(SPEC-066). 결제 안내는 금액·계좌·기한을 보고 돈을 보내는 곳 | 안내마다 화면: 화면 여덟이 늘지만 모양이 같음 |
| S6 | 결제 기한 지난 주문 목록과 답할 맞춤 주문 목록은 주문 목록(SCR-020)의 거름으로 봄 | API-044 하나가 `status`·`kind`로 거름. 할 일 목록에서도 바로 열림 | 목록 화면을 따로: 같은 API로 화면만 늘어남 |
| S7 | 사장님 알림(SCR-019, 카카오톡)은 할 일 목록 아래에 둠 | 알림에 할 일 종류와 할 일 목록 주소만 담음(SPEC-067) | 사장님 뿌리 바로 아래: 웹 메뉴와 섞여 보임 |
| S8 | 웹 경로: 손님 `/s/:slug`, 사장님 `/owner/…`, 운영자 `/operator/…`. 주문에 딸린 결정 화면은 `/owner/orders/:orderId/…`, 나머지는 06단계 API 경로를 따름 | 06단계 예약 링크 주소와 로그인·장부 콜백 주소에 맞춤 | 화면 이름으로 새 경로: 계약 경로와 두 벌이 됨 |
| S9 | 흐름 상자의 까닭은 넷(가름·안에서·밖에서·흐름 끝). 구글 시트 장부에 적는 상자는 '밖에서' | 사장님은 장부를 구글 시트에서 봄. 화면 없는 상자를 하나씩 설명하지 않아도 됨 | 까닭 없이 비움: 빠뜨린 것과 화면이 없는 것을 가를 수 없음 |

## 8. 06단계와 맞춘 것

- 화면이 부르는 API를 모두 적으니 API-001~072가 하나도 빠지지 않고 화면에 이어졌습니다. 화면만 있고 API가 없는 것은 카카오톡으로 먼저 보내는 세 화면(SCR-005 결제 안내, SCR-011 손님에게 가는 알림, SCR-019 사장님 알림)이고, 이들은 우리 서버가 카카오로 보내는 안내라 06단계 계약에 API가 없습니다.
- 계약을 바꿀 일은 찾지 못했습니다. 화면이 더 필요한 API는 08단계에서 상태를 적으며 다시 봅니다.
- 열린 질문 OPEN-8(사장님이 오픈빌더 봇 ID를 찾는 곳)은 SCR-041 카카오톡 채널 연결 화면의 길잡이로 08단계에서 정합니다. OPEN-6(운영자 인증 서비스)은 SCR-046에 걸립니다.

## 9. 검사

`python3 -B research/cake-sitemap-2026-11/check_sitemap.py . --hub <허브의 sitemap.py>`를 2026-11-12 15:19 KST에 그린 판에 돌린 결과: 검사 17개 통과 17, 실패 0, 못 봄 0. `--hub`를 주지 않으면 S2는 '못 봄'입니다.

| 검사 | 결과 |
| --- | --- |
| S1 원본을 PyYAML로 읽음 | 뿌리 3개, 화면 49개 |
| S2 허브 파서로 읽음 | CORTHEX 허브의 `sitemap.py`가 PyYAML과 같은 나무를 읽음. `# without a screen` 줄 1개 |
| S3 SCR ID | SCR-001~049, 빈 번호 없이 나무 순서 |
| S4 칸과 볼 수 있는 사람 | 화면마다 필요한 칸이 있고 access는 정한 6가지 가운데 하나 |
| S5 경로 | 경로 53개(웹 41, 카카오톡 12)가 겹치지 않음 |
| S6 뿌리에서 닿음 | 손님 13, 사장님 32, 운영자 4. 뿌리마다 `audience` 하나 |
| S7 참조 | 흐름·용어·SPEC·API·여는 화면이 모두 있음 |
| S8 흐름 상자 | 상자 291개: 화면 182, 가름 43, 안에서 34, 밖에서 10, 흐름 끝 22 |
| S9 양쪽 맞음 | 화면의 `flows`와 흐름 표가 같음. 흐름 상자가 없는 화면 5개는 모두 `no_flow` 까닭이 있음 |
| S10 API | 72/72 |
| S11 SPEC | 69/69 |
| S12 읽기 모델 | 18개: 화면 15, 화면 없음 3(TERM-057·058·070) |
| S13 할 일·안내 | SCR-016의 할 일 종류 13, 맨 위 안내 5가 06단계 값과 같고, 모두 할 일 목록에서 열림 |
| S14 피할 말 | 0(허용한 쓰임 69곳) |
| S15 보기 셋 | 보드 상자 49·화살표 46, 목록 49줄, 슬라이드 15장 49항목, 그린 시각 있음 |
| S16 그린 것 | 원본에서 다시 그린 것과 같음(16개) |
| S17 03단계 흐름 검사 | `check_flows.py` 문제 0, 피할 말 0. 필수 113개 가운데 108개가 흐름 그림에 있는 것은 03단계 그대로 |

- 일부러 넣은 오류 29가지를 검사가 모두 잡았습니다: 경로 겹침, 정하지 않은 access, `flows` 어긋남, 피할 말, 없는 API·용어, 화면 없음 표시 빠짐, 따옴표 없는 콜론, ID 겹침, 탭 들여쓰기, 허브가 읽지 못하는 블록 글, 없앤 화면을 쓰는 흐름 표, 카카오 경로 모양, `no_flow` 빠짐, 할 일 종류 틀림, 할 일 목록에서 닿지 않는 여는 화면, 뿌리 `audience` 겹침, 흐름 표의 줄 빠짐·없는 화면·화면과 까닭을 함께 적음·정하지 않은 까닭·화면 이름 틀림·새 상자의 빈 줄·흐름 표만 바꿈, 보기 페이지의 슬라이드·목록·그린 시각·보드 화살표 빠짐, README 표 손 고침.
- 그리기 도구는 흐름 그림에 없는 상자의 줄을 만나면 멈추고, 그림에 새로 생긴 상자에는 빈 줄을 더합니다(검사 S8이 채우라고 알림).
- 보드의 Mermaid 그림 셋을 Mermaid 10.9.1로 읽어 오류 없이 상자 49개·화살표 46개로 그려지는 것을 확인했습니다. 마지막 판을 1280px(밝은 화면)과 390px(어두운 화면)에서 그려 보았고 가로로 넘치지 않았습니다. 좁은 화면에서도 한국어 낱말은 중간에서 끊기지 않고, 긴 카카오톡 경로만 칸 끝에서 끊깁니다. 올린 페이지에서는 Artifact가 Mermaid를 그리는데, 그 모습은 직접 보지 못했습니다.
- 못 본 것: 카카오톡 화면은 아직 실제로 없어서 카드와 알림의 모양은 08·09단계에서 봅니다.

## 10. 다음 단계에 넘기는 것

- 08단계(화면 상태): 화면 49개마다 보통·불러오는 중·빈·오류·권한·오래된 모습을 적습니다. 카드 화면은 30분 기한과 옛 판, 카카오톡 화면은 친구가 아닐 때(다음 대화 때 먼저 전함)를 상태로 다룹니다.
- 08단계에서 OPEN-8(SCR-041의 봇 ID 길잡이)을 정합니다.
- 09단계(목업)는 08단계 화면 정의를 따라 화면마다 후보 둘에서 시작합니다.

## 11. 확인 지점

- 질문: 이 화면 나무(뿌리 셋, 화면 49개)와 7절의 정한 것 S1~S9에 동의하시나요?
