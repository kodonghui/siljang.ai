# 10단계 WBS

<!-- build_wbs.py가 research/cake-wbs-2026-11/wbs_rows.py에서 생성. 손으로 고치지 않음 -->

작업 181개 · 크기 합 245.5일 · 반복 10개 · 동희님 17개 · Claude 164개 · SPEC 79개 · 수락 기준 328개 · API 83개 · 화면 50개(상태 367개, 09에서 그린 161개, 그리지 않은 206개) · 테이블 58개 · 앱 규칙 40개 · 공통 규칙 9개 · 열린 질문 10개 · 끝난 작업 12개.

읽는 법과 나눈 방식은 [README](README.md)에 있습니다. '닿는 것'은 만드는 API, 쓰고 읽는 테이블, 만드는 화면입니다. '끝난 조건'의 첫 줄은 손으로 쓴 조건이고, 수락 기준·응답 코드·스킬 결과·화면 상태·응답 행·규칙 줄은 원본에서 생성합니다. 화면 작업의 앞선 작업에는 그 화면이 부르는 API를 만드는 작업이 자동으로 들어갑니다. 끝난 작업은 끝난 조건 맨 앞에 '끝남'과 끝난 날·증거가 붙습니다.

| 반복 | 이름 | 작업 | 크기 합(일) | 동희님 | Claude |
| --- | --- | --- | --- | --- | --- |
| 0 | 개발 전 확인 | 17 | 13.5 | 12 | 5 |
| 1 | 뼈대 | 20 | 29 | 0 | 20 |
| 2 | 가게 준비 | 31 | 43 | 0 | 31 |
| 3 | AI 상담과 주문 요청 | 28 | 44.5 | 0 | 28 |
| 4 | 결제와 주문 확정 | 25 | 35.5 | 0 | 25 |
| 5 | 변경·취소·환불 | 16 | 22 | 0 | 16 |
| 6 | 제작·인도·문제 신고·후기 | 24 | 30 | 0 | 24 |
| 7 | 장부·지우기·운영자 | 6 | 13 | 0 | 6 |
| 8 | 출시 준비와 12단계 준비 | 9 | 10 | 2 | 7 |
| 9 | 스토어 앱 | 5 | 5 | 3 | 2 |

가장 긴 앞선 작업 줄(차례대로만 할 수 있는 작업의 크기 합): 43.5일, 작업 26개(TASK-001 → TASK-002 → TASK-015 → TASK-017 → TASK-018 → TASK-020 → TASK-032 → TASK-038 → TASK-067 → TASK-069 → TASK-071 → TASK-078 → TASK-079 → TASK-083 → TASK-091 → TASK-092 → TASK-093 → TASK-094 → TASK-095 → TASK-097 → TASK-132 → TASK-136 → TASK-139 → TASK-140 → TASK-141 → TASK-142).

## 반복 0. 개발 전 확인

개발을 막는 확인과 결정입니다. 끝나면 기술 스택이 정해지고, 카카오·AI 회사에 대한 확인 전 가정이 시험 결과로 바뀝니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-001 | 기술 스택·배포 환경 후보 비교(공식 문서로 확인) | REQ-130, REQ-135, REQ-141, REQ-148, REQ-149 | 없음 | 없음 | Claude | 1일 | 끝남: 2026-11-15, docs/10-wbs/tech-stack.md(기술 스택 제안)<br/>tech-stack.md에 스택을 정하는 요구사항(ID)과 후보마다 서버·웹·PostgreSQL 운영·서울 리전·자동으로 하는 일·사진 저장·월 비용 범위(공식 가격표)·두 AI 회사 공식 SDK를 공식 문서 주소와 확인 날짜로 적고, 추천과 반론을 둠. 카카오 스킬 응답 시간은 서버가 없어 재지 못해 TASK-171(개발 전 시험)과 TASK-164(부하 시험)로 넘김 |
| TASK-002 | 기술 스택·배포 환경 고르기 | REQ-130, REQ-141 | 없음 | TASK-001 | 동희님 | 0.5일 | 끝남: 2026-11-15 18:31 무렵 동희님 결정 카드 '추천안대로 (추천)', docs/records/progress.md<br/>결정 카드에서 고른 답을 말 그대로 docs/records/progress.md에 남김 |
| TASK-003 | 운영자 인증 서비스 고르기(비밀번호·2단계 인증을 맡길 곳) | OPEN-6 | 없음 | TASK-001 | 동희님 | 0.5일 | 고른 서비스를 결정 카드 답 그대로 기록에 남김 |
| TASK-004 | 세션 길이 정하기(사장님 30일·운영자 12시간 제안) | DEC-26 | 없음 | 없음 | 동희님 | 0.5일 | 끝남: 2026-11-15 17시 무렵 동희님 결정 카드 '제안대로 (추천)', 06 DEC-26<br/>정한 길이를 결정 카드 답 그대로 기록에 남김 |
| TASK-005 | Anthropic에 보관 안 함(Zero Data Retention) 신청 | DEC-25, REQ-266 | 없음 | 없음 | 동희님 | 0.5일 | 신청한 날과 회사의 답(허가·거절·기다림)을 기록에 남김. 허가 전에는 처리방침에 30일 보관(04 AI-1) |
| TASK-006 | OpenAI에 보관 안 함(Zero Data Retention) 신청 | DEC-25, REQ-266 | 없음 | 없음 | 동희님 | 0.5일 | 신청한 날과 회사의 답(허가·거절·기다림)을 기록에 남김. 허가 전에는 처리방침에 30일 보관(04 AI-1) |
| TASK-007 | 카카오 시험 채널·오픈빌더 봇·카카오 디벨로퍼스 시험 앱 만들기 | OPEN-1, OPEN-3, OPEN-9, OPEN-11 | 없음 | 없음 | 동희님 | 1일 | 시험 채널·봇·앱이 있고 그 ID와 키는 저장소 밖 비밀 저장소에만 둠(기록에는 만든 날과 이름만). Claude가 시험 서버를 스킬로 붙일 수 있음 |
| TASK-008 | 카카오 시험 서버와 시험 대본(받은 요청을 그대로 남기는 버리는 서버) | OPEN-1, OPEN-2, OPEN-3, OPEN-4, OPEN-12 | 없음 | 없음 | Claude | 1일 | 시험 대본(보낼 말·누를 버튼·볼 값)이 있고, 받은 스킬 요청 본문을 손님 값은 가린 채 남기는 서버가 시험 주소에서 돎 |
| TASK-009 | 시험 채널에서 대본대로 보내고 누르기(메시지 ID·콜백·사진·빈 응답·봇 ID·먼저 보내기 권한·후기 extra·PKCE) | OPEN-1, OPEN-2, OPEN-3, OPEN-4, OPEN-8, OPEN-9, OPEN-11, OPEN-12 | 없음 | TASK-007, TASK-008 | 동희님 | 1일 | 대본의 항목마다 해 본 날과 화면 사진이 남고, 시험 서버에 그 요청이 남음 |
| TASK-010 | 카카오에 스킬 요청의 출처 IP·서명 문의 | OPEN-10 | 없음 | 없음 | 동희님 | 0.5일 | 문의한 날과 받은 답(없으면 '답 기다림')을 기록에 남김 |
| TASK-011 | 시험 결과로 04·05·06의 확인 전 가정 고치기와 열린 질문 닫기 | OPEN-1, OPEN-2, OPEN-3, OPEN-4, OPEN-6, OPEN-8, OPEN-9, OPEN-10, OPEN-11, OPEN-12 | 없음 | TASK-009, TASK-010, TASK-003, TASK-004 | Claude | 2일 | 가정마다 시험 결과를 적고, 맞지 않은 것은 SPEC·스키마·계약을 고치는 PR이 단계 검사를 모두 지나 합쳐짐. 06 열린 질문 표에서 답을 얻은 것을 닫음 |
| TASK-012 | 법령 원문 다시 확인(02 4-2 법 표의 조문) | REQ-239, REQ-240, REQ-141 | 없음 | 없음 | Claude | 1일 | 끝남: 2026-11-15, docs/02-prd/requirements.md 13절(조문 36개 대조, 원문과 어긋난 인용 없음, 빠진 조건 2곳 고침)<br/>02 4-2 법 표의 조문마다 국가법령정보센터 원문을 다시 열어 조문 번호·시행일을 대조하고, 바뀐 것을 고치는 PR이 합쳐짐 |
| TASK-013 | 법률 질문 목록을 전문가에게 확인(02 5-2와 tech-stack.md 8-2) | REQ-208 | 없음 | TASK-012 | 동희님 | 1일 | 02 5-2 질문 10개와 tech-stack.md 8-2의 호스팅 질문마다 전문가의 답과 날짜를 기록에 남기고, 답으로 바뀌는 요구사항 목록을 Claude에게 넘김 |
| TASK-014 | 구글 클라우드 프로젝트와 OAuth 동의 화면(장부 연결) 만들기와 검증이 필요한지 확인 | TBL-045 | 없음 | 없음 | 동희님 | 0.5일 | 동의 화면의 범위와 검증 상태(필요 없음·신청함·허가)를 기록에 남김 |
| TASK-170 | Cloudflare·Supabase 계정과 개발 프로젝트 만들기(추천안 기준) | REQ-135, REQ-141 | 없음 | TASK-002 | 동희님 | 0.5일 | Cloudflare 계정에 Workers 유료 플랜(월 5달러)을 켜고, Supabase 조직에 서울(ap-northeast-2) 개발 프로젝트를 무료 등급으로 만듦. 연결 문자열과 키는 저장소 밖 비밀 저장소에만 두고 기록에는 만든 날·리전·플랜 이름만 남김. 스택을 다르게 고르면 이 작업은 없앰 |
| TASK-171 | 추천 플랫폼 시험: Workers에서 Hyperdrive로 Supabase 서울에 붙여 보기(추천안 기준) | REQ-130, REQ-131 | 없음 | TASK-170 | Claude | 1일 | tech-stack.md 8-1의 시험 항목(직결 연결 문자열로 연결, 트랜잭션과 행 잠금, btree_gist와 마이그레이션 0001~0020·규칙 테스트, 읽기 캐시 끔, 한국에서 보낸 요청을 처리한 데이터센터와 왕복 시간, Cron Trigger와 Queues 한 번씩, Supabase Storage 비공개 버킷의 S3 호환 주소에서 사진 저장소 모듈(app/server의 S3Store)의 넣기·보기·읽기·복사·지우기·목록 한 번씩)마다 결과와 확인 날짜를 남기고, 실패한 항목은 다른 후보로 바꿀지 동희님께 확인 요청으로 올림. 지연 측정 스크립트를 TASK-172에 넘김 |
| TASK-172 | OVH 서버(뭄바이·싱가포르)에서 지연 측정 스크립트 돌리기(추천안 기준) | REQ-148 | 없음 | TASK-171 | 동희님 | 0.5일 | Claude가 준 스크립트의 출력(서울의 Supabase와 Cloudflare까지 왕복 시간)을 기록에 붙임. 서버 주소와 계정은 적지 않음. 이 결과로 1분 외부 감시(TASK-016)를 OVH 서버에 둘지 고름 |

## 반복 1. 뼈대

뼈대입니다. 끝나면 스테이징에서 사장님·운영자가 로그인하고, 시험 채널의 손님 메시지가 우리 서버에 닿아 가게별로 남고, 같은 평가 세트를 두 AI 회사 모델에 돌릴 수 있습니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-015 | 개발 저장소 뼈대: 고른 스택, 린트·테스트·CI, 비밀 값은 환경 변수로 | REQ-135 | 없음 | TASK-002 | Claude | 2일 | 끝남: 2026-11-15, app/와 .github/workflows/app.yml(PR #58, GitHub Actions에서 린트·타입 검사·시험·빌드·저장소와 로그 키 검사 통과)<br/>빈 서버와 웹이 CI에서 린트·시험을 지나고, 저장소와 로그에 키가 없음을 검사하는 단계가 CI에 있음 |
| TASK-016 | 스테이징 배포와 외부 감시 | REQ-148 | 없음 | TASK-015 | Claude | 1일 | main에 합치면 스테이징에 배포되고, 외부 감시가 1분마다 확인해 멈추면 알림이 옴. 서버 안의 일 실행기의 실패 로그(job_run_failed·job_find_failed 등, ID만 실음, 앱 README 44)가 생기면 운영자에게 알림이 옴 |
| TASK-017 | 마이그레이션 0001~0020 적용과 규칙 테스트를 CI에서 | G3 | TBL-001, TBL-002, TBL-003, TBL-004, TBL-005, TBL-006, TBL-007, TBL-008, TBL-009, TBL-010, TBL-011, TBL-012, TBL-013, TBL-014, TBL-015, TBL-016, TBL-017, TBL-018, TBL-019, TBL-020, TBL-021, TBL-022, TBL-023, TBL-024, TBL-025, TBL-026, TBL-027, TBL-028, TBL-029, TBL-030, TBL-031, TBL-032, TBL-033, TBL-034, TBL-035, TBL-036, TBL-037, TBL-038, TBL-039, TBL-040, TBL-041, TBL-042, TBL-043, TBL-044, TBL-045, TBL-046, TBL-047, TBL-048, TBL-049, TBL-050, TBL-051, TBL-052, TBL-053, TBL-054, TBL-055, TBL-056, TBL-057, TBL-058 | TASK-015 | Claude | 1일 | 끝남: 2026-11-15, .github/workflows/db.yml(PR #59, GitHub Actions의 PostgreSQL 16.15에서 마이그레이션 20개를 차례로 적용하고 규칙 테스트 324개와 05 검사 15개 통과)<br/>CI에서 PostgreSQL 16에 마이그레이션 20개를 차례로 적용하고 05 규칙 테스트가 모두 통과<br/>04 공통 규칙(G3)을 지키는지 보는 시험 |
| TASK-018 | 공통 요청 처리: 요청 키로 같은 요청 한 번, 오류 응답 꼴, 내부 오류를 응답에 싣지 않음 | G2, G6, G8, G9 | TBL-050, TBL-051 | TASK-017 | Claude | 2일 | 끝남: 2026-11-16, app/server(PR #60, GitHub Actions의 app 작업이 PostgreSQL 16.15에 마이그레이션 20개를 적용하고 06 오류 코드 37개·필드 오류 사유 24개의 계약 모양 시험, 요청 키 시험, G2·G6·G8·G9 시험 등 서버 시험 155개 통과)<br/>06 오류 코드 37개와 필드 오류 사유 24개가 계약의 모양으로 나가는 시험, 같은 요청 키를 두 번 보내면 처음 결과를 돌려주는 시험<br/>04 공통 규칙(G2·G6·G8·G9)을 지키는지 보는 시험 |
| TASK-019 | 가게별 기록 나누기 공통 계층(모든 읽기·쓰기에 가게 조건) | SPEC-068, REQ-134, A9, G1 | TBL-003, TBL-004, TBL-016, TBL-017, TBL-019, TBL-023, TBL-031, TBL-048 | TASK-018 | Claude | 1일 | 끝남: 2026-11-16, app/server(PR #61, GitHub Actions의 app 작업이 PostgreSQL 16.15에 마이그레이션 20개를 적용하고 교차 가게 시험 묶음(다른 가게 ID·없는 ID·형식이 틀린 ID가 같은 404·422, 두 가게의 기록 그대로)과 등록 완결 시험, SPEC-068 수락 기준 1·2, 05 A9·E1, 04 G1, 가게 조건 정적 시험 등 서버 시험 312개 통과)<br/>다른 가게의 ID로 부른 요청이 404이고 남는 기록이 0인 교차 가게 시험 묶음이 있고, 새 API가 생길 때마다 이 묶음에 들어감<br/>SPEC-068 수락 기준 #1~#2: 자동 시험 통과<br/>05 앱 규칙(A9)을 지키는지 보는 서버 시험<br/>04 공통 규칙(G1)을 지키는지 보는 시험 |
| TASK-020 | 사장님 카카오 로그인·로그아웃·내 정보 | SPEC-001, DEC-26 | API-078, API-001, API-002, API-003, TBL-001, TBL-002, TBL-003 | TASK-018, TASK-011 | Claude | 2일 | 세션은 마지막으로 쓴 때부터 30일 동안 유지하고 쓸 때마다 다시 30일로 늘림(DEC-26). 늘리는 방법(같은 쿠키를 다시 보내는 때)을 정하고 시험함<br/>SPEC-001 수락 기준 #1~#4: 자동 시험 통과<br/>API-078 응답(200·422·429·default)마다 통과하는 시험<br/>API-001 응답(200·401·422·429·503·default)마다 통과하는 시험<br/>API-002 응답(200·401·default)마다 통과하는 시험<br/>API-003 응답(204·default)마다 통과하는 시험 |
| TASK-021 | 운영자 로그인(이메일·비밀번호·2단계 인증) | SPEC-001, DEC-26 | API-004, API-005, API-006, TBL-001, TBL-002, TBL-003 | TASK-018, TASK-003 | Claude | 1일 | 세션은 로그인한 때부터 12시간이 지나면 끝나고 쓴다고 늘지 않음(DEC-26)<br/>SPEC-001 수락 기준 #5: 자동 시험 통과<br/>API-004 응답(200·401·422·429·default)마다 통과하는 시험<br/>API-005 응답(200·401·default)마다 통과하는 시험<br/>API-006 응답(204·default)마다 통과하는 시험 |
| TASK-022 | 사진 올리기(신고증·도안·완성 사진): 크기·형식·장수 | SPEC-002, SPEC-004, SPEC-053, A11 | API-007, TBL-003, TBL-006, TBL-007, TBL-008, TBL-009, TBL-024, TBL-027, TBL-035, TBL-037, TBL-040, TBL-044, TBL-050, TBL-054 | TASK-018 | Claude | 1일 | 끝남: 2026-11-16, app/server(PR #62, GitHub Actions의 app 작업이 PostgreSQL 16.15에 마이그레이션 20개를 적용하고 API-007 응답(201·401·413·422·429·503·default)마다의 계약 시험, 05 A11 사진 장수 시험(신고·완성·후기 사진의 5장과 순서 겹침은 데이터베이스가 막고 참고 사진의 상담마다 10장은 앱이 셈), 다른 사장님의 uploadId가 없는 ID와 같은 upload_not_found인 시험, 저장소 모듈·15분 서명 주소 시험 등 서버 시험 391개 통과)<br/>API-007 응답(201·401·413·422·429·503·default)마다 통과하는 시험<br/>05 앱 규칙(A11)을 지키는지 보는 서버 시험 |
| TASK-023 | 자동으로 하는 일 실행기: 정한 시각·다시 하기·이벤트 키로 한 번만 | A33 | TBL-051 | TASK-018 | Claude | 2일 | 끝남: 2026-11-16, app/server(PR #64, GitHub Actions의 app 작업이 PostgreSQL 16.15에 마이그레이션 20개를 적용하고 같은 이벤트 키를 일곱 테이블마다 차례로·동시에 두 번 넣어 한 행인 시험, 키로 넣은 일이 실행기 두 번·연결 둘에서 한 번만 돌고 겹친 실행기 둘이 행마다 한 번씩 처리하는 시험, 던진 행·연결이 끊긴 행·임대한 채 멈춘 행을 새 실행기가 한 번씩 잇는 시험, 06 서버 안의 일 13개와 등록부를 견주는 시험과 05 부분 인덱스와 찾기를 견주는 시험 등 서버 시험 522개 통과)<br/>06 서버 안의 일 13개가 쓸 실행기에서 같은 이벤트 키를 두 번 넣어도 한 번만 돌고, 서버를 다시 띄워도 기다리던 일이 이어지는 시험<br/>05 앱 규칙(A33)을 지키는지 보는 서버 시험 |
| TASK-024 | 접속기록 남기기 공통(손님 개인정보를 읽고 쓸 때) | SPEC-074, A24 | TBL-053 | TASK-018 | Claude | 1일 | SPEC-074 수락 기준 #1~#3: 자동 시험 통과<br/>05 앱 규칙(A24)을 지키는지 보는 서버 시험 |
| TASK-025 | 계좌번호·원래 값 암호화와 마스킹한 값 저장 | A23, A15 | TBL-015, TBL-019, TBL-033 | TASK-018 | Claude | 1일 | 끝남: 2026-11-16, app/server(PR #63, GitHub Actions의 app 작업이 PostgreSQL 16.15에 마이그레이션 20개를 적용하고 가게 계좌·환불 계좌·대화 속 번호를 쓴 뒤 데이터베이스의 모든 기본 테이블에 평문(숫자만인 꼴과 하이픈을 넣은 꼴)이 0건인 시험, 키 버전을 바꿔도 앞 봉투가 읽히고 새 봉투는 지금 버전인 시험, 05 A23 봉투 시험(05 CHECK와 같은 꼴, 다른 가게·다른 쓰는 곳·바뀐 암호문은 거절)과 A15 마스킹한 값 시험(종류별 저장, 같은 값은 같은 플레이스홀더, 동시에 온 번호) 등 서버 시험 433개 통과)<br/>계좌번호와 원래 값이 데이터베이스에 평문으로 남지 않는 시험, 키를 바꿔도 읽히는 시험<br/>05 앱 규칙(A23·A15)을 지키는지 보는 서버 시험 |
| TASK-026 | 모델 호출 한 곳: 두 회사(Anthropic·OpenAI) 어댑터, 배포 설정으로 고름, 호출마다 모델·토큰·금액 기록 | REQ-266, DEC-25, REQ-138 | TBL-048 | TASK-018 | Claude | 2일 | 끝남: 2026-11-16, app/server(PR #65, GitHub Actions의 app 작업이 PostgreSQL 16.15에 마이그레이션 20개를 적용하고 같은 입력을 설정만 바꿔 두 회사 모델(모의 스트림)에 보내 같은 AiTurnOutput과 회사·모델·토큰·금액이 남은 ai_calls 행을 보는 시험, 실패·시간 초과·키 없음·끝 사용량 없음도 한 행씩 남는 시험, 06 AiTurnOutput과 견주는 시험, 운영 설정에서 추적 주소로 가는 요청이 0이고 추적을 켜면 모델을 호출하지 않는 시험 등 서버 시험 567개 통과. 진짜 키로 부르기는 TASK-027)<br/>같은 입력을 설정만 바꿔 두 회사 모델(모의 응답)에 보내는 시험, 호출마다 ai_calls에 회사·모델·토큰·금액이 남는 시험, AI 출력 모양(AiTurnOutput)이 회사와 상관없이 같음, 운영 설정에서 추적 도구가 꺼짐 |
| TASK-027 | AI 평가 세트(합성 상담 100개 이상)와 채점·두 회사로 돌리는 도구 | REQ-145, REQ-139 | 없음 | TASK-026 | Claude | 3일 | 합성 상담 100개 이상이 있고 실제 손님 대화가 없음을 출처 점검표로 보임, REQ-145의 잣대(틀린 금액 등)마다 채점, 한 명령으로 두 회사 모델에 돌려 결과 표가 나옴 |
| TASK-028 | 카카오 스킬 받기 공통: 스킬 키 확인, 요청 키, 4초 안 응답과 콜백, 카카오 응답 꼴 | SPEC-017, G4, G5 | API-070, API-071, API-072, API-073, TBL-003, TBL-004, TBL-016, TBL-017, TBL-018, TBL-027, TBL-048, TBL-051 | TASK-018, TASK-011 | Claude | 2일 | SPEC-017 수락 기준 #1~#2·#6: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 callback_pending·ai_unavailable·ai_timeout·ai_key_missing·ai_limit_reached·ai_cost_limit_reached·unsupported_message·rate_limited·duplicate·not_accepting·server_error<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 not_accepting·server_error<br/>API-072 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 duplicate·not_accepting·server_error<br/>API-073 응답(200·401·422·default)마다 통과하는 시험<br/>04 공통 규칙(G4·G5)을 지키는지 보는 시험 |
| TASK-029 | 사장님·운영자 웹 바탕: 09 토큰, 공통 상태, 확인 창, 필드 옆 오류 | REQ-147, G7 | 없음 | TASK-015 | Claude | 2일 | 09 design/base.tokens.json을 그대로 쓰고, 공통 상태(불러오는 중·빈·오류·권한·오래됨·보내는 중·됨)와 확인 창·필드 오류 부품이 360·1280에서 page-check 통과, 360px에서 가로 스크롤 없음<br/>04 공통 규칙(G7)을 지키는지 보는 시험 |
| TASK-030 | SCR-014 사장님 로그인 화면 | SPEC-001 | SCR-014 | TASK-029, TASK-020 | Claude | 1일 | SCR-014 상태 4개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 2개(normal·error)와 그리지 않은 2개(loading·rate-limited)는 08 와이어프레임과 09 토큰으로, 08 응답 행 12개마다 정한 상태로 보임 |
| TASK-031 | SCR-046 운영자 로그인 화면 | SPEC-001 | SCR-046 | TASK-029, TASK-021 | Claude | 1일 | SCR-046 상태 4개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 2개(normal·error)와 그리지 않은 2개(rate-limited·submitting)는 08 와이어프레임과 09 토큰으로, 08 응답 행 5개마다 정한 상태로 보임 |
| TASK-173 | Workers 서버 설정: Hyperdrive(읽기 캐시 끔)·Queues·Cron Trigger·서울 가까이 두기·비밀 값(추천안 기준) | REQ-130, REQ-135 | 없음 | TASK-015, TASK-171 | Claude | 1일 | wrangler 설정에 Hyperdrive 바인딩(캐시 끔)·큐와 소비자·1분 Cron Trigger·서울 리전 배치 힌트를 두고, 사장님·운영자 웹은 같은 Worker의 정적 자산으로 냄. 스테이징에서 요청 하나가 데이터베이스에 쓰고, 큐 메시지(ID만 실음)가 소비되고, Cron이 작업 표를 읽는 시험이 지남. 비밀 값은 wrangler secret으로만 넣고 저장소에는 이름만. 스테이징의 계좌번호 암호화 키(FIELD_KEY_CURRENT·FIELD_KEY_V1, 앱 README 32)를 넣고 사본을 저장소 밖 비밀 저장소에 둠 |
| TASK-174 | Supabase에 맞추기: CI에 PostgreSQL 17, Data API 끄기, 서버 전용 데이터베이스 역할(추천안 기준) | REQ-134, REQ-135 | 없음 | TASK-017, TASK-170 | Claude | 1일 | CI가 마이그레이션 20개와 규칙 테스트를 PostgreSQL 16과 17에서 돌림. 스테이징 데이터베이스에도 CI와 같은 판의 마이그레이션을 적용하고 적용한 판을 남김(2026-11-15 TASK-017에서 옮김). Supabase 프로젝트의 Data API를 끄고 publishable·secret 키를 서버와 웹 어디에도 쓰지 않으며, 서버는 필요한 표 권한만 가진 역할로 붙는 것을 점검표로 남김 |
| TASK-176 | 사장님 웹앱 홈 화면 설치(PWA): 매니페스트·아이콘·서비스 워커 | REQ-267 | 없음 | TASK-029 | Claude | 1일 | 매니페스트(name·short_name, 아이콘 192·512px, start_url, display standalone)가 모든 화면에 걸리고, 서비스 워커는 정적 파일만 저장하고 API 응답은 저장하지 않음. Chromium 설치 조건(tech-stack.md 9-1)을 자동 시험으로 보고, 동희님 휴대폰에서 홈 화면에 추가해 주소창 없이 열리는 화면 사진을 남김 |

## 반복 2. 가게 준비

가게 준비입니다. 끝나면 사장님이 가게를 등록하고 가격표·운영규정·결제 수단·영업 캘린더·채널 연결을 마쳐 예약 링크가 나오고, 운영자가 영업 신고를 확인합니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-032 | 가게 등록과 내 가게 조회 | SPEC-002 | API-008, API-009, TBL-003, TBL-050 | TASK-019, TASK-022, TASK-020 | Claude | 1일 | SPEC-002 수락 기준 #1~#4: 자동 시험 통과<br/>API-008 응답(201·401·409·422·503·default)마다 통과하는 시험<br/>API-009 응답(200·401·404·default)마다 통과하는 시험 |
| TASK-033 | 보류된 영업 신고 다시 올리기 | SPEC-003 | API-011, TBL-002, TBL-003, TBL-015, TBL-042, TBL-043, TBL-050 | TASK-032 | Claude | 0.5일 | API-011 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-034 | 운영자의 영업 신고 확인·보류 | SPEC-003 | API-012, API-013, API-014, TBL-002, TBL-003, TBL-015, TBL-042, TBL-043, TBL-050 | TASK-021, TASK-032 | Claude | 2일 | SPEC-003 수락 기준 #1~#3: 자동 시험 통과<br/>API-012 응답(200·401·422·default)마다 통과하는 시험<br/>API-013 응답(200·401·404·default)마다 통과하는 시험<br/>API-014 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-035 | 운영자 알림 | SPEC-008, SPEC-010, SPEC-017 | API-015, TBL-003, TBL-004, TBL-005, TBL-006, TBL-010, TBL-013, TBL-015, TBL-016, TBL-017, TBL-018, TBL-027, TBL-048, TBL-051 | TASK-021 | Claude | 0.5일 | API-015 응답(200·401·422·default)마다 통과하는 시험 |
| TASK-036 | 사업자 정보 변경 요청과 운영자 확인 | SPEC-078, A37 | API-080, API-081, API-082, TBL-002, TBL-003, TBL-015, TBL-043, TBL-050, TBL-058 | TASK-034 | Claude | 2일 | SPEC-078 수락 기준 #1~#5: 자동 시험 통과<br/>API-080 응답(201·200·401·404·409·422·503·default)마다 통과하는 시험<br/>API-081 응답(200·401·422·default)마다 통과하는 시험<br/>API-082 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A37)을 지키는지 보는 서버 시험 |
| TASK-037 | 가게 정보와 설정 바꾸기(결제 기다림 주문 한도·AI 비용 한도 포함) | SPEC-077 | API-010, TBL-003, TBL-042, TBL-048, TBL-050 | TASK-032 | Claude | 1일 | SPEC-077 수락 기준 #1~#8: 자동 시험 통과<br/>API-010 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-038 | 가격표와 도안 올리기(버전) | SPEC-004 | API-016, API-017, API-018, API-019, TBL-006, TBL-007, TBL-008, TBL-009, TBL-050 | TASK-032 | Claude | 2일 | SPEC-004 수락 기준 #1~#4: 자동 시험 통과<br/>API-016 응답(200·401·404·default)마다 통과하는 시험<br/>API-017 응답(201·200·401·404·409·422·default)마다 통과하는 시험<br/>API-018 응답(200·401·404·default)마다 통과하는 시험<br/>API-019 응답(200·401·404·default)마다 통과하는 시험 |
| TASK-039 | 운영규정 만들기와 버전 | SPEC-005, A21 | API-020, API-021, API-022, API-023, TBL-010, TBL-011, TBL-012, TBL-050 | TASK-032 | Claude | 2일 | SPEC-005 수락 기준 #1~#6: 자동 시험 통과<br/>API-020 응답(200·401·404·default)마다 통과하는 시험<br/>API-021 응답(201·200·401·404·409·422·default)마다 통과하는 시험<br/>API-022 응답(200·401·404·default)마다 통과하는 시험<br/>API-023 응답(200·401·404·default)마다 통과하는 시험<br/>05 앱 규칙(A21)을 지키는지 보는 서버 시험 |
| TASK-040 | 결제 수단(계좌) 등록과 예금주 확인 | SPEC-006, A25 | API-024, API-025, TBL-003, TBL-015, TBL-031, TBL-043 | TASK-032, TASK-025 | Claude | 1일 | SPEC-006 수락 기준 #1~#4: 자동 시험 통과<br/>API-024 응답(200·401·404·default)마다 통과하는 시험<br/>API-025 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A25)을 지키는지 보는 서버 시험 |
| TASK-041 | 영업 캘린더 정하기와 그날 주문 마감 | SPEC-007, SPEC-012 | API-026, API-027, API-028, API-029, TBL-013, TBL-014, TBL-034, TBL-042, TBL-050 | TASK-032 | Claude | 2일 | SPEC-007 수락 기준 #1~#4: 자동 시험 통과<br/>SPEC-012 수락 기준 #1: 자동 시험 통과<br/>API-026 응답(200·401·404·default)마다 통과하는 시험<br/>API-027 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-028 응답(200·401·404·422·default)마다 통과하는 시험<br/>API-029 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-042 | 채널 연결 설정과 스킬 키 바꾸기 | SPEC-008, A36 | API-030, API-031, API-079, TBL-004, TBL-051 | TASK-032, TASK-028 | Claude | 2일 | SPEC-008 수락 기준 #5~#6: 자동 시험 통과<br/>API-030 응답(200·401·404·default)마다 통과하는 시험<br/>API-031 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-079 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A36)을 지키는지 보는 서버 시험 |
| TASK-043 | 채널 연결 확인(연결 문구·시험 버튼 다섯·먼저 보내기 시험) | SPEC-008, A19, A20 | API-032, API-070, API-071, API-072, API-073, TBL-004, TBL-051 | TASK-042, TASK-023 | Claude | 3일 | SPEC-008 수락 기준 #1~#4: 자동 시험 통과<br/>API-032 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-070 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 channel_test_card<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 block_verified·channel_linked<br/>API-072 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 block_verified·channel_linked<br/>API-073 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 notice_test<br/>05 앱 규칙(A19·A20)을 지키는지 보는 서버 시험 |
| TASK-044 | 예약 링크 발급과 개인정보 처리방침 만들기 | SPEC-010, A10, A39 | API-037, API-039, TBL-003, TBL-004, TBL-005, TBL-006, TBL-010, TBL-013, TBL-015, TBL-051 | TASK-038, TASK-039, TASK-040, TASK-041, TASK-043, TASK-034 | Claude | 2일 | SPEC-010 수락 기준 #1~#4: 자동 시험 통과<br/>API-037 응답(200·401·404·default)마다 통과하는 시험<br/>API-039 응답(200·404·429·default)마다 통과하는 시험<br/>05 앱 규칙(A10·A39)을 지키는지 보는 서버 시험 |
| TASK-045 | 예약 링크 페이지 보이기와 문의 열기 | SPEC-011 | API-038, TBL-003, TBL-004, TBL-005, TBL-006, TBL-007, TBL-009, TBL-013, TBL-014, TBL-034, TBL-037, TBL-039, TBL-041 | TASK-044 | Claude | 2일 | SPEC-011 수락 기준 #1~#5: 자동 시험 통과<br/>API-038 응답(200·404·429·default)마다 통과하는 시험 |
| TASK-046 | SCR-015 가게 등록 화면 | SPEC-002, SPEC-068 | SCR-015 | TASK-029, TASK-022, TASK-032 | Claude | 1일 | SCR-015 상태 5개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 2개(normal·error)와 그리지 않은 3개(permission·stale·submitting)는 08 와이어프레임과 09 토큰으로, 08 응답 행 17개마다 정한 상태로 보임 |
| TASK-047 | SCR-034 가게 설정 화면 | SPEC-009, SPEC-017, SPEC-024, SPEC-025, SPEC-052, SPEC-077 | SCR-034 | TASK-029, TASK-032, TASK-037, TASK-020 | Claude | 1일 | SCR-034 상태 8개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 2개(normal·error)와 그리지 않은 6개(loading·load-failed·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 19개마다 정한 상태로 보임 |
| TASK-048 | SCR-035 영업 신고 화면 | SPEC-003, SPEC-078 | SCR-035 | TASK-029, TASK-032, TASK-033, TASK-022, TASK-036 | Claude | 1일 | SCR-035 상태 8개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 2개(normal·error)와 그리지 않은 6개(loading·permission·stale·submitting·on-hold·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 36개마다 정한 상태로 보임 |
| TASK-049 | SCR-036 가격표와 도안 화면 | SPEC-004 | SCR-036 | TASK-029, TASK-038, TASK-022 | Claude | 2일 | SCR-036 상태 9개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 6개(loading·load-failed·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 23개마다 정한 상태로 보임 |
| TASK-050 | SCR-037 가격표 버전 이력 화면 | SPEC-004, SPEC-013 | SCR-037 | TASK-029, TASK-038 | Claude | 0.5일 | SCR-037 상태 5개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 2개(loading·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 9개마다 정한 상태로 보임 |
| TASK-051 | SCR-038 운영규정 화면 | SPEC-005 | SCR-038 | TASK-029, TASK-039 | Claude | 2일 | SCR-038 상태 10개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·empty·error·confirm)와 그리지 않은 6개(loading·load-failed·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 15개마다 정한 상태로 보임 |
| TASK-052 | SCR-039 운영규정 버전 이력 화면 | SPEC-005, SPEC-016 | SCR-039 | TASK-029, TASK-039 | Claude | 0.5일 | SCR-039 상태 5개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 2개(loading·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 9개마다 정한 상태로 보임 |
| TASK-053 | SCR-040 결제 수단 화면 | SPEC-006 | SCR-040 | TASK-029, TASK-040 | Claude | 1일 | SCR-040 상태 10개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·empty·error·confirm)와 그리지 않은 6개(loading·load-failed·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 16개마다 정한 상태로 보임 |
| TASK-054 | SCR-041 카카오톡 채널 연결 화면 | SPEC-008, SPEC-017 | SCR-041 | TASK-029, TASK-042, TASK-043 | Claude | 2일 | SCR-041 상태 10개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 7개(loading·permission·stale·submitting·checking·event-off·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 41개마다 정한 상태로 보임 |
| TASK-055 | SCR-043 예약 링크 화면 | SPEC-010 | SCR-043 | TASK-029, TASK-044 | Claude | 1일 | SCR-043 상태 6개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 3개(loading·permission·stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 5개마다 정한 상태로 보임 |
| TASK-056 | SCR-032 영업 캘린더 화면 | SPEC-007, SPEC-012, SPEC-015 | SCR-032 | TASK-029, TASK-041 | Claude | 2일 | 달력 버튼을 44px로(설계 재검토 K3에서 43.6px로 잼)<br/>SCR-032 상태 10개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·empty·error·confirm)와 그리지 않은 6개(loading·load-failed·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 17개마다 정한 상태로 보임 |
| TASK-057 | SCR-033 영업 캘린더 설정 화면 | SPEC-007 | SCR-033 | TASK-029, TASK-041 | Claude | 1일 | SCR-033 상태 10개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·empty·error·confirm)와 그리지 않은 6개(loading·load-failed·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 16개마다 정한 상태로 보임 |
| TASK-058 | SCR-047 영업 신고 확인 목록 화면 | SPEC-003, SPEC-002, SPEC-078 | SCR-047 | TASK-029, TASK-034, TASK-021, TASK-036 | Claude | 1일 | SCR-047 상태 6개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 3개(loading·permission·stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 15개마다 정한 상태로 보임 |
| TASK-059 | SCR-048 영업 신고 확인 화면 | SPEC-003, SPEC-078 | SCR-048 | TASK-029, TASK-034, TASK-036 | Claude | 1일 | SCR-048 상태 10개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·empty·error·confirm)와 그리지 않은 6개(loading·on-hold·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 34개마다 정한 상태로 보임 |
| TASK-060 | SCR-049 운영자 알림 화면 | SPEC-008, SPEC-010, SPEC-017 | SCR-049 | TASK-029, TASK-035 | Claude | 0.5일 | SCR-049 상태 6개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 3개(loading·permission·stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 5개마다 정한 상태로 보임 |
| TASK-061 | SCR-001 예약 링크 페이지 화면 | SPEC-011, SPEC-014, SPEC-063 | SCR-001 | TASK-029, TASK-045 | Claude | 2일 | SCR-001 상태 6개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 3개(loading·rate-limited·stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 5개마다 정한 상태로 보임 |
| TASK-062 | SCR-002 가게 개인정보 처리방침 화면 | SPEC-010, SPEC-011, SPEC-018 | SCR-002 | TASK-029, TASK-044 | Claude | 0.5일 | SCR-002 상태 4개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 2개(normal·error)와 그리지 않은 2개(loading·rate-limited)는 08 와이어프레임과 09 토큰으로, 08 응답 행 4개마다 정한 상태로 보임 |

## 반복 3. AI 상담과 주문 요청

AI 상담과 주문 요청입니다. 끝나면 손님이 가게 채널에서 AI 상담으로 견적과 날짜를 받고 주문 요청을 하며, 답하지 못한 질문은 에스컬레이션 건으로 사장님 할 일 목록에 뜹니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-063 | 손님 메시지 받기: 상담 열기·이어가기, 채널 친구 여부, 한도, 글 길이 | SPEC-017, REQ-262, A13 | API-070, TBL-003, TBL-004, TBL-016, TBL-017, TBL-018, TBL-027, TBL-048, TBL-051 | TASK-028, TASK-019 | Claude | 2일 | SPEC-017 수락 기준 #3~#4·#7: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 callback_pending·ai_unavailable·ai_timeout·ai_key_missing·ai_limit_reached·ai_cost_limit_reached·unsupported_message·rate_limited·duplicate·not_accepting·server_error<br/>05 앱 규칙(A13)을 지키는지 보는 서버 시험 |
| TASK-064 | AI 상담 고지(처리방침 버전과 함께) | SPEC-018, A39 | API-070, TBL-005, TBL-017, TBL-018 | TASK-063, TASK-044 | Claude | 1일 | SPEC-018 수락 기준 #1~#3: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>05 앱 규칙(A39)을 지키는지 보는 서버 시험 |
| TASK-065 | 참고 사진 받기 | SPEC-019, A11 | API-070, API-072, TBL-018, TBL-020, TBL-021 | TASK-063 | Claude | 1일 | SPEC-019 수락 기준 #1: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 photo_received·photo_rejected<br/>API-072 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 photo_download_failed<br/>05 앱 규칙(A11)을 지키는지 보는 서버 시험 |
| TASK-066 | AI 모델로 보내는 대화 마스킹과 줄이기 | SPEC-021, A15 | API-070, TBL-018, TBL-019, TBL-027, TBL-048, TBL-049 | TASK-063, TASK-025, TASK-026 | Claude | 2일 | SPEC-021 수락 기준 #1~#11: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 masking_failed<br/>05 앱 규칙(A15)을 지키는지 보는 서버 시험 |
| TASK-067 | 견적(가게 규칙) | SPEC-013 | API-070, TBL-006, TBL-007, TBL-008, TBL-009, TBL-010, TBL-020, TBL-021, TBL-022, TBL-023, TBL-049, TBL-056 | TASK-063, TASK-038 | Claude | 2일 | SPEC-013 수락 기준 #1~#6: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험 |
| TASK-068 | 그날 받을 수 있는지 판정과 다른 날 권하기 | SPEC-014, A3, A4 | API-070, TBL-013, TBL-014, TBL-027, TBL-034, TBL-049 | TASK-063, TASK-041 | Claude | 2일 | SPEC-014 수락 기준 #1~#2: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>05 앱 규칙(A3·A4)을 지키는지 보는 서버 시험 |
| TASK-069 | AI 상담 답 만들기(주문서 초안 채우기·견적 알림·에스컬레이션) | SPEC-020, A35, A13 | API-070, TBL-018, TBL-020, TBL-022, TBL-027, TBL-048, TBL-049 | TASK-066, TASK-067, TASK-068, TASK-027 | Claude | 3일 | SPEC-020 수락 기준 #1~#8: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 answered·ai_output_rejected<br/>05 앱 규칙(A35·A13)을 지키는지 보는 서버 시험 |
| TASK-070 | 다른 가게 디자인 요청에 조문 인용하기 | SPEC-026 | API-070, TBL-011, TBL-027, TBL-049 | TASK-069, TASK-039 | Claude | 1일 | SPEC-026 수락 기준 #1: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험 |
| TASK-071 | 주문 요청 준비: 빈 항목 묻기와 금액 다시 셈 | SPEC-027 | API-070, TBL-006, TBL-020, TBL-022 | TASK-069 | Claude | 1일 | SPEC-027 수락 기준 #1~#3: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험 |
| TASK-072 | 사장님 할 일 목록과 사장님 알림(우리 채널 봇) | SPEC-067, DEC-21 | API-040, TBL-001, TBL-042, TBL-043 | TASK-020, TASK-023 | Claude | 2일 | SPEC-067 수락 기준 #1~#6: 자동 시험 통과<br/>API-040 응답(200·401·404·422·default)마다 통과하는 시험 |
| TASK-073 | 질문을 사장님께 에스컬레이션 | SPEC-022, A34 | API-070, API-041, TBL-016, TBL-017, TBL-018, TBL-019, TBL-027, TBL-042, TBL-043, TBL-044, TBL-055 | TASK-069, TASK-072 | Claude | 2일 | SPEC-022 수락 기준 #1~#5: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 handed_over<br/>API-041 응답(200·401·404·default)마다 통과하는 시험<br/>05 앱 규칙(A34)을 지키는지 보는 서버 시험 |
| TASK-074 | 에스컬레이션 건에 사장님 답 전하기(한도 넘겨 받기 포함) | SPEC-023 | API-041, API-042, TBL-017, TBL-027, TBL-042, TBL-044, TBL-055 | TASK-073 | Claude | 2일 | SPEC-023 수락 기준 #1~#5: 자동 시험 통과<br/>API-041 응답(200·401·404·default)마다 통과하는 시험<br/>API-042 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-075 | 사장님 답 기다림: 지연 안내·다시 알림·답 없어 닫힘 | SPEC-024, A28 | TBL-003, TBL-013, TBL-023, TBL-025, TBL-027, TBL-031, TBL-042, TBL-043, TBL-044 | TASK-073, TASK-023, TASK-037 | Claude | 2일 | SPEC-024 수락 기준 #1~#6: 자동 시험 통과<br/>05 앱 규칙(A28)을 지키는지 보는 서버 시험 |
| TASK-076 | 문의 끊김으로 닫기와 이어가기 | SPEC-025, A22 | TBL-003, TBL-017, TBL-020, TBL-022, TBL-023, TBL-027 | TASK-063, TASK-023, TASK-037 | Claude | 1일 | SPEC-025 수락 기준 #1~#6: 자동 시험 통과<br/>05 앱 규칙(A22)을 지키는지 보는 서버 시험 |
| TASK-077 | 상담 대화 조회(가린 값) | SPEC-021, SPEC-019, SPEC-065 | API-043, TBL-016, TBL-017, TBL-018, TBL-019, TBL-020, TBL-021, TBL-022, TBL-023, TBL-024, TBL-025, TBL-026, TBL-027, TBL-028, TBL-029, TBL-030, TBL-031, TBL-033, TBL-042, TBL-043, TBL-044, TBL-048, TBL-049, TBL-050, TBL-051, TBL-052, TBL-053, TBL-054, TBL-055, TBL-056 | TASK-066, TASK-024 | Claude | 1일 | API-043 응답(200·401·404·422·default)마다 통과하는 시험 |
| TASK-078 | 주문 내용 요약과 취소·환불 규정 따로 알리기 | SPEC-028, REQ-240, A21 | API-070, TBL-011, TBL-020, TBL-022, TBL-024 | TASK-071, TASK-039 | Claude | 2일 | SPEC-028 수락 기준 #1~#6: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>05 앱 규칙(A21)을 지키는지 보는 서버 시험 |
| TASK-079 | 알레르기 정보 동의와 알레르기 답 받기 | SPEC-075, A26 | API-070, API-071, TBL-004, TBL-020, TBL-024 | TASK-078 | Claude | 1일 | SPEC-075 수락 기준 #1~#5: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 allergy_saved·allergy_declined<br/>05 앱 규칙(A26)을 지키는지 보는 서버 시험 |
| TASK-080 | 주문자 이름·연락처 받기 | SPEC-072 | API-070, API-071, TBL-020, TBL-024 | TASK-078 | Claude | 1일 | SPEC-072 수락 기준 #1~#3: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 orderer_saved·input_invalid |
| TASK-081 | 손님 명령 확인 버튼(카드 키·30분·받은 사람만) | SPEC-069, A7, A8 | API-070, API-071, TBL-016, TBL-024 | TASK-028 | Claude | 1일 | SPEC-069 수락 기준 #1~#2: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 card_shown<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 declined·card_stale·card_expired·card_not_yours·card_used<br/>05 앱 규칙(A7·A8)을 지키는지 보는 서버 시험 |
| TASK-082 | 가예약·해제·옮기기 | SPEC-015, A3, A6 | TBL-014, TBL-027, TBL-031, TBL-034 | TASK-041 | Claude | 2일 | SPEC-015 수락 기준 #1~#8: 자동 시험 통과<br/>05 앱 규칙(A3·A6)을 지키는지 보는 서버 시험 |
| TASK-083 | 주문 요청하기(한 트랜잭션, 결제 기다림 주문 한도) | SPEC-029, A40, A6 | API-071, API-042, TBL-003, TBL-010, TBL-016, TBL-017, TBL-020, TBL-023, TBL-024, TBL-026, TBL-027, TBL-031, TBL-034, TBL-042, TBL-044, TBL-051, TBL-057 | TASK-079, TASK-080, TASK-081, TASK-082, TASK-074 | Claude | 3일 | SPEC-029 수락 기준 #1~#6: 자동 시험 통과<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 order_requested·day_full·order_limit_reached·retry_needed<br/>API-042 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A40·A6)을 지키는지 보는 서버 시험 |
| TASK-084 | 기본 디자인 주문의 가예약과 결제 안내로 진행 | SPEC-030, A3 | API-071, TBL-003, TBL-023, TBL-027, TBL-031, TBL-034 | TASK-083 | Claude | 2일 | SPEC-030 수락 기준 #1: 자동 시험 통과<br/>API-071 응답(200·401·422·default)마다 통과하는 시험<br/>05 앱 규칙(A3)을 지키는지 보는 서버 시험 |
| TASK-085 | SCR-003 가게 채널 상담 카카오 응답 | SPEC-013, SPEC-014, SPEC-017, SPEC-018, SPEC-019, SPEC-020, SPEC-022, SPEC-025, SPEC-026, SPEC-027, SPEC-049, SPEC-056, SPEC-057, SPEC-008 | SCR-003 | TASK-028 | Claude | 2일 | SCR-003 상태 10개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 3개(normal·empty·error)와 그리지 않은 7개(loading·permission·stale·handed-over·fixed-answer·rate-limited·link-test)는 08 와이어프레임과 09 토큰으로, 08 응답 행 28개마다 정한 상태로 보임 |
| TASK-086 | SCR-004 주문 요청 카드 카카오 응답 | SPEC-028, SPEC-029, SPEC-030, SPEC-069, SPEC-072, SPEC-075 | SCR-004 | TASK-028 | Claude | 1일 | SCR-004 상태 9개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 5개(normal·allergy·orderer·expired·error)와 그리지 않은 4개(done·stale·day-full·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 29개마다 정한 상태로 보임 |
| TASK-087 | SCR-016 할 일 목록 화면 | SPEC-067, SPEC-024, SPEC-037 | SCR-016 | TASK-029, TASK-072, TASK-020 | Claude | 1일 | SCR-016 상태 7개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·empty·error·not-sent)와 그리지 않은 3개(loading·permission·stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 12개마다 정한 상태로 보임 |
| TASK-088 | SCR-017 에스컬레이션 건 화면 | SPEC-022, SPEC-023, SPEC-056, SPEC-079 | SCR-017 | TASK-029, TASK-073, TASK-074 | Claude | 2일 | SCR-017 상태 7개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 2개(normal·error)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 20개마다 정한 상태로 보임(API-083의 행은 TASK-155) |
| TASK-089 | SCR-018 상담 대화 화면 | SPEC-021, SPEC-019, SPEC-065, SPEC-068 | SCR-018 | TASK-029, TASK-077 | Claude | 1일 | SCR-018 상태 6개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 3개(loading·permission·stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 7개마다 정한 상태로 보임 |
| TASK-090 | SCR-019 사장님 알림 화면 | SPEC-067, SPEC-003, SPEC-024, SPEC-006 | SCR-019 | TASK-029 | Claude | 0.5일 | SCR-019 상태 4개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 3개(normal·not-sent·error)와 그리지 않은 1개(stale)는 08 와이어프레임과 09 토큰으로 |

## 반복 4. 결제와 주문 확정

결제와 주문 확정입니다. 끝나면 결제 안내가 가고, 손님의 결제 확인 요청과 사장님의 입금 대조로 주문 확정까지 갑니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-091 | 주문 목록과 주문 하나(가게 것만) | SPEC-031, SPEC-013, SPEC-045, SPEC-068 | API-044, API-045, TBL-003, TBL-004, TBL-006, TBL-007, TBL-008, TBL-009, TBL-010, TBL-016, TBL-017, TBL-019, TBL-020, TBL-021, TBL-022, TBL-023, TBL-025, TBL-026, TBL-031, TBL-033, TBL-034, TBL-035, TBL-042, TBL-044, TBL-047, TBL-048, TBL-049, TBL-050, TBL-056 | TASK-019, TASK-083 | Claude | 1일 | API-044 응답(200·401·404·422·default)마다 통과하는 시험<br/>API-045 응답(200·401·404·default)마다 통과하는 시험 |
| TASK-092 | 맞춤 주문에 사장님 답하기(수락·금액 바꿔 수락·거절) | SPEC-031, A32 | API-046, TBL-021, TBL-022, TBL-023, TBL-026, TBL-031, TBL-034, TBL-042, TBL-044, TBL-050 | TASK-091 | Claude | 2일 | SPEC-031 수락 기준 #1~#7: 자동 시험 통과<br/>API-046 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A32)을 지키는지 보는 서버 시험 |
| TASK-093 | 결제 안내 만들고 전하기 | SPEC-032, A5 | TBL-010, TBL-015, TBL-022, TBL-031, TBL-044 | TASK-092, TASK-084, TASK-040 | Claude | 2일 | SPEC-032 수락 기준 #1~#6: 자동 시험 통과<br/>05 앱 규칙(A5)을 지키는지 보는 서버 시험 |
| TASK-094 | 손님의 결제 확인 요청 받기(입금했다고 할 때) | SPEC-033 | API-070, API-071, TBL-024, TBL-026, TBL-031, TBL-034, TBL-042 | TASK-093 | Claude | 1일 | SPEC-033 수락 기준 #1~#5: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 payment_claimed·not_allowed_now |
| TASK-095 | 입금 대조로 결제 확인 | SPEC-034, A1 | API-057, API-058, API-059, TBL-023, TBL-031, TBL-032, TBL-042, TBL-050 | TASK-094 | Claude | 3일 | SPEC-034 수락 기준 #1: 자동 시험 통과<br/>API-057 응답(200·401·404·422·default)마다 통과하는 시험<br/>API-058 응답(200·401·404·default)마다 통과하는 시험<br/>API-059 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A1)을 지키는지 보는 서버 시험 |
| TASK-096 | 다르게 들어온 결제 | SPEC-035, A29 | API-059, TBL-025, TBL-031, TBL-032, TBL-033, TBL-034, TBL-042, TBL-044 | TASK-095 | Claude | 2일 | SPEC-035 수락 기준 #1~#6: 자동 시험 통과<br/>API-059 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A29)을 지키는지 보는 서버 시험 |
| TASK-097 | 주문 확정하기와 주문 확정 안내 | SPEC-036, A1 | API-059, API-073, TBL-003, TBL-023, TBL-031, TBL-032, TBL-033, TBL-034, TBL-035, TBL-042, TBL-044, TBL-047 | TASK-095 | Claude | 1일 | SPEC-036 수락 기준 #1~#3: 자동 시험 통과<br/>API-059 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-073 응답(200·401·422·default)마다 통과하는 시험<br/>05 앱 규칙(A1)을 지키는지 보는 서버 시험 |
| TASK-098 | 결제 기한 지남: 가예약 풀고 사장님이 고르기 | SPEC-037, A28 | API-047, TBL-023, TBL-031, TBL-034, TBL-042 | TASK-093, TASK-023 | Claude | 2일 | SPEC-037 수락 기준 #1~#3: 자동 시험 통과<br/>API-047 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A28)을 지키는지 보는 서버 시험 |
| TASK-099 | 결제 기한 연장 | SPEC-038 | API-047, TBL-023, TBL-031, TBL-034, TBL-050 | TASK-098 | Claude | 1일 | SPEC-038 수락 기준 #1~#4: 자동 시험 통과<br/>API-047 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-100 | 결제 없어 취소 | SPEC-039 | API-047, TBL-023, TBL-031, TBL-044, TBL-047, TBL-050 | TASK-098 | Claude | 1일 | SPEC-039 수락 기준 #1: 자동 시험 통과<br/>API-047 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-101 | 잘못 누른 결제 확인 취소 | SPEC-070, A17 | API-059, TBL-023, TBL-025, TBL-031, TBL-032, TBL-033, TBL-034, TBL-035, TBL-044, TBL-047, TBL-050 | TASK-097 | Claude | 1일 | SPEC-070 수락 기준 #1~#2: 자동 시험 통과<br/>API-059 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A17)을 지키는지 보는 서버 시험 |
| TASK-102 | 결제로 확인하지 않은 들어온 입금 남기기 | SPEC-071 | API-059, TBL-031, TBL-033, TBL-042, TBL-050 | TASK-095 | Claude | 1일 | SPEC-071 수락 기준 #1~#5: 자동 시험 통과<br/>API-059 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-103 | 손님이 새 금액 확인하기 | SPEC-076, A32 | API-070, API-071, API-073, TBL-022, TBL-023, TBL-024, TBL-025, TBL-026, TBL-031, TBL-034, TBL-043, TBL-047 | TASK-092 | Claude | 2일 | SPEC-076 수락 기준 #1~#4: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 amount_confirmed·amount_declined<br/>API-073 응답(200·401·422·default)마다 통과하는 시험<br/>05 앱 규칙(A32)을 지키는지 보는 서버 시험 |
| TASK-104 | 손님에게 먼저 보내는 안내와 다음 대화 때 전하기 | SPEC-066, A12, A20 | API-073, TBL-004, TBL-016, TBL-018, TBL-031, TBL-044 | TASK-043, TASK-023 | Claude | 2일 | SPEC-066 수락 기준 #1~#5: 자동 시험 통과<br/>API-073 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 notice_shown·notice_gone<br/>05 앱 규칙(A12·A20)을 지키는지 보는 서버 시험 |
| TASK-105 | 내 주문 보기와 본인 확인 | SPEC-040 | API-070, API-071, TBL-010, TBL-012, TBL-016, TBL-023, TBL-024, TBL-026, TBL-027, TBL-032, TBL-033, TBL-049 | TASK-083 | Claude | 2일 | SPEC-040 수락 기준 #1~#4: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험 |
| TASK-106 | SCR-005 결제 안내 카카오 응답 | SPEC-032, SPEC-066, SPEC-076 | SCR-005 | TASK-028 | Claude | 1일 | SCR-005 상태 7개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 4개(normal·amount-confirm·deferred·error)와 그리지 않은 3개(done·stale·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 35개마다 정한 상태로 보임 |
| TASK-107 | SCR-006 결제 확인 요청 카드 카카오 응답 | SPEC-033, SPEC-069 | SCR-006 | TASK-028 | Claude | 0.5일 | SCR-006 상태 7개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 4개(normal·depositor·expired·error)와 그리지 않은 3개(done·stale·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 29개마다 정한 상태로 보임 |
| TASK-108 | SCR-007 내 주문 보기 카카오 응답 | SPEC-040 | SCR-007 | TASK-028 | Claude | 1일 | SCR-007 상태 8개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 3개(normal·empty·error)와 그리지 않은 5개(loading·permission·stale·handed-over·rate-limited)는 08 와이어프레임과 09 토큰으로, 08 응답 행 22개마다 정한 상태로 보임 |
| TASK-109 | SCR-011 손님 알림 카카오 응답 | SPEC-066, SPEC-023, SPEC-024, SPEC-036, SPEC-039, SPEC-044, SPEC-045, SPEC-047, SPEC-052, SPEC-053, SPEC-059, SPEC-061 | SCR-011 | TASK-028 | Claude | 1일 | SCR-011 상태 5개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 4개(normal·photo-consent·deferred·error)와 그리지 않은 1개(stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 6개마다 정한 상태로 보임 |
| TASK-110 | SCR-020 주문 목록 화면 | SPEC-031, SPEC-037, SPEC-068 | SCR-020 | TASK-029, TASK-091 | Claude | 1일 | SCR-020 상태 6개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 3개(loading·permission·stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 8개마다 정한 상태로 보임 |
| TASK-111 | SCR-021 주문 상세 화면 | SPEC-045, SPEC-048, SPEC-068 | SCR-021 | TASK-029, TASK-091 | Claude | 2일 | SCR-021 상태 8개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·error·confirm)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 8개마다 정한 상태로 보임(API-048의 행은 TASK-131) |
| TASK-112 | SCR-022 맞춤 주문 검토 화면 | SPEC-031 | SCR-022 | TASK-029, TASK-091, TASK-092 | Claude | 1일 | SCR-022 상태 9개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·error·confirm-notify·confirm)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 21개마다 정한 상태로 보임 |
| TASK-113 | SCR-023 결제 기한 지난 주문 화면 | SPEC-037, SPEC-038, SPEC-039 | SCR-023 | TASK-029, TASK-091, TASK-098 | Claude | 1일 | SCR-023 상태 9개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·error·confirm-notify·confirm)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 21개마다 정한 상태로 보임 |
| TASK-114 | SCR-028 입금 대조 목록 화면 | SPEC-034, SPEC-033, SPEC-035, SPEC-037 | SCR-028 | TASK-029, TASK-095 | Claude | 1일 | SCR-028 상태 6개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 3개(loading·permission·stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 6개마다 정한 상태로 보임 |
| TASK-115 | SCR-029 입금 대조 화면 | SPEC-034, SPEC-035, SPEC-036, SPEC-070, SPEC-071 | SCR-029 | TASK-029, TASK-095 | Claude | 2일 | SCR-029 상태 10개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·error·confirm-notify·expired)와 그리지 않은 6개(loading·permission·stale·submitting·mismatch·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 26개마다 정한 상태로 보임 |

## 반복 5. 변경·취소·환불

변경·취소·환불입니다. 끝나면 변경 요청과 차액 결제, 손님 취소와 가게 사정 취소, 환불 결정과 송금 표시가 돕니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-116 | 변경 요청하기 | SPEC-041 | API-070, API-071, API-062, TBL-010, TBL-011, TBL-023, TBL-024, TBL-025, TBL-042 | TASK-105 | Claude | 2일 | SPEC-041 수락 기준 #1~#2: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 change_requested<br/>API-062 응답(200·401·404·default)마다 통과하는 시험 |
| TASK-117 | 변경 요청에 사장님 답하기 | SPEC-042 | API-062, API-063, TBL-010, TBL-023, TBL-025, TBL-031, TBL-034, TBL-042, TBL-044, TBL-050 | TASK-116 | Claude | 2일 | SPEC-042 수락 기준 #1~#5: 자동 시험 통과<br/>API-062 응답(200·401·404·default)마다 통과하는 시험<br/>API-063 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-118 | 차액 결제 | SPEC-043 | API-063, TBL-010, TBL-025, TBL-031, TBL-032, TBL-034 | TASK-117, TASK-093 | Claude | 1일 | SPEC-043 수락 기준 #1~#2: 자동 시험 통과<br/>API-063 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-119 | 차액 결제가 기한까지 없을 때 | SPEC-044 | API-059, API-071, TBL-025, TBL-031, TBL-034, TBL-043, TBL-044 | TASK-118, TASK-023 | Claude | 1일 | SPEC-044 수락 기준 #1~#2: 자동 시험 통과<br/>API-059 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험 |
| TASK-120 | 변경 반영 | SPEC-045 | API-059, API-063, TBL-023, TBL-025, TBL-026, TBL-033, TBL-034, TBL-035, TBL-042, TBL-044, TBL-047 | TASK-118 | Claude | 1일 | SPEC-045 수락 기준 #1~#4: 자동 시험 통과<br/>API-059 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-063 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-121 | 환불 계산(가게 규칙)과 미리보기 | SPEC-016, A30 | API-049, TBL-010, TBL-011, TBL-012, TBL-023, TBL-026, TBL-031, TBL-032, TBL-033, TBL-035 | TASK-039, TASK-091 | Claude | 2일 | SPEC-016 수락 기준 #1~#12: 자동 시험 통과<br/>API-049 응답(200·401·404·422·default)마다 통과하는 시험<br/>05 앱 규칙(A30)을 지키는지 보는 서버 시험 |
| TASK-122 | 손님이 주문 취소하기 | SPEC-046 | API-070, API-071, TBL-011, TBL-023, TBL-024, TBL-025, TBL-031, TBL-032, TBL-033, TBL-034, TBL-042, TBL-043, TBL-047 | TASK-121, TASK-105 | Claude | 2일 | SPEC-046 수락 기준 #1~#5: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 order_cancelled |
| TASK-123 | 환불 결정·송금 표시와 다시 알림 | SPEC-047, A2, A18 | API-050, API-060, API-061, TBL-011, TBL-023, TBL-031, TBL-032, TBL-033, TBL-042, TBL-044, TBL-047, TBL-050 | TASK-121, TASK-023 | Claude | 3일 | SPEC-047 수락 기준 #1~#10: 자동 시험 통과<br/>API-050 응답(201·401·404·409·422·default)마다 통과하는 시험<br/>API-060 응답(200·401·404·default)마다 통과하는 시험<br/>API-061 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A2·A18)을 지키는지 보는 서버 시험 |
| TASK-124 | 가게 사정 취소 | SPEC-048 | API-048, TBL-011, TBL-023, TBL-025, TBL-031, TBL-033, TBL-034, TBL-042, TBL-043, TBL-044, TBL-047, TBL-050 | TASK-121 | Claude | 2일 | SPEC-048 수락 기준 #1~#3: 자동 시험 통과<br/>API-048 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-125 | 환불받을 손님 계좌 받기 | SPEC-049 | API-070, TBL-019, TBL-033, TBL-042 | TASK-123, TASK-025 | Claude | 1일 | SPEC-049 수락 기준 #1~#2: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험 |
| TASK-126 | SCR-008 변경 요청 카드 카카오 응답 | SPEC-041, SPEC-069 | SCR-008 | TASK-028 | Claude | 1일 | SCR-008 상태 6개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 3개(normal·expired·error)와 그리지 않은 3개(done·stale·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 29개마다 정한 상태로 보임 |
| TASK-127 | SCR-009 취소 카드 카카오 응답 | SPEC-046, SPEC-016, SPEC-069 | SCR-009 | TASK-028 | Claude | 0.5일 | SCR-009 상태 6개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 3개(normal·expired·error)와 그리지 않은 3개(done·stale·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 29개마다 정한 상태로 보임 |
| TASK-128 | SCR-024 변경 요청 화면 | SPEC-042, SPEC-043, SPEC-044, SPEC-045 | SCR-024 | TASK-029, TASK-116, TASK-117 | Claude | 1일 | SCR-024 상태 10개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·error·confirm-notify·confirm)와 그리지 않은 6개(loading·permission·stale·submitting·awaiting-payment·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 21개마다 정한 상태로 보임 |
| TASK-129 | SCR-025 환불 결정 화면 | SPEC-047, SPEC-016, SPEC-071 | SCR-025 | TASK-029, TASK-121, TASK-123 | Claude | 1일 | SCR-025 상태 8개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·error·confirm-notify)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 21개마다 정한 상태로 보임 |
| TASK-130 | SCR-026 환불 송금 화면 | SPEC-047, SPEC-049, SPEC-066 | SCR-026 | TASK-029, TASK-123 | Claude | 1일 | SCR-026 상태 8개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 17개마다 정한 상태로 보임 |
| TASK-131 | SCR-021 주문 상세 화면: 가게 사정 취소 | SPEC-048 | SCR-021 | TASK-111, TASK-124 | Claude | 0.5일 | '가게 사정 취소' 액션과 확인 창(무엇이 손님에게 가는지 한 줄)<br/>SCR-021 응답 행 가운데 API-048의 12개마다 정한 상태로 보임(상태 그리기는 TASK-111) |

## 반복 6. 제작·인도·문제 신고·후기

제작·인도·문제 신고·후기입니다. 끝나면 제작 목록부터 인도·미수령, 문제 신고와 보상, 후기와 포트폴리오까지 돕니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-132 | 날짜별 제작 목록 | SPEC-050 | API-051, TBL-023, TBL-026, TBL-035, TBL-043, TBL-057 | TASK-097 | Claude | 1일 | SPEC-050 수락 기준 #1~#3: 자동 시험 통과<br/>API-051 응답(200·401·404·422·default)마다 통과하는 시험 |
| TASK-133 | 맞춤 재료 주문과 제작 시작 표시(5분 안 되돌리기) | SPEC-051 | API-052, API-053, TBL-035, TBL-036, TBL-050 | TASK-132 | Claude | 2일 | SPEC-051 수락 기준 #1~#2: 자동 시험 통과<br/>API-052 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-053 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-134 | 전날 안내 | SPEC-052 | TBL-003, TBL-013, TBL-023, TBL-044 | TASK-104, TASK-037 | Claude | 1일 | SPEC-052 수락 기준 #1~#3: 자동 시험 통과 |
| TASK-135 | 완성 표시와 완성 사진 보내기 | SPEC-053, A26 | API-052, API-073, API-071, TBL-003, TBL-024, TBL-027, TBL-035, TBL-037, TBL-040, TBL-044 | TASK-133, TASK-022, TASK-104 | Claude | 2일 | SPEC-053 수락 기준 #1~#3: 자동 시험 통과<br/>API-052 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-073 응답(200·401·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 photo_consent_saved<br/>05 앱 규칙(A26)을 지키는지 보는 서버 시험 |
| TASK-136 | 오늘 픽업 목록과 인도 | SPEC-054, A27 | API-054, TBL-023, TBL-026, TBL-035, TBL-047, TBL-050 | TASK-132 | Claude | 1일 | SPEC-054 수락 기준 #1: 자동 시험 통과<br/>API-054 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A27)을 지키는지 보는 서버 시험 |
| TASK-137 | 미수령과 폐기 | SPEC-055, A27 | API-055, API-056, TBL-023, TBL-035, TBL-047 | TASK-136 | Claude | 1일 | SPEC-055 수락 기준 #1: 자동 시험 통과<br/>API-055 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-056 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A27)을 지키는지 보는 서버 시험 |
| TASK-138 | 받기 전 문제는 에스컬레이션 건으로 | SPEC-056 | API-070, TBL-023, TBL-027 | TASK-073 | Claude | 1일 | SPEC-056 수락 기준 #1: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험 |
| TASK-139 | 신고 내용 모으기 | SPEC-057 | API-070, API-064, TBL-024, TBL-028, TBL-029, TBL-043 | TASK-136 | Claude | 2일 | SPEC-057 수락 기준 #1~#2: 자동 시험 통과<br/>API-070 응답(200·401·422·default)마다 통과하는 시험<br/>API-064 응답(200·401·404·default)마다 통과하는 시험 |
| TASK-140 | 문제 신고하기 | SPEC-058, A38 | API-071, API-064, API-083, TBL-010, TBL-024, TBL-028, TBL-030, TBL-035, TBL-042, TBL-043 | TASK-139 | Claude | 2일 | SPEC-058 수락 기준 #1: 자동 시험 통과<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 issue_reported<br/>API-064 응답(200·401·404·default)마다 통과하는 시험<br/>API-083 응답(201·200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A38)을 지키는지 보는 서버 시험 |
| TASK-141 | 보상 정하기 | SPEC-059, A38 | API-065, TBL-023, TBL-026, TBL-028, TBL-029, TBL-030, TBL-031, TBL-032, TBL-033, TBL-042, TBL-044, TBL-050 | TASK-140, TASK-123 | Claude | 2일 | SPEC-059 수락 기준 #1~#6: 자동 시험 통과<br/>API-065 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A38)을 지키는지 보는 서버 시험 |
| TASK-142 | 재제작 주문 | SPEC-060, A31 | API-065, TBL-023, TBL-026, TBL-030, TBL-034, TBL-035, TBL-046, TBL-047 | TASK-141 | Claude | 2일 | SPEC-060 수락 기준 #1~#3: 자동 시험 통과<br/>API-065 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A31)을 지키는지 보는 서버 시험 |
| TASK-143 | 에스컬레이션 건에서 문제 신고로 남기기 | SPEC-079 | API-083, TBL-010, TBL-023, TBL-027, TBL-028, TBL-030, TBL-042, TBL-050 | TASK-140, TASK-074 | Claude | 1일 | SPEC-079 수락 기준 #1~#4: 자동 시험 통과<br/>API-083 응답(201·200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-144 | 후기 부탁 | SPEC-061 | API-072, TBL-013, TBL-023, TBL-030, TBL-035, TBL-044 | TASK-136, TASK-104 | Claude | 1일 | SPEC-061 수락 기준 #1~#2: 자동 시험 통과<br/>API-072 응답(200·401·422·default)마다 통과하는 시험 |
| TASK-145 | 후기 받기와 사진 게시 동의 | SPEC-062, A26 | API-072, API-066, TBL-023, TBL-038, TBL-039, TBL-040 | TASK-144 | Claude | 2일 | SPEC-062 수락 기준 #1~#2: 자동 시험 통과<br/>API-072 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 review_saved·review_not_allowed·review_invalid<br/>API-066 응답(200·401·404·422·default)마다 통과하는 시험<br/>05 앱 규칙(A26)을 지키는지 보는 서버 시험 |
| TASK-146 | 포트폴리오 올리기와 내리기 | SPEC-063 | API-067, API-068, API-069, API-071, TBL-024, TBL-037, TBL-039, TBL-040, TBL-041 | TASK-145, TASK-045 | Claude | 2일 | SPEC-063 수락 기준 #1~#3: 자동 시험 통과<br/>API-067 응답(200·401·404·default)마다 통과하는 시험<br/>API-068 응답(201·200·401·409·422·default)마다 통과하는 시험<br/>API-069 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>API-071 응답(200·401·422·default)마다 통과하는 시험, 스킬 결과 consent_withdrawn |
| TASK-147 | SCR-010 문제 신고 카드 카카오 응답 | SPEC-057, SPEC-058, SPEC-069 | SCR-010 | TASK-028 | Claude | 0.5일 | SCR-010 상태 6개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 3개(normal·expired·error)와 그리지 않은 3개(done·stale·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 29개마다 정한 상태로 보임 |
| TASK-148 | SCR-012 후기 남기기 카카오 응답 | SPEC-062, SPEC-061, SPEC-019 | SCR-012 | TASK-028 | Claude | 0.5일 | SCR-012 상태 4개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 2개(normal·error)와 그리지 않은 2개(done·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 12개마다 정한 상태로 보임 |
| TASK-149 | SCR-013 사진 게시 동의 철회 카드 카카오 응답 | SPEC-063, SPEC-069 | SCR-013 | TASK-028 | Claude | 0.5일 | SCR-013 상태 6개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하), 09에서 그린 3개(normal·expired·error)와 그리지 않은 3개(done·stale·permission)는 08 와이어프레임과 09 토큰으로, 08 응답 행 29개마다 정한 상태로 보임 |
| TASK-150 | SCR-027 문제 신고 화면 | SPEC-058, SPEC-059, SPEC-060, SPEC-079 | SCR-027 | TASK-029, TASK-139, TASK-141 | Claude | 1일 | SCR-027 상태 9개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·error·confirm-notify·confirm)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 20개마다 정한 상태로 보임 |
| TASK-151 | SCR-030 제작 목록 화면 | SPEC-050, SPEC-051, SPEC-053, SPEC-060 | SCR-030 | TASK-029, TASK-132, TASK-133, TASK-022 | Claude | 1일 | SCR-030 상태 8개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 35개마다 정한 상태로 보임 |
| TASK-152 | SCR-031 픽업 목록 화면 | SPEC-054, SPEC-055 | SCR-031 | TASK-029, TASK-132, TASK-136, TASK-137 | Claude | 1일 | SCR-031 상태 10개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 5개(normal·empty·error·confirm-notify·confirm)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 37개마다 정한 상태로 보임 |
| TASK-153 | SCR-044 포트폴리오 화면 | SPEC-063 | SCR-044 | TASK-029, TASK-146 | Claude | 1일 | SCR-044 상태 8개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 21개마다 정한 상태로 보임 |
| TASK-154 | SCR-045 후기 화면 | SPEC-062 | SCR-045 | TASK-029, TASK-145 | Claude | 1일 | SCR-045 상태 6개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 3개(loading·permission·stale)는 08 와이어프레임과 09 토큰으로, 08 응답 행 6개마다 정한 상태로 보임 |
| TASK-155 | SCR-017 에스컬레이션 건 화면: 문제 신고로 남기기 | SPEC-079 | SCR-017 | TASK-088, TASK-140 | Claude | 0.5일 | '문제 신고로 남기기' 액션과 확인 창<br/>SCR-017 응답 행 가운데 API-083의 10개마다 정한 상태로 보임(상태 그리기는 TASK-088) |

## 반복 7. 장부·지우기·운영자

장부·지우기·운영자입니다. 끝나면 구글 시트 장부 쓰기, 지난 기록 지우기, 운영자의 가게 기록 보기가 돕니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-156 | 고를 기능 켜기(장부 연결, 완성 사진 보내기) | SPEC-009 | API-033, API-034, API-035, API-036, TBL-003, TBL-045, TBL-047 | TASK-014, TASK-037 | Claude | 2일 | SPEC-009 수락 기준 #1~#2: 자동 시험 통과<br/>API-033 응답(200·401·404·default)마다 통과하는 시험<br/>API-034 응답(200·401·404·422·default)마다 통과하는 시험<br/>API-035 응답(200·401·404·409·422·503·default)마다 통과하는 시험<br/>API-036 응답(200·401·404·409·422·default)마다 통과하는 시험 |
| TASK-157 | 장부 쓰기와 다시 적기 | SPEC-064, A14 | TBL-023, TBL-026, TBL-042, TBL-043, TBL-045, TBL-046, TBL-047 | TASK-156, TASK-023 | Claude | 3일 | SPEC-064 수락 기준 #1~#3: 자동 시험 통과<br/>05 앱 규칙(A14)을 지키는지 보는 서버 시험 |
| TASK-158 | 지난 기록 지우기(하루 한 번 03:00) | SPEC-065, A16, A22 | TBL-016, TBL-017, TBL-018, TBL-019, TBL-020, TBL-021, TBL-022, TBL-023, TBL-024, TBL-025, TBL-026, TBL-027, TBL-028, TBL-029, TBL-030, TBL-031, TBL-033, TBL-042, TBL-043, TBL-044, TBL-049, TBL-050, TBL-051, TBL-052, TBL-053, TBL-054, TBL-055, TBL-056 | TASK-023 | Claude | 3일 | 올리고 1시간 안에 쓰지 않은 사진 파일(TASK-022가 둔 저장소의 임시 위치 tmp/ 아래)을 저장소에서 지움<br/>SPEC-065 수락 기준 #1~#12: 자동 시험 통과<br/>05 앱 규칙(A16·A22)을 지키는지 보는 서버 시험 |
| TASK-159 | 운영자의 가게 기록 보기와 원래 값·보관 기록 열기 | SPEC-073, A24 | API-074, API-075, API-076, API-077, TBL-003, TBL-017, TBL-018, TBL-019, TBL-023, TBL-026, TBL-033, TBL-052, TBL-053 | TASK-021, TASK-024, TASK-025 | Claude | 2일 | SPEC-073 수락 기준 #1~#6: 자동 시험 통과<br/>API-074 응답(200·401·404·422·default)마다 통과하는 시험<br/>API-075 응답(200·401·404·422·default)마다 통과하는 시험<br/>API-076 응답(200·401·404·default)마다 통과하는 시험<br/>API-077 응답(200·401·404·409·422·default)마다 통과하는 시험<br/>05 앱 규칙(A24)을 지키는지 보는 서버 시험 |
| TASK-160 | SCR-042 장부 연결 화면 | SPEC-009, SPEC-064 | SCR-042 | TASK-029, TASK-156 | Claude | 1일 | SCR-042 상태 9개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 3개(normal·empty·error)와 그리지 않은 6개(loading·permission·stale·submitting·reconnect·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 34개마다 정한 상태로 보임 |
| TASK-161 | SCR-050 가게 기록 보기 화면 | SPEC-073, SPEC-074 | SCR-050 | TASK-029, TASK-159 | Claude | 2일 | SCR-050 상태 9개를 360·1280에서 그려 page-check 통과(누르는 곳 44px), 09에서 그린 4개(normal·empty·error·confirm)와 그리지 않은 5개(loading·permission·stale·submitting·done)는 08 와이어프레임과 09 토큰으로, 08 응답 행 31개마다 정한 상태로 보임 |

## 반복 8. 출시 준비와 12단계 준비

출시 준비와 12단계 준비입니다. 끝나면 평가로 모델을 고르고 처리방침을 채우고, 부하·백업 시험과 운영 배포를 마치고, 12단계 시험 계획이 나옵니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-162 | 평가 세트를 두 회사 모델에 돌려 지나는 것 가운데 가장 싼 모델 고르기 | REQ-145, DEC-25 | 없음 | TASK-027, TASK-069, TASK-073, TASK-078 | Claude | 2일 | 모델마다 REQ-145 잣대의 결과와 상담 1,000개당 비용 표, 고른 모델과 이유를 기록에 남기고 배포 설정을 그 모델로 |
| TASK-163 | 처리방침 국외 이전 항목 채우기(고른 회사 이름·나라·보유 기간) | REQ-141, DEC-25 | 없음 | TASK-162, TASK-005, TASK-006, TASK-044 | Claude | 0.5일 | 고른 회사와 보관 안 함 허가 여부에 맞는 보유 기간이 처리방침(API-039)에 나오고, 허가 전이면 30일 |
| TASK-164 | 스테이징 부하 시험: 동시 상담 20개에서 스킬 응답 P99 4초 | REQ-130, SPEC-017 | TBL-003, TBL-004, TBL-016, TBL-017, TBL-018, TBL-027, TBL-048, TBL-051 | TASK-016, TASK-069, TASK-063 | Claude | 1일 | SPEC-017 수락 기준 #5: 자동 시험 통과 |
| TASK-165 | 하루 한 번 백업과 복구 시험 | REQ-149 | 없음 | TASK-016, TASK-175 | Claude | 1일 | 주문·동의·결제 기록의 백업이 하루 한 번 남고, 복구 시험 한 번의 결과(걸린 시간·잃은 기록 0)를 기록에 남김. 추천안으로 가면 Pro로 올린 운영 프로젝트(TASK-175)의 백업을 새 프로젝트로 복구해 봄. 스택을 다르게 고르면 TASK-175 대신 그 스택의 백업 작업을 기다림 |
| TASK-166 | 출시 전 보안 점검: 비밀 값·암호화·가게 나누기·접속기록 | REQ-134, REQ-135 | 없음 | TASK-019, TASK-025, TASK-024, TASK-159 | Claude | 1일 | 점검표(키가 저장소·로그·대화 기록에 없음, 교차 가게 시험, 암호화, 접속기록)의 항목마다 결과를 남기고 고칠 것은 작업으로 올림. 앞 키 버전의 봉투를 지금 버전으로 다시 감싸는 도구(값은 그대로, masked_values.value_hmac도 지금 버전으로 다시 셈, 앞 봉투가 그대로일 때만 씀)를 두고 앱 README 33의 키 바꾸기 차례를 스테이징에서 한 번 해 봄(2026-11-16 TASK-025에서 옮김) |
| TASK-167 | 운영 계정과 키 만들기: 우리 서비스 채널(사장님 알림), 디벨로퍼스 운영 앱, AI 회사·구글 운영 키 | DEC-21 | 없음 | TASK-002 | 동희님 | 1일 | 운영 키는 배포 환경의 비밀 저장소에만 두고, 만든 것 목록과 날짜를 기록에 남김(키 값은 적지 않음). 계좌번호 암호화 키(FIELD_KEY_CURRENT·FIELD_KEY_V1, 앱 README 32)는 운영 Worker의 비밀 값으로 넣고 사본을 저장소 밖 비밀 저장소에 둠(키를 잃으면 계좌번호를 되살릴 수 없음, 05 E20) |
| TASK-168 | 운영 배포와 되돌리기 절차 | REQ-148 | 없음 | TASK-167, TASK-165, TASK-164, TASK-163, TASK-166 | Claude | 1일 | 운영 주소에서 스모크 시험이 지나고 되돌리기를 한 번 해 봄 |
| TASK-169 | 12단계 시험 계획(TC ID)과 브라우저 에이전트가 걸을 플로우 | FL-001, FL-002, FL-003, FL-004, FL-005, FL-006, FL-007, FL-008, FL-009, FL-010, FL-011, FL-012, FL-013, FL-014 | 없음 | TASK-168 | Claude | 2일 | 플로우 14개와 수락 기준 328개에서 TC를 만들고, 브라우저 에이전트가 걸을 플로우와 보는 곳을 12단계 문서 초안에 둠 |
| TASK-175 | 운영 Supabase 프로젝트를 Pro로 올리기(매일 백업 7일, 추천안 기준) | REQ-149 | 없음 | TASK-170 | 동희님 | 0.5일 | 운영 프로젝트(서울)가 Pro이고 대시보드의 백업 목록에 매일 백업이 보이는 화면 사진을 기록에 남김. 복구 시험(TASK-165)은 이 프로젝트를 새 프로젝트로 복구해 봄(유료 플랜과 물리 백업이 있어야 됨) |

## 반복 9. 스토어 앱

스토어 앱입니다. 웹을 낸 다음에 합니다(동희님 2026-11-15 17:56 무렵 "웹앱+스토어 앱인데 웹부터 만들어바"). 끝나면 사장님·운영자 웹을 감싼 iOS·Android 앱이 두 스토어 심사를 지나 내려받을 수 있고, 사장님이 앱 알림(휴대폰 알림)으로도 할 일 알림을 받습니다.

| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-177 | Apple Developer Program·Google Play 개발자 계정 만들기 | REQ-268 | 없음 | TASK-168 | 동희님 | 0.5일 | 두 계정을 만든 날과 계정 종류(개인·회사)를 기록에 남김(계정 정보와 키는 적지 않음). Google 개인 계정이면 비공개 테스트 12명·14일 조건이 걸림(tech-stack.md 9-4) |
| TASK-178 | 스토어 앱 전 결정: 카카오 로그인 옆의 다른 로그인(Apple 심사 4.8)과 사장님 계정 지우기 | REQ-268 | 없음 | TASK-168 | 동희님 | 0.5일 | 결정 카드의 답을 말 그대로 기록에 남기고, 계정 지우기를 요구사항·SPEC·API에 더하는 PR이 단계 검사를 지나 합쳐짐 |
| TASK-179 | 웹을 Capacitor로 감싼 iOS·Android 앱(추천안 기준): 앱 안 로그인(네이티브 쿠키나 토큰), 알림 링크로 화면 열기, 사진 올리기 | REQ-268, DEC-10, DEC-26 | 없음 | TASK-176, TASK-177, TASK-178 | Claude | 2일 | 두 플랫폼 시험 빌드에서 사장님 로그인·할 일 목록·사진 올리기·알림 링크로 그 화면 열기가 됨. 로그인 방식이 06 계약을 바꾸면 그 PR이 06 검사를 지나 합쳐짐. 감싸는 길(tech-stack.md 9-2)을 다르게 고르면 이 작업을 고침 |
| TASK-180 | 사장님 앱 알림(APNs·Firebase Cloud Messaging)으로 할 일 알림 | REQ-268 | 없음 | TASK-179 | Claude | 1일 | 앱 알림을 허락한 사장님에게 할 일 알림이 앱 알림으로도 가고 누르면 그 할 일 화면이 열림. 카카오톡 알림(지금 설계)과 함께 보낼지 하나만 보낼지는 이 작업 전에 동희님께 확인 요청 |
| TASK-181 | 스토어 등록 정보와 심사 제출: 앱 설명·스크린숏·처리방침 주소·데이터 보안 양식·심사용 시험 계정 | REQ-268 | 없음 | TASK-179, TASK-180 | 동희님 | 1일 | Claude가 쓴 등록 문구 초안으로 두 스토어에 제출하고, 심사 결과(통과·거절과 사유)와 날짜를 기록에 남김 |

## 부록 A. SPEC → 작업

| SPEC | 이름 | 수락 기준 | 작업(받은 수락 기준) |
| --- | --- | --- | --- |
| SPEC-001 | 사장님 로그인 | 5 | TASK-020(#1~#4), TASK-021(#5), TASK-030, TASK-031 |
| SPEC-002 | 가게 등록 | 4 | TASK-022, TASK-032(#1~#4), TASK-046, TASK-058 |
| SPEC-003 | 운영자의 영업 신고 확인과 보류 | 3 | TASK-033, TASK-034(#1~#3), TASK-048, TASK-058, TASK-059, TASK-090 |
| SPEC-004 | 가격표와 도안 올리기 | 4 | TASK-022, TASK-038(#1~#4), TASK-049, TASK-050 |
| SPEC-005 | 운영규정 확정 | 6 | TASK-039(#1~#6), TASK-051, TASK-052 |
| SPEC-006 | 결제 수단 등록 | 4 | TASK-040(#1~#4), TASK-053, TASK-090 |
| SPEC-007 | 영업 캘린더 정하기와 바꾸기 | 4 | TASK-041(#1~#4), TASK-056, TASK-057 |
| SPEC-008 | 가게 카카오톡 채널 연결 | 6 | TASK-035, TASK-042(#5~#6), TASK-043(#1~#4), TASK-054, TASK-060, TASK-085 |
| SPEC-009 | 고를 기능 켜기(장부 연결, 완성 사진 보내기) | 2 | TASK-047, TASK-156(#1~#2), TASK-160 |
| SPEC-010 | 예약 링크 발급과 개인정보 처리방침 만들기 | 4 | TASK-035, TASK-044(#1~#4), TASK-055, TASK-060, TASK-062 |
| SPEC-011 | 예약 링크 페이지 보이기와 문의 열기 | 5 | TASK-045(#1~#5), TASK-061, TASK-062 |
| SPEC-012 | 그날 주문 마감 누르기 | 1 | TASK-041(#1), TASK-056 |
| SPEC-013 | 견적 계산(가게 규칙) | 6 | TASK-050, TASK-067(#1~#6), TASK-085, TASK-091 |
| SPEC-014 | 그날 받을 수 있는지 판정과 다른 날 권하기 | 2 | TASK-061, TASK-068(#1~#2), TASK-085 |
| SPEC-015 | 가예약·해제·옮기기 | 8 | TASK-056, TASK-082(#1~#8) |
| SPEC-016 | 환불 계산(가게 규칙) | 12 | TASK-052, TASK-121(#1~#12), TASK-127, TASK-129 |
| SPEC-017 | 손님 메시지 받기(카카오 스킬 요청) | 7 | TASK-028(#1~#2·#6), TASK-035, TASK-047, TASK-054, TASK-060, TASK-063(#3~#4·#7), TASK-085, TASK-164(#5) |
| SPEC-018 | AI 상담 고지 | 3 | TASK-062, TASK-064(#1~#3), TASK-085 |
| SPEC-019 | 참고 사진 받기 | 1 | TASK-065(#1), TASK-077, TASK-085, TASK-089, TASK-148 |
| SPEC-020 | AI 상담 답 만들기(초안 채우기·견적 안내·에스컬레이션) | 8 | TASK-069(#1~#8), TASK-085 |
| SPEC-021 | AI 모델로 보내는 대화 마스킹과 줄이기 | 11 | TASK-066(#1~#11), TASK-077, TASK-089 |
| SPEC-022 | 질문을 사장님께 에스컬레이션 | 5 | TASK-073(#1~#5), TASK-085, TASK-088 |
| SPEC-023 | 에스컬레이션 건에 사장님 답 전하기 | 5 | TASK-074(#1~#5), TASK-088, TASK-109 |
| SPEC-024 | 사장님 답 기다림: 지연 안내·다시 알림과 답 없어 닫힘 | 6 | TASK-047, TASK-075(#1~#6), TASK-087, TASK-090, TASK-109 |
| SPEC-025 | 문의 끊김으로 닫기와 이어가기 | 6 | TASK-047, TASK-076(#1~#6), TASK-085 |
| SPEC-026 | 다른 가게 디자인 요청에 조문 인용하기 | 1 | TASK-070(#1), TASK-085 |
| SPEC-027 | 주문 요청 준비: 빈 항목 묻기와 금액 다시 계산 | 3 | TASK-071(#1~#3), TASK-085 |
| SPEC-028 | 주문 내용 요약과 취소·환불 규정 따로 알리기 | 6 | TASK-078(#1~#6), TASK-086 |
| SPEC-029 | 주문 요청하기(한 트랜잭션) | 6 | TASK-083(#1~#6), TASK-086 |
| SPEC-030 | 기본 디자인 주문의 가예약과 결제 안내로 진행 | 1 | TASK-084(#1), TASK-086 |
| SPEC-031 | 맞춤 주문에 사장님 답하기(수락·금액 변경 수락·거절) | 7 | TASK-091, TASK-092(#1~#7), TASK-110, TASK-112 |
| SPEC-032 | 결제 안내 만들고 전하기 | 6 | TASK-093(#1~#6), TASK-106 |
| SPEC-033 | 손님의 '입금했어요'를 결제 확인 요청으로 | 5 | TASK-094(#1~#5), TASK-107, TASK-114 |
| SPEC-034 | 입금 대조로 결제 확인 | 1 | TASK-095(#1), TASK-114, TASK-115 |
| SPEC-035 | 다르게 들어온 결제 | 6 | TASK-096(#1~#6), TASK-114, TASK-115 |
| SPEC-036 | 주문 확정하기 | 3 | TASK-097(#1~#3), TASK-109, TASK-115 |
| SPEC-037 | 결제 기한 지남: 자리 풀고 사장님이 고르기 | 3 | TASK-087, TASK-098(#1~#3), TASK-110, TASK-113, TASK-114 |
| SPEC-038 | 결제 기한 연장 | 4 | TASK-099(#1~#4), TASK-113 |
| SPEC-039 | 결제 없어 취소 | 1 | TASK-100(#1), TASK-109, TASK-113 |
| SPEC-040 | 내 주문 보기와 본인 확인 | 4 | TASK-105(#1~#4), TASK-108 |
| SPEC-041 | 변경 요청하기 | 2 | TASK-116(#1~#2), TASK-126 |
| SPEC-042 | 변경 요청에 사장님 답하기 | 5 | TASK-117(#1~#5), TASK-128 |
| SPEC-043 | 차액 결제 | 2 | TASK-118(#1~#2), TASK-128 |
| SPEC-044 | 차액 결제가 기한까지 없을 때 | 2 | TASK-109, TASK-119(#1~#2), TASK-128 |
| SPEC-045 | 변경 반영 | 4 | TASK-091, TASK-109, TASK-111, TASK-120(#1~#4), TASK-128 |
| SPEC-046 | 손님이 주문 취소하기 | 5 | TASK-122(#1~#5), TASK-127 |
| SPEC-047 | 환불 결정 | 10 | TASK-109, TASK-123(#1~#10), TASK-129, TASK-130 |
| SPEC-048 | 가게 사정 취소 | 3 | TASK-111, TASK-124(#1~#3), TASK-131 |
| SPEC-049 | 환불받을 손님 계좌 받기 | 2 | TASK-085, TASK-125(#1~#2), TASK-130 |
| SPEC-050 | 날짜별 제작 목록 | 3 | TASK-132(#1~#3), TASK-151 |
| SPEC-051 | 맞춤 재료 주문과 제작 시작 표시 | 2 | TASK-133(#1~#2), TASK-151 |
| SPEC-052 | 전날 안내 | 3 | TASK-047, TASK-109, TASK-134(#1~#3) |
| SPEC-053 | 완성 표시와 완성 사진 보내기 | 3 | TASK-022, TASK-109, TASK-135(#1~#3), TASK-151 |
| SPEC-054 | 오늘 픽업 목록과 인도 | 1 | TASK-136(#1), TASK-152 |
| SPEC-055 | 미수령과 폐기 | 1 | TASK-137(#1), TASK-152 |
| SPEC-056 | 받기 전 문제는 에스컬레이션 건으로 | 1 | TASK-085, TASK-088, TASK-138(#1) |
| SPEC-057 | 신고 내용 모으기 | 2 | TASK-085, TASK-139(#1~#2), TASK-147 |
| SPEC-058 | 문제 신고하기 | 1 | TASK-140(#1), TASK-147, TASK-150 |
| SPEC-059 | 보상 정하기 | 6 | TASK-109, TASK-141(#1~#6), TASK-150 |
| SPEC-060 | 재제작 주문 | 3 | TASK-142(#1~#3), TASK-150, TASK-151 |
| SPEC-061 | 후기 부탁 | 2 | TASK-109, TASK-144(#1~#2), TASK-148 |
| SPEC-062 | 후기 받기와 사진 게시 동의 | 2 | TASK-145(#1~#2), TASK-148, TASK-154 |
| SPEC-063 | 포트폴리오 올리기와 내리기 | 3 | TASK-061, TASK-146(#1~#3), TASK-149, TASK-153 |
| SPEC-064 | 장부 쓰기 | 3 | TASK-157(#1~#3), TASK-160 |
| SPEC-065 | 지난 기록 지우기 | 12 | TASK-077, TASK-089, TASK-158(#1~#12) |
| SPEC-066 | 손님에게 먼저 보내는 안내 | 5 | TASK-104(#1~#5), TASK-106, TASK-109, TASK-130 |
| SPEC-067 | 사장님 알림과 할 일 목록 | 6 | TASK-072(#1~#6), TASK-087, TASK-090 |
| SPEC-068 | 가게별 기록 나누기 | 2 | TASK-019(#1~#2), TASK-046, TASK-089, TASK-091, TASK-110, TASK-111 |
| SPEC-069 | 손님 명령 확인 버튼 | 2 | TASK-081(#1~#2), TASK-086, TASK-107, TASK-126, TASK-127, TASK-147, TASK-149 |
| SPEC-070 | 잘못 누른 결제 확인 취소 | 2 | TASK-101(#1~#2), TASK-115 |
| SPEC-071 | 결제로 확인하지 않은 들어온 입금 남기기 | 5 | TASK-102(#1~#5), TASK-115, TASK-129 |
| SPEC-072 | 주문자 이름·연락처 받기 | 3 | TASK-080(#1~#3), TASK-086 |
| SPEC-073 | 운영자의 가게 기록 보기와 원래 값·보관 기록 열기 | 6 | TASK-159(#1~#6), TASK-161 |
| SPEC-074 | 접속기록 남기기 | 3 | TASK-024(#1~#3), TASK-161 |
| SPEC-075 | 알레르기 정보 동의와 알레르기 답 받기 | 5 | TASK-079(#1~#5), TASK-086 |
| SPEC-076 | 손님이 새 금액 확인하기 | 4 | TASK-103(#1~#4), TASK-106 |
| SPEC-077 | 가게 정보와 설정 바꾸기 | 8 | TASK-037(#1~#8), TASK-047 |
| SPEC-078 | 사업자 정보 변경 요청과 운영자 확인 | 5 | TASK-036(#1~#5), TASK-048, TASK-058, TASK-059 |
| SPEC-079 | 에스컬레이션 건에서 문제 신고로 남기기 | 4 | TASK-088, TASK-143(#1~#4), TASK-150, TASK-155 |

## 부록 B. API → 작업

| API | 연산 | 응답 | 만드는 작업 | 함께 고치는 작업 | 부르는 화면 작업 |
| --- | --- | --- | --- | --- | --- |
| API-001 | `POST /owner/session` | 200·401·422·429·503·default | TASK-020 | 없음 | TASK-030 |
| API-002 | `GET /owner/me` | 200·401·default | TASK-020 | 없음 | TASK-087 |
| API-003 | `DELETE /owner/session` | 204·default | TASK-020 | 없음 | TASK-047 |
| API-004 | `POST /operator/session` | 200·401·422·429·default | TASK-021 | 없음 | TASK-031 |
| API-005 | `GET /operator/me` | 200·401·default | TASK-021 | 없음 | TASK-058 |
| API-006 | `DELETE /operator/session` | 204·default | TASK-021 | 없음 | TASK-058 |
| API-007 | `POST /owner/uploads` | 201·401·413·422·429·503·default | TASK-022 | 없음 | TASK-046, TASK-048, TASK-049, TASK-151 |
| API-008 | `POST /owner/shop` | 201·401·409·422·503·default | TASK-032 | 없음 | TASK-046 |
| API-009 | `GET /owner/shop` | 200·401·404·default | TASK-032 | 없음 | TASK-047, TASK-048 |
| API-010 | `PATCH /owner/shop` | 200·401·404·409·422·default | TASK-037 | 없음 | TASK-047 |
| API-011 | `PUT /owner/shop/license` | 200·401·404·409·422·default | TASK-033 | 없음 | TASK-048 |
| API-012 | `GET /operator/shops` | 200·401·422·default | TASK-034 | 없음 | TASK-058 |
| API-013 | `GET /operator/shops/{shopId}` | 200·401·404·default | TASK-034 | 없음 | TASK-059 |
| API-014 | `POST /operator/shops/{shopId}/license-review` | 200·401·404·409·422·default | TASK-034 | 없음 | TASK-059 |
| API-015 | `GET /operator/alerts` | 200·401·422·default | TASK-035 | 없음 | TASK-060 |
| API-016 | `GET /owner/price-list` | 200·401·404·default | TASK-038 | 없음 | TASK-049 |
| API-017 | `POST /owner/price-list/versions` | 201·200·401·404·409·422·default | TASK-038 | 없음 | TASK-049 |
| API-018 | `GET /owner/price-list/versions` | 200·401·404·default | TASK-038 | 없음 | TASK-050 |
| API-019 | `GET /owner/price-list/versions/{version}` | 200·401·404·default | TASK-038 | 없음 | TASK-050 |
| API-020 | `GET /owner/operating-rules` | 200·401·404·default | TASK-039 | 없음 | TASK-051 |
| API-021 | `POST /owner/operating-rules/versions` | 201·200·401·404·409·422·default | TASK-039 | 없음 | TASK-051 |
| API-022 | `GET /owner/operating-rules/versions` | 200·401·404·default | TASK-039 | 없음 | TASK-052 |
| API-023 | `GET /owner/operating-rules/versions/{version}` | 200·401·404·default | TASK-039 | 없음 | TASK-052 |
| API-024 | `GET /owner/payment-destination` | 200·401·404·default | TASK-040 | 없음 | TASK-053 |
| API-025 | `PUT /owner/payment-destination` | 200·401·404·409·422·default | TASK-040 | 없음 | TASK-053 |
| API-026 | `GET /owner/calendar` | 200·401·404·default | TASK-041 | 없음 | TASK-057 |
| API-027 | `PUT /owner/calendar` | 200·401·404·409·422·default | TASK-041 | 없음 | TASK-057 |
| API-028 | `GET /owner/calendar/days` | 200·401·404·422·default | TASK-041 | 없음 | TASK-056 |
| API-029 | `PATCH /owner/calendar/days/{day}` | 200·401·404·409·422·default | TASK-041 | 없음 | TASK-056 |
| API-030 | `GET /owner/kakao-channel` | 200·401·404·default | TASK-042 | 없음 | TASK-054 |
| API-031 | `PUT /owner/kakao-channel` | 200·401·404·409·422·default | TASK-042 | 없음 | TASK-054 |
| API-032 | `POST /owner/kakao-channel/check` | 200·401·404·409·422·default | TASK-043 | 없음 | TASK-054 |
| API-033 | `GET /owner/ledger` | 200·401·404·default | TASK-156 | 없음 | TASK-160 |
| API-034 | `POST /owner/ledger/authorization` | 200·401·404·422·default | TASK-156 | 없음 | TASK-160 |
| API-035 | `PUT /owner/ledger` | 200·401·404·409·422·503·default | TASK-156 | 없음 | TASK-160 |
| API-036 | `DELETE /owner/ledger` | 200·401·404·409·422·default | TASK-156 | 없음 | TASK-160 |
| API-037 | `GET /owner/booking-link` | 200·401·404·default | TASK-044 | 없음 | TASK-055 |
| API-038 | `GET /public/shops/{slug}` | 200·404·429·default | TASK-045 | 없음 | TASK-061 |
| API-039 | `GET /public/shops/{slug}/privacy-policy` | 200·404·429·default | TASK-044 | 없음 | TASK-062 |
| API-040 | `GET /owner/tasks` | 200·401·404·422·default | TASK-072 | 없음 | TASK-087 |
| API-041 | `GET /owner/handoffs/{handoffId}` | 200·401·404·default | TASK-073 | TASK-074 | TASK-088, TASK-155 |
| API-042 | `POST /owner/handoffs/{handoffId}/answer` | 200·401·404·409·422·default | TASK-074 | TASK-083 | TASK-088, TASK-155 |
| API-043 | `GET /owner/consultations/{consultationId}/messages` | 200·401·404·422·default | TASK-077 | 없음 | TASK-089 |
| API-044 | `GET /owner/orders` | 200·401·404·422·default | TASK-091 | 없음 | TASK-110 |
| API-045 | `GET /owner/orders/{orderId}` | 200·401·404·default | TASK-091 | 없음 | TASK-111, TASK-112, TASK-113, TASK-131 |
| API-046 | `POST /owner/orders/{orderId}/custom-decision` | 200·401·404·409·422·default | TASK-092 | 없음 | TASK-112 |
| API-047 | `POST /owner/orders/{orderId}/overdue-decision` | 200·401·404·409·422·default | TASK-098 | TASK-099, TASK-100 | TASK-113 |
| API-048 | `POST /owner/orders/{orderId}/shop-cancel` | 200·401·404·409·422·default | TASK-124 | 없음 | TASK-111, TASK-131 |
| API-049 | `GET /owner/orders/{orderId}/refund-preview` | 200·401·404·422·default | TASK-121 | 없음 | TASK-129 |
| API-050 | `POST /owner/orders/{orderId}/refunds` | 201·401·404·409·422·default | TASK-123 | 없음 | TASK-129 |
| API-051 | `GET /owner/production-days/{day}` | 200·401·404·422·default | TASK-132 | 없음 | TASK-151, TASK-152 |
| API-052 | `POST /owner/orders/{orderId}/production-marks` | 200·401·404·409·422·default | TASK-133 | TASK-135 | TASK-151 |
| API-053 | `POST /owner/orders/{orderId}/production-marks/undo` | 200·401·404·409·422·default | TASK-133 | 없음 | TASK-151 |
| API-054 | `POST /owner/orders/{orderId}/handover` | 200·401·404·409·422·default | TASK-136 | 없음 | TASK-152 |
| API-055 | `POST /owner/orders/{orderId}/no-pickup` | 200·401·404·409·422·default | TASK-137 | 없음 | TASK-152 |
| API-056 | `POST /owner/orders/{orderId}/discard` | 200·401·404·409·422·default | TASK-137 | 없음 | TASK-152 |
| API-057 | `GET /owner/payment-requests` | 200·401·404·422·default | TASK-095 | 없음 | TASK-114 |
| API-058 | `GET /owner/payment-requests/{paymentRequestId}` | 200·401·404·default | TASK-095 | 없음 | TASK-115 |
| API-059 | `POST /owner/payment-requests/{paymentRequestId}/reconciliation` | 200·401·404·409·422·default | TASK-095 | TASK-096, TASK-097, TASK-101, TASK-102, TASK-119, TASK-120 | TASK-115 |
| API-060 | `GET /owner/refunds/{refundId}` | 200·401·404·default | TASK-123 | 없음 | TASK-130 |
| API-061 | `POST /owner/refunds/{refundId}/sent` | 200·401·404·409·422·default | TASK-123 | 없음 | TASK-130 |
| API-062 | `GET /owner/change-requests/{changeRequestId}` | 200·401·404·default | TASK-116 | TASK-117 | TASK-128 |
| API-063 | `POST /owner/change-requests/{changeRequestId}/decision` | 200·401·404·409·422·default | TASK-117 | TASK-118, TASK-120 | TASK-128 |
| API-064 | `GET /owner/issue-reports/{issueReportId}` | 200·401·404·default | TASK-139 | TASK-140 | TASK-150 |
| API-065 | `POST /owner/issue-reports/{issueReportId}/compensation` | 200·401·404·409·422·default | TASK-141 | TASK-142 | TASK-150 |
| API-066 | `GET /owner/reviews` | 200·401·404·422·default | TASK-145 | 없음 | TASK-154 |
| API-067 | `GET /owner/portfolio` | 200·401·404·default | TASK-146 | 없음 | TASK-153 |
| API-068 | `POST /owner/portfolio/items` | 201·200·401·409·422·default | TASK-146 | 없음 | TASK-153 |
| API-069 | `DELETE /owner/portfolio/items/{portfolioItemId}` | 200·401·404·409·422·default | TASK-146 | 없음 | TASK-153 |
| API-070 | `POST /kakao/skills/message` | 200·401·422·default | TASK-028 | TASK-043, TASK-063, TASK-064, TASK-065, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070, TASK-071, TASK-073, TASK-078, TASK-079, TASK-080, TASK-081, TASK-094, TASK-103, TASK-105, TASK-116, TASK-122, TASK-125, TASK-138, TASK-139 | TASK-085, TASK-108 |
| API-071 | `POST /kakao/skills/card` | 200·401·422·default | TASK-028 | TASK-043, TASK-079, TASK-080, TASK-081, TASK-083, TASK-084, TASK-094, TASK-103, TASK-105, TASK-116, TASK-119, TASK-122, TASK-135, TASK-140, TASK-146 | TASK-086, TASK-106, TASK-107, TASK-126, TASK-127, TASK-147, TASK-149 |
| API-072 | `POST /kakao/skills/review` | 200·401·422·default | TASK-028 | TASK-043, TASK-065, TASK-144, TASK-145 | TASK-148 |
| API-073 | `POST /kakao/skills/event` | 200·401·422·default | TASK-028 | TASK-043, TASK-097, TASK-103, TASK-104, TASK-135 | TASK-085, TASK-106, TASK-109 |
| API-074 | `GET /operator/shops/{shopId}/records` | 200·401·404·422·default | TASK-159 | 없음 | TASK-161 |
| API-075 | `GET /operator/shops/{shopId}/consultations/{consultationId}` | 200·401·404·422·default | TASK-159 | 없음 | TASK-161 |
| API-076 | `GET /operator/shops/{shopId}/orders/{orderId}` | 200·401·404·default | TASK-159 | 없음 | TASK-161 |
| API-077 | `POST /operator/shops/{shopId}/originals` | 200·401·404·409·422·default | TASK-159 | 없음 | TASK-161 |
| API-078 | `POST /owner/session/authorization` | 200·422·429·default | TASK-020 | 없음 | TASK-030 |
| API-079 | `POST /owner/kakao-channel/skill-key` | 200·401·404·409·422·default | TASK-042 | 없음 | TASK-054 |
| API-080 | `POST /owner/shop/identity-changes` | 201·200·401·404·409·422·503·default | TASK-036 | 없음 | TASK-048 |
| API-081 | `GET /operator/identity-changes` | 200·401·422·default | TASK-036 | 없음 | TASK-058 |
| API-082 | `POST /operator/identity-changes/{changeId}/review` | 200·401·404·409·422·default | TASK-036 | 없음 | TASK-059 |
| API-083 | `POST /owner/handoffs/{handoffId}/issue-report` | 201·200·401·404·409·422·default | TASK-140 | TASK-143 | TASK-088, TASK-155 |

## 부록 C. 화면 → 작업과 상태

| SCR | 이름 | 상태 | 09에서 그린 것 | 그리지 않은 것 | 응답 행 | 작업 |
| --- | --- | --- | --- | --- | --- | --- |
| SCR-001 | 예약 링크 페이지 | 6 | 3 | 3(loading·rate-limited·stale) | 5 | TASK-061 |
| SCR-002 | 가게 개인정보 처리방침 | 4 | 2 | 2(loading·rate-limited) | 4 | TASK-062 |
| SCR-003 | 가게 채널 상담 | 10 | 3 | 7(loading·permission·stale·handed-over·fixed-answer·rate-limited·link-test) | 28 | TASK-085 |
| SCR-004 | 주문 요청 카드 | 9 | 5 | 4(done·stale·day-full·permission) | 29 | TASK-086 |
| SCR-005 | 결제 안내 | 7 | 4 | 3(done·stale·permission) | 35 | TASK-106 |
| SCR-006 | 결제 확인 요청 카드 | 7 | 4 | 3(done·stale·permission) | 29 | TASK-107 |
| SCR-007 | 내 주문 보기 | 8 | 3 | 5(loading·permission·stale·handed-over·rate-limited) | 22 | TASK-108 |
| SCR-008 | 변경 요청 카드 | 6 | 3 | 3(done·stale·permission) | 29 | TASK-126 |
| SCR-009 | 취소 카드 | 6 | 3 | 3(done·stale·permission) | 29 | TASK-127 |
| SCR-010 | 문제 신고 카드 | 6 | 3 | 3(done·stale·permission) | 29 | TASK-147 |
| SCR-011 | 손님 알림 | 5 | 4 | 1(stale) | 6 | TASK-109 |
| SCR-012 | 후기 남기기 | 4 | 2 | 2(done·permission) | 12 | TASK-148 |
| SCR-013 | 사진 게시 동의 철회 카드 | 6 | 3 | 3(done·stale·permission) | 29 | TASK-149 |
| SCR-014 | 사장님 로그인 | 4 | 2 | 2(loading·rate-limited) | 12 | TASK-030 |
| SCR-015 | 가게 등록 | 5 | 2 | 3(permission·stale·submitting) | 17 | TASK-046 |
| SCR-016 | 할 일 목록 | 7 | 4 | 3(loading·permission·stale) | 12 | TASK-087 |
| SCR-017 | 에스컬레이션 건 | 7 | 2 | 5(loading·permission·stale·submitting·done) | 30 | TASK-088, TASK-155 |
| SCR-018 | 상담 대화 | 6 | 3 | 3(loading·permission·stale) | 7 | TASK-089 |
| SCR-019 | 사장님 알림 | 4 | 3 | 1(stale) | 0 | TASK-090 |
| SCR-020 | 주문 목록 | 6 | 3 | 3(loading·permission·stale) | 8 | TASK-110 |
| SCR-021 | 주문 상세 | 8 | 3 | 5(loading·permission·stale·submitting·done) | 20 | TASK-111, TASK-131 |
| SCR-022 | 맞춤 주문 검토 | 9 | 4 | 5(loading·permission·stale·submitting·done) | 21 | TASK-112 |
| SCR-023 | 결제 기한 지난 주문 | 9 | 4 | 5(loading·permission·stale·submitting·done) | 21 | TASK-113 |
| SCR-024 | 변경 요청 | 10 | 4 | 6(loading·permission·stale·submitting·awaiting-payment·done) | 21 | TASK-128 |
| SCR-025 | 환불 결정 | 8 | 3 | 5(loading·permission·stale·submitting·done) | 21 | TASK-129 |
| SCR-026 | 환불 송금 | 8 | 3 | 5(loading·permission·stale·submitting·done) | 17 | TASK-130 |
| SCR-027 | 문제 신고 | 9 | 4 | 5(loading·permission·stale·submitting·done) | 20 | TASK-150 |
| SCR-028 | 입금 대조 목록 | 6 | 3 | 3(loading·permission·stale) | 6 | TASK-114 |
| SCR-029 | 입금 대조 | 10 | 4 | 6(loading·permission·stale·submitting·mismatch·done) | 26 | TASK-115 |
| SCR-030 | 제작 목록 | 8 | 3 | 5(loading·permission·stale·submitting·done) | 35 | TASK-151 |
| SCR-031 | 픽업 목록 | 10 | 5 | 5(loading·permission·stale·submitting·done) | 37 | TASK-152 |
| SCR-032 | 영업 캘린더 | 10 | 4 | 6(loading·load-failed·permission·stale·submitting·done) | 17 | TASK-056 |
| SCR-033 | 영업 캘린더 설정 | 10 | 4 | 6(loading·load-failed·permission·stale·submitting·done) | 16 | TASK-057 |
| SCR-034 | 가게 설정 | 8 | 2 | 6(loading·load-failed·permission·stale·submitting·done) | 19 | TASK-047 |
| SCR-035 | 영업 신고 | 8 | 2 | 6(loading·permission·stale·submitting·on-hold·done) | 36 | TASK-048 |
| SCR-036 | 가격표와 도안 | 9 | 3 | 6(loading·load-failed·permission·stale·submitting·done) | 23 | TASK-049 |
| SCR-037 | 가격표 버전 이력 | 5 | 3 | 2(loading·permission) | 9 | TASK-050 |
| SCR-038 | 운영규정 | 10 | 4 | 6(loading·load-failed·permission·stale·submitting·done) | 15 | TASK-051 |
| SCR-039 | 운영규정 버전 이력 | 5 | 3 | 2(loading·permission) | 9 | TASK-052 |
| SCR-040 | 결제 수단 | 10 | 4 | 6(loading·load-failed·permission·stale·submitting·done) | 16 | TASK-053 |
| SCR-041 | 카카오톡 채널 연결 | 10 | 3 | 7(loading·permission·stale·submitting·checking·event-off·done) | 41 | TASK-054 |
| SCR-042 | 장부 연결 | 9 | 3 | 6(loading·permission·stale·submitting·reconnect·done) | 34 | TASK-160 |
| SCR-043 | 예약 링크 | 6 | 3 | 3(loading·permission·stale) | 5 | TASK-055 |
| SCR-044 | 포트폴리오 | 8 | 3 | 5(loading·permission·stale·submitting·done) | 21 | TASK-153 |
| SCR-045 | 후기 | 6 | 3 | 3(loading·permission·stale) | 6 | TASK-154 |
| SCR-046 | 운영자 로그인 | 4 | 2 | 2(rate-limited·submitting) | 5 | TASK-031 |
| SCR-047 | 영업 신고 확인 목록 | 6 | 3 | 3(loading·permission·stale) | 15 | TASK-058 |
| SCR-048 | 영업 신고 확인 | 10 | 4 | 6(loading·on-hold·permission·stale·submitting·done) | 34 | TASK-059 |
| SCR-049 | 운영자 알림 | 6 | 3 | 3(loading·permission·stale) | 5 | TASK-060 |
| SCR-050 | 가게 기록 보기 | 9 | 4 | 5(loading·permission·stale·submitting·done) | 31 | TASK-161 |

## 부록 D. 테이블 → 작업

| TBL | 테이블 | 작업 |
| --- | --- | --- |
| TBL-001 | `owners` | TASK-017, TASK-020, TASK-021, TASK-072 |
| TBL-002 | `operators` | TASK-017, TASK-020, TASK-021, TASK-033, TASK-034, TASK-036 |
| TBL-003 | `shops` | TASK-017, TASK-019, TASK-020, TASK-021, TASK-022, TASK-028, TASK-032, TASK-033, TASK-034, TASK-035, TASK-036, TASK-037, TASK-040, TASK-044, TASK-045, TASK-063, TASK-075, TASK-076, TASK-083, TASK-084, TASK-091, TASK-097, TASK-134, TASK-135, TASK-156, TASK-159, TASK-164 |
| TBL-004 | `kakao_channels` | TASK-017, TASK-019, TASK-028, TASK-035, TASK-042, TASK-043, TASK-044, TASK-045, TASK-063, TASK-079, TASK-091, TASK-104, TASK-164 |
| TBL-005 | `privacy_policies` | TASK-017, TASK-035, TASK-044, TASK-045, TASK-064 |
| TBL-006 | `price_lists` | TASK-017, TASK-022, TASK-035, TASK-038, TASK-044, TASK-045, TASK-067, TASK-071, TASK-091 |
| TBL-007 | `price_options` | TASK-017, TASK-022, TASK-038, TASK-045, TASK-067, TASK-091 |
| TBL-008 | `price_option_rules` | TASK-017, TASK-022, TASK-038, TASK-067, TASK-091 |
| TBL-009 | `designs` | TASK-017, TASK-022, TASK-038, TASK-045, TASK-067, TASK-091 |
| TBL-010 | `operating_rules` | TASK-017, TASK-035, TASK-039, TASK-044, TASK-067, TASK-083, TASK-091, TASK-093, TASK-105, TASK-116, TASK-117, TASK-118, TASK-121, TASK-140, TASK-143 |
| TBL-011 | `rule_clauses` | TASK-017, TASK-039, TASK-070, TASK-078, TASK-116, TASK-121, TASK-122, TASK-123, TASK-124 |
| TBL-012 | `refund_tiers` | TASK-017, TASK-039, TASK-105, TASK-121 |
| TBL-013 | `business_calendars` | TASK-017, TASK-035, TASK-041, TASK-044, TASK-045, TASK-068, TASK-075, TASK-134, TASK-144 |
| TBL-014 | `calendar_days` | TASK-017, TASK-041, TASK-045, TASK-068, TASK-082 |
| TBL-015 | `payment_accounts` | TASK-017, TASK-025, TASK-033, TASK-034, TASK-035, TASK-036, TASK-040, TASK-044, TASK-093 |
| TBL-016 | `customers` | TASK-017, TASK-019, TASK-028, TASK-035, TASK-063, TASK-073, TASK-077, TASK-081, TASK-083, TASK-091, TASK-104, TASK-105, TASK-158, TASK-164 |
| TBL-017 | `consultations` | TASK-017, TASK-019, TASK-028, TASK-035, TASK-063, TASK-064, TASK-073, TASK-074, TASK-076, TASK-077, TASK-083, TASK-091, TASK-158, TASK-159, TASK-164 |
| TBL-018 | `messages` | TASK-017, TASK-028, TASK-035, TASK-063, TASK-064, TASK-065, TASK-066, TASK-069, TASK-073, TASK-077, TASK-104, TASK-158, TASK-159, TASK-164 |
| TBL-019 | `masked_values` | TASK-017, TASK-019, TASK-025, TASK-066, TASK-073, TASK-077, TASK-091, TASK-125, TASK-158, TASK-159 |
| TBL-020 | `order_drafts` | TASK-017, TASK-065, TASK-067, TASK-069, TASK-071, TASK-076, TASK-077, TASK-078, TASK-079, TASK-080, TASK-083, TASK-091, TASK-158 |
| TBL-021 | `reference_photos` | TASK-017, TASK-065, TASK-067, TASK-077, TASK-091, TASK-092, TASK-158 |
| TBL-022 | `quotes` | TASK-017, TASK-067, TASK-069, TASK-071, TASK-076, TASK-077, TASK-078, TASK-091, TASK-092, TASK-093, TASK-103, TASK-158 |
| TBL-023 | `orders` | TASK-017, TASK-019, TASK-067, TASK-075, TASK-076, TASK-077, TASK-083, TASK-084, TASK-091, TASK-092, TASK-095, TASK-097, TASK-098, TASK-099, TASK-100, TASK-101, TASK-103, TASK-105, TASK-116, TASK-117, TASK-120, TASK-121, TASK-122, TASK-123, TASK-124, TASK-132, TASK-134, TASK-136, TASK-137, TASK-138, TASK-141, TASK-142, TASK-143, TASK-144, TASK-145, TASK-157, TASK-158, TASK-159 |
| TBL-024 | `confirm_cards` | TASK-017, TASK-022, TASK-077, TASK-078, TASK-079, TASK-080, TASK-081, TASK-083, TASK-094, TASK-103, TASK-105, TASK-116, TASK-122, TASK-135, TASK-139, TASK-140, TASK-146, TASK-158 |
| TBL-025 | `change_requests` | TASK-017, TASK-075, TASK-077, TASK-091, TASK-096, TASK-101, TASK-103, TASK-116, TASK-117, TASK-118, TASK-119, TASK-120, TASK-122, TASK-124, TASK-158 |
| TBL-026 | `order_details` | TASK-017, TASK-077, TASK-083, TASK-091, TASK-092, TASK-094, TASK-103, TASK-105, TASK-120, TASK-121, TASK-132, TASK-136, TASK-141, TASK-142, TASK-157, TASK-158, TASK-159 |
| TBL-027 | `handoffs` | TASK-017, TASK-022, TASK-028, TASK-035, TASK-063, TASK-066, TASK-068, TASK-069, TASK-070, TASK-073, TASK-074, TASK-075, TASK-076, TASK-077, TASK-082, TASK-083, TASK-084, TASK-105, TASK-135, TASK-138, TASK-143, TASK-158, TASK-164 |
| TBL-028 | `issue_details` | TASK-017, TASK-077, TASK-139, TASK-140, TASK-141, TASK-143, TASK-158 |
| TBL-029 | `issue_photos` | TASK-017, TASK-077, TASK-139, TASK-141, TASK-158 |
| TBL-030 | `issue_reports` | TASK-017, TASK-077, TASK-140, TASK-141, TASK-142, TASK-143, TASK-144, TASK-158 |
| TBL-031 | `payment_requests` | TASK-017, TASK-019, TASK-040, TASK-075, TASK-077, TASK-082, TASK-083, TASK-084, TASK-091, TASK-092, TASK-093, TASK-094, TASK-095, TASK-096, TASK-097, TASK-098, TASK-099, TASK-100, TASK-101, TASK-102, TASK-103, TASK-104, TASK-117, TASK-118, TASK-119, TASK-121, TASK-122, TASK-123, TASK-124, TASK-141, TASK-158 |
| TBL-032 | `payments` | TASK-017, TASK-095, TASK-096, TASK-097, TASK-101, TASK-105, TASK-118, TASK-121, TASK-122, TASK-123, TASK-141 |
| TBL-033 | `refunds` | TASK-017, TASK-025, TASK-077, TASK-091, TASK-096, TASK-097, TASK-101, TASK-102, TASK-105, TASK-120, TASK-121, TASK-122, TASK-123, TASK-124, TASK-125, TASK-141, TASK-158, TASK-159 |
| TBL-034 | `slot_holds` | TASK-017, TASK-041, TASK-045, TASK-068, TASK-082, TASK-083, TASK-084, TASK-091, TASK-092, TASK-094, TASK-096, TASK-097, TASK-098, TASK-099, TASK-101, TASK-103, TASK-117, TASK-118, TASK-119, TASK-120, TASK-122, TASK-124, TASK-142 |
| TBL-035 | `productions` | TASK-017, TASK-022, TASK-091, TASK-097, TASK-101, TASK-120, TASK-121, TASK-132, TASK-133, TASK-135, TASK-136, TASK-137, TASK-140, TASK-142, TASK-144 |
| TBL-036 | `production_undos` | TASK-017, TASK-133 |
| TBL-037 | `completion_photos` | TASK-017, TASK-022, TASK-045, TASK-135, TASK-146 |
| TBL-038 | `reviews` | TASK-017, TASK-145 |
| TBL-039 | `review_photos` | TASK-017, TASK-045, TASK-145, TASK-146 |
| TBL-040 | `photo_consents` | TASK-017, TASK-022, TASK-135, TASK-145, TASK-146 |
| TBL-041 | `portfolio_items` | TASK-017, TASK-045, TASK-146 |
| TBL-042 | `owner_tasks` | TASK-017, TASK-033, TASK-034, TASK-037, TASK-041, TASK-072, TASK-073, TASK-074, TASK-075, TASK-077, TASK-083, TASK-091, TASK-092, TASK-094, TASK-095, TASK-096, TASK-097, TASK-098, TASK-102, TASK-116, TASK-117, TASK-120, TASK-122, TASK-123, TASK-124, TASK-125, TASK-140, TASK-141, TASK-143, TASK-157, TASK-158 |
| TBL-043 | `owner_alerts` | TASK-017, TASK-033, TASK-034, TASK-036, TASK-040, TASK-072, TASK-073, TASK-075, TASK-077, TASK-103, TASK-119, TASK-122, TASK-124, TASK-132, TASK-139, TASK-140, TASK-157, TASK-158 |
| TBL-044 | `notifications` | TASK-017, TASK-022, TASK-073, TASK-074, TASK-075, TASK-077, TASK-083, TASK-091, TASK-092, TASK-093, TASK-096, TASK-097, TASK-100, TASK-101, TASK-104, TASK-117, TASK-119, TASK-120, TASK-123, TASK-124, TASK-134, TASK-135, TASK-141, TASK-144, TASK-158 |
| TBL-045 | `ledger_links` | TASK-017, TASK-156, TASK-157 |
| TBL-046 | `ledger_rows` | TASK-017, TASK-142, TASK-157 |
| TBL-047 | `ledger_writes` | TASK-017, TASK-091, TASK-097, TASK-100, TASK-101, TASK-103, TASK-120, TASK-122, TASK-123, TASK-124, TASK-136, TASK-137, TASK-142, TASK-156, TASK-157 |
| TBL-048 | `ai_calls` | TASK-017, TASK-019, TASK-026, TASK-028, TASK-035, TASK-037, TASK-063, TASK-066, TASK-069, TASK-077, TASK-091, TASK-164 |
| TBL-049 | `ai_tool_calls` | TASK-017, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070, TASK-077, TASK-091, TASK-105, TASK-158 |
| TBL-050 | `request_keys` | TASK-017, TASK-018, TASK-022, TASK-032, TASK-033, TASK-034, TASK-036, TASK-037, TASK-038, TASK-039, TASK-041, TASK-077, TASK-091, TASK-092, TASK-095, TASK-099, TASK-100, TASK-101, TASK-102, TASK-117, TASK-123, TASK-124, TASK-133, TASK-136, TASK-141, TASK-143, TASK-158 |
| TBL-051 | `ops_events` | TASK-017, TASK-018, TASK-023, TASK-028, TASK-035, TASK-042, TASK-043, TASK-044, TASK-063, TASK-077, TASK-083, TASK-158, TASK-164 |
| TBL-052 | `kept_records` | TASK-017, TASK-077, TASK-158, TASK-159 |
| TBL-053 | `access_logs` | TASK-017, TASK-024, TASK-077, TASK-158, TASK-159 |
| TBL-054 | `file_deletions` | TASK-017, TASK-022, TASK-077, TASK-158 |
| TBL-055 | `handoff_questions` | TASK-017, TASK-073, TASK-074, TASK-077, TASK-158 |
| TBL-056 | `order_draft_extras` | TASK-017, TASK-067, TASK-077, TASK-091, TASK-158 |
| TBL-057 | `order_detail_extras` | TASK-017, TASK-083, TASK-132 |
| TBL-058 | `shop_identity_changes` | TASK-017, TASK-036 |

## 부록 E. 규칙·열린 질문·SPEC 밖 요구사항 → 작업

| ID | 내용 | 작업 |
| --- | --- | --- |
| A1 | 05 앱 규칙: 확정은 결제 확인으로만 | TASK-095, TASK-097 |
| A2 | 05 앱 규칙: 환불 합은 받은 금액을 넘지 않음 | TASK-123 |
| A3 | 05 앱 규칙: 하루 최대 개수를 넘지 않음 | TASK-068, TASK-082, TASK-084 |
| A4 | 05 앱 규칙: 픽업 날짜 | TASK-068 |
| A5 | 05 앱 규칙: 결제 안내 금액 | TASK-093 |
| A6 | 05 앱 규칙: 상태가 가는 길과 동시 쓰기 | TASK-082, TASK-083 |
| A7 | 05 앱 규칙: 손님 확인 카드 | TASK-081 |
| A8 | 05 앱 규칙: 손님 명령은 그 손님만 | TASK-081 |
| A9 | 05 앱 규칙: 모든 읽기·쓰기는 그 가게 것만 | TASK-019 |
| A10 | 05 앱 규칙: 예약 링크를 낼 조건 | TASK-044 |
| A11 | 05 앱 규칙: 사진 장수 | TASK-022, TASK-065 |
| A12 | 05 앱 규칙: 먼저 보내는 안내 | TASK-104 |
| A13 | 05 앱 규칙: AI 비용 한도 | TASK-063, TASK-069 |
| A14 | 05 앱 규칙: 장부에 적는 값 | TASK-157 |
| A15 | 05 앱 규칙: 마스킹한 값 | TASK-025, TASK-066 |
| A16 | 05 앱 규칙: 지난 기록 지우기 | TASK-158 |
| A17 | 05 앱 규칙: 결제 확인 취소 | TASK-101 |
| A18 | 05 앱 규칙: 환불 보내기 | TASK-123 |
| A19 | 05 앱 규칙: 채널 연결 확인 | TASK-043 |
| A20 | 05 앱 규칙: 먼저 보내기와 발송 결과 | TASK-043, TASK-104 |
| A21 | 05 앱 규칙: 주문 요청 카드에 들어가는 규정 글 | TASK-039, TASK-078 |
| A22 | 05 앱 규칙: 주문이 끝남, 상담 끝남, 보관 기록 | TASK-076, TASK-158 |
| A23 | 05 앱 규칙: 계좌번호와 원래 값의 암호화 | TASK-025 |
| A24 | 05 앱 규칙: 접속기록 | TASK-024, TASK-159 |
| A25 | 05 앱 규칙: 예금주 확인과 계좌 바꾸기 | TASK-040 |
| A26 | 05 앱 규칙: 알레르기 정보 동의와 사진 게시 동의 | TASK-079, TASK-135, TASK-145 |
| A27 | 05 앱 규칙: 주문 상태와 제작 행의 인도·미수령 시각 | TASK-136, TASK-137 |
| A28 | 05 앱 규칙: 사장님 답 기다림의 끝과 결제 기한 | TASK-075, TASK-098 |
| A29 | 05 앱 규칙: 취소 뒤 들어온 입금·더 들어온 금액의 환불 계산값 | TASK-096 |
| A30 | 05 앱 규칙: 환불 계산값 | TASK-121 |
| A31 | 05 앱 규칙: 재제작 주문의 돈과 후기 부탁 | TASK-142 |
| A32 | 05 앱 규칙: 기본 디자인 범위와 손님의 새 금액 확인 | TASK-092, TASK-103 |
| A33 | 05 앱 규칙: 같은 일은 한 번만: 이벤트 키의 형식과 대상마다 하나 | TASK-023 |
| A34 | 05 앱 규칙: 덧붙은 질문과 마감된 날 질문 | TASK-073 |
| A35 | 05 앱 규칙: 차례마다 AI 호출 상한 | TASK-069 |
| A36 | 05 앱 규칙: 스킬 키와 연결 문구, '연결 확인 중' 선점 | TASK-042 |
| A37 | 05 앱 규칙: 사업자 정보 변경 요청의 반영과 가게가 정하는 값을 쓰는 때 | TASK-036 |
| A38 | 05 앱 규칙: 문제 종류와 보상 없음의 사유, 그 밖의 보상, 에스컬레이션 건에서 남기는 문제 신고 | TASK-140, TASK-141 |
| A39 | 05 앱 규칙: 상담 고지 때의 처리방침 버전 | TASK-044, TASK-064 |
| A40 | 05 앱 규칙: 결제 기다림 주문 한도 | TASK-083 |
| G1 | 04 공통 규칙 | TASK-019 |
| G2 | 04 공통 규칙 | TASK-018 |
| G3 | 04 공통 규칙 | TASK-017 |
| G4 | 04 공통 규칙 | TASK-028 |
| G5 | 04 공통 규칙 | TASK-028 |
| G6 | 04 공통 규칙 | TASK-018 |
| G7 | 04 공통 규칙 | TASK-029 |
| G8 | 04 공통 규칙 | TASK-018 |
| G9 | 04 공통 규칙 | TASK-018 |
| OPEN-1 | 06 열린 질문(API-070) | TASK-007, TASK-008, TASK-009, TASK-011 |
| OPEN-2 | 06 열린 질문(API-070) | TASK-008, TASK-009, TASK-011 |
| OPEN-3 | 06 열린 질문(API-070) | TASK-007, TASK-008, TASK-009, TASK-011 |
| OPEN-4 | 06 열린 질문(API-070) | TASK-008, TASK-009, TASK-011 |
| OPEN-6 | 06 열린 질문(API-004) | TASK-003, TASK-011 |
| OPEN-8 | 06 열린 질문(API-031) | TASK-009, TASK-011 |
| OPEN-9 | 06 열린 질문(API-032, API-073) | TASK-007, TASK-009, TASK-011 |
| OPEN-10 | 06 열린 질문(API-031, API-032, API-070) | TASK-010, TASK-011 |
| OPEN-11 | 06 열린 질문(API-078, API-001) | TASK-007, TASK-009, TASK-011 |
| OPEN-12 | 06 열린 질문(API-072) | TASK-008, TASK-009, TASK-011 |
| REQ-139 | SPEC 행 밖 요구사항(권장, 비기능) | TASK-027 |
| REQ-145 | SPEC 행 밖 요구사항(필수, 비기능) | TASK-027, TASK-162 |
| REQ-147 | SPEC 행 밖 요구사항(권장, 비기능) | TASK-029 |
| REQ-148 | SPEC 행 밖 요구사항(권장, 비기능) | TASK-001, TASK-016, TASK-168, TASK-172 |
| REQ-149 | SPEC 행 밖 요구사항(권장, 비기능) | TASK-001, TASK-165, TASK-175 |
| REQ-267 | SPEC 행 밖 요구사항(필수, 비기능) | TASK-176 |
| REQ-268 | SPEC 행 밖 요구사항(권장, 비기능) | TASK-177, TASK-178, TASK-179, TASK-180, TASK-181 |
