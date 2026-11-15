import { createApp } from "./app";

// Worker 진입점. /api/* 만 여기로 오고, 나머지는 정적 자산이 받는다(wrangler.jsonc의 assets).
const app = createApp();

export default app;
