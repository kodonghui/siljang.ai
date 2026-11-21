import { createApp } from "./app";
import { createKakaoCallbackHandler } from "./kakao-callback-queue";
import { createScheduledHandler } from "./scheduled";

// Worker 진입점. /api/* 만 fetch로 오고(나머지는 정적 자산, wrangler.jsonc의 assets), Cron Trigger는 scheduled로 온다
// (서버 안의 일 실행기, TASK-023. Wrangler의 staging에 1분 Cron을 연결함, TASK-173).
const app = createApp();

export default {
  fetch: app.fetch,
  scheduled: createScheduledHandler(),
  queue: createKakaoCallbackHandler(),
};
