// 평가 도구(TASK-027)를 빌드 없이 Node 22의 타입 지우기로 돌리려고 ts-hooks.mjs를 붙인다(package.json의 eval 명령이 --import로 실음).
import { register } from "node:module";

register("./ts-hooks.mjs", import.meta.url);
