import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindingLimiter, OWNER_LOGIN_RATE, UPLOAD_RATE } from "../src/rate-limit";

// 사진 올리기의 사장님마다 1분 30번(06 DEC-16, TASK-022). 코드의 값과 Worker 설정(wrangler.jsonc)의 묶음 값이 같은지 본다.

/** wrangler.jsonc를 읽는다(이 파일은 줄 전체 주석 // 만 씀). */
function wranglerConfig(): { ratelimits?: unknown; env: { staging: { ratelimits?: unknown } } } {
  const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const json = text
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(json);
}

describe("사진 올리기 한도 묶음(Cloudflare Rate Limiting)", () => {
  it("wrangler.jsonc의 묶음이 UPLOAD_RATE와 같음(이름·1분·30번)", () => {
    expect(UPLOAD_RATE).toEqual({ binding: "UPLOAD_RATE_LIMITER", limit: 30, periodSeconds: 60 });
    const expected = [
      {
        name: UPLOAD_RATE.binding,
        namespace_id: "1001",
        simple: { limit: UPLOAD_RATE.limit, period: UPLOAD_RATE.periodSeconds },
      },
      { name: OWNER_LOGIN_RATE.binding, namespace_id: "1002", simple: { limit: 10, period: 60 } },
    ];
    expect(OWNER_LOGIN_RATE).toEqual({ binding: "OWNER_LOGIN_RATE_LIMITER", limit: 10, periodSeconds: 60 });
    expect(wranglerConfig().ratelimits).toEqual(expected);
    expect(wranglerConfig().env.staging.ratelimits).toEqual(expected);
  });

  it("묶음에는 키만 넘기고 success를 그대로 돌려줌", async () => {
    const seen: unknown[] = [];
    const limiter = bindingLimiter({
      limit: async (options) => {
        seen.push(options);
        return { success: seen.length <= 1 };
      },
    });
    expect(await limiter.limit("upload:a")).toBe(true);
    expect(await limiter.limit("upload:a")).toBe(false);
    expect(seen).toEqual([{ key: "upload:a" }, { key: "upload:a" }]);
  });
});
