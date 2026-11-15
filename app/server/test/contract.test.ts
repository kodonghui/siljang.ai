import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PROBLEM_TITLES, problemBody } from "../src/problem";

// 뼈대가 내는 오류가 06 계약(api/openapi.yaml)의 꼴과 말을 따르는지 본다.
const contract = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as {
  components: {
    schemas: { Problem: { required: string[]; properties: Record<string, { enum?: string[]; pattern?: string }> } };
    "x-corthex": { errors: Record<string, { status: number; message: string }> };
  };
};

describe("06 계약과 맞춤", () => {
  const errors = contract.components["x-corthex"].errors;
  const problem = contract.components.schemas.Problem;

  it("오류 코드·상태·제목이 계약의 오류 목록과 같다", () => {
    for (const [code, title] of Object.entries(PROBLEM_TITLES)) {
      const entry = errors[code];
      expect(entry, code).toBeDefined();
      expect(title).toBe(entry?.message);
      expect(problemBody(code as keyof typeof PROBLEM_TITLES, "a".repeat(32)).status).toBe(entry?.status);
      expect(problem.properties.code?.enum).toContain(code);
    }
  });

  it("Problem 본문이 계약의 필수 필드와 traceId 꼴을 갖춘다", () => {
    const body = problemBody("not_found", "0123456789abcdef0123456789abcdef", "/api/x") as unknown as Record<
      string,
      unknown
    >;
    for (const field of problem.required) {
      expect(body, field).toHaveProperty(field);
    }
    const pattern = problem.properties.traceId?.pattern;
    expect(pattern).toBeDefined();
    expect(String(body.traceId)).toMatch(new RegExp(pattern ?? "^$"));
  });
});
