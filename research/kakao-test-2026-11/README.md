# 카카오 시험 서버(TASK-008)

## 1. 무엇·왜

- 06 API 계약의 열린 질문 8개(OPEN-1·2·3·4·8·9·11·12)를 실제 카카오 요청으로 확인하려고 만든 버리는 서버입니다. 제품 코드가 아니고, TASK-011이 끝나면 지웁니다(6절).
- 무엇을 보내고 누를지는 대본 [`docs/10-wbs/kakao-test-script.md`](../../docs/10-wbs/kakao-test-script.md)에 있습니다. 대본의 항목 K-01~K-11마다 이 서버가 필요한 답(바로 답, 4.5초·6초 뒤 답, 빈 응답 네 가지, 콜백, 사진 받기, 후기 버튼의 extra, 봇 ID, Event API, 카카오 로그인 PKCE)을 보냅니다.
- 받은 스킬 요청은 손님 값을 마스킹해 Cloudflare KV에 14일 동안 남깁니다(5절). 기록을 공개로 읽는 경로는 없고, Claude가 wrangler와 API 토큰으로만 읽습니다.
- Cloudflare 계정·API 토큰으로 배포합니다. 2026-11-19 시험 주소에서 합성 요청과 마스킹 기록을 확인해 TASK-008의 끝난 조건을 채웠습니다. [실제 환경 확인](../../docs/records/hands-on.md)

## 2. 폴더

| 파일 | 하는 일 |
| --- | --- |
| `worker/src/index.ts` | 경로(`POST /skill`, `GET /login/start`·`/login/callback`, `GET /health`)와 KV·큐·fetch를 쓰는 부분 |
| `worker/src/items.ts` | 받은 요청에서 대본 항목을 고르고 항목마다 답을 만듦(입력만으로 정하는 함수) |
| `worker/src/kakao.ts` | 스킬 응답 만들기와 카카오 한도(출력 3개, 바로가기 10개, 버튼 3개, 이름 14자, simpleText 1000자) |
| `worker/src/mask.ts`, `worker/src/record.ts` | 손님 값 마스킹과 기록 본문 |
| `worker/src/login.ts` | 카카오 로그인 PKCE 시험(S256, RFC 7636), 시험 표와 state 서명 |
| `worker/test/*.test.ts` | 단위 시험(문서 예제 모양에 가짜 값, `worker/test/fixtures/README.md`) |
| `worker/test/local-e2e.sh`, `worker/test/mock-kakao.mjs` | 계정 없이 wrangler dev와 가짜 카카오 서버(콜백·사진·리다이렉트)로 하는 로컬 시험 |
| `worker/wrangler.template.jsonc` | Worker 설정. KV ID 자리는 비워 둠 |
| `deploy.sh` | 자원 만들기·배포·비밀 값 넣기(4절) |
| `read-records.sh` | 기록 내려받기(5절) |

`worker/wrangler.local.jsonc`(KV ID가 든 설정), `worker/.dev.vars`, `local/`(배포 출력·내려받은 기록)은 `.gitignore`로 저장소에 넣지 않습니다.

## 3. 로컬 시험(계정 없이)

```bash
cd research/kakao-test-2026-11/worker
npm ci
npm run check
npm run e2e:local
```

- `npm run check`: 형 검사(`tsc --noEmit`)와 단위 시험(`node --test`, Node 22의 형 지우기로 TS를 바로 돌림).
- `npm run e2e:local`: wrangler dev(로컬 모드, 원격 바인딩 없음)에 무작위 시험 키를 넣어 띄우고, 가짜 카카오 서버로 콜백·사진을 받아 항목별 답과 KV 기록을 봅니다. 실제 카카오·Cloudflare에는 닿지 않습니다.
- 모든 wrangler 명령은 `WRANGLER_SEND_METRICS=false`로 돌립니다(사용 통계 보내지 않음).
- 로컬 시험은 포트 8791(wrangler dev)과 8792(가짜 카카오 서버)가 비어 있어야 합니다. 이미 무언가 답하면 옛 서버에 붙지 않도록 바로 멈춥니다. 끝나면 wrangler dev의 자식 프로세스(workerd)까지 멈춥니다.
- 2026-11-15 결과(Node 22.23.4, wrangler 4.156.0, TypeScript 5.9.3): 형 검사 오류 0, 단위 시험 41개 통과, 로컬 시험 50개 통과(1분 40초). npm 레지스트리에서 받는 데 막힘은 없었습니다. 로컬 시험에서 큐의 27초 지연 보내기와 waitUntil 2초 콜백이 가짜 카카오 서버에 닿았고, 허용 호스트 밖의 사진 주소와 밖으로 가는 리다이렉트는 받지 않고 건너뛰었으며, 표가 없거나 틀리거나 지난 로그인 시험은 403, 서버가 만들지 않은 state는 기록 없이 400이었고, 기록 30건에 견본의 가짜 손님 값·시험 키가 그대로 남지 않았습니다.

## 4. 배포

1. 환경 변수(반복 0 안내서 3절): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `KAKAO_TEST_SKILL_KEY`. 하위 도메인 배포에는 `KAKAO_TEST_DOMAIN`에 스킴·경로를 뺀 이름을 넣습니다. 있으면 `KAKAO_TEST_REST_API_KEY`(K-10·K-11), `KAKAO_TEST_CLIENT_SECRET`(K-11)도 넣습니다.
2. `bash research/kakao-test-2026-11/deploy.sh`
   - 처음 한 번: KV 이름공간 `siljang-kakao-test-records`와 큐 `siljang-kakao-test-callbacks`를 만들고, KV ID를 넣은 `worker/wrangler.local.jsonc`를 씁니다.
   - 단위 시험을 돌린 뒤 Worker `siljang-kakao-test`를 올립니다. `KAKAO_TEST_DOMAIN`을 주면 Cloudflare 사용자 지정 도메인에, 비워 두면 workers.dev에 연결합니다. 비밀 값이 들어가기 전에는 `/skill`이 503으로 요청을 거절합니다.
   - 비밀 값은 표준 입력으로만 넣습니다: `SKILL_KEY`, 마스킹 HMAC 키 `HASH_KEY`(처음 한 번 `openssl rand`로 만들고 Cloudflare 밖에 남기지 않음. 바꾸면 전에 남긴 기록과 사용자 표시를 견줄 수 없음), 있으면 `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`.
   - 끝에 `/health`와 키 없는 `/skill`(401이어야 함)을 보고 시험 주소를 화면에만 찍습니다. 주소는 채팅으로 동희님께 드리고 저장소·기록에는 적지 않습니다.
3. 동희님이 대본 1절대로 봇과 앱에 주소를 넣으면, Claude가 첫 스킬 요청을 `read-records.sh`로 보고 시작을 알려 드립니다.

- 토큰 권한: 안내서 4-1의 ③ 4(템플릿 `Edit Cloudflare Workers` + Queues). KV는 템플릿에 있고, Queues 권한이 목록에서 어떤 이름으로 보이는지는 확인 못 함입니다.
- 새 계정에서 workers.dev 하위 도메인을 먼저 정해야 하는지는 확인 못 함입니다. 배포가 그 때문에 멈추면 `local/deploy.log`를 보고 Cloudflare 대시보드의 Workers 첫 화면에서 정한 뒤 다시 돌립니다.
- 비용: Workers 유료 플랜(TASK-170)에서 KV 쓰기는 월 100만 건, 큐는 월 100만 작업까지 요금에 들어 있습니다 [C2]. 시험 한 번은 기록 50건 안팎입니다.

## 5. 기록과 Claude가 읽는 법

- 저장 곳: KV 이름공간 하나(바인딩 `RECORDS`). 고른 이유(Claude 판단)
  - Claude가 TASK-170의 같은 API 토큰과 wrangler로 바로 읽습니다(`wrangler kv key list/get --remote`). 기록을 꺼내는 HTTP 경로를 따로 열 필요가 없습니다.
  - 키마다 TTL(14일)을 걸어 지우는 일을 따로 두지 않아도 됩니다.
  - D1(표 설계가 들고 TTL이 없음), R2(버킷과 수명 규칙을 따로 만듦), Workers Logs(콘솔 출력이 마스킹 전 값으로 남을 수 있음)보다 이 시험에 단순합니다. Workers Logs는 꺼 둡니다(`observability.enabled: false`).
  - KV는 다른 데이터센터에 퍼지기까지 시간이 걸리지만, 기록은 시험이 끝난 뒤에 읽으므로 괜찮습니다.
- 읽기: `bash research/kakao-test-2026-11/read-records.sh` → `local/records/<UTC 시각>/`에 기록마다 JSON 한 파일과 한 줄 요약 `summary.tsv`.
- 기록 키: `rec:<받은 시각 ISO>:<무작위 4자>`. 종류(`kind`): `skill`(스킬 요청과 우리 답), `skill_rejected`(키가 틀린 스킬 요청 모양, IP 없음), `callback_result`(콜백을 보낸 결과와 카카오의 답), `event_result`(Event API의 답과 작업 결과), `login_result`(로그인 시험의 결과), `error`.
- `skill` 기록의 필드: 받은 시각, 항목, 처리 ms, 헤더(아래 규칙), Cloudflare 정보(데이터센터·나라·ASN·HTTP 판·TLS 판·RTT), 본문 바이트 수와 HMAC, 같은 요청 거르기 후보 키(OPEN-1), 받은 필드 목록, 문서에 없는 ID 같은 필드, 마스킹한 본문, 마스킹한 우리 답, 항목별 덧붙임.
- 마스킹 규칙(원래 값은 되살릴 수 없음):
  - 사용자 키(`userRequest.user.id`, `botUserKey`, `plusfriendUserKey`, `appUserId`, Event API 결과의 `userID`): `uk:<글자 종류와 길이>:<HMAC 앞 12자>`. 같은 사용자는 같은 표시라 요청끼리 견줄 수 있습니다.
  - 그 밖의 ID(`id`, `…Id`): `id:<꼴>:<HMAC 앞 12자>`. 카카오가 만든 작업 ID(`taskId`)는 그대로 둡니다(문의할 때 씀).
  - 주소: 스킴·호스트와 경로 조각의 길이만, 쿼리는 이름만(`expires` 값은 둠). 시험 서버의 workers.dev 하위 도메인은 지웁니다.
  - 글: 숫자가 7개 넘게 이어지면(사이에 빈칸·점·붙임표 하나씩 허용) `#`으로, 이메일은 길이만. ISO 날짜·시각은 둡니다. 글 안의 JSON(보안 이미지 값)은 풀어서 같은 규칙으로.
  - 헤더: 스킬 키는 맞는지만, `authorization`·`cookie`는 길이만, 정해 둔 헤더(콘텐츠 종류, user-agent 등)만 값, 나머지는 꼴과 HMAC. 출처 IP는 스킬 요청에만(카카오 서버의 주소, OPEN-10 참고), 로그인 시험에서는 남기지 않습니다.
  - 사진은 받아서 상태·종류·바이트 수·걸린 ms만 세고 버립니다. 로그인 시험의 토큰도 받자마자 버리고 있었는지만 남깁니다. 봇 ID는 대화창 답에만 끝 4자를 보이고 기록에는 `****`로 남깁니다.
- 사진을 받으러 가는 곳: 카카오 쪽 도메인(`kakaocdn.net`, `kakao.com`, `kakao.co.kr`, `daumcdn.net`과 그 하위)만입니다. 대화창에 누가 다른 주소를 적어도 서버가 그 주소로 요청하지 않게 하려는 것입니다. 목록 밖이면 받지 않고 '건너뜀'과 주소 꼴(호스트 포함)만 남깁니다. 리다이렉트는 3번까지 직접 따라가며 호스트마다 다시 봅니다. K-06에서 사진이 다른 호스트로 오면 Worker 변수 `EXTRA_IMAGE_HOSTS`(쉼표 목록)에 그 호스트를 더해 다시 올립니다. 로컬 시험은 이 변수로 `127.0.0.1`을 더합니다.
- 키 없이 닿는 경로를 좁힌 것
  - 로그인 시험(K-11): 카드의 버튼 주소에 30분짜리 표(`HASH_KEY`로 만든 HMAC)를 붙여, 카드를 받은 사람만 `/login/start`를 엽니다. 표가 없거나 틀리면 403이고, KV에 쓰지도 REST API 키(인가 주소의 `client_id`)가 든 주소로 보내지도 않습니다. state도 서버가 서명한 것만 KV에서 찾고 기록합니다.
  - 키가 틀린 스킬 요청과 오류 기록은 Worker 인스턴스마다 20건까지만 남깁니다(아무나 보낸 요청으로 KV 쓰기를 채우지 못하게).

## 6. 지우는 법(TASK-011 뒤)

```bash
cd research/kakao-test-2026-11/worker
npx wrangler delete -c wrangler.local.jsonc
```

그 뒤 `npx wrangler kv namespace list`로 `siljang-kakao-test-records`의 ID를 보고 `npx wrangler kv namespace delete --namespace-id <ID>`, `npx wrangler queues delete siljang-kakao-test-callbacks`. 마지막으로 `local/`과 `worker/wrangler.local.jsonc`를 지웁니다. 봇의 스킬 주소와 디벨로퍼스 앱의 리다이렉트 URI는 동희님이 지웁니다.

## 7. 확인 못 한 것

- 2026-11-19 Cloudflare에서 HTTPS `/health` 200, 키 없는 `/skill` 401, 합성 K-01 응답의 바로가기 10개, KV 기록의 가짜 사용자 ID 마스킹을 확인했습니다. 실제 카카오 스킬 키의 Aside Vault 보관과 봇 연결이 남았습니다. 큐의 지연 보내기(`delaySeconds`), waitUntil로 25초까지 기다린 콜백, 사진 주소 받기는 로컬에서 확인했습니다.
- 새 계정의 workers.dev 하위 도메인, Queues 토큰 권한의 이름(4절).
- 보통 사진 메시지의 주소가 어느 호스트로 오는지(5절의 목록은 카카오 쪽 도메인으로 잡은 Claude 판단입니다).
- 카카오 쪽의 확인 못 한 것은 대본 5절에 있습니다.

## 출처(2026-11-15 확인)

| 번호 | 문서 | 주소 |
| --- | --- | --- |
| C2 | Cloudflare Workers: Pricing(KV·Queues 포함량) | https://developers.cloudflare.com/workers/platform/pricing/ |
| C12 | Cloudflare Workers: Limits(waitUntil은 응답 뒤 30초까지) | https://developers.cloudflare.com/workers/platform/limits/ |
| C13 | Cloudflare Queues: Limits(delaySeconds 24시간까지) | https://developers.cloudflare.com/queues/platform/limits/ |
| C14 | RFC 7636 Proof Key for Code Exchange(부록 B의 S256 예) | https://www.rfc-editor.org/rfc/rfc7636 |

카카오 문서는 대본 7절에 있습니다.
