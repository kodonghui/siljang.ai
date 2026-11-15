# app: 서버와 웹 (11단계 원본)

TASK-015(REQ-135)의 개발 저장소 뼈대입니다. 계약은 [../api/openapi.yaml](../api/openapi.yaml), 스키마는 [../db/](../db/)에 있고 여기서 고치지 않습니다.

## 설계 메모

1. 배치: `app/` 아래 npm workspaces 둘. `server/`는 Cloudflare Workers의 Hono(TypeScript strict), `web/`은 React·Vite. 웹 빌드(`web/dist`)를 같은 Worker가 정적 자산으로 줍니다(tech-stack.md ②·③).
2. 주소: API는 `/api` 아래에 둡니다. 07 사이트맵의 화면 주소(`/owner/orders` 등)와 06 계약의 API 경로가 같은 출처에서 겹치기 때문입니다. `/api/*`만 Worker 코드가 받고(`run_worker_first`), 나머지는 정적 파일이며 없는 화면 주소는 `index.html`입니다. 계약의 `servers` 주소는 TASK-016에서 정합니다.
3. `GET /api/healthz`는 06 계약에 없는 기반 시설 주소입니다(TASK-016의 1분 감시용). 계약 API가 아닙니다.
4. 오류: 06의 Problem(`application/problem+json`; `type`·`title`·`status`·`code`·`traceId`) 꼴입니다. 뼈대는 `not_found`(404)와 `internal`(500)만 내고, 나머지 오류 코드와 요청 키는 TASK-018이 만듭니다.
5. 설정과 키: env는 `server/src/settings.ts` 한 곳만 읽습니다. 키(`ANTHROPIC_API_KEY`·`OPENAI_API_KEY`)는 Worker 비밀 값이나 환경 변수에만 두고, 글·JSON·로그로 바꾸면 가립니다. 모델은 서버만 부르고 `VITE_*`에는 비밀 값을 넣지 않습니다. `APP_ENV`가 없으면 production입니다.
6. 로컬 값은 `server/.dev.vars`에 둡니다(저장소에 넣지 않음, 값 없는 예시는 `server/.dev.vars.example`). 시험은 키 없이 지납니다.
7. 로그: `server/src/log.ts`의 JSON 한 줄이고 event·traceId·errorName·names·status만 싣습니다. 오류 메시지·요청 본문·헤더·설정 값은 싣지 않습니다.
8. 서버 코드는 Node 형식을 쓰지 않습니다. 타입은 `wrangler types`가 만드는 Workers 런타임 형식만 보고(`npm run typecheck`가 만듦), 시험만 Node 형식을 씁니다.
9. 도구: Node 22.23.4(`.nvmrc`), npm과 `package-lock.json`, TypeScript 7, Vitest 5, Biome(린트와 형식을 도구 하나로). 버전은 모두 정확히 고정했습니다.
10. Vitest 5를 고른 까닭: 4.1은 Node 22의 npm 10.9가 vite 8의 선택 피어(@vitejs/devtools)와 함께 풀다 멈춥니다. 서버 시험은 Node에서 `app.request()`로 돌리고, Workers 런타임 시험(vitest-pool-workers, 지금은 Vitest 4.1만 받음)은 TASK-171·173에서 정합니다.
11. lockfile은 나온 지 일주일 넘은 판만 쓰도록 `npm install --before=2026-11-08`로 만들었습니다. 의존성을 바꿀 때도 같은 방식을 씁니다.
12. wrangler 설정에는 계정 ID·도메인·비밀 값이 없습니다. 배포(TASK-016)는 CI 환경 변수로 계정을 고릅니다. Hyperdrive·Queues·Cron·nodejs_compat은 TASK-171·173에서 더합니다.
13. CI(`.github/workflows/app.yml`): 설치·린트·타입 검사·시험·빌드와, 저장소 키 검사·로그 키 검사(`../tools/check-no-keys.mjs`). 작업에 비밀 값을 넘기지 않습니다.

## 명령 (`app/`에서)

```bash
npm ci && npm run lint && npm run typecheck && npm test && npm run build
```

개발 때는 `npm run dev -w server`(wrangler dev, 127.0.0.1:8787)와 `npm run dev -w web`(Vite, `/api`를 8787로 넘김)을 함께 띄웁니다.
