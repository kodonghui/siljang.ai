import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createApp } from "../src/app";
import {
  ApiError,
  CONFIRMATION_KINDS,
  ERROR_CODES,
  ERRORS,
  type ErrorCode,
  FIELD_REASONS,
  type ProblemExtras,
  problemBody,
} from "../src/problem";
import { REPLAYED_HEADER, REQUEST_KEY_HEADER, readRequestKey } from "../src/request-key";

// 오류 응답이 06 계약(api/openapi.yaml)의 목록·말·모양을 따르는지 본다(TASK-018).
type Schema = Record<string, unknown> & { enum?: string[]; pattern?: string; minLength?: number; maxLength?: number };
const contract = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as {
  components: {
    schemas: Record<string, { required?: string[]; properties: Record<string, Schema> }>;
    parameters: Record<string, { name: string; schema: Schema }>;
    headers: Record<string, { schema: Schema }>;
    "x-corthex": {
      errors: Record<string, { status: number; message: string }>;
      fieldErrors: Record<string, string>;
    };
  };
};

const xc = contract.components["x-corthex"];
const schemas = contract.components.schemas;

// 계약의 Problem 스키마로 응답 본문을 검사한다(OpenAPI 3.1 = JSON Schema 2020-12). 계약의 확장 키워드는 무시.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract as unknown as object, "openapi");
const validateProblem = ajv.getSchema("openapi#/components/schemas/Problem");
if (validateProblem === undefined) throw new Error("Problem schema not found in the contract");

/** 코드마다 꼭 붙어야 하는 것(06 Problem의 설명). */
function requiredExtras(code: ErrorCode): ProblemExtras {
  if (code === "validation_failed") return { errors: [{ field: "/name", code: "required" }] };
  if (code === "confirmation_required")
    return { confirm: [{ kind: "closed_day_with_orders", count: 3, day: "2026-11-20" }] };
  if (ERRORS[code].status === 429) return { retryAfterSeconds: 30 };
  if (code === "method_not_allowed") return { allow: ["GET", "POST"] };
  return {};
}

function appThrowing(code: ErrorCode, extras: ProblemExtras) {
  const app = createApp({ logSink: () => {} });
  app.get("/probe", () => {
    throw new ApiError(code, extras);
  });
  return app;
}

async function expectContractProblem(res: Response, code: ErrorCode) {
  expect(res.status).toBe(ERRORS[code].status);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = (await res.json()) as Record<string, unknown>;
  const ok = validateProblem?.(body);
  expect(validateProblem?.errors ?? [], `${code}: ${JSON.stringify(validateProblem?.errors)}`).toEqual([]);
  expect(ok).toBe(true);
  expect(body).toMatchObject({
    type: `/problems/${code}`,
    title: ERRORS[code].title,
    status: ERRORS[code].status,
    code,
  });
  return body;
}

describe("06 계약의 목록과 같음", () => {
  it("오류 코드 38개: 이름·상태·말이 계약의 errors와 같고 Problem.code enum과도 같다", () => {
    expect(Object.keys(xc.errors)).toHaveLength(38);
    expect([...ERROR_CODES].sort()).toEqual(Object.keys(xc.errors).sort());
    for (const code of ERROR_CODES) {
      expect(ERRORS[code].status, code).toBe(xc.errors[code]?.status);
      expect(ERRORS[code].title, code).toBe(xc.errors[code]?.message);
    }
    expect([...(schemas.Problem?.properties.code?.enum ?? [])].sort()).toEqual([...ERROR_CODES].sort());
  });

  it("필드 오류 사유 24개: fieldErrors와 FieldError.code enum과 같다", () => {
    expect(Object.keys(xc.fieldErrors)).toHaveLength(24);
    expect([...FIELD_REASONS].sort()).toEqual(Object.keys(xc.fieldErrors).sort());
    expect([...(schemas.FieldError?.properties.code?.enum ?? [])].sort()).toEqual([...FIELD_REASONS].sort());
  });

  it("확인할 것의 종류가 ConfirmationNeeded.kind enum과 같다", () => {
    expect([...CONFIRMATION_KINDS].sort()).toEqual(
      [...(schemas.ConfirmationNeeded?.properties.kind?.enum ?? [])].sort(),
    );
  });

  it("요청 키 헤더의 이름·길이·글자가 계약의 IdempotencyKey와 같고, 다시 보냄 헤더 값이 계약의 enum 안", () => {
    const p = contract.components.parameters.IdempotencyKey;
    expect(p?.name).toBe(REQUEST_KEY_HEADER);
    const pattern = new RegExp(p?.schema.pattern ?? "^$");
    const samples = [
      "a".repeat(15),
      "a".repeat(16),
      "a".repeat(64),
      "a".repeat(65),
      `${"a".repeat(20)} b`,
      `ui-${"F0_".repeat(6)}`,
    ];
    for (const s of samples) {
      const accepted = (() => {
        try {
          readRequestKey(new Headers({ [REQUEST_KEY_HEADER]: s }));
          return true;
        } catch {
          return false;
        }
      })();
      const lengthOk = s.length >= (p?.schema.minLength ?? 0) && s.length <= (p?.schema.maxLength ?? 0);
      expect(accepted, s).toBe(pattern.test(s) && lengthOk);
    }
    expect(contract.components.headers.IdempotencyReplayed?.schema.enum).toEqual(["true"]);
    expect(REPLAYED_HEADER).toBe("Idempotency-Replayed");
  });
});

describe("오류 코드 37개가 계약의 모양으로 나간다", () => {
  for (const code of Object.keys(ERRORS) as ErrorCode[]) {
    it(`${code} (${ERRORS[code].status})`, async () => {
      const extras = requiredExtras(code);
      const res = await appThrowing(code, extras).request("/api/probe");
      const body = await expectContractProblem(res, code);
      expect(String(body.instance)).toBe("/api/probe");
      if (ERRORS[code].status === 429) {
        expect(res.headers.get("retry-after")).toBe("30");
        expect(body.retryAfterSeconds).toBe(30);
      } else {
        expect(res.headers.get("retry-after")).toBeNull();
      }
      if (code === "method_not_allowed") expect(res.headers.get("allow")).toBe("GET, POST");
      else expect(res.headers.get("allow")).toBeNull();
    });
  }
});

describe("필드 오류 사유 24개가 계약의 모양으로 나간다", () => {
  for (const reason of FIELD_REASONS) {
    it(reason, async () => {
      const errors = [
        { field: "/items/0/price", code: reason },
        { field: "header:Idempotency-Key", code: reason },
        { field: "query:cursor", code: reason },
        { field: "path:orderId", code: reason },
        { field: "file", code: reason },
        { field: "/", code: reason },
      ] as const;
      const res = await appThrowing("validation_failed", { errors }).request("/api/probe");
      const body = await expectContractProblem(res, "validation_failed");
      expect(body.errors).toEqual(errors);
    });
  }
});

describe("계약에 맞지 않는 오류는 내보내지 않는다", () => {
  const cases: [ErrorCode, ProblemExtras][] = [
    ["validation_failed", {}],
    ["not_found", { errors: [{ field: "/x", code: "required" }] }],
    ["validation_failed", { errors: [{ field: "x y", code: "required" }] }],
    ["confirmation_required", {}],
    ["rate_limited", {}],
    ["rate_limited", { retryAfterSeconds: 0 }],
    ["method_not_allowed", {}],
    ["not_found", { detail: "" }],
  ];
  for (const [code, extras] of cases) {
    it(`${code} ${JSON.stringify(extras)} → internal`, async () => {
      const lines: string[] = [];
      const app = createApp({ logSink: (l) => lines.push(l) });
      app.get("/probe", () => {
        throw new ApiError(code, extras);
      });
      const res = await app.request("/api/probe");
      await expectContractProblem(res, "internal");
      expect(lines.some((l) => l.includes('"errorName":"ProblemShapeError"'))).toBe(true);
    });
  }

  it("Problem 본문의 traceId가 계약의 꼴", () => {
    const body = problemBody("not_found", "0123456789abcdef0123456789abcdef", "/api/x");
    expect(validateProblem?.(body)).toBe(true);
  });
});
