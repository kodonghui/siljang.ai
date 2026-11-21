import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { KAKAO_COMMON_OUTCOMES, kakaoAiFailureOutcome, kakaoReply } from "../src/kakao-reply";
import type { ShopRequest } from "../src/routes";
import { expectSchema } from "./support/contract";

const api = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8"));
const examples = api.paths["/kakao/skills/message"].post.responses[200].content["application/json"].examples;
const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};

describe("TASK-028 고정 스킬 응답의 계약", () => {
  it.each([
    "callback_pending",
    "ai_unavailable",
    "ai_timeout",
    "ai_key_missing",
    "ai_limit_reached",
    "ai_cost_limit_reached",
    "unsupported_message",
    "rate_limited",
    "duplicate",
    "not_accepting",
    "server_error",
  ] as const)("API-070의 %s 예시·스키마·상태를 만족한다", async (outcome) => {
    expect(KAKAO_COMMON_OUTCOMES).toContain(outcome);
    const response = kakaoReply(responder, outcome, { contactPhone: "010-1234-5678" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe(outcome);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual(examples[outcome].value);
    expectSchema("SkillResponse", body);
  });

  it("API-073의 전할 안내 없음도 같은 형식을 쓴다", async () => {
    const response = kakaoReply(responder, "notice_gone");
    const expected =
      api.paths["/kakao/skills/event"].post.responses[200].content["application/json"].examples.notice_gone.value;
    expect(await response.json()).toEqual(expected);
  });

  it("같은 제한 구간의 두 번째 안내와 중복은 출력이 없다", async () => {
    for (const outcome of ["rate_limited", "duplicate"] as const) {
      const response = kakaoReply(responder, outcome, { silent: true });
      const body = await response.json();
      expect(body).toEqual({ version: "2.0", template: { outputs: [] } });
      expectSchema("SkillResponse", body);
    }
  });

  it("AI 실패 안내에는 빈 출력 옵션이나 가게 연락처가 섞이지 않는다", async () => {
    const response = kakaoReply(responder, "ai_timeout", { silent: true, contactPhone: "02-000-0000" });
    expect(await response.json()).toEqual(examples.ai_timeout.value);
  });

  it.each([
    ["timeout", "ai_timeout"],
    ["unavailable", "ai_unavailable"],
    ["key_missing", "ai_key_missing"],
    ["limit_reached", "ai_limit_reached"],
  ] as const)("모델 호출 실패 %s를 고정 결과 %s로 바꾼다", (failure, outcome) => {
    expect(kakaoAiFailureOutcome(failure)).toBe(outcome);
  });

  it("출력 검증 실패는 호출 실패로 바꾸지 않는다", () => {
    expect(() => kakaoAiFailureOutcome("schema_invalid" as never)).toThrow("unsupported model failure");
  });
});
