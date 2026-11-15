# 10단계 WBS: 수제케이크 주문제작 개발 작업

상태: 초안(2026-11-15), 동희님 확인 전(9절 체크포인트). 원본은 작업 목록 [`wbs_rows.py`](../../research/cake-wbs-2026-11/wbs_rows.py)이고, [`build_wbs.py`](../../research/cake-wbs-2026-11/build_wbs.py)가 원본과 01~09단계 산출물에서 작업 표 [`wbs.md`](wbs.md)와 이 문서의 생성 절을 만들고 검사합니다. 사람이 보는 곳은 Notion 작업 데이터베이스이고, 이 일의 끝에 한 번 올립니다(8절).

## 1. 한눈에

<!-- BEGIN generated:counts -->
작업 169개 · 크기 합 235일 · 반복 9개 · 동희님 11개 · Claude 158개 · SPEC 79개 · 수락 기준 328개 · API 83개 · 화면 50개(상태 367개, 09에서 그린 161개, 그리지 않은 206개) · 테이블 58개 · 앱 규칙 40개 · 공통 규칙 9개 · 열린 질문 11개.
<!-- END generated:counts -->

- 작업 표는 [`wbs.md`](wbs.md)입니다. 작업마다 출처(SPEC·REQ·OPEN·DEC·규칙), 닿는 것(API·테이블·화면), 앞선 작업, 맡은 이, 크기, 끝난 조건이 있고, 끝에 SPEC·API·화면·테이블·규칙에서 작업을 찾는 부록 A~E가 있습니다.
- 반복 0은 개발을 막는 확인과 결정이고(5절), 반복 1~8이 개발입니다(4절).
- 화면 작업은 08단계 상태를 모두 끝난 조건으로 받습니다. 09단계에서 그리지 않은 상태도 그 화면 작업에서 08 와이어프레임과 09 토큰으로 만들고 확인합니다.
- 기술 스택은 아직 고르지 않았습니다. 작업은 스택과 상관없이 썼고, 후보와 추천은 6절, 고르는 일은 TASK-002(동희님)입니다.

## 2. 입력과 버전

- 입력: main `da7f7fc`(2026-11-15 16:23 KST, [PR #49](https://github.com/kodonghui/siljang.ai/pull/49)를 합친 커밋)의 01~09단계 산출물. 읽기만 하고 고치지 않았습니다.
- 생성기가 읽은 원본과 그 수(생성 절):

<!-- BEGIN generated:inputs -->
| 단계 | 원본(읽기만) | 읽은 것 |
| --- | --- | --- |
| 01 | `docs/01-domain/domain.md` | 용어집의 금지어 109개 |
| 02 | `docs/02-prd/requirements.md` | 요구사항 266개(제외 31개), SPEC 행에 없는 유효 요구사항 5개(REQ-139, REQ-145, REQ-147, REQ-148, REQ-149) |
| 03 | `docs/03-user-flow/FL-*.md` | 플로우 14개(출처 ID) |
| 04 | `research/cake-spec-2026-11/spec_rows.py`, `docs/04-functional-spec/spec.md` | SPEC 79개, 수락 기준 328개, 공통 규칙 9개 |
| 05 | `db/schema.sql`, `docs/05-erd/README.md`, `research/cake-erd-2026-11/erd_map.py` | 테이블 58개, 앱 규칙 40개, SPEC마다 닿는 테이블 |
| 06 | `api/openapi.yaml`, `research/cake-api-2026-11/api_ops.py`·`api_catalog.py` | API 83개(응답 417개), 카카오 스킬 API 넷의 결과 코드 57개, 열린 질문 11개, 결정 사항 25개 |
| 07 | `docs/07-sitemap/sitemap.yaml` | 화면 50개와 화면마다 부르는 API |
| 08 | `research/cake-screens-2026-11/screens_*.py`, `docs/08-screens/SCR-*.md` | 상태 367개, 응답 행 974개 |
| 09 | `research/cake-mockup-2026-11/gen_screens.py` | 그리는 상태 이름 12개(empty·error·confirm-notify·confirm·expired·not-sent·deferred·allergy·orderer·amount-confirm·depositor·photo-consent), 그린 상태 161개 |
<!-- END generated:inputs -->

- 만든 것: [`wbs.md`](wbs.md)(생성)와 이 README의 생성 절 다섯(counts·inputs·iterations·before-dev·checks). 생성한 곳은 손으로 고치지 않습니다.

## 3. 나눈 방식

- 작업 하나는 PR 하나로 끝내고 검사를 지날 수 있는 크기입니다. 크기는 0.5·1·2·3일 가운데 하나이고, 3일을 넘으면 나눕니다. 크기는 Claude의 어림이고 시간 약속이 아닙니다.
- 맡은 이는 동희님이나 Claude 하나입니다. 동희님 몫은 동희님 계정이나 판단이 있어야 하는 일(카카오 채널·봇·앱 만들기, AI 회사에 신청, 전문가 확인, 결정 카드 답, 운영 계정)이고, 나머지는 Claude가 만들어 PR로 올립니다.
- 서버 작업은 SPEC 하나나 그 일부와 그 API를, 화면 작업은 화면(SCR) 하나를 맡습니다. 여러 기능이 함께 쓰는 바탕(요청 키, 오류 응답, 가게 나누기, 자동으로 하는 일 실행기, 암호화, 모델 호출, 웹 바탕)은 반복 1에 따로 둡니다.
- 끝난 조건의 첫 줄은 손으로 쓰고, 나머지 줄은 원본에서 생성합니다.
  - 수락 기준: SPEC마다 그 SPEC을 출처 맨 앞에 둔 서버 작업이 #1~#n을 모두 받습니다. 그런 작업이 둘 이상이면 원본의 `ac`로 나눕니다(예: SPEC-001은 TASK-020이 #1~#4, TASK-021이 #5).
  - API: 계약(`api/openapi.yaml`)의 응답 코드마다 시험 한 줄. 카카오 스킬 API 넷(API-070~073)은 그 작업의 SPEC에 속한 스킬 결과 코드도 받습니다.
  - 화면: 08단계 상태 전부와 응답 행. 사장님·운영자 웹 화면은 360·1280에서 그려 page-check(누르는 곳 44px)를 지나고, 손님 화면(카카오톡 안)은 스킬 응답이 08 정의와 같은지(출력 3개 이하, 카드 설명 400자 이하) 봅니다.
  - 규칙: 05 앱 규칙(A)과 04 공통 규칙(G)을 받은 작업은 그 규칙을 지키는지 보는 시험 줄을 받습니다.
- 앞선 작업은 원본에 적은 것에, 화면 작업이면 그 화면이 부르는 API를 만드는 작업이 자동으로 더해집니다. API는 처음 그 API를 적은 작업이 만들고, 뒤 작업은 고칩니다.
- 화면이 부르는 API 가운데 뒤 반복에서 만드는 것이 있으면, 화면 작업은 그 API를 기다리지 않고(`later_api`) 뒤 반복에 그 API 몫만 하는 화면 작업(`only_api`)을 둡니다. 지금은 둘입니다: SCR-017의 API-083(문제 신고로 남기기, 반복 6), SCR-021의 API-048(가게 사정 취소, 반복 5). 그래서 앞 반복의 작업이 뒤 반복의 작업을 기다리지 않습니다(7절 검사).
- 테이블은 서버 작업이 출처 SPEC에서 닿는 테이블(05 `erd_map.py`)을 받고, 마이그레이션 작업(TASK-017)이 모든 테이블을 만듭니다.
- 06 열린 질문은 반복 0의 시험·결정 작업이 받고, TASK-011이 그 결과로 04·05·06의 확인 전 가정을 고칩니다. SPEC 행에 없는 유효 요구사항(2절 표)을 받은 작업은 `wbs.md` 부록 E에 있습니다.
- ID는 바꾸거나 다시 쓰지 않습니다. 새 작업은 끝 번호 다음이고, 없앤 작업은 지우지 않고 `status='removed'`와 날짜·이유를 남깁니다(`wbs.md`의 '지운 작업' 절).

## 4. 반복 계획

- 반복 하나가 끝나면 스테이징에서 사람이 처음부터 끝까지 돌려 볼 수 있는 플로우가 하나 늡니다. 반복 2~7은 손님 주문의 플로우를 따라갑니다: 가게 준비 → AI 상담과 주문 요청 → 결제와 주문 확정 → 변경·취소·환불 → 제작·인도·문제 신고·후기 → 장부·지우기·운영자.
- 반복 안에서는 서버 작업이 먼저, 그 API를 부르는 화면 작업이 뒤에 옵니다(`wbs.md`도 같은 차례).
- 날짜는 넣지 않았습니다. 크기 합은 한 사람이 차례대로 할 때의 날 수이고, 아래 '가장 긴 앞선 작업 줄'은 작업을 여럿 함께 해도 줄일 수 없는 날 수입니다.

<!-- BEGIN generated:iterations -->
| 반복 | 이름 | 작업 | 크기 합(일) | 동희님 | Claude | 끝나면 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 개발 전 확인 | 14 | 11.5 | 10 | 4 | 기술 스택이 정해지고, 카카오·AI 회사에 대한 확인 전 가정이 시험 결과로 바뀝니다. |
| 1 | 뼈대 | 17 | 26 | 0 | 17 | 스테이징에서 사장님·운영자가 로그인하고, 시험 채널의 손님 메시지가 우리 서버에 닿아 가게별로 남고, 같은 평가 세트를 두 AI 회사 모델에 돌릴 수 있습니다. |
| 2 | 가게 준비 | 31 | 43 | 0 | 31 | 사장님이 가게를 등록하고 가격표·운영규정·결제 수단·영업 캘린더·채널 연결을 마쳐 예약 링크가 나오고, 운영자가 영업 신고를 확인합니다. |
| 3 | AI 상담과 주문 요청 | 28 | 44.5 | 0 | 28 | 손님이 가게 채널에서 AI 상담으로 견적과 날짜를 받고 주문 요청을 하며, 답하지 못한 질문은 에스컬레이션 건으로 사장님 할 일 목록에 뜹니다. |
| 4 | 결제와 주문 확정 | 25 | 35.5 | 0 | 25 | 결제 안내가 가고, 손님의 결제 확인 요청과 사장님의 입금 대조로 주문 확정까지 갑니다. |
| 5 | 변경·취소·환불 | 16 | 22 | 0 | 16 | 변경 요청과 차액 결제, 손님 취소와 가게 사정 취소, 환불 결정과 송금 표시가 돕니다. |
| 6 | 제작·인도·문제 신고·후기 | 24 | 30 | 0 | 24 | 제작 목록부터 인도·미수령, 문제 신고와 보상, 후기와 포트폴리오까지 돕니다. |
| 7 | 장부·지우기·운영자 | 6 | 13 | 0 | 6 | 구글 시트 장부 쓰기, 지난 기록 지우기, 운영자의 가게 기록 보기가 돕니다. |
| 8 | 출시 준비와 12단계 준비 | 8 | 9.5 | 1 | 7 | 평가로 모델을 고르고 처리방침을 채우고, 부하·백업 시험과 운영 배포를 마치고, 12단계 시험 계획이 나옵니다. |
| 합 | | 169 | 235 | 11 | 158 | |

가장 긴 앞선 작업 줄(차례대로만 할 수 있는 작업의 크기 합): 43.5일, 작업 26개(TASK-001 → TASK-002 → TASK-015 → TASK-017 → TASK-018 → TASK-020 → TASK-032 → TASK-038 → TASK-067 → TASK-069 → TASK-071 → TASK-078 → TASK-079 → TASK-083 → TASK-091 → TASK-092 → TASK-093 → TASK-094 → TASK-095 → TASK-097 → TASK-132 → TASK-136 → TASK-139 → TASK-140 → TASK-141 → TASK-142).
<!-- END generated:iterations -->

- 반복 1은 모두 TASK-015(개발 저장소 뼈대)를 거쳐 TASK-002(스택 고르기)를 기다립니다. 그래서 반복 0에서 TASK-001과 TASK-002를 먼저 합니다.
- 카카오 스킬을 받는 작업(TASK-028)과 사장님 로그인(TASK-020)은 카카오 시험 결과로 가정을 고치는 TASK-011을 기다립니다. TASK-011은 동희님의 시험 채널 만들기(TASK-007)와 대본대로 해 보기(TASK-009)를 기다립니다.

## 5. 개발 전 확인 목록(반복 0)

개발을 시작하기 전에 끝낼 확인과 결정입니다. 동희님 몫의 끝난 조건에는 기록에 남길 것까지 적었습니다.

<!-- BEGIN generated:before-dev -->
| ID | 작업 | 맡은 이 | 크기 | 출처 | 앞선 작업 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-001 | 기술 스택·배포 환경 후보 비교(공식 문서로 확인) | Claude | 1일 | REQ-130, REQ-135, REQ-141, REQ-148, REQ-149 | 없음 | README 6절 표에 후보마다 언어·웹 프레임워크·PostgreSQL 16 운영 방법·서울 리전·월 비용 범위·두 AI 회사 공식 SDK·카카오 스킬 5초 제한 안의 응답을 공식 문서 주소와 확인 날짜로 적고, 추천과 반론을 둠 |
| TASK-002 | 기술 스택·배포 환경 고르기 | 동희님 | 0.5일 | REQ-130, REQ-141 | TASK-001 | 결정 카드에서 고른 답을 말 그대로 docs/records/progress.md에 남김 |
| TASK-003 | 운영자 인증 서비스 고르기(비밀번호·2단계 인증을 맡길 곳) | 동희님 | 0.5일 | OPEN-6 | TASK-001 | 고른 서비스를 결정 카드 답 그대로 기록에 남김 |
| TASK-004 | 세션 길이 정하기(사장님 30일·운영자 12시간 제안) | 동희님 | 0.5일 | OPEN-5 | 없음 | 정한 길이를 결정 카드 답 그대로 기록에 남김 |
| TASK-005 | Anthropic에 보관 안 함(Zero Data Retention) 신청 | 동희님 | 0.5일 | DEC-25, REQ-266 | 없음 | 신청한 날과 회사의 답(허가·거절·기다림)을 기록에 남김. 허가 전에는 처리방침에 30일 보관(04 AI-1) |
| TASK-006 | OpenAI에 보관 안 함(Zero Data Retention) 신청 | 동희님 | 0.5일 | DEC-25, REQ-266 | 없음 | 신청한 날과 회사의 답(허가·거절·기다림)을 기록에 남김. 허가 전에는 처리방침에 30일 보관(04 AI-1) |
| TASK-007 | 카카오 시험 채널·오픈빌더 봇·카카오 디벨로퍼스 시험 앱 만들기 | 동희님 | 1일 | OPEN-1, OPEN-3, OPEN-9, OPEN-11 | 없음 | 시험 채널·봇·앱이 있고 그 ID와 키는 저장소 밖 비밀 저장소에만 둠(기록에는 만든 날과 이름만). Claude가 시험 서버를 스킬로 붙일 수 있음 |
| TASK-008 | 카카오 시험 서버와 시험 대본(받은 요청을 그대로 남기는 버리는 서버) | Claude | 1일 | OPEN-1, OPEN-2, OPEN-3, OPEN-4, OPEN-12 | 없음 | 시험 대본(보낼 말·누를 버튼·볼 값)이 있고, 받은 스킬 요청 본문을 손님 값은 가린 채 남기는 서버가 시험 주소에서 돎 |
| TASK-009 | 시험 채널에서 대본대로 보내고 누르기(메시지 ID·콜백·사진·빈 응답·봇 ID·먼저 보내기 권한·후기 extra·PKCE) | 동희님 | 1일 | OPEN-1, OPEN-2, OPEN-3, OPEN-4, OPEN-8, OPEN-9, OPEN-11, OPEN-12 | TASK-007, TASK-008 | 대본의 항목마다 해 본 날과 화면 사진이 남고, 시험 서버에 그 요청이 남음 |
| TASK-010 | 카카오에 스킬 요청의 출처 IP·서명 문의 | 동희님 | 0.5일 | OPEN-10 | 없음 | 문의한 날과 받은 답(없으면 '답 기다림')을 기록에 남김 |
| TASK-011 | 시험 결과로 04·05·06의 확인 전 가정 고치기와 열린 질문 닫기 | Claude | 2일 | OPEN-1, OPEN-2, OPEN-3, OPEN-4, OPEN-5, OPEN-6, OPEN-8, OPEN-9, OPEN-10, OPEN-11, OPEN-12 | TASK-009, TASK-010, TASK-003, TASK-004 | 가정마다 시험 결과를 적고, 맞지 않은 것은 SPEC·스키마·계약을 고치는 PR이 단계 검사를 모두 지나 합쳐짐. 06 열린 질문 표에서 답을 얻은 것을 닫음 |
| TASK-012 | 법령 원문 다시 확인(01 5-1 법령 표의 조문) | Claude | 1일 | REQ-239, REQ-240, REQ-141 | 없음 | 5-1 법령 표의 조문마다 국가법령정보센터 원문을 다시 열어 조문 번호·시행일을 대조하고, 바뀐 것을 고치는 PR이 합쳐짐 |
| TASK-013 | 법률 질문 목록을 전문가에게 확인(01 5-2) | 동희님 | 1일 | REQ-208 | TASK-012 | 5-2 질문마다 전문가의 답과 날짜를 기록에 남기고, 답으로 바뀌는 요구사항 목록을 Claude에게 넘김 |
| TASK-014 | 구글 클라우드 프로젝트와 OAuth 동의 화면(장부 연결) 만들기와 검증이 필요한지 확인 | 동희님 | 0.5일 | TBL-045 | 없음 | 동의 화면의 범위와 검증 상태(필요 없음·신청함·허가)를 기록에 남김 |
<!-- END generated:before-dev -->

- 비밀 값(카카오 앱 키, AI 회사 키, 구글 OAuth 클라이언트 비밀)은 저장소·기록·대화에 두지 않고 비밀 저장소에만 둡니다(REQ-135). 기록에는 만든 날과 이름만 남깁니다.

## 6. 기술 스택 후보와 추천

TASK-001의 첫 버전입니다. 아래 '확인한 사실'은 2026-11-15에 공식 문서를 열어 본 것만 적었고, 확인하지 않은 것(월 비용 범위, 카카오 5초 안 응답을 후보마다 잰 값)은 TASK-001에서 채웁니다. 고르는 일은 TASK-002(동희님)입니다.

### 6-1. 이미 정해진 조건(저장소 원본)

- 데이터베이스는 PostgreSQL 16입니다(05 `db/schema.sql`과 마이그레이션 0001~0020, 규칙 테스트를 PostgreSQL 16에서 돌림).
- 카카오 스킬 요청에 P99 4초 안에 답합니다(REQ-130, 카카오 제한 5초). AI 답이 늦으면 콜백으로 보냅니다(06 계약).
- AI 모델 호출은 한 곳에 모으고, 배포 설정으로 Anthropic이나 OpenAI 가운데 한 회사의 모델을 부릅니다(REQ-266, DEC-25).
- 손님 화면은 카카오톡 안(스킬 응답)이고, 사장님·운영자 화면은 웹(360·1280, 09 토큰)입니다.
- 운영 서버 월 가동률 99%와 1분마다 외부 감시(REQ-148), 하루 한 번 백업과 복구 시험(REQ-149), 비밀 값은 저장소·로그에 0건(REQ-135), 처리방침에 국외 이전 다섯 항목(REQ-141).
- 저장소의 생성·검사 도구는 Python 파일 54개이고, 브라우저로 화면을 재는 도구(page-check 등)는 JavaScript 파일 3개(Playwright)입니다(main `da7f7fc`의 `research/`).

### 6-2. 후보

언어와 배포를 나눠 봅니다.

| 언어 후보 | 서버 | 사장님·운영자 웹 | 좋은 점 | 걸리는 점 |
| --- | --- | --- | --- | --- |
| A. Python 서버 + TypeScript 웹 (추천) | Python, FastAPI(비동기) | TypeScript, React | 생성·검사 도구가 이미 Python이라 서버 시험과 AI 평가 도구(TASK-027)를 같은 언어로 씀. 두 AI 회사 모두 Python 공식 SDK가 있음 | 언어가 둘이라 한 사람이 둘을 유지하고, 계약에서 만드는 타입도 두 언어로 만듦 |
| B. TypeScript 하나 | TypeScript, Node | TypeScript, React | 서버·웹·화면 재는 도구(Playwright)가 한 언어. 두 AI 회사 모두 TypeScript 공식 SDK가 있음 | 지금 Python으로 된 생성·검사 도구와 AI 평가 도구가 서버와 다른 언어로 남음 |

| 배포 후보 | 서버 | PostgreSQL 16 | 서울 리전 | 월 비용 범위 |
| --- | --- | --- | --- | --- |
| 1. Google Cloud | Cloud Run(컨테이너) | Cloud SQL for PostgreSQL이 PostgreSQL 16을 지원 | Cloud Run·Cloud SQL 모두 asia-northeast3(서울) | TASK-001 |
| 2. AWS | Amazon ECS on AWS Fargate(컨테이너) | Amazon RDS for PostgreSQL 16.x | ap-northeast-2(Asia Pacific (Seoul)), Fargate도 지원 | TASK-001 |
| 3. Supabase + 컨테이너 서버 | 1이나 2의 컨테이너 | Supabase의 PostgreSQL(16 지원은 확인하지 않음) | Supabase 리전 Northeast Asia (Seoul) ap-northeast-2 | TASK-001 |

- 카카오 5초 안 응답: 세 배포 후보 모두 서울 리전이라 카카오 서버와의 거리는 비슷할 것으로 봅니다(가설, 재지 않음). 고른 스택으로 TASK-164(스테이징 부하 시험)가 P99 4초를 잽니다.

### 6-3. 추천과 반론

- 추천: 언어는 A(Python FastAPI 서버 + TypeScript React 웹), 배포는 TASK-001에서 월 비용 범위를 공식 가격표로 확인한 뒤 1~3 가운데 추천합니다.
- 이유: ① 계약·규칙·화면 검사와 생성기가 이미 Python이라, 서버 시험과 AI 평가 세트 도구(TASK-027)를 같은 언어로 붙일 수 있습니다. ② 두 AI 회사 모두 Python 공식 SDK가 있어 모델 호출 한 곳(TASK-026)에 두 어댑터를 같은 모양으로 둘 수 있습니다. ③ FastAPI는 `async def` 경로 함수를 지원해, 카카오 스킬 응답과 AI 호출을 기다리는 동안 다른 요청을 받을 수 있습니다.
- 반론(B 쪽): 서버와 웹을 TypeScript 하나로 하면 한 사람이 유지할 언어가 하나로 줄고, 계약에서 만든 타입을 서버와 웹이 함께 씁니다. ②와 ③은 B도 같습니다(두 회사 모두 TypeScript 공식 SDK가 있고, Node도 비동기). 그래서 A의 실제 이점은 ① 하나이고, 그것이 언어 둘을 유지하는 값보다 큰지가 고를 점입니다.

### 6-4. 확인한 사실(2026-11-15, 공식 문서)

| 사실 | 출처 |
| --- | --- |
| Anthropic 공식 SDK: Python, TypeScript, Java, Go, Ruby, PHP, C# | https://platform.claude.com/docs/en/cli-sdks-libraries/overview (`docs.anthropic.com/en/api/client-sdks`에서 옮겨 감) |
| OpenAI 공식 Python 라이브러리, Python 3.10 이상 | https://github.com/openai/openai-python (README) |
| OpenAI 공식 TypeScript·JavaScript 라이브러리 | https://github.com/openai/openai-node (README) |
| FastAPI는 `async def` 경로 함수를 지원 | https://fastapi.tiangolo.com/async/ |
| AWS 리전 ap-northeast-2 = Asia Pacific (Seoul) | https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html |
| Amazon RDS for PostgreSQL 릴리스 노트에 16.x(16.2~16.15)가 있음 | https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html |
| Amazon ECS on AWS Fargate가 Asia Pacific (Seoul)을 지원 | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate-Regions.html |
| Cloud Run 리전 asia-northeast3 (Seoul, South Korea) | https://docs.cloud.google.com/run/docs/locations |
| Cloud SQL for PostgreSQL이 PostgreSQL 16(16.15)을 지원 | https://docs.cloud.google.com/sql/docs/postgres/db-versions |
| Cloud SQL 리전 asia-northeast3(서울) | https://docs.cloud.google.com/sql/docs/postgres/locations |
| Supabase 리전 Northeast Asia (Seoul), ap-northeast-2 | https://supabase.com/docs/guides/platform/regions |

- 확인하지 않은 것: 후보마다 월 비용 범위, Supabase의 PostgreSQL 16 지원, 후보마다 카카오 스킬 응답 시간, 운영자 인증 서비스 후보(TASK-003), 웹 프레임워크 React와 그 밖의 후보 비교.

## 7. 검사

`python3 -I research/cake-wbs-2026-11/build_wbs.py .`가 아래 검사를 하고, 마지막 줄에 '검사 n개 · 오류 m'을 적습니다. 오류가 있거나 생성 파일이 원본과 다르면 종료 코드 1입니다. `--write`를 붙이면 생성 파일을 다시 쓰고 검사합니다. 01~09단계 검사와 함께 `checks.sh`에서 `wbs`로 돌립니다.

<!-- BEGIN generated:checks -->
1. 작업 ID 꼴·차례·중복
2. 수락 기준 배정(SPEC마다 #1~#n이 한 작업 이상)
3. 스킬 결과(카카오 스킬 API 넷의 결과 코드)마다 작업
4. 출처·닿는 ID가 원본에 있음
5. SPEC 79개마다 작업
6. API마다 만드는 작업
7. 화면마다 작업과 08 상태, 화면이 부르는 API마다 기다리는 화면 작업
8. 테이블마다 작업
9. 앱 규칙 A·공통 규칙 G마다 작업
10. 열린 질문 OPEN마다 작업
11. SPEC 밖 유효 요구사항마다 작업
12. 맡은 이 하나·크기·끝난 조건·반복
13. 앞선 작업: 없는 ID·자기 자신·고리·반복 거꾸로
14. 금지어(01 용어집, 02·03 검사와 같은 허용 꼴)와 옛 용어(08·09 검사와 같은 목록): 작업·반복 설명·README의 손으로 쓴 글
15. 생성 파일이 원본과 같음
<!-- END generated:checks -->

결과(2026-11-15):

- `build_wbs.py .`(16:57 KST): '검사 15개 · 오류 0'. 1절과 같은 수의 줄을 냅니다.
- `checks.sh`(@@T_CHECKS@@ KST 시작, 이 PR의 머리): @@CHECKS@@
- CORTHEX 허브 스냅숏(`hub.py snapshot`, 16:55 KST, 이 가지와 main `da7f7fc`): 항목 562 → 731(작업 169개를 읽음). 알림은 main의 경고 2·정보 1에 'SPEC을 잇지 않은 작업' 경고 30개가 더해졌습니다(오류 0). 반복 0의 확인·결정 작업 14개, 반복 1의 바탕 작업 9개(TASK-015~018·023·025~027·029), 반복 8의 출시 준비 7개(TASK-162·163·165~169)입니다. 이 작업들은 SPEC 행이 아니라 요구사항·열린 질문·결정·규칙에서 나와 그대로 둡니다.

## 8. 관리 방법

- 원본은 [`wbs_rows.py`](../../research/cake-wbs-2026-11/wbs_rows.py)입니다. 작업을 더하고 고치고 없애는 것은 원본에서만 하고, `python3 -I research/cake-wbs-2026-11/build_wbs.py . --write`로 `wbs.md`와 이 README의 생성 절을 다시 만듭니다.
- 01~09단계 원본이 바뀌면 생성기를 다시 돌립니다. 응답 코드·수락 기준·화면 상태 줄은 자동으로 맞고, 새 SPEC·API·화면·테이블·규칙을 맡은 작업이 없거나 원본에 없는 ID를 쓰면 검사가 오류를 냅니다.
- 사람이 보는 곳은 Notion 작업 데이터베이스(작업 한 행, 상태 보드)입니다. 2026-11-15 동희님 지시(기록은 저장소에, Notion은 마지막에 한 번)에 따라 이 일의 끝에 한 번 올리고, 저장소 원본이 이깁니다(`.corthex/project.json`의 `10-wbs`, truth `source`). 원본을 먼저 고치고 보드를 고치며, 보드는 다시 읽어 원본과 견준 뒤에 맞췄다고 적습니다. 없앤 작업은 보드에서도 지우지 않고 상태에 '없앰'과 날짜를 둡니다.
- CORTHEX 기본값인 GitHub Projects를 쓰지 않는 이유: 이 작업 세션에는 GitHub Projects를 다루는 도구가 없고, 위 지시로 사람이 보는 곳을 Notion으로 둡니다.
- 개발이 시작되면(11단계) PR 제목이나 본문에 TASK ID를 적어 작업과 PR을 잇습니다.

## 9. 체크포인트

동희님께 확인받을 것은 둘입니다. 답은 결정 카드로 받고, 받으면 말 그대로 이 절과 진행 기록에 적습니다.

1. 반복 계획: 반복 0~8의 나눔과 차례(4절), 반복 0의 동희님 몫(5절)으로 가도 될지. 다음 할 일은 아래와 같습니다.
   - 반복 0: Claude가 TASK-001(스택 비교 마무리: 월 비용 범위)·TASK-008(카카오 시험 서버와 대본)·TASK-012(법령 원문 다시 확인)를 먼저 하고, 동희님 몫(TASK-002~007·009·010·013·014)을 결정 카드와 체크리스트로 드립니다.
   - 반복 1: 스택을 고르면 TASK-015부터 뼈대(저장소와 CI, 스테이징, 마이그레이션, 공통 요청 처리, 가게 나누기, 로그인, 카카오 스킬 받기, 모델 호출, 평가 세트, 웹 바탕)를 만듭니다.
2. 기술 스택: 언어를 6절의 추천 A(Python 서버 + TypeScript 웹)로 할지 B(TypeScript 하나)로 할지. 배포 회사는 TASK-001의 비용 확인 뒤 TASK-002에서 고릅니다.

## 10. 확정한 뒤 고친 것

아직 없습니다. 동희님이 확인하신 뒤 고치면 아래 표에 적습니다.

| 날짜 | 고친 것 | 이유와 근거 | PR |
| --- | --- | --- | --- |
