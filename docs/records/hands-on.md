# 실제 환경 확인 기록

실제 배포와 계정 연결에서 확인한 결과를 날짜, 도구, 결과 순서로 남깁니다.

## 2026-11-21 · PR #121 main 검증과 연결 제한

- 연결된 GitHub 도구: main `1f27eb8c6bc01d8ffcf866cff46afebbf5addd6f`, app `44876506358`의 check·스테이징 배포와 db `44876506378` 두 버전이 모두 성공했습니다. 배포 작업의 공개 주소와 실제 데이터베이스 조회 단계도 성공입니다.
- 셸 HTTP 경로는 앱 JSON이 아닌 프록시 상위 연결 초기화 오류 503입니다. GitHub 연결 도구로 읽은 서명 커밋의 SHA-1과 트리·부모 객체를 확인해 로컬 main을 fast-forward했습니다. 독립 Wrangler 배포 태그 조회와 공개 주소 재확인은 미실행입니다.
- SSH의 등록된 키 파일을 복원하고 형식을 확인했지만 데스크톱 연결은 여전히 종료 코드 255입니다. 공유 데스크톱 도구도 실행 제한 오류입니다. Aside·agent-desktop 사용이나 실제 로그인 성공으로 기록하지 않습니다.

## 2026-11-21 · TASK-176 PWA 설치 조건

- 로컬 운영 빌드: Node 22.23.4·Playwright Chromium에서 `npm run check:pwa -w web` 실행. `check-pwa: Chromium 설치 오류 0 · 정적 캐시 통과 · API 캐시 0건`입니다. 모의 API가 매 요청 새 값을 반환하고 오프라인에서는 API가 실패하며 정적 파일만 열렸습니다.
- 실제 스테이징 HTTPS: CDP `Page.getInstallabilityErrors`의 목록은 비어 있습니다. 이름 `Siljang 웹앱`, 시작 `/owner`, `standalone`, 아이콘 192·512px, 서비스 워커 준비를 확인했습니다. 확인 결과는 [설치 조건 기록](pwa/2026-11-21-installability.json)에 있습니다.
- 360·1280 화면 사진을 각각 열어 현재 본문이 '준비 중입니다'인 것도 확인했습니다. PWA 설치 조건이 통과해도 사장님 업무 화면이 끝난 뜻은 아닙니다.
- 실제 휴대폰 홈 화면 추가·주소창 없는 실행 사진과 출시 아이콘 확인은 TASK-167로 옮겼습니다. 이 기록은 휴대폰 설치나 사진을 대신하지 않습니다.

## 2026-11-21 · PR #119 배포 확인과 TASK-020 환경 점검

- 도구: GitHub CLI·Wrangler 4.158.0·curl. PR #119의 squash main `e5208e3f8d102e82e553b41c1b4509a4ed47721e`와 `git ls-remote` 원격 SHA, Wrangler의 최신 배포 태그가 같았습니다.
- main app `44874041960`의 검사·스테이징 배포·상태 확인·실제 데이터베이스 조회 확인 단계와 db `44874041907`이 성공했습니다. 별도 공개 상태 요청도 HTTP 200과 `status=ok`였습니다.
- TASK-020: 기존 스테이징의 바인딩은 필드 키 두 개·Hyperdrive·업로드 한도이며 카카오 로그인 설정은 없습니다. 이름과 종류만 읽었습니다. 데이터베이스 소유자 인증·Aside·agent-desktop은 현재 환경에 없습니다.
- Wrangler 별도 원격 미리보기에서 테이블·생성 권한을 읽는 두 요청은 모두 ProxyWorker 연결 끊김으로 HTTP 500이었습니다. 이 조회를 중단하고 미리보기를 종료했습니다. 테이블 존재·마이그레이션 적용·OAuth 화면은 확인하지 않았습니다.

## 2026-11-19 · TASK-009 PC 카카오톡 마지막 시험

- agent-desktop으로 채널 추가 전후의 K-01을 보내고 Wrangler에서 `isFriend` 없음과 `true`를 확인했습니다. 채널 친구 추가를 원래 상태로 복원했습니다.
- Aside에서 원본 후기 블록을 복사해 PC용 사진 필수만 해제했습니다. PC 카드로 합성 후기 글과 동의를 보낸 뒤 Wrangler에서 `orderNo` 일치와 33초를 확인했습니다. 시험 Worker의 임시 라우팅은 정리했습니다.
- PC 카드의 각 버튼이 연 인가 요청을 Aside의 기존 로그인에서 완료했습니다. 결과 화면과 Worker의 세 결과를 대조했습니다. 채널의 공개·검색과 개발 연결을 원래대로 복원했습니다. [시험 시각과 세부 결과](../10-wbs/kakao-test-script.md)

## 2026-11-19 · TASK-009 10초 간격 반복 발화 재시험

- PC 카카오톡 Siljang Test의 재시험에서 Worker 수신 간격은 0.130초·10.377초였습니다. 첫 두 건의 2초 구간과 후보 키가 같았고 세 번째는 달랐습니다. 시각 제외 키와 본문 해시는 세 건 모두 같았습니다.
- PC 답 말풍선과 HTTP 200 Worker 기록을 대조했습니다. [시험 대본](../10-wbs/kakao-test-script.md#k-02-같은-말open-1)

## 2026-11-19 · TASK-171 한국 스테이징 요청과 Hyperdrive 연결 수

- 한국에서 `/cdn-cgi/trace`의 `loc=KR`, `colo=LAX`, `warp=off`를 확인했습니다. 실제 스테이징 응답의 `CF-Ray`는 LAX, `CF-Placement`는 `remote-ICN`이었습니다. 상태 200 다섯 건은 604~918ms, 실제 데이터베이스를 조회한 합성 세션 401 다섯 건은 613~921ms였습니다.
- 같은 Hyperdrive에서 첫 `SELECT 1`의 왕복은 두 번 모두 147ms였습니다. 트랜잭션의 첫 표본 뒤 SQL 22건은 142~146ms였습니다. 스테이징에 합성 세션 20건을 동시에 보내 모두 HTTP 401을 확인했습니다. PostgreSQL 연결은 관측 중 최대 4개, 서버 설정 상한은 60개였습니다. 읽기 전용 미리보기 세션을 종료했습니다.
- 잠금·비공개 저장소·Cron·Queues와 합쳐 무료 플랫폼 시험 결과를 정리했습니다. [스택 시험 결과](../10-wbs/tech-stack.md#8-1-시험-결과2026-11-19)

## 2026-11-19 · TASK-009 카카오 개발 채널 반복 발화와 빈 응답

- PC 카카오톡 Siljang Test에서 같은 말을 세 번 보냈습니다. 0.100초 차이의 첫 두 요청이 2초 구간 경계를 지났고 세 건의 시각 제외 키는 일치했습니다. 세 번째 요청은 47.718초 뒤에 받았습니다.
- 6초 늦은 응답에서 PC에 65초 동안 답과 오류가 표시되지 않았고 Worker에는 요청 한 건만 남았습니다. 네 가지 빈 응답에서도 PC에 답과 오류가 표시되지 않았습니다.
- 카카오 채널의 공개와 검색을 OFF로 확인했습니다. 수신 시각과 HTTP 상태는 [시험 대본](../10-wbs/kakao-test-script.md#k-02-같은-말open-1)에 남겼습니다. 후기의 보안 이미지와 버튼 extra는 휴대폰 시험이 남았습니다.

## 2026-11-19 · TASK-173 스테이징 앱의 데이터베이스 쓰기

- 운영자 화면에 들어갈 수 없는 비활성 합성 계정과 세션을 스테이징 시험에 사용했습니다. `GET /api/operator/me`는 HTTP 401, 같은 세션의 `DELETE /api/operator/session`은 HTTP 204였고 세션 쿠키가 삭제됐습니다.
- 별도 Hyperdrive 미리보기에서 같은 합성 세션의 `ended_at`이 설정된 것을 읽었습니다. 이 값이 실제 앱의 쓰기를 확인하는 증거입니다. 확인 뒤 합성 계정과 세션을 삭제했습니다.
- GitHub Actions가 스테이징 앱에 1분 Cron을 등록하고 상태와 실제 데이터베이스 조회를 통과했습니다. Wrangler tail에서 15:44:29 KST의 실제 스테이징 Cron 실행이 `ok`였음을 확인했습니다. [스테이징 배포 로그](https://github.com/kodonghui/siljang.ai/actions/runs/44472883249/job/135387113916)

## 2026-11-19 · TASK-174 스테이징 Supabase 권한 대조

- Aside에서 Data API 비활성, 마이그레이션 원장 22행을 확인했습니다. 저장소의 0001~0022는 원장 적용에 사용한 버전과 차이 0입니다. CI의 PostgreSQL 16.15·17.11이 통과했습니다.
- 스테이징과 같은 Hyperdrive에서 PostgreSQL 17.12와 `siljang_runtime` 로그인 및 `NOINHERIT`를 확인했습니다. `access_logs`의 `INSERT`, `DELETE`, `SELECT(accessed_at)`는 허용됐습니다. 테이블 전체 `SELECT`, `UPDATE`, `TRUNCATE`, 테이블 소유 권한은 없었습니다.
- 스테이징의 현재 비밀 설정에는 Supabase publishable·secret 키가 없었습니다. 데이터 경로는 Hyperdrive와 PostgreSQL 역할을 사용합니다. 운영자 인증의 Supabase Auth 연결은 TASK-021에서 다룹니다. [스테이징 조회 검사](https://github.com/kodonghui/siljang.ai/actions/runs/44472883249/job/135387113916)

## 2026-11-19 · TASK-009 카카오 개발 채널 콜백

- PC 카카오톡 Siljang Test에서 초기 콜백과 20·50·280·320초 버튼을 한 번씩 실행했습니다. 3.0·20.0·56.3·290.5초에 발신한 응답은 PC 대화에 표시됐고 카카오 결과는 모두 HTTP 200 `SUCCESS`였습니다.
- 320초 설정의 실제 Worker 발신은 321.1초였습니다. 카카오 HTTP 200 `SUCCESS`와 PC 말풍선을 확인했습니다. 공식 문서의 5분과 다른 개발 채널 결과입니다. [카카오 콜백 가이드](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/ai_chatbot_callback_guide)
- 3·20초는 `waitUntil`, 50·280·320초는 Cloudflare Queue를 사용했습니다. [카카오 시험 대본](../10-wbs/kakao-test-script.md#k-05-콜백open-2)

## 2026-11-19 · TASK-173 무료 Cron·Queue와 스테이징 비밀 값

- 공개 경로가 없는 별도 시험 Worker에 서울 Placement `aws:ap-northeast-2`와 Cron `* * * * *`를 적용했습니다. 15:21:43·15:22:43 KST에 Cron이 실행돼 Hyperdrive를 통해 스테이징 데이터베이스의 `request_keys`를 서버 전용 역할로 읽었습니다. `WHERE false`로 조회해 데이터 행은 반환하지 않았습니다.
- 각 Cron이 ID만 담은 메시지를 지연 5초로 발행했습니다. Wrangler tail에서 같은 메시지의 소비를 확인했으며 발행부터 소비까지 각각 7.7초와 8.1초였습니다. 확인한 실행은 모두 성공이었습니다.
- 시험 종료 뒤 시험 Worker의 Cron과 큐 연결을 해제했고 공개 경로 없이 종료했습니다. 스테이징용 큐는 발행자 0·소비자 0 상태입니다.
- Aside에서 필드 키의 사본을 Vault에 보관한 뒤 Wrangler의 일괄 처리로 기존 스테이징에 `FIELD_KEY_CURRENT`와 `FIELD_KEY_V1`을 함께 적용했습니다. 키 이름 두 개와 스테이징 상태 `ok`를 확인했습니다.
- 앱 Worker의 staging 설정에 1분 Cron과 서울 Placement를 추가합니다. AI 콜백 소비자 연결과 정상 앱 경로의 합성 쓰기 시험은 남았습니다. [Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · [Cloudflare Placement](https://developers.cloudflare.com/workers/configuration/placement/)

## 2026-11-19 · TASK-171 Hyperdrive 경합과 Supabase S3

- Cloudflare 원격 미리보기에서 스테이징과 같은 Hyperdrive를 사용했습니다. 첫 SQL 186ms, PostgreSQL 17.12, `btree_gist`, 서버 전용 역할이 확인됐습니다. SQLSTATE `55P03` 경합 뒤 커밋된 값을 다른 연결에서 읽었고 합성 행만 삭제했습니다.
- Aside에서 비공개 시험 버킷을 확인했습니다. 기존 앱 S3Store의 업로드·메타데이터 조회·다운로드·복사와 종류 보존·접두어 및 `startAfter` 목록·두 시험 객체 삭제가 통과했습니다. 익명 GET은 HTTP 403이었습니다.
- 카카오 시험 Worker의 실제 K-05 콜백은 Cloudflare Queue 지연 50초로 발행됐습니다. Worker는 수신 뒤 56.3초에 카카오에 발신해 HTTP 200 `SUCCESS`를 받았습니다.
- Windows 하위 시스템에서 스크립트의 실제 스테이징 HTTP 200을 3회 확인했습니다. 별도 시험 호스트에서는 스테이징 HTTP 200 2회(SIN)와 격리 PostgreSQL에 대한 선택적 SQL 경로를 확인했습니다. [기술 스택 8-1](../10-wbs/tech-stack.md#8-1-개발-전-시험task-171-동희님이-계정을-만든-뒤-task-170)

## 2026-11-19 · TASK-170 무료 개발 환경 설정 확인

- 기존 Cloudflare 계정은 Workers Free, 서울 Supabase 개발 프로젝트는 Free·Nano(`ap-northeast-2`)입니다. Aside Vault와 Cloudflare·GitHub 비밀 저장소를 사용했습니다.
- Wrangler의 Hyperdrive 설정은 Supabase 직결 주소와 읽기 캐시 OFF를 확인했습니다. 스테이징 앱의 상태 HTTP 200과 임의 세션을 넣은 실제 DB 조회 HTTP 401을 다시 대조했습니다. [스테이징 배포 검사](https://github.com/kodonghui/siljang.ai/actions/runs/44467448470/job/135369043023)

## 2026-11-19 · TASK-009 개발 시나리오 탈출 명령

- 15:09 KST Aside로 기본 탈출 블록의 개발 설정에 `시험 나가기`를 저장하고 재열었습니다. 탈출 블록은 카카오가 정한 응답을 표시합니다. [카카오 블록 가이드](https://kakaobusiness.gitbook.io/main/tool/chatbot/main_notions/block)
- 공개 OFF·검색 OFF, 기존 개발 연결을 다시 확인했습니다. 탈출 동작은 후속 PC 시험에서 확인합니다.

## 2026-11-19 · TASK-009 PC 카카오톡 사진·봇 ID

- K-09(14:51:30 KST)는 Worker에서 16진수 24자 뒤에 느낌표가 붙은 봇 ID 형식, NRT, HTTP 200이었습니다. PC에서 확인한 기본 ID 길이와 끝 네 글자는 관리센터 값과 맞았습니다. 기존 답을 확대해 화면의 느낌표도 확인했으며 실제 식별자는 기록하지 않았습니다.
- K-06(14:54:07 KST)의 합성 사진은 `userRequest.utterance`의 URL로 왔습니다. Worker가 361ms 동안 처리해 HTTP 200 `image/png` 101바이트를 읽었으며 PC 대화에도 결과가 표시됐습니다.
- Aside에서 콜백과 후기를 개발 시나리오에 저장하고 재열었습니다. PC에서 K-07의 글 입력을 거쳐 사진 버튼까지 표시됐고, 버튼에는 ‘모바일에서 확인해 주세요’가 나왔습니다. 같은 대화에서 K-08·K-05 발화는 진행 중인 사진 질문으로 이어졌고 이 발화에 대응하는 Worker 요청은 확인되지 않았습니다.
- 14:58 KST Aside에서 공개 OFF·검색 OFF, 같은 개발 채널 연결, 운영 연결 공란을 확인했습니다. [카카오 시험 대본](../10-wbs/kakao-test-script.md#k-06-사진-메시지open-3)

## 2026-11-19 · TASK-007 카카오 시험 채널·봇·앱 확인

- Aside에서 Siljang Test 개발 채널의 챗봇 연결, 폴백 블록의 시험 서버 스킬 및 스킬 데이터 응답, 시험 앱의 카카오 로그인 활성화와 리다이렉트 설정을 확인했습니다. 운영 채널 연결은 비어 있었습니다.
- Aside Vault에 시험 설정이 보관돼 있음을 확인했습니다. Wrangler는 시험 Worker에 `SKILL_KEY`, `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `HASH_KEY`의 네 이름이 있다고 반환했습니다.
- 실제 채널의 스킬 연결은 PC 카카오톡의 13:03 KST K-01 말풍선과 동일 요청의 Worker KV 기록(HTTP 200)으로 확인했습니다. [PR #100](https://github.com/kodonghui/siljang.ai/pull/100)

## 2026-11-19 · TASK-009 PC 카카오톡 실앱 시험

- Aside 컴퓨터 사용으로 PC 카카오톡의 `Siljang Test` 채팅방을 열었습니다. 채널 비공개 상태에서는 메시지를 보낼 수 없다는 안내가 표시됐고, 동희님 승인으로 검색 허용을 끈 채 채널을 잠시 공개했을 때 입력란이 나타났습니다.
- `시험 시작`과 `늦게 4`를 각 1회 보냈습니다. `늦게 4`는 PC 앱에서 4.5초 지연 응답으로 표시됐습니다. Wrangler에서 K-01(13:03:29 KST, NRT, HTTP 200, 메뉴 10개)과 K-03a(13:04:09 KST, NRT, HTTP 200, 서버 처리 4,500ms)를 각각 대조했습니다.
- 실앱 친구 추가 전후와 나머지 대본 항목은 남았습니다. [카카오 시험 대본](../10-wbs/kakao-test-script.md#k-01-시험-시작open-1-8-1)

## 2026-11-19 · TASK-173 스테이징 앱 DB 연결 준비

- 배포 전 스테이징의 `/api/operator/me`에 형식이 맞는 임의 세션 쿠키를 넣어 호출하니 HTTP 500 `internal`이었습니다. 쿠키가 없을 때는 세션 조회 없이 바로 HTTP 401이므로 DB 확인에는 형식이 맞는 쿠키를 사용합니다.
- Wrangler 모의 배포에서 `staging`의 `HYPERDRIVE`와 `UPLOAD_RATE_LIMITER`가 모두 표시됐습니다. 실제 배포 후에는 기존 운영자 조회에서 HTTP 401 `unauthenticated`가 돌아오는지 자동 검사합니다.

## 2026-11-19 · TASK-174 Supabase 서버 전용 역할

- Aside에서 `siljang-dev`에 `siljang_runtime` PostgreSQL 로그인 역할을 만들고 비밀번호를 Vault에 보관했습니다. Management API를 통해 역할의 멤버십과 권한을 확인한 뒤 `NOINHERIT`와 현재 서버 쿼리에 필요한 테이블 권한을 적용했습니다.
- 실제 Supabase 권한 조회에서 `access_logs`의 `INSERT`·`DELETE`·`SELECT(accessed_at)`는 허용, 테이블 전체 `SELECT`·`UPDATE`·`TRUNCATE`와 테이블 소유는 불가였습니다. 역할의 LOGIN은 켜져 있고 INHERIT는 꺼져 있습니다.
- 별도 PostgreSQL 16.15에서 역할 전환, 조회용 행 잠금과 접속기록 보존 기간 SQL이 실행됐습니다. 이 테스트에서는 `UPDATE`·`TRUNCATE` 실행을 권한 오류로 확인했습니다. 스테이징 앱의 실제 접속은 확인이 남았습니다.

## 2026-11-19 · TASK-009 카카오 K-02~K-04 개발 봇테스트

- Aside로 `같은 말` 세 번, `늦게 4`·`늦게 6`, `빈 응답 1`~`4`를 보냈습니다. Wrangler로 기록 9건의 항목과 결과를 대조했습니다.
- 동일 발화는 세 번 모두 시각을 뺀 키와 본문 해시가 같았습니다. 첫 두 발화의 간격은 1.899초였고 2초 구간 번호는 세 건 모두 달랐습니다. 표시된 ID 후보는 봇 사용자 키의 경로였습니다.
- 4.5초 응답은 보였고 6초 응답과 빈 응답 네 가지는 말풍선 없이 끝났습니다. 6초 Worker 요청은 약 4분간의 기록에서 한 건만 확인했습니다. 카카오톡 앱의 실제 대화 화면과 시험 사진 저장은 남았습니다. [카카오 시험 대본](../10-wbs/kakao-test-script.md#k-02-같은-말open-1)

## 2026-11-19 · TASK-174 서울 Supabase 마이그레이션

- `siljang-dev`에 원본 커밋 `97e05c7e09bdf8e4c57799cc8253e8341b5a1c77`의 `db/migrations` 0001~0022를 적용했습니다. 현재 `main`과 이 경로의 차이는 0입니다. Aside가 적용할 SQL 파일의 SHA-256을 확인한 뒤 Supabase Management API로 같은 프로젝트에 한 번 실행했습니다.
- 빈 `public`을 확인하는 조건과 트랜잭션 잠금을 사용했습니다. 원장 `siljang_deploy.migrations`에는 파일명·원본 커밋·파일별 SHA-256·적용 시간이 있습니다. 적용 후 API 검증 결과는 원장 22행, `public` 테이블 60개, `btree_gist` 설치였습니다. 대시보드에서 Free와 Data API 비활성화를 확인했습니다.
- PostgreSQL TLS 직결 또는 세션 풀러 접속, 서버 전용 역할과 `access_logs` 권한, Worker를 통한 사용은 확인이 남았습니다.

## 2026-11-19 · TASK-009 카카오 K-11 로그인 시험

- 개발 봇의 `로그인 시험` 카드가 만든 링크 3개를 Aside에서 순서대로 열었습니다. 결과 화면의 토큰 요청은 ① 정상 PKCE 200, ② 틀린 verifier 400(`invalid_grant`·`KOE313`), ③ PKCE 없이 200이었습니다. Wrangler의 마스킹된 Worker KV에서도 세 모드 결과가 각각 성공·거절·성공이었습니다.
- 이 시험 앱의 카카오 토큰 서버는 인가 요청에 포함된 PKCE 값을 검증했고, PKCE가 없는 요청도 허용했습니다. 카카오톡 앱의 버튼 동작과 Siljang 본앱의 로그인은 확인이 남았습니다. [카카오 시험 대본](../10-wbs/kakao-test-script.md#k-11-카카오-로그인-pkceopen-11)

## 2026-11-19 · TASK-009 카카오 K-01 개발 봇 시험

- Aside로 개발 봇테스트에서 `시험 시작`을 한 번 보냈습니다. 화면에 `시험 서버가 받았어요(K-01)`와 메뉴 10개, NRT, 처리 0ms가 표시됐습니다. `isFriend`와 `appUserId`는 값 없음으로 표시됐습니다.
- Wrangler로 해당 시간대의 마스킹된 KV 기록 1건에서 `kind=skill`, `item=K-01`, 응답 상태 200을 확인했습니다. 카카오톡 앱에서 친구 추가 전후로 보내는 시험과 다른 항목은 남았습니다. [카카오 시험 대본](../10-wbs/kakao-test-script.md#k-01-시험-시작open-1-8-1)

## 2026-11-19 · TASK-170 서울 Supabase 개발 프로젝트

- Aside에서 `siljang-dev`를 `Free`·`Nano`로 생성했습니다. 대시보드의 리전은 `Northeast Asia (Seoul)`(`ap-northeast-2`)이고 상태는 `Active`입니다. 프로젝트의 Data API가 비활성화된 상태도 다시 확인했습니다.
- 데이터베이스 비밀번호를 Aside Vault에 보관했습니다. `SUPABASE_DEV_DB_URL`·`SUPABASE_DEV_POOLER_URL`은 Vault의 연결 템플릿 이름입니다. 비밀번호를 적용한 실제 연결은 TASK-171에서 확인합니다.

## 2026-11-19 · TASK-016 main 자동 배포와 실행기 실패 모니터

- Aside로 배포 토큰을 Vault와 GitHub `staging`의 `CLOUDFLARE_API_TOKEN`에 등록했습니다. GitHub CLI에서 두 비밀 값 이름과 `SILJANG_STAGING_DOMAIN`을 확인했습니다.
- `main` 커밋 `97e05c7e09bdf8e4c57799cc8253e8341b5a1c77`의 `스테이징 배포`가 성공했습니다. Wrangler로 배포 태그를 대조했고, 공개 주소에서 상태 200과 `status=ok`, 로그인 화면 200, 세션 없는 운영자 조회 401을 확인했습니다. [GitHub Actions 배포 작업](https://github.com/kodonghui/siljang.ai/actions/runs/44436005766/job/135265573044)
- Cloudflare의 `Siljang staging job failures` 모니터가 활성화 상태입니다. `siljang-staging`의 Workers Logs에서 `job_run_failed` 또는 `job_find_failed`가 한 건 이상이면 계정 소유자 1명에게 이메일을 보내도록 설정했습니다. 실행 주기는 15분이며 메일 수신 시험은 남았습니다. [Cloudflare 모니터 문서](https://developers.cloudflare.com/notifications/monitors/)

## 2026-11-19 · TASK-183 Cloudflare Images WebP 회전

- Cloudflare Images 대시보드에서 시험 전 무료 포함량 5,000건 중 사용량 0건을 확인했습니다. Wrangler 4.158.0에서 `dev --remote`로 별도의 미리보기 Worker에 Images 바인딩을 연결했습니다. [Images 바인딩 문서](https://developers.cloudflare.com/images/optimization/binding/)
- 24×16 정적 파일은 16×24, 4,000×3,000 정적 파일은 3,000×4,000, 24×16 애니메이션은 16×24로 회전했습니다. 모두 HTTP 200과 `image/webp`였습니다. Pillow로 입력 알파 채널을 회전해 출력과 비교했고, 모든 프레임이 일치했습니다. 애니메이션은 2프레임, 지연 80·120ms, 반복 값 3을 유지했습니다.
- `curl`의 각 전체 응답 시간은 0.921·0.785·0.259초였습니다. 큰 크기의 합성 입력은 압축 후 1,022바이트였습니다. 큰 압축 파일, 모든 방향, 실제 사용자 사진 경로와 CPU·메모리 사용량은 미확인입니다.

## 2026-11-19 · TASK-014 구글 OAuth 시험 설정

- Aside에서 구글 클라우드 `Siljang` 프로젝트를 만들었습니다. 같은 프로젝트의 Billing에서 연결된 결제 계정이 없음을 확인했습니다.
- Google Auth Platform의 앱 이름은 `Siljang`, Audience는 `External`·`Testing`입니다. Data Access에서 `https://www.googleapis.com/auth/drive.file`이 비민감 범위 한 개이고 민감·제한 범위가 비어 있음을 확인했습니다. [Drive API 범위](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- Verification Center는 현재 `Testing` 상태에서 검증이 필요 없다고 표시했습니다. OAuth 클라이언트 생성과 파일을 선택하는 실제 시험은 TASK-156에서 진행합니다.

## 2026-11-19 · TASK-010 카카오 스킬 발신 검증 문의

- Aside에서 `봇 생성하기` → `스킬 등록 및 관리`로 ‘오픈빌더 스킬 요청의 발신 검증 문의’를 보냈습니다. 10:05:48 KST에 ‘문의가 정상적으로 접수되었습니다. 확인후 이메일로 답변드리겠습니다.’ 화면을 확인했습니다. [카카오 문의처](https://cs.kakao.com/requests?service=169)
- 보낸 본문

  > 카카오톡 채널 봇(오픈빌더)의 스킬 서버를 만들고 있습니다. 스킬 서버가 받은 요청이 카카오에서 보낸 것인지 확인할 방법이 있는지 문의드립니다. (1) 스킬 요청에 서명(예: HMAC)을 붙이는 기능이 있는지, (2) 스킬 요청을 보내는 카카오 서버의 출처 IP 목록을 받을 수 있는지, (3) 둘 다 없다면 스킬의 헤더값 입력 말고 권하시는 방법이 있는지 알려 주세요.

- 답 기다림. 답변은 TASK-011에서 06 OPEN-10에 반영합니다.

## 2026-11-19 · TASK-170 무료 MVP 개발 환경

- Aside의 Cloudflare `Workers plans`에서 `Free`가 `Current plan`으로 표시됐습니다. 같은 계정에 `siljang-staging`과 기존 스테이징 주소가 있습니다. Wrangler 4.158.0 `whoami`와 `hyperdrive list`가 성공했습니다.
- Supabase 대시보드 진입에 필요한 GitHub Mobile 확인 요청을 다시 발송했습니다. 서울 `ap-northeast-2` 프로젝트와 무료 할당량 확인이 남았습니다.

## 2026-11-19 · TASK-016 외부 감시와 배포 환경

- SSH 별칭 `ko-family`에서 systemd 사용자 서비스와 1분 타이머를 설치했습니다. `systemd-analyze --user verify`가 성공했고, `systemctl --user is-active`와 `is-enabled`가 각각 `active`와 `enabled`였습니다.
- `journalctl --user -u siljang-staging-health.service`에서 09:54와 09:55 KST의 `Siljang staging health check passed: HTTP 200, status=ok`를 확인했습니다. 스테이징의 비인증 API 응답 401과 시험 서버의 JSON이 아닌 응답 200은 수동 시험에서 실패로 판정했습니다. [스테이징 상태 확인](https://staging.siljang.ai.corthex-hq.com/api/healthz)
- Aside에서 `Rules` → `Settings` → `Managed Transforms`의 `Remove visitor IP headers` 스위치가 꺼진 상태임을 확인했습니다. Wrangler `versions view`의 스테이징 배포 태그는 `a038cdfc20e40c17a6ad93fe29309addce572989`였습니다.
- GitHub CLI로 `staging` 환경을 만들고 `CLOUDFLARE_ACCOUNT_ID`가 목록에 있는 것을 확인했습니다. `CLOUDFLARE_API_TOKEN`과 `SILJANG_STAGING_DOMAIN`, main 자동 배포와 장애 알림 전달은 확인이 남았습니다.

## 2026-11-19 · TASK-027 합성 상담 실제 평가

- Node 22.23.4에서 추적을 끈 평가 도구로 두 회사에 합성 상담 사례를 134개씩 보냈습니다. Anthropic 134개와 OpenAI 7개 응답을 얻었습니다. 비용 도구가 집계한 금액은 142.80원입니다. [평가 결과](ai-eval/2026-11-19-eval-20261118T203404Z-d00cea.md)
- OpenAI 스트림 오류 127건을 확인했습니다. 대표 응답은 HTTP 200 안의 `rate_limit_exceeded`와 약 15시간 뒤 재시도 안내였습니다. OpenAI를 다시 실행하고 검토 대상 44건의 사람 판정을 기록하는 일이 남았습니다.

## 2026-11-19 · TASK-008 카카오 시험 Worker

- Wrangler로 카카오 시험 Worker, 마스킹 기록용 KV, 콜백 큐를 배포했습니다. 하위 도메인 DNS가 생긴 뒤 인증서가 적용될 때까지 기다려 외부에서 HTTPS를 확인했습니다.
- OVH에서 `/health` 200과 `ok`, 키 없는 `/skill` 401, 합성 K-01의 200·응답 버전 2.0·바로가기 10개를 확인했습니다. K-01 응답의 기록 키로 Wrangler에서 KV를 읽었습니다. `kind=skill`, `item=K-01`이고 합성 원본 사용자 ID 두 개가 없으며 `uk:` 마스킹 표시가 있었습니다.
- 이 작업의 시험에서는 Worker에 합성 확인용 키를 두었습니다. TASK-007에서 실채널에 연결할 키를 새로 만들고 Aside Vault와 Worker 비밀 값에 둡니다. 실제 카카오 요청은 TASK-009에서 확인합니다.

## 2026-11-19 · TASK-016 스테이징 주소 연결

- 도구와 범위: Wrangler 4.158.0으로 Cloudflare `siljang-staging`을 배포하고 CORTHEX 도메인의 스테이징 주소를 연결했습니다. 기존 앱 코드 `74420fb`를 처음 배포한 뒤 GitHub Actions에 넣은 명령과 같은 옵션으로 배포를 다시 확인했습니다.
- 결과: OVH 두 곳에서 `/`, `/operator/login`, `/manifest.webmanifest`, `/service-worker.js`는 200, `/api/healthz`는 200과 `{"status":"ok"}`, 세션 없는 `/api/operator/me`는 401입니다. 데이터베이스 연결과 로그인 계정은 TASK-170 이후입니다. [스테이징 상태 확인](https://staging.siljang.ai.corthex-hq.com/api/healthz)
- OVH에서 보낸 정상 요청에 대해 Wrangler tail의 `CF-Connecting-IP`와 Cloudflare가 알려 준 요청 출처 IP가 같았습니다. 같은 경로에 임의의 `CF-Connecting-IP`를 넣은 요청은 HTTP 403이었고 Wrangler tail에 도착하지 않았습니다. Cloudflare API의 Pseudo IPv4 설정은 `off`였습니다.
- GitHub 연동 계정은 Actions 변수·비밀 값 조회와 `staging` 환경 생성에 403을 받았습니다. Actions `main` 자동 배포, 1분 외부 감시, 실행기 실패 알림이 남았습니다. Cloudflare API는 방문자 IP 헤더를 제거하는 관리 변환의 설정 조회에 403을 반환했습니다.

## 2026-11-21 · PR #122 합친 뒤 배포 확인

- main `d2a2d766abf6af256ba9ee51d4db0a89e6815821`의 app `44877763219`(스테이징 배포·공개 상태·운영자 DB 조회 포함)·db `44877763209`가 성공했습니다. 연결된 GitHub 도구의 원격 main과 서명 커밋·트리를 대조했습니다.
- 셸 HTTP·Git·Wrangler의 프록시 503이 남아 독립 배포 태그 조회와 카카오 조작은 미실행입니다. 이 결과를 실제 카카오 상담 성공으로 기록하지 않습니다.

## 2026-11-21 · TASK-030 사장님 로그인 화면의 로컬 브라우저 확인

- Chromium에서 실제 React 화면을 360·1280으로 열고 API만 합성 응답으로 대체했습니다. API-078의 200·422·429·기본 오류, API-001의 새 사장님·기존 가게·신고 보류 200과 401·422·429·503·기본 오류를 대조했습니다. 전체 화면 134개·흐름 18개에서 오류 0, 사장님 흐름 두 너비 모두 통과입니다.
- 인가 주소·코드 교환 본문, StrictMode에서도 POST 한 번, 콜백 쿼리 제거, 동의 거부 때 API 호출 0건, 안전한 돌아갈 위치, Retry-After 동안 버튼 막힘, 실패 후 로그아웃 재시도와 페이지 복원을 확인했습니다. 사진에서 카드가 가운데 있고 오류 안내와 글이 잘리지 않는 것도 확인했습니다.
- [검사 JSON](owner-login/2026-11-21-page-check.json) · [1280 기본 화면](owner-login/2026-11-21-normal-1280.png) · [360 오류 화면](owner-login/2026-11-21-error-360.png). 사진은 합성 추적 ID만 담고 있습니다.
- 실제 카카오 로그인은 미실행입니다. 환경 연결과 TASK-020의 스테이징 설정·마이그레이션, 카카오 공식 버튼 자산 적용 확인이 남았습니다. 업무 본문은 준비 중이므로 이를 업무 화면 완료로 기록하지 않습니다.

## 2026-11-21 · TASK-027 실제 OpenAI 재확인과 한도 중단

- 호출 전 progress.md와 draft PR #124에 두 건 확인의 전형 1.68원·상한 9.31원(실행 한도 20원), 본 134건 전형 111.72원·상한 621.49원(실행 한도 700원)을 적었습니다. 환율은 기존 1450원·2026-11-14 기준이며 당일 환율 조회는 하지 않았습니다. 기존 `OPENAI_API_KEY`를 이어 썼고 값은 출력하지 않았습니다.
- `eval-20261121T072229Z-139559`: 합성 두 건 모두 정상 출력, 한도 오류 0건, 사용량 기준 0.73원입니다. 이어서 `eval-20261121T072427Z-d934a7`을 실행했습니다. AMT-01은 정상 출력(0.19원), AMT-02·03은 `limit_reached`·`stream_rate_limit`이었습니다. 스트림 수집기는 공급자 코드 `rate_limit_exceeded`에만 이 유형을 붙이는 것을 소스에서 대조했습니다.
- 실패 상한 2번에서 AMT-04 앞에 자동 중단하고 종료 코드 4로 끝났습니다. 본 134건 가운데 시도 3·정상 출력 1·실패 2·미호출 131입니다. 실패 두 건의 사용량·금액은 미확인입니다. 사용량을 받은 세 호출의 계산 합은 0.92원이고 전체 청구액을 확인한 것은 아닙니다. 추가 모델 호출은 중단했습니다.
- [연결 확인 원본](ai-eval/2026-11-21-openai-probe/run.json) · [본 실행 설정](ai-eval/2026-11-21-openai-recheck/run.json) · [본 실행의 부분 결과](ai-eval/2026-11-21-openai-recheck/summary.md). 실제 손님 대화는 사용하지 않았습니다. 전체 모델 품질 비교와 WBS 완료 판정은 보류합니다.

## 2026-11-21 · 네트워크 회복과 PR #123 배포 태그 직접 확인

- 이전 프록시 503 이후 Git fetch와 Wrangler 큐 목록 조회가 종료 코드 0으로 끝났습니다. 큐 목록에 `siljang-staging-jobs`가 있습니다. 목록 조회와 앱 소비자 연결 완료는 구분합니다.
- 최신 배포 시각의 Worker 버전에서 태그 `af519bf73ca1a33079cc7da4ef2fff121008e0e4`를 확인했고 원격 main의 PR #123 SHA와 같았습니다. 공개 `/api/healthz`도 HTTP 200·ok였습니다. 오래된 첫 배포 항목의 태그를 현재 배포로 기록하지 않았습니다.
- 두 데스크톱의 SSH는 연결됐지만 기본 셸의 Aside 명령은 종료 코드 127이었습니다. Windows 설치 앱에 Aside가 있음을 확인해 실행 경로를 조회하고 있습니다. 아직 실제 웹 계정·카카오 조작은 미실행입니다.

## 2026-11-21 · TASK-173 원격 스키마 확인 중단과 PR #124 배포 확인

- main `5861032782781e422c0dc267abaee3859ccda7e5`의 app `44880964308`(스테이징 배포 포함)·db `44880964294`가 성공했습니다. Wrangler의 최신 배포 시각 버전 태그와 원격 SHA가 같고 공개 상태 HTTP 200을 확인했습니다.
- 공개 경로가 없는 Wrangler 원격 미리보기로 서버 역할·스키마 생성 권한·owner_sessions·콜백 열의 존재를 읽으려 했으나 두 번 모두 HTTP 500과 ProxyWorker 연결 끊김으로 끝났습니다. 두 번째는 앱의 pgConnector를 사용해 오류 수신과 닫기를 처리했습니다. 데이터베이스 응답을 받은 것이 아니므로 존재·부재를 단정하지 않습니다. 프로세스를 종료하고 이 조회를 중단했습니다.
- 두 데스크톱의 SSH와 Aside 브라우저 설치는 확인했습니다. 기본 셸·Windows 통상 CLI 경로·WSL에서 두 CLI를 찾지 못해 실제 계정 화면 조작은 하지 않았습니다. 비밀 값과 사용자 경로는 기록하지 않았습니다.

## 2026-11-21 · TASK-028 공통 응답 확인 범위

- 로컬 PostgreSQL 16.15와 Hono 요청 시험에서 연결 확인 중인 세 경로의 연락처와 기록 생성 0건, 가게 A·B 연락처 분리, 다른 연결 키의 연락처 조회 0건을 확인했습니다. 고정 응답 11종의 API 예시·SkillResponse 스키마·상태·헤더를 대조했습니다. 실제 카카오 앱 화면이나 AI 처리 연결을 확인한 것은 아닙니다.
- 실제 모델 호출은 추가하지 않았습니다. 스테이징 설정·스키마와 도구 연결이 확인된 뒤 같은 경로를 실제 채널에서 확인합니다. 현재 WBS TASK-028은 진행 중으로 유지합니다.

## 2026-11-21 · PR #125·127 배포와 TASK-028 중단 시험

- PR #125의 main `e96ebfa1b5a5b052153ad2dc2caf31b443eead10`: app `44884014953`(스테이징 배포 포함)·db `44884014990` 성공 뒤 Wrangler의 최신 배포 시각 버전 태그와 SHA를 직접 대조했습니다. 공개 `/api/healthz`는 200·ok였습니다.
- PR #127의 main `4c67291bf98527baa5debbdb3e22f00d47f528f4`: app `44885492241`(배포 포함)·db `44885492284` 성공, Git fetch로 받은 origin/main과 직접 조회한 최신 Worker 태그가 같고 공개 상태 200·ok였습니다.
- PR #128은 로컬 PostgreSQL 16.15에서 중단된 트랜잭션의 변경이 남지 않는 것, 늦은 쿼리·커밋과 연결 대기 중의 쓰기를 막는 것을 확인했습니다. Hono·가짜 시계의 스킬 전체 기한 시험과 합쳐 17개가 통과했습니다. 실제 카카오 발송·AI 호출·스테이징 동시 20개 부하 시험은 하지 않았습니다.

## 2026-11-21 · PR #128 배포와 TASK-183 원격 검증 중단

- main `564aaba6abce8b09db6c58071d19171941073acd`의 app `44886250079`(배포 포함)·db `44886250074`가 성공했습니다. Git fetch의 origin/main과 Wrangler 최신 배포 시각의 버전 태그가 같은 SHA이고 공개 `/api/healthz` 200·ok를 직접 확인했습니다.
- TASK-183 합성 입력 20개를 만들고 첫 방향 6의 602바이트 WebP를 Wrangler 원격 미리보기에 보냈으나 HTTP 500·ProxyWorker의 Network connection lost였습니다. 공식 안내의 로컬 실행과 `images.remote=true`로 바꾼 두 번째도 HTTP 500·Images 바인딩의 Network connection lost였습니다. 이후 프로세스를 종료했고 원격 요청을 더 하지 않았습니다.
- 이미지 출력·CPU·최대 Worker 메모리는 미확인입니다. 로컬 독립 검사기가 원본 촬영 정보 남음을 검출했지만 이는 원격 변환 통과의 증거가 아닙니다. [재현 도구와 결과](../../research/webp-orientation-2026-11/README.md)를 보존했으며 앱 바인딩·수신 경로는 바꾸지 않았습니다.

## 2026-11-21 · PR #129 배포와 TASK-158 요청 키 시험

- main `b7c74943f3e1458c4fc5e658d061b0c85cd28d0e`의 app `44887547373`(배포 포함)·db `44887547229` 성공을 확인했습니다. 공개 Git의 원격 main과 Wrangler 최신 배포 시각의 버전 태그가 같고 공개 상태는 200·ok였습니다.
- 로컬 PostgreSQL 16.15에서 24시간 경계·최근 키 보존·유효 처리 임대·잠금·배치·동시 지우기 11개 시험이 통과했습니다. 아직 03:00 실행기에 연결하거나 스테이징의 실제 기록을 지운 결과는 아닙니다.

- 같은 로컬 PostgreSQL에서 AI 도구 인자의 30일 경계·열린 상담·가게 분리·잠금·동시 실행과 비용 행 보존 네 시험이 통과했습니다. 관련 정적 검사와 요청 키를 합쳐 28개입니다. 중간 CI의 모의 쿼리 타입 오류를 고친 뒤 전체 웹·서버 타입 검사도 통과했습니다. 스테이징의 실제 지우기는 아직 실행하지 않았습니다.

- 같은 로컬 PostgreSQL에서 접속기록의 2년 경계·최근 기록·미래 기준 시각·다른 가게·잠금·동시 배치 다섯 시험이 통과했습니다. 전체 관련 33개와 웹·서버 타입·린트 성공을 확인했으며 아직 스테이징 지우기나 03:00 실행 결과는 아닙니다.
