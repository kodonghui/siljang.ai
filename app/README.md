# app: 서버와 웹 (11단계 원본)

TASK-015(REQ-135)의 개발 저장소 뼈대, TASK-018의 공통 요청 처리(요청 키·오류 응답·데이터베이스 연결 층·시각과 확인 카드의 바탕·운영 기록), TASK-019의 가게별 기록 나누기(가게 범위 접근 층·가게 조건 검사·교차 가게 시험 묶음), TASK-022의 사진 올리기(06 API-007, 저장소 모듈, 사장님 범위 경로, 15분 서명 주소, 05 A11 사진 장수), TASK-025의 계좌번호·원래 값 암호화(05 A23·E20의 봉투와 키 버전, 05 A15 마스킹한 값 저장), TASK-023의 서버 안의 일 실행기(05 A33의 같은 일은 한 번만, 기다리는 일 찾기·잡기, 일 등록부, Cron 어댑터)입니다. 계약은 [../api/openapi.yaml](../api/openapi.yaml), 스키마는 [../db/](../db/)에 있고 여기서 고치지 않습니다.

## 설계 메모

1. 배치: `app/` 아래 npm workspaces 둘. `server/`는 Cloudflare Workers의 Hono(TypeScript strict), `web/`은 React·Vite. 웹 빌드(`web/dist`)를 같은 Worker가 정적 자산으로 줍니다(tech-stack.md ②·③).
2. 주소: API는 `/api` 아래에 둡니다. 07 사이트맵의 화면 주소(`/owner/orders` 등)와 06 계약의 API 경로가 같은 출처에서 겹치기 때문입니다. `/api/*`만 Worker 코드가 받고(`run_worker_first`), 나머지는 정적 파일이며 없는 화면 주소는 `index.html`입니다. 계약의 `servers` 주소는 TASK-016에서 정합니다.
3. `GET /api/healthz`는 06 계약에 없는 기반 시설 주소입니다(TASK-016의 1분 감시용). 계약 API가 아닙니다.
4. 오류: 06의 Problem(`application/problem+json`; `type`·`title`·`status`·`code`·`traceId`, 코드에 따라 `errors`·`confirm`·`retryAfterSeconds`) 꼴입니다. 오류 코드 37개와 필드 오류 사유 24개는 `server/src/problem.ts` 한 곳에 손으로 적었고, `server/test/contract.test.ts`가 06 계약(`components.x-corthex`의 errors·fieldErrors와 `Problem`·`FieldError` 스키마)과 같은지, 코드마다 나가는 응답이 계약의 Problem 스키마에 맞는지(Ajv) 봅니다. 코드마다 붙어야 하는 것(422 `validation_failed`의 `errors`, 409 `confirmation_required`의 `confirm`, 429의 `retryAfterSeconds`와 `Retry-After`, 405의 `Allow`)이 빠지거나 다른 코드에 붙으면 그 응답을 내보내지 않고 500 `internal`로 바꿉니다. 계약에 없는 방법으로 부르면 405와 `Allow`(06 DEC-02), 없는 경로는 404입니다.
5. 설정과 키: env는 `server/src/settings.ts` 한 곳만 읽습니다. 비밀 값(`ANTHROPIC_API_KEY`·`OPENAI_API_KEY`·`DATABASE_URL`·`REQUEST_HASH_KEY`·`STORAGE_ACCESS_KEY_ID`·`STORAGE_SECRET_ACCESS_KEY`·`FILE_URL_KEY`)은 Worker 비밀 값이나 환경 변수에만 두고, 글·JSON·로그로 바꾸면 가립니다. `DATABASE_URL`은 `postgres://`나 `postgresql://`로 시작하고 `REQUEST_HASH_KEY`(요청 지문의 HMAC 키)와 `FILE_URL_KEY`(사진 서명 주소의 키, 27)는 32자 이상이어야 하며, 아니면 값을 싣지 않은 설정 오류(500)로 멈춥니다. 계좌번호·원래 값 암호화의 키(`FIELD_KEY_CURRENT`·`FIELD_KEY_V<버전>`)도 이 모듈이 읽습니다(31\~33). 모델은 서버만 부르고 `VITE_*`에는 비밀 값을 넣지 않습니다. `APP_ENV`가 없으면 production입니다.
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
17. 시각(04 G8)·확인 카드(04 G9)·운영 기록(TBL-051): `server/src/time.ts`는 저장은 UTC, 날짜와 시각을 읽고 셈하는 일은 가게 시간대(Intl)로 하는 바탕입니다(하루 내내 세는 기한 `addAllDay`, 답하는 시간 안에서만 세는 기다림 `addWithinReplyHours`, REQ-259). 서머타임이 있는 시간대에서 벽시계 값이 두 번 있으면 앞의 것, 없으면 건너뛴 길이만큼 뒤로 민 시각입니다(`shopLocalToUtc`, 서울은 지금 서머타임이 없음). 기한마다의 길이와 시작점은 그 SPEC을 만드는 작업이 씁니다. `server/src/confirm-card.ts`는 카드 누름이 받은 사람·상담·주문 버전·초안 판·30분 기한에 맞는지 판단만 하고, 누름을 `confirm_cards`에 남기는 일은 TASK-081입니다. `server/src/ops-events.ts`는 내용 없이 종류·건수와 숫자만 남깁니다.
18. 가게별 기록 나누기(TASK-019; 04 SPEC-068·G1, 05 A9·E1, 06 DEC-02): 가게 기록을 읽고 쓰는 경로는 `server/src/routes.ts`의 `shopRoute`로 선언합니다. 처리기는 Hono 맥락이나 날 데이터베이스 연결을 받지 않고 `ShopRequest`(가게 범위 `scope`, 가게 범위 연결 `db`, 경로의 ID·본문·응답·요청 키 명령)만 받습니다. 가게 범위(`ShopScope`)는 `server/src/shop-scope.ts`의 `createShopScope`로만 만들어지고(모듈 안의 표시로 흉내 낸 것을 거름), 요청에서 가게를 찾는 해석기(`ScopeResolvers`의 사장님·손님·운영자·예약 링크)가 부릅니다. 해석기가 없는 쪽의 경로는 닫혀 있습니다(사장님·운영자 401 `unauthenticated`, 손님 401 `skill_key_invalid`, 예약 링크 404 `not_found`). 가게 범위 연결(`ShopDb`)은 `$1`을 늘 그 가게 ID로 채우고, 가게 테이블마다 `shop_id = $1`(가게 행은 `id = $1`)이 확실히 걸리지 않은 SQL은 데이터베이스에 보내지 않고 500 `internal`로 멈춥니다(`server/src/sql-scope.ts`의 검사). 경로의 ID는 `owned`로 고르며 다른 가게 ID·없는 ID·형식이 틀린 ID(100자 넘는 것 포함)가 모두 같은 404 `not_found`이고, 본문·쿼리의 ID는 `references`로 보며 다른 가게 ID와 없는 ID가 같은 422 `validation_failed`의 `reference_not_found`(형식이 틀리면 `bad_format`)입니다. 403은 쓰지 않습니다.
19. 무엇이 막는지: 데이터베이스는 가게가 섞인 행을 막습니다(가게 테이블의 복합 외래 키 `(shop_id, id)`, SQLSTATE 23503, 05 E1). 다른 가게의 행을 읽거나 고치는 것은 데이터베이스가 막지 않으므로(05 A9) 앱이 네 겹으로 막습니다. ① 형식: 처리기가 받는 `ShopDb`는 `Queryable`이 아니고 날 `query`가 없습니다. ② 실행 때: 가게 조건이 없는 SQL은 보내지 않습니다(규칙은 `server/src/sql-scope.ts` 첫머리: 가게 테이블마다 `shop_id = $1`, INSERT의 shop_id 값은 `$1`이고 값의 원천을 UNION 따위로 잇지 않음, SET으로 shop_id를 넣지 않음, 검사가 보지 못하는 꼴인 유니코드 이스케이프, SQL 글을 돌리는 내장 함수, 설정을 바꾸는 `set_config`, 따옴표 이름을 쓰지 않음, BETWEEN의 짝 AND와 CASE … END·배열 `[…]` 안의 AND는 조건을 잇는 AND로 치지 않음, WHERE·ON의 끝과 SET 목록의 나눔은 식 밖에서만 찾음(배열 `[…]` 안의 쉼표, 함수 `left(…)`·`right(…)`, `COLLATION FOR (…)`, `WITHIN GROUP (…)`, `IS DISTINCT FROM`은 끝이 아님), 하위 질의·함수·JOIN USING의 별칭과 별칭을 적지 않은 함수의 함수 이름, WITH ORDINALITY 뒤와 다른 스키마 함수의 별칭도 별칭 겹침 검사에 넣음, 주석·문자열·달러 따옴표는 PostgreSQL이 읽는 대로 걷어 내고 봄). 이 검사는 가게 조건을 빠뜨린 실수를 막는 것이라, 검사를 피하려고 일부러 꾸민 SQL은 코드 검토가 함께 봅니다. ③ 정적 시험(`server/test/shop-scope-static.test.ts`): 서버 코드의 가게 테이블 SQL이 모두 가게 조건을 지키는지, 날 연결을 쥔 파일에 가게 테이블 SQL이 없는지(운영 기록 `ops-events.ts`만 까닭을 적어 허락), SQL의 테이블 이름 자리에 값을 끼워 넣지 않는지, 가게 범위를 허락한 파일만 만드는지 봅니다. ④ 교차 가게 시험 묶음(20번). 가게 테이블 54개 목록(`SHOP_TABLES`)은 손으로 적었고, 시험이 05(`db/schema.sql`)와 시험용 데이터베이스의 `shop_id` 열과 같은지 봅니다.
20. 교차 가게 시험 묶음(`server/test/support/cross-shop.ts`·`server/test/cross-shop.test.ts`): 가게 둘과 사장님 둘을 만들고(`server/test/support/shops.ts`, 손님 이름·연락처는 지어낸 값), 등록한 경로마다 가게 A 사장님으로 가게 B의 ID·없는 ID·B의 ID를 대문자로(경로의 ID면 형식이 틀린 ID 둘도) 넣어 부릅니다. 응답이 모두 같고(상태·헤더 이름, `traceId`·`instance` 말고 본문), 두 가게의 기록(가게 테이블 54개와 가게 행, B 사장님의 요청 키)이 그대로이며, 응답과 A의 요청 키에 B의 기록 ID가 없고, A 자신의 ID로는 일하는지 봅니다. A가 낸 명령이 404로 끝나면 06 DEC-04대로 그 요청 키에 남습니다(같은 키로 다시 보내면 같은 404). 등록 목록 `CROSS_SHOP_CASES`는 실제 가게 범위 API가 아직 없어 비어 있고, 시험 파일 안의 시험용 경로 8개(등록 9건)로 층과 묶음이 일하는지 봅니다. 묶음은 앱의 등록 목록과 시험용 등록을 함께 모두 부르고(등록만 보고 끝나는 사례 없음), 지금 부르는 쪽은 사장님뿐이라 다른 출처의 경로를 등록하면 그 작업이 부르는 쪽을 더할 때까지 실패합니다. SPEC-068 수락 기준 1(주문·상담·결제 안내 ID로 부른 화면과 명령)과 2(가격표 새 버전의 원본 도안이 B의 것이면 없는 ID와 같은 422이고 B의 도안 복사 0건)도 여기서 봅니다.
21. 새 가게 범위 API를 만들 때: `APP_ROUTES`에 `shopRoute`로 선언하고 `CROSS_SHOP_CASES`에 등록합니다(경로의 ID는 kind `path`, 본문·쿼리의 ID는 `reference`, A 자신의 ID로 부를 때의 상태 `ownStatus`). 등록이 빠지거나, 선언 없이 라우터에 붙이거나(`app.get` 따위), 선언이 없어진 등록이 남으면 CI가 실패합니다. 06 계약과도 견주어, 가게 범위인 계약 API(사장님 세션, 카카오 스킬 키, 운영자의 `{shopId}`, 예약 링크)를 만들면 그 쪽(`via`)으로 선언했는지 봅니다. 가게 범위가 아닌 경로는 `openRoute`에 까닭을 적습니다.
22. 넘기는 것: 사장님 세션 해석기와 묶음에서 사장님으로 부르는 방법은 TASK-020(가게가 없는 사장님의 `shop_not_registered`와 첫 가게 범위를 만드는 가게 등록은 TASK-032), 손님(카카오 스킬) 해석기는 TASK-028입니다. 카카오 스킬은 처리한 모든 경우에 200이고 다른 가게의 것은 없는 것과 같은 답이므로(06 API-070, REQ-252) 손님 경로를 묶음에 넣을 때 부르는 쪽과 기대를 더하고, 같은 손님만 자기 주문을 보는 규칙은 TASK-105입니다. 운영자는 TASK-021·159, 예약 링크는 TASK-044·045, 여러 가게를 도는 서버 작업(날 연결을 쓰면 정적 시험의 허락 목록에 까닭을 더함)은 TASK-023, 올린 파일 ID의 `upload_not_found`는 `server/src/uploads.ts`의 `checkUploads`(TASK-022, 23), 보관한 주문의 404(05 A22)는 TASK-091·158입니다. 같은 가게라도 다른 주문의 것인 본문·쿼리 ID(SPEC-068의 입력 예외, 환불의 변경 요청 등)는 그 API 작업이 `references` 뒤에 주문까지 보고 같은 `reference_not_found`로 돌려줍니다.
23. 올린 파일을 두는 곳(TASK-022; 06 DEC-09·DEC-02, 04 SPEC-068 [입력], 설계 재검토 M18): 05에 올린 파일 테이블을 더하지 않고 사진 저장소의 임시 위치 `tmp/<사장님 ID>/<uploadId>`에 둡니다. 05의 사진은 행마다 저장 위치(`storage_key`, 가게는 `shops.license_photo_key`)만 있고, 지울 파일 표(TBL-054)는 가게(`shop_id`)가 꼭 있고 출처가 참고·신고 사진뿐이라 가게가 정해지기 전에 올린 신고증을 담지 못합니다. 06이 요구하는 것(먼저 올리고 `uploadId`, 1시간, 없음·지남·다른 사장님 것을 가리지 않음, 저장 위치가 보이지 않음)은 키와 ID로 모두 지키고, 04·05·06에 한 번만 쓰기나 엄격한 세기를 요구하는 글은 없습니다(쓰이는 곳: `server/src/uploads.ts`).
    - `uploadId`는 `upl_` + 올린 시각(밀리초, 16진수 12자리) + 용도 한 글자(`l`·`d`·`c`) + 무작위 16바이트(base64url 22자)이고 계약의 꼴(`^upl_[A-Za-z0-9_-]{20,200}$`)에 맞습니다. 용도를 ID에 넣은 까닭은 Supabase Storage의 S3 호환 주소가 사용자 메타데이터를 받지 않기 때문입니다(Supabase 문서 'S3 compatibility', 2026-11-16 확인).
    - 없음·1시간 지남·다른 사장님 것·우리가 내지 않은 ID는 모두 같은 `upload_not_found`입니다. 키에 부른 사장님의 ID가 들어 있어 다른 사장님이 올린 ID는 없는 파일과 같고, 1시간은 ID의 시각으로 봅니다. 다른 용도로 올린 것은 `upload_wrong_purpose`, 계약의 꼴이 아니면 `bad_format`, 같은 ID를 두 번 넣으면 `duplicate`입니다.
    - 명령이 쓰는 차례: `checkUploads`(ID들을 한 번에 보고 필드마다 422) → `promoteUpload`(가게의 영구 위치 `shops/<가게 ID>/<용도>/<uploadId>`로 복사. 그 사이 임시 파일이 없어졌으면 `upload_not_found`, 저장소가 답하지 않으면 503 `storage_unavailable`, 둘 다 기록을 쓰기 전이라 남는 것이 없음, 06 API-008) → 명령이 기록을 씀(실패하면 복사본을 지움) → `discardUpload`(임시 파일을 지움. 실패해도 명령은 성공).
    - 한 번만 쓰기는 실제로만입니다. 쓴 뒤 임시 파일을 지우므로 같은 ID를 다시 쓰면 `upload_not_found`지만, 지우기가 실패하면 1시간 안에 같은 사장님이 다시 쓸 수 있습니다(다른 사장님에게는 여전히 없는 파일).
24. 사진 올리기 한도(06 DEC-16, 설계 재검토 RD-18): 사장님마다 1분 30번은 Cloudflare Workers의 Rate Limiting 바인딩(`server/wrangler.jsonc`의 `ratelimits`, 키 `upload:<사장님 ID>`, `server/src/rate-limit.ts`)이 세고, 1시간 안에 올리고 쓰지 않은 파일 50개는 그 사장님의 임시 위치를 1시간 전 시각 뒤부터 나열해 셉니다(키가 올린 시각 순). 둘 다 느슨한 한도입니다. 바인딩은 Cloudflare 위치마다 대략 세고(Cloudflare 문서 'Rate Limiting', 2026-11-12 고침, 2026-11-16 확인, 기간은 10초나 60초만), 50개는 동시에 온 요청이 같은 수를 보고 함께 지날 수 있습니다. DEC-16의 까닭(가게 등록 전에도 카카오 계정만으로 열린 올리기로 한 사람이 저장소를 채우지 못하게)과 첫 버전 가게 1\~3곳에는 이것으로 맞다고 보고 행 잠금 같은 엄격한 세기는 하지 않았습니다. `Retry-After`는 1분 한도면 60초, 50개면 가장 오래된 파일부터 1시간을 넘겨 50개 밑이 될 때까지의 초(1\~3600, 목록이 1,000개를 넘으면 3600)입니다.
25. 받는 것(06 API-007, 04 SPEC-002·004·053): 차례는 1분 한도(429) → 선언한 길이(413) → 쓰지 않은 파일 50개(429) → 본문을 한도까지 읽고 multipart로(413·422) → UploadForm(422) → 용도별 크기(413) → 내용으로 본 종류(422) → 저장(503) → 201입니다. 본문은 이 경로만 20MiB + 64KiB(multipart 머리·경계의 여유)까지 읽으면서 셉니다(TASK-018의 256 KiB는 다른 경로 그대로). 용도별 크기는 신고증·도안 10MiB, 완성 사진 20MiB이고(06의 MB는 05 `byte_size`의 20971520과 같은 MiB) 넘으면 413 `file_too_large`입니다. 종류는 파일 이름·Content-Type이 아니라 내용의 시그니처로 봅니다(JPEG `FF D8 FF`, PNG 8바이트, WEBP `RIFF`…`WEBP`, HEIC는 ftyp 상자의 주 브랜드가 heic 무리이거나 `mif1`·`msf1`이면서 호환 브랜드에 heic 무리가 있음). 모르는 내용이거나 그 용도가 받지 않는 종류(신고증의 WEBP 등)면 422 `/file` `not_allowed`(06 예시)이고, AVIF·담은 것을 말하지 않는 HEIF·GIF는 받지 않습니다. 응답의 `contentType`은 내용으로 본 종류이고, `expiresAt`은 사장님 범위의 시간대(가게가 정해지기 전이라 기본 서울) 오프셋을 붙인 시각입니다(`server/src/time.ts`의 `toShopIso`, 06 DEC-15). 요청 키는 받지 않습니다(다시 올리면 새 `uploadId`가 하나 더 생길 뿐, 06 DEC-04 밖).
26. 사진 저장소 모듈(TASK-022; 기술 스택 제안 4-3의 3): 업무 코드는 `server/src/storage.ts`의 `ObjectStore`(넣기·보기·읽기·복사·지우기·접두어 목록)만 쓰고, 요청마다 쓰는 바깥 서비스(시계·저장소·한도·서명 주소)는 `server/src/services.ts`가 줍니다(시험은 `createApp({ services })`로 메모리 저장소·메모리 한도·시각을 넣음). 진짜 구현 `S3Store`는 Supabase Storage(서울)의 S3 호환 주소를 경로 꼴과 SigV4로 부릅니다. S3를 고른 까닭은 Supabase의 publishable·secret 키를 서버·웹 어디에도 쓰지 않기로 해서(TASK-174) 그 키가 필요한 Storage REST API 대신 저장소만 다루는 S3 접근 키를 쓰기 때문이고, 같은 모듈이 옮길 곳의 S3·Cloud Storage에도 맞습니다(기술 스택 제안 4-2). 서명은 `aws4fetch` 1.0.20(정확히 고정, `--before=2026-11-08`)이 합니다. 새 의존성의 까닭: Workers의 fetch와 SubtleCrypto만 쓰는 작은 꾸러미라 Node 형식을 끌어오지 않고(8번), SigV4를 손으로 짜지 않으려고. 다시 시도는 끄고(`retries: 0`) 저장소가 답하지 않거나 오류면 503 `storage_unavailable`입니다. 응답 머리 뒤에 몸체를 읽다 연결이 끊겨도 몸체를 읽어야 결과를 아는 동작(목록·복사)은 같은 503이고, 상태 코드로 끝난 동작(넣기·지우기, 없는 객체)은 버리는 몸체의 오류를 무시합니다(Codex 지적, 2026-11-16). 설정은 `STORAGE_ENDPOINT`·`STORAGE_REGION`·`STORAGE_BUCKET`(셋 다 있거나 셋 다 없음, https만이고 로컬 개발만 localhost의 http)과 비밀 값 둘이며 `settings.ts`만 읽습니다. 저장소 설정·비밀 값·한도 바인딩·`FILE_URL_KEY`가 빠졌으면 그것을 쓰는 요청만 500 `internal`(설정 오류, 로그에는 이름만)입니다. 시험은 메모리 저장소(`server/test/support/storage.ts`)로 06 응답마다 보고, `S3Store`는 보내는 요청의 모양(주소·방법·서명 머리·복사 원본·목록 질의)만 가짜 fetch로 봅니다. 로컬의 S3 흉내 서버(moto)로 한 번 더 돌린 결과는 [진행 기록](../docs/records/progress.md)에 있고, 진짜 Supabase Storage에서 도는지는 시험하지 않았습니다(TASK-171의 끝난 조건에 더함).
27. 사진의 15분 서명 주소(06 DEC-09): 06의 사진 주소(`licensePhotoUrl` 등, 15분, 저장 위치가 보이지 않음)를 만들고 내주는 경로가 WBS의 어느 작업에도 없어 이 작업에 작게 넣었습니다. 첫 소비자(TASK-032의 가게 조회 API-009)로 넘기지 않은 까닭은 주소 꼴·키·내주는 경로가 사진을 보이는 API 모두(가게 조회, 도안, 상담의 참고 사진, 완성 사진, 운영자 화면)가 함께 쓰는 바탕이라서입니다. `server/src/file-url.ts`의 주소는 `<요청의 origin>/api/files/v1/<token>?exp=<유닉스 초>&sig=<HMAC-SHA256>`이고, token은 저장 위치를 AES-GCM으로 감싼 값이라 주소에서 가게 ID·용도·저장 위치가 보이지 않습니다. 두 키는 비밀 값 `FILE_URL_KEY`에서 HKDF로 따로 뽑습니다. `GET /api/files/v1/:token`은 06 계약 밖의 `openRoute`이고(주소의 서명이 권한이라 세션·가게를 보지 않고 데이터베이스도 보지 않음), 응답 머리는 `cache-control: private, max-age=<남은 초>`, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox`, `cross-origin-resource-policy: same-origin`, `referrer-policy: no-referrer`입니다. 사진이 아닌 종류로 저장된 것은 내려받기(`application/octet-stream`)로만 내고, 틀린 주소·지난 주소·없는 파일은 같은 404 `not_found`입니다. 주소를 가진 사람은 15분 동안 그 사진을 보므로, 누구에게 내줄지는 주소를 내주는 API가 정합니다.
28. 사장님 범위 경로(TASK-022): 06 API-007은 가게가 정해지기 전에도 열리므로(TASK-019가 가게 범위 밖으로 둔 API-001·002·003·007·008·078) `server/src/routes.ts`에 `ownerRoute`를 더했습니다. 처리기는 `OwnerRequest`(사장님 범위 `owner`, 요청, `services`, `json`)만 받고 데이터베이스 연결은 받지 않습니다. 사장님 범위(`OwnerScope`: 사장님 ID와 시간대)는 `server/src/owner-scope.ts`의 `createOwnerScope`로만 만들어지고(정적 시험이 만드는 파일을 정함, `as OwnerScope` 없음), 사장님 세션 해석기(`createApp`의 `ownerAccount`, TASK-020)가 없으면 401 `unauthenticated`로 닫혀 있으며 흉내 낸 범위는 500입니다. 06 계약과 견주는 시험이 사장님 범위 계약 API(지금은 API-007)를 `ownerRoute`로 선언했는지 봅니다. 교차 가게 묶음(20)은 가게 범위 경로만 부르므로, 다른 사장님 ID의 시험(같은 `upload_not_found`, 남는 것 0)은 `server/test/uploads.test.ts`가 따로 합니다.
29. 05 A11 사진 장수(04 SPEC-019·053·057·062): 신고·완성·후기 사진의 5장은 데이터베이스가 막습니다(순서 `position` 1\~5의 CHECK는 23514, 같은 신고 내용·제작·후기 안에서 순서가 겹치면 23505. 시험이 부모 행 검사보다 먼저 걸리는 것까지 봄). 참고 사진의 상담마다 10장은 여러 메시지의 행을 세야 해서 앱이 셉니다. `server/src/photo-count.ts`의 `referencePhotoRoom`이 가게 범위 연결의 트랜잭션 안에서 상담 행을 잠그고(`FOR UPDATE`, 같은 상담에 동시에 온 사진을 차례로 셈) 더 붙일 수 있는 수(0\~10)를 줍니다. 데이터베이스는 메시지 안 순서 11만 막고 상담마다 10장은 막지 않는 것을 시험으로 남겼습니다. 참고 사진을 받는 일(카카오)은 TASK-065가 사진 행을 넣는 같은 트랜잭션에서 이 도구를 부릅니다.
30. 넘기는 것과 열린 질문(TASK-022)
    - 1시간 지나고 쓰지 않은 임시 파일(`tmp/`) 지우기: TASK-158(지난 기록 지우기, 끝난 조건에 더함). 실행기(TASK-023)가 아니라 지우기 작업에 둔 까닭은 대상과 주기(하루 한 번)가 SPEC-065의 지우기와 같고 실행기는 그 바탕이라서입니다. 그 전까지 남은 파일은 1시간 뒤 50개 한도에서 세지 않습니다.
    - 진짜 Supabase Storage(서울, 비공개 버킷)의 S3 호환 주소에서 `S3Store`가 도는지: TASK-171(끝난 조건에 더함). 버킷과 S3 접근 키를 만드는 일은 TASK-170 뒤입니다. Workers 런타임에서의 multipart 읽기와 한도 바인딩은 10번대로 TASK-171·173의 Workers 런타임 시험에서 봅니다.
    - 명령에서 쓰기: 가게 등록의 신고증(TASK-032, API-008), 가격표의 도안(TASK-038, API-017), 완성 사진(TASK-135, API-052). 서명 주소를 내주는 쪽: 가게 조회(TASK-032, API-009)와 사진을 보이는 다른 API 작업.
    - 감싼 앱(Capacitor, TASK-179)에서 사진 주소를 다른 origin으로 부르면 `cross-origin-resource-policy: same-origin`을 다시 봅니다.
    - 열린 질문: 사진의 EXIF(찍은 곳의 위치 정보 등) 지우기 규칙은 02·04·05·06에 없어 이번에 하지 않았습니다. 사장님 사진(신고증·도안·완성)은 이 경로로, 손님 사진(참고·신고·후기)은 카카오로 받으므로 어디서 다룰지(04 공통 규칙이나 SPEC-019·053) 동희님께 확인 요청할 거리입니다.
31. 계좌번호와 원래 값의 암호화(TASK-025; 05 A23·5절 E20, REQ-191): `server/src/field-crypto.ts`의 `FieldCrypto`가 가게 계좌번호(`payment_accounts.account_number_enc`)·환불 계좌번호(`refunds.refund_account_enc`)·대화 속 전화번호와 계좌번호의 원래 값(`masked_values.original_enc`)을 저장하기 전에 암호화합니다. 데이터베이스는 봉투 모양만 봅니다.
    - 봉투: AES-256-GCM, 값마다 `crypto.getRandomValues`로 새 12바이트 nonce, 16바이트 태그, `v<키 버전>:base64url(nonce‖암호문‖태그)`(채움 없음). 05의 봉투 CHECK 셋과 같은 글(`ENVELOPE_PATTERN`)이고 시험이 05와 견줍니다. 1바이트 값이 가장 짧은 봉투(39자)라 빈 값은 만들지 않고, 평문은 256바이트까지입니다. Web Crypto만 써서 새 의존성은 없습니다.
    - 키: 버전마다 32바이트 비밀 값 하나에서 HKDF-SHA256으로 암호화 키와 같은 값 찾기 HMAC 키를 따로 뽑습니다(`file-url.ts`와 같은 방식). 05 E20의 '다른 비밀 키'를 비밀 값 하나로 지키는 까닭: 뽑은 두 키는 서로 다른 키라 하나가 새어도 다른 키나 비밀 값을 알 수 없고, 버전마다 비밀 값 하나만 넣고 간수하면 됩니다.
    - 묶는 값(AAD): 쓰는 곳(테이블.컬럼, 마스킹 원본은 `masked_values.original`), 가게 ID, 키 버전. 05에 없는 것을 더했습니다. 데이터베이스에 쓸 수 있는 사람이 봉투를 다른 가게·다른 컬럼으로 옮겨도 풀리지 않게 하려는 것이고(GCM이 거절) 봉투 모양은 그대로입니다. 정당하게 옮길 때(대화 속 계좌번호를 환불 계좌로, TASK-125)는 풀고 다시 암호화합니다.
    - 실패: 꼴이 틀림·없는 키 버전·바뀐 암호문·다른 가게·다른 쓰는 곳은 모두 `FieldCryptoError` 하나이고 메시지에 평문·키·봉투가 없습니다. 응답은 500 `internal`, 로그에는 오류 이름만입니다(06 G6, 시험으로 확인).
32. 키를 받는 법과 넣는 법: `settings.ts`가 비밀 값 `FIELD_KEY_V<버전>`(버전 1\~999, 무작위 32바이트의 base64url 43자)과 새로 쓸 때의 버전 `FIELD_KEY_CURRENT`를 읽습니다.
    - 버전마다 따로 넣는 까닭: Workers 비밀 값은 넣은 뒤 다시 읽을 수 없어서, 값 하나에 키 목록을 두면 키를 바꿀 때 앞 키를 다시 적어야 합니다.
    - 둘 다 없으면 암호화가 필요한 요청만 500 `internal`(`MissingSettingError`)입니다. 하나만 있거나, 꼴이 틀리거나, 지금 버전의 키가 없거나, `FIELD_KEY_`로 시작하는 다른 이름(`FIELD_KEY_V01` 같은 오타)이 있으면 값을 싣지 않은 설정 오류로 멈춥니다.
    - `FIELD_KEY_CURRENT`는 비밀 값이 아니지만 환경마다 다르고 wrangler 설정을 로컬 개발과 함께 쓰므로 키와 같이 `wrangler secret put`으로 넣습니다. 로컬은 `server/.dev.vars`에 같은 이름으로 두고 개발용 키는 스테이징·운영 키와 다르게 만듭니다.
    - 키를 잃으면 계좌번호를 되살릴 수 없습니다(05 E20 반론). 그래서 키는 권한을 좁힌 파일로 만들어 Worker에 넣고, 그 값을 저장소 밖 비밀 저장소(비밀번호 관리자 등)에 사본으로 둔 뒤 파일을 지웁니다. 키는 화면·대화·저장소·기록에 남기지 않습니다. 스테이징은 TASK-173, 운영은 TASK-167에서 합니다.

    ```bash
    (umask 077 && node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" > ~/field-key-v1.txt)
    ```

    ```bash
    npx wrangler secret put FIELD_KEY_V1 < ~/field-key-v1.txt
    ```

    ```bash
    printf 1 | npx wrangler secret put FIELD_KEY_CURRENT
    ```

    사본을 비밀 저장소에 옮긴 뒤 `rm ~/field-key-v1.txt`로 파일을 지웁니다.
33. 키 바꾸기 차례(05 E20 '키 버전을 봉투에 적어 바꿀 수 있게'):
    1. 새 키 `FIELD_KEY_V2`를 넣습니다(지금 버전은 그대로 1). 모든 Worker가 v2 봉투를 읽을 수 있게 된 뒤에
    2. `FIELD_KEY_CURRENT`를 2로 바꿉니다. 이제 새로 쓰는 봉투는 v2이고 v1 봉투도 읽힙니다. 둘로 나누는 까닭은 한 번에 바꾸면 아직 v2 키가 없는 Worker가 v2 봉투를 만나 읽지 못하기 때문입니다.
    3. 앞 버전 봉투를 지금 버전으로 다시 감쌉니다. 값은 그대로이고 `masked_values.value_hmac`도 지금 버전으로 다시 셉니다. 그 사이에 사장님이 계좌를 바꿨으면 덮지 않도록 앞 봉투가 그대로일 때만 씁니다. 이 도구는 TASK-166으로 넘겼습니다(끝난 조건에 더함).
    4. 세 컬럼에 `v1:`로 시작하는 봉투가 0건인지 봅니다.
    5. Worker의 `FIELD_KEY_V1`을 지웁니다. 비밀 저장소의 사본은 다시 감싸기 전의 백업(운영은 매일 백업 7일, TASK-175)이 모두 지난 뒤에 지웁니다. 그 전에 백업을 되살리면 v1 봉투가 다시 생기기 때문입니다.
    - 같은 값 찾기는 `valueHashes`가 가진 모든 버전의 HMAC으로 찾고 `valueHash`(지금 버전)로 써서, 2와 3 사이에도 같은 번호가 같은 플레이스홀더를 받습니다(시험).
34. 05 A15 마스킹한 값(`server/src/masked-values.ts`, TBL-019): `maskValue(tx, fc, 상담 ID, 종류, 숫자)`가 플레이스홀더(예: `[전화번호1]`)를 돌려줍니다. 가게 범위 연결의 트랜잭션 안에서 부르고, 다른 가게의 상담·없는 상담은 404 `not_found`이며 아무것도 쓰지 않습니다.
    - 전화번호·계좌번호는 원래 값의 봉투·같은 값 찾기 HMAC·끝 4자리를 두고, 같은 상담의 같은 값은 같은 플레이스홀더(행 하나)입니다. 카드번호는 끝 4자리만 두고 같은 번호도 나올 때마다 새 번호, 긴 숫자는 아무것도 두지 않습니다(끝 4자리도 없음, REQ-192).
    - 번호는 상담 안에서 종류마다 1부터 매깁니다. 상담 행을 잠가(`FOR UPDATE`) 같은 상담에 동시에 온 값을 차례로 매깁니다(잠금을 빼면 동시 시험이 실패하는 것을 확인함). 999를 넘으면 `MaskingFailedError`이고, 부르는 쪽(TASK-066)은 AI를 부르지 않고 에스컬레이션합니다(SPEC-021 [외부]).
    - HMAC은 원래 값만이 아니라 가게·상담·종류와 함께 셉니다. 같은 상담 안의 같은 값 찾기에만 쓰므로, 데이터베이스를 읽은 사람이 다른 상담·다른 가게의 같은 번호를 해시로 잇지 못하게 했습니다.
    - 받는 값은 숫자만입니다. 자릿수는 계좌번호 10\~16(06·SPEC-021), 카드번호 13\~19(SPEC-021), 긴 숫자 9 이상(SPEC-021 '8자리 넘는')이고, 전화번호는 원본에 자릿수가 없어 끝 4자리를 둘 수 있는 4\~20자리만 봅니다. 띄어쓰기·하이픈·한글 숫자를 숫자로 바꾸고 무엇을 무엇으로 볼지 나누는 일은 TASK-066입니다.
    - `openMaskedValue`는 플레이스홀더의 원래 값(카드번호는 끝 4자리만, 긴 숫자는 없음)을 돌려줍니다. 볼 수 있는 사람인지는 부르는 작업이 먼저 봅니다(그 가게 사장님 화면, 사유를 적고 연 운영자 TASK-159와 접속기록 TASK-024).
35. 계좌번호 도구(`server/src/account-number.ts`): 06 `accountNumber`(숫자와 '-', 숫자만 10\~16자리, 10\~40자)와 같은 글의 검사(시험이 06의 해당 스키마 모두와 견줌), 봉투와 끝 4자리(숫자만 셈)를 함께 만드는 `sealAccountNumber`, 푸는 `openAccountNumber`. 평문은 받은 그대로(숫자와 '-') 암호화해 사장님이 넣은 꼴 그대로 보입니다(06 응답 예시와 같음). 형식이 틀린 값의 422는 경로가 먼저 냅니다(TASK-040·125).
36. 시험(TASK-025)
    - 평문으로 남지 않음: 도구로 가게 계좌·환불 계좌·대화 속 전화번호·계좌번호·카드번호·긴 숫자를 쓴 뒤, 데이터베이스의 모든 기본 테이블의 모든 행을 글로 바꿔(`t::text`) 숫자만인 꼴과 '-'를 넣은 꼴이 0건인지 봅니다. 일부러 남긴 표시 숫자를 찾는지 먼저 봐서 검사가 헛돌지 않게 했습니다.
    - 키를 바꿔도 읽힘: v1로 쓴 값을 v2가 지금일 때 읽고, 새로 쓰면 v2이고, 바꾸는 중간(v2 키만 더함)에도 둘 다 읽히고, v1 키를 빼면 일반 오류입니다. 마스킹한 값은 바꾼 뒤에도 같은 번호가 같은 플레이스홀더입니다.
    - 이 밖에: 05 CHECK와 같은 봉투, 바이트 하나를 바꾼 봉투·다른 가게·다른 쓰는 곳의 거절, 오류의 글·inspect·JSON과 500 응답·로그에 평문·키·봉투 없음, 설정의 키 꼴, A15의 종류별 저장·번호·동시 쓰기·다른 가게 404, 데이터베이스가 평문 계좌번호와 끝 4자리 없는 환불 계좌 봉투를 거절(23514).
37. 넘기는 것(TASK-025)
    - 앞 버전 봉투를 다시 감싸는 도구와 키 바꾸기를 스테이징에서 한 번 해 보기: TASK-166(출시 전 보안 점검, 끝난 조건에 더함). 여러 가게를 도는 한 번짜리 도구라 가게 범위 밖 접근의 까닭을 함께 적습니다.
    - 진짜 키 만들기와 사본: 스테이징은 TASK-173, 운영은 TASK-167(끝난 조건에 더함).
    - 쓰는 곳: 가게 계좌 등록·보기(TASK-040, API-024·025), 결제 안내를 보일 때 계좌번호 채우기(TASK-093, 결제 안내 글 `notifications.body`에는 계좌번호를 넣지 않음), 대화 마스킹(TASK-066), 환불 계좌 받기(TASK-125, 대화 속 계좌번호를 풀고 환불 계좌로 다시 암호화), 운영자의 원래 값 열기(TASK-159, 접속기록 TASK-024).
    - 데이터베이스 서버의 로그: PostgreSQL은 제약을 어긴 문장의 행 값을 로그에 적습니다(`DETAIL: Failing row contains (…)`). CI의 서비스 컨테이너 로그에서 이 PR의 시험이 일부러 봉투 컬럼에 넣은 평문 시험 계좌번호가 보였습니다. 이 도구들은 평문을 봉투 컬럼에 보내지 않지만, 다른 개인정보(손님 이름·연락처 등)는 제약 오류와 함께 운영 데이터베이스의 로그에 남을 수 있어 TASK-166 점검표의 로그 항목에서 그 로그의 설정과 보관을 봅니다.
38. 서버 안의 일 실행기(TASK-023, 05 A33, 06 10절)의 층은 셋입니다. 업무 코드는 Workers의 `env`·`ctx`·Cron을 직접 부르지 않습니다(tech-stack.md 4-3).
    - 찾는 곳(`server/src/due-sources.ts`): 기다리는 일은 따로 된 작업 테이블이 아니라 05에 이미 있는 행입니다(05는 바꾸지 않음). 때를 세는 컬럼과 그 05 부분 인덱스가 있는 곳 11개(`owner_tasks.wait_due_at`, `handoffs.created_at`, `payment_requests`의 `due_at`·`due_cap_at`(차액 결제는 따로), `owner_alerts`·`notifications`의 `next_attempt_at`과 발송 결과 조회 때, `ledger_writes.next_attempt_at`)마다 찾기 SQL과 잡기 SQL을 글자 그대로 둡니다.
    - 찾기는 여러 가게에 걸쳐 가게 ID·행 ID·때만 읽습니다. TASK-019 정적 시험이 이 파일 하나에서, 시험 파일에 적은 꼴(FROM 하나, 끼워 넣기 없음)로만 허용합니다. 잡기는 가게 범위 연결(`createShopScope(shopId, { kind: "job", job })`)에서 찾기와 같은 조건에 `FOR UPDATE SKIP LOCKED`입니다. SQL에 `now()`가 없고 기준 시각은 실행기가 넘깁니다(한 번의 실행 안에서 같고, 시험이 시계를 정함).
    - 실행기(`server/src/job-runner.ts`): 일마다 찾고, 행마다 짧은 트랜잭션에서 잡아 처리합니다. 처리 모양은 둘입니다. `transaction`은 잡은 트랜잭션 안에서 처리하고, 던지면 그 행만 되돌립니다. `leased`(카카오 Event API 같은 바깥 호출)는 잡은 트랜잭션에서 때 컬럼을 임대 끝(2분 뒤)으로 미뤄 두고, 트랜잭션 밖에서 부르고(20초를 넘으면 시간 넘김), 새 짧은 트랜잭션에서 그 행이 아직 이 임대인지(때 = 임대 끝) 보고 결과를 씁니다. 중간에 멈추면 임대가 끝난 뒤 다시 찾힙니다.
    - 어댑터(`server/src/scheduled.ts`, `index.ts`의 `scheduled`): Cron 이벤트의 시각(`scheduledTime`)을 기준 시각으로 실행기를 `waitUntil`에 넘깁니다. 설정 오류나 연결 실패는 이름만 로그로 남기고 던지지 않으며, 다음 분에 다시 돕니다.
39. 일 등록부(`server/src/jobs.ts`): 06 10절의 13개를 06의 차례로 이름·SPEC·맡는 작업·도는 꼴·찾는 곳·메모와 함께 둡니다. 처리(`JOB_HANDLERS`)는 이번에 비어 있고 맡는 작업이 붙입니다. 처리가 없는 일과 요청 안의 일은 실행기에 넘기지 않습니다(`runnableJobs`).
    - 등록 완결 시험(`test/jobs.test.ts`, TASK-019의 교차 가게 묶음과 같은 방식): 06 계약(`components.x-corthex.jobs`)과 06 README 10절 생성 표의 13개가 등록부와 같은 차례로 같아야 합니다. 06에 일이 더해지거나 빠지면 CI가 실패합니다. 맡는 작업이 WBS에 그 SPEC으로 있고 TASK-023 뒤에 오는지, 찾는 곳마다 한 일만 쓰는지도 봅니다.
40. 도는 꼴은 넷입니다.
    - 매분(`minute`): 9개(SPEC-024·025·037·044·064·066·067·008·047). 찾는 곳이 아직 없는 일(`consultation_idle`·`channel_check`·`refund_send_realert`)은 맡는 작업이 곳을 더합니다(47).
    - 가게 시각(`shop_time`, SPEC-052·061): 실행기에는 매분으로 넘깁니다. 맡는 작업이 가게 시간대(G8, `time.ts`)로 센 보낼 때를 `notifications.next_attempt_at`에 둔 행을 만들면, 손님 안내 일(SPEC-066)이 그 행을 보냅니다.
    - 하루 한 번(`day`, SPEC-065 지난 기록 지우기): 03:00 Asia/Seoul(Cron은 UTC라 UTC 18:00)부터 3시간 안에 시작합니다. 트랜잭션 단위 advisory lock(`pg_advisory_xact_lock`, Hyperdrive에서 됨)으로 하나만 시작하고, 시작할 때 `ops_events`에 `purge_run`(count 0, detail `{"started":1}`)을 적어 그날 다시 시작하지 않습니다. 3시간 안에 시작하지 못하면 다음 날 03:00에 합니다(SPEC-065의 '실패하면 다음 날 다시'). 그 실행 안에서는 곳마다 묶음 20번(1,000행)까지 하고 남은 것은 다음 날입니다.
    - 요청 안(`request`, SPEC-074 접속기록): 운영자 요청을 처리하는 트랜잭션 안에서 함께 적어야 빠지지 않으므로 실행기에 넘기지 않고, 등록부에는 맡는 작업(TASK-024)과 까닭만 둡니다.
41. 한도와 겹침(Cron 한 번은 CPU 30초·벽시계 15분, tech-stack.md 3-3): 한 번의 실행은 일마다 곳마다 50행, 모두 45초까지 하고 남은 것은 다음 분에 합니다. 일의 차례는 분마다 돌려 한 일이 늘 뒤로 밀리지 않게 합니다. 앞 실행이 끝나기 전에 다음 분이 와도 `SKIP LOCKED`와 임대로 같은 행을 두 번 처리하지 않습니다.
42. 다시 하기 때(`server/src/retry.ts`): G4(처음과 1·5·30분 뒤, 4번까지. 05 `attempts` CHECK 0\~4와 견줌), 발송 결과 조회(요청 1·5·30분 뒤. 찾기 SQL의 셈과 같은지 23가지로 시험), 장부 다시 적기(1분·5분·30분·2시간·6시간, 그 뒤 하루 한 번)를 한 곳에 둡니다.
43. 같은 일은 한 번만(`server/src/event-keys.ts`, 05 A33): A33 표의 키 일곱을 짓는 `eventKeys`와 `insertOnce`(`INSERT … ON CONFLICT (shop_id, 키 컬럼) DO NOTHING RETURNING id`)입니다. `insertOnce`는 새로 넣었는지와 행 ID를 돌려주고, 넣지 못했으면 있는 행을 따로 읽습니다. 뒤따르는 일은 새로 넣었을 때만 합니다. 키 형식은 05 README A33 표를 읽어 견주고(표가 바뀌면 시험이 실패), 넣는 SQL이 그 꼴이 아니면 `insertOnce`가 거절합니다.
44. 실패 남기기: 처리 실패는 ID만 실은 로그(`job_item_failed`·`job_act_failed`·`job_find_failed`·`job_start_failed`·`job_run_failed`, G6)입니다. 05 `ops_events.kind`에 실행기 실패 종류가 없어 05를 바꾸지 않고 로그로 두며, 운영자 알림은 TASK-016(스테이징 배포와 외부 감시)의 끝난 조건에 더했습니다. 일마다 한 번의 실행이 끝나면 `job_run`(일 이름과 처리한 수)을 남깁니다.
45. 큐 대신 Cron(2026-11-16에 고름): 발송 결과 조회(1·5·30분 뒤)와 장부 다시 적기(1분\~6시간 뒤)는 큐 `delaySeconds` 대신 1분 Cron이 데이터베이스의 때 컬럼으로 찾습니다. 05에 그 때를 셀 컬럼과 인덱스가 이미 있고, 서버를 다시 띄워도 기다리던 일이 저절로 이어지고, 큐 메시지를 잃거나 두 번 받아도 상관없고, Cloudflare 없이 시험되기 때문입니다. 큐는 AI 답·콜백에만 씁니다(tech-stack.md 3-2, 10-wbs README 10절). 새 의존성은 없습니다.
46. 시험(TASK-023): 서버 시험 434 → 513개(21 → 27파일).
    - (가) 같은 이벤트 키: 일곱 테이블마다 같은 키를 차례로, 그리고 동시에(연결 둘, 뒤 것은 앞 것이 커밋할 때까지 기다림) 두 번 넣어 한 행입니다. 앞 것을 되돌리면 기다리던 것이 넣습니다. 실행기로는 키로 넣은 일이 실행기 두 번·연결 둘에서 한 번만 돌고, 겹친 실행기 둘이 20행을 한 번씩 처리합니다.
    - (나) 멈춘 실행기 뒤 이어짐: 처리 중 던지면 그 행만 되돌리고, 다음 실행기가 그 행과 남은 행을 한 번씩 합니다. 행을 잡은 채 연결이 끊겨도(`pg_terminate_backend`) 겹친 실행기는 그 행을 건너뛰고 새 실행기가 한 번 합니다. 임대한 채 멈추면 임대가 끝나기 전에는 다시 찾지 않고, 끝난 뒤 새 실행기가 바깥을 부르고 결과를 적습니다.
    - 이 밖에: 등록부와 06(13개), 찾기가 05 부분 인덱스의 조건으로 시작하고 실행 계획이 그 인덱스를 씀, G4 다시 보내기 4번과 멈춘 바깥 호출의 시간 넘김, 하루 한 번(같은 분의 둘 중 하나만 시작, 그날 다시 안 함, 다음 날, 놓친 창), 묶음·시간 한도, scheduled 어댑터(가짜 이벤트), 로그에 ID만.
    - 공유 시험 데이터베이스에서 다른 시험의 행을 집지 않게, 실행기 시험은 2001\~2008년의 아무 분을 기준 시각으로 쓰고 처리는 자기 행만 봅니다.
47. 넘기는 것(TASK-023)
    - 1분 Cron Trigger(`wrangler.jsonc`의 `triggers.crons`): TASK-173(끝난 조건에 이미 있음).
    - 처리: 등록부의 맡는 작업(TASK-075·076·098·119·134·144·157·158·104·072·043·123)이 `JOB_HANDLERS`에 붙입니다. 찾는 곳이 없는 일은 곳을 더합니다. `consultation_idle`(SPEC-025)은 가게마다 기준이 달라 `cutoff`나 새 곳을, `channel_check`(SPEC-008)는 `kakao_channels.claim_expires_at`에 05 인덱스가 없어 05 PR을 먼저, `refund_send_realert`(SPEC-047)는 찾을 곳을 고릅니다.
    - 지우기: TASK-158이 지운 수를 `purge_run`에 적습니다(실행기가 적는 시작 표시는 count 0). 1,000행을 넘어 남는 것을 다음 날로 둘지 나눠 할지도 TASK-158이 고릅니다.
    - 실패 알림은 TASK-016, 접속기록은 TASK-024(요청 안)가 맡습니다.
    - 늘 던지는 행은 매분 다시 집혀 묶음을 채울 수 있습니다. 맡는 작업은 다시 해도 안 될 실패를 행의 상태(`failed`와 `fail_code` 같은 것)로 적어 찾기에서 빠지게 합니다.
    - 시간 넘김 뒤 실제로는 된 바깥 호출은 다시 보낼 수 있습니다(G4 다시 보내기와 같은 위험). 카카오 요청 ID로 결과를 조회하는 손님 안내(TASK-104)와 사장님 알림(TASK-072)이 다룹니다.

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
