import { expect, it } from "vitest";
import { createApp } from "../src/app";
import { expectProblem } from "./support/contract";
import { newRequestKey, testEnv } from "./support/db";

it("인증 없는 가게 설정 변경은401이고 DB를 열지 않음", async () => {
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
    "https://siljang.example/api/owner/shop",
    {
      method: "PATCH",
      headers: {
        origin: "https://siljang.example",
        "content-type": "application/json",
        "Idempotency-Key": newRequestKey(),
      },
      body: JSON.stringify({ baseRevision: "1", name: "합성 설정" }),
    },
    testEnv(),
  );
  await expectProblem(response, "unauthenticated");
  expect(calls).toBe(0);
});
