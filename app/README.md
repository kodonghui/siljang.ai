# app: 서버와 웹 (11단계 원본)

TASK-015(REQ-135)의 개발 저장소 뼈대와 TASK-018의 공통 요청 처리(요청 키·오류 응답·데이터베이스 연결 층·시각과 확인 카드의 바탕·운영 기록)입니다. 계약은 [../api/openapi.yaml](../api/openapi.yaml), 스키마는 [../db/](../db/)에 있고 여기서 고치지 않습니다.

## 설계 메모

1. 배치: `app/` 아래 npm workspaces 둘. `server/`는 Cloudflare Workers의 Hono(TypeScript strict), `web/`은 React·Vite. 웹 빌드(`web/dist`)를 같은 Worker가 정적 자산으로 줍니다(tech-stack.md ②·③).
2. 주소: API는 `/api` 아래에 둡니다. 07 사이트맵의 화면 주소(`/owner/orders` 등)와 06 계약의 API 경로가 같은 출처에서 겹치기 때문입니다. `/api/*`만 Worker 코드가 받고(`run_worker_first`), 나머지는 정적 파일이며 없는 화면 주소는 `index.html`입니다. 계약의 `servers` 주소는 TASK-016에서 정합니다.
3. `GET /api/healthz`는 06 계약에 없는 기반 시설 주소입니다(TASK-016의 1분 감시용). 계약 API가 아닙니다.
4. 오류: 06의 Problem(`application/problem+json`; `type`·`title`·`status`·`code`·`traceId`, 코드에 따라 `errors`·`confirm`·`retryAfterSeconds`) 꼴입니다. 오류 코드 37개와 필드 오류 사유 24개는 `server/src/problem.ts` 한 곳에 손으로 적었고, `server/test/contract.test.ts`가 06 계약(`components.x-corthex`의 errors·fieldErrors와 `Problem`·`FieldError` 스키마)과 같은지, 코드마다 나가는 응답이 계약의 Problem 스키마에 맞는지(Ajv) 봅니다. 코드마다 붙어야 하는 것(422 `validation_failed`의 `errors`, 409 `confirmation_required`의 `confirm`, 429의 `retryAfterSeconds`와 `Retry-After`, 405의 `Allow`)이 빠지거나 다른 코드에 붙으면 그 응답을 내보내지 않고 500 `internal`로 바꿉니다. 계약에 없는 방법으로 부르면 405와 `Allow`(06 DEC-02), 없는 경로는 404입니다.
5. 설정과 키: env는 `server/src/settings.ts` 한 곳만 읽습니다. 비밀 값(`ANTHROPIC_API_KEY`·`OPENAI_API_KEY`·`DATABASE_URL`·`REQUEST_HASH_KEY`)은 Worker 비밀 값이나 환경 변수에만 두고, 글·JSON·로그로 바꾸면 가립니다. `DATABASE_URL`은 `postgres://`나 `postgresql://`로 시작하고 `REQUEST_HASH_KEY`(요청 지문의 HMAC 키)는 32자 이상이어야 하며, 아니면 값을 싣지 않은 설정 오류(500)로 멈춥니다. 모델은 서버만 부르고 `VITE_*`에는 비밀 값을 넣지 않습니다. `APP_ENV`가 없으면 production입니다.
6. 로컬 값은 `server/.dev.vars`에 둡니다(저장소에 넣지 않음, 값 없는 예시는 `server/.dev.vars.example`). 시험은 키 없이 지납니다.
7. 로그: `server/src/log.ts`의 JSON 한 줄이고 event·traceId·errorName·names·status·code(06 오류 코드)·dbCode(SQLSTATE 5자)만 싣습니다. 각 값은 그 꼴에 맞을 때만 씁니다. 오류 메시지·스택·SQL·넣은 값·요청 본문·헤더·설정 값은 응답에도 로그에도 싣지 않습니다(04 G6). 예상하지 못한 오류의 응답은 일반 500 `internal`과 `traceId`뿐입니다.
8. 서버 코드는 Node 형식을 쓰지 않습니다. 타입은 `wrangler types`가 만드는 Workers 런타임 형식만 보고(`npm run typecheck`가 만듦), 시험만 Node 형식을 씁니다.
9. 도구: Node 22.23.4(`.nvmrc`), npm과 `package-lock.json`, TypeScript 7, Vitest 5, Biome(린트와 형식을 도구 하나로). 버전은 모두 정확히 고정했습니다.
10. Vitest 5를 고른 까닭: 4.1은 Node 22의 npm 10.9가 vite 8의 선택 피어(@vitejs/devtools)와 함께 풀다 멈춥니다. 서버 시험은 Node에서 `app.request()`로 돌리고, Workers 런타임 시험(vitest-pool-workers, 지금은 Vitest 4.1만 받음)은 TASK-171·173에서 정합니다.
11. lockfile은 나온 지 일주일 넘은 판만 쓰도록 `npm install --before=2026-11-08`로 만들었습니다. 의존성을 바꿀 때도 같은 방식을 씁니다.
12. wrangler 설정에는 계정 ID·도메인·비밀 값이 없습니다. 배포(TASK-016)는 CI 환경 변수로 계정을 고릅니다. Hyperdrive·Queues·Cron은 TASK-173에서 더합니다. `nodejs_compat`는 따로 켜지 않습니다. Cloudflare 문서(Hyperdrive 'Connect to PostgreSQL', 2026-10-23 고침, 2026-11-15 확인)에 따르면 호환 날짜가 2026-08-04 이후인 Worker는 `nodejs_compat`·`nodejs_compat_v2`가 기본으로 켜지고, 이 Worker의 호환 날짜는 2026-11-01입니다. TASK-015 때 적은 'nodejs_compat은 TASK-171·173에서 더함'은 이 확인으로 고칩니다(TASK-018).
13. CI(`.github/workflows/app.yml`): 설치·린트·타입 검사·시험용 데이터베이스(PostgreSQL 16.15, `db.yml`과 같은 이미지 digest, 마이그레이션 0001\~0020)·시험·빌드와, 저장소 키 검사·로그 키 검사(`../tools/check-no-keys.mjs`). 작업에 비밀 값을 넘기지 않습니다. CI는 `REQUIRE_DATABASE_TESTS=1`이라 데이터베이스 시험을 건너뛰지 않고, 연결이 없으면 실패합니다.
14. 데이터베이스 드라이버: node-postgres `pg` 8.23.1(2026-09-30 나옴). Cloudflare Hyperdrive 문서(2026-11-15 확인, 'node-postgres (pg)' 쪽은 2026-04-21 고침)가 '권함'으로 적은 드라이버이고(Hyperdrive에는 8.16.3 이상), 기술 스택 제안(`docs/10-wbs/tech-stack.md`)이 고른 것과 같습니다. 문서대로 요청마다 새 `Client`를 만들고(연결 풀은 Hyperdrive가 맡음) 응답 뒤 닫습니다(`server/src/db.ts`). 업무 코드는 pg를 직접 부르지 않고 `Queryable`·`RequestDb`만 받습니다. 날짜(`date`)와 시간대 없는 시각(`timestamp`)은 JS Date로 바꾸지 않고 글 그대로 받습니다(서버의 시간대가 섞이지 않게, 04 G8). 타입은 `@types/pg` 대신 쓰는 부분만 적은 `server/src/types/pg.d.ts`입니다(`@types/pg`는 Node 형식을 끌고 와 8번을 깹니다). Workers 런타임(workerd)에서 `wrangler dev`로 로컬 PostgreSQL에 직접 붙어 쿼리와 요청 키 다시 돌려주기를 한 번 확인했습니다(2026-11-15, Hyperdrive 없이). Hyperdrive 바인딩과 Workers 런타임 시험은 TASK-173입니다.
15. 요청 키(04 G2, 06 DEC-04, TBL-050): 쓰기 명령은 `server/src/request-key.ts`의 `runCommand`로 처리합니다. `Idempotency-Key` 헤더(16\~64자, 영문·숫자·`_`·`-`)가 없거나 틀리면 422 `validation_failed`(`header:Idempotency-Key`)입니다. 요청 지문은 명령·경로의 ID·본문을 키 순서로 이은 JSON의 HMAC-SHA256(`REQUEST_HASH_KEY`)입니다. 같은 키에 다른 지문이면 422 `idempotency_key_reused`, 처리 중(60초 안)이면 409 `request_in_progress`, 끝났으면 처음과 같은 상태 코드로, 처음 결과가 가리킨 기록(`response_ref`)을 지금 다시 읽은 본문과 `Idempotency-Replayed: true`를 돌려줍니다. 명령의 쓰기와 '끝남' 표시는 같은 트랜잭션입니다. 처리 중의 기한이 지나면(처리하던 서버가 멈춤) 같은 지문의 다음 요청만 이어받고, 늦게 끝난 앞 요청은 기한 값이 바뀐 것을 보고 자기 트랜잭션을 되돌립니다(두 번 처리되지 않음). 남기지 않는 결과는 DEC-04의 422·5xx와, 이 작업이 같은 까닭(아무것도 바꾸지 않은 결과)으로 더한 409 `confirmation_required`·401·429입니다. 남긴 오류(404·409 등)는 같은 코드의 Problem으로 다시 돌려줍니다. 24시간 지난 키를 지우는 일은 TASK-158(SPEC-065)입니다.
16. 데이터베이스 시험: `TEST_DATABASE_URL`(마이그레이션을 적용한 데이터베이스)이 있으면 돌고, 없으면 로컬에서는 건너뜁니다. `REQUIRE_DATABASE_TESTS=1`(CI)이면 없을 때 실패합니다. 로컬 준비는 아래 '명령'에 있습니다.
17. 시각(04 G8)·확인 카드(04 G9)·운영 기록(TBL-051): `server/src/time.ts`는 저장은 UTC, 날짜와 시각을 읽고 셈하는 일은 가게 시간대(Intl)로 하는 바탕입니다(하루 내내 세는 기한 `addAllDay`, 답하는 시간 안에서만 세는 기다림 `addWithinReplyHours`, REQ-259). 기한마다의 길이와 시작점은 그 SPEC을 만드는 작업이 씁니다. `server/src/confirm-card.ts`는 카드 누름이 받은 사람·상담·주문 버전·초안 판·30분 기한에 맞는지 판단만 하고, 누름을 `confirm_cards`에 남기는 일은 TASK-081입니다. `server/src/ops-events.ts`는 내용 없이 종류·건수와 숫자만 남깁니다.

## 명령 (`app/`에서)

```bash
npm ci && npm run lint && npm run typecheck && npm test && npm run build
```

데이터베이스 시험까지 돌리려면 로컬 PostgreSQL(예: 127.0.0.1:54329)에 시험용 데이터베이스를 만들고 마이그레이션을 적용한 뒤 `TEST_DATABASE_URL`을 줍니다.

```bash
psql -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE app_test TEMPLATE template0" "host=127.0.0.1 port=54329 user=postgres dbname=postgres"
```

```bash
bash ../tools/db-migrate.sh "host=127.0.0.1 port=54329 user=postgres dbname=app_test"
```

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/app_test npm test
```

개발 때는 `npm run dev -w server`(wrangler dev, 127.0.0.1:8787)와 `npm run dev -w web`(Vite, `/api`를 8787로 넘김)을 함께 띄웁니다.
