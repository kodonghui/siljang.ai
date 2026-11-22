import { expect, it } from "vitest";
import { createApp } from "../src/app";
import { expectProblem } from "./support/contract";
import { newRequestKey, testEnv } from "./support/db";

it("인증 없는 연결 확인 시작은401이고DB를 읽거나 쓰지 않음", async () => {
  let calls = 0;
  const fail = async (): Promise<never> => {
    calls++;
    throw new Error("DB를 부르면 안 됨");
  };
  const app = createApp({
    connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    logSink: () => {},
  });
  const response = await app.request(
    "https://siljang.example/api/owner/kakao-channel/check",
    { method: "POST", headers: { origin: "https://siljang.example", "Idempotency-Key": newRequestKey() } },
    testEnv(),
  );
  await expectProblem(response, "unauthenticated");
  expect(calls).toBe(0);
});
it("연결 확인 경로는POST만 받고 GET은405와Allow를 돌려줌", async () => {
  const app = createApp({ logSink: () => {} }),
    response = await app.request("https://siljang.example/api/owner/kakao-channel/check", {}, testEnv());
  await expectProblem(response, "method_not_allowed");
  expect(response.headers.get("allow")).toBe("POST");
});
