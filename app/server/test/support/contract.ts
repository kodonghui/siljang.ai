import { readFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect } from "vitest";
import { parse } from "yaml";
import { ERRORS, type ErrorCode } from "../../src/problem";

/** 06 계약(api/openapi.yaml). 응답 본문을 계약의 스키마로 검사한다(OpenAPI 3.1 = JSON Schema 2020-12). */
export const contract = parse(readFileSync(new URL("../../../../api/openapi.yaml", import.meta.url), "utf8")) as {
  readonly paths: Record<string, Record<string, unknown>>;
};

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract as unknown as object, "openapi");

export function contractSchema(name: string): ValidateFunction {
  const v = ajv.getSchema(`openapi#/components/schemas/${name}`);
  if (v === undefined) throw new Error(`schema ${name} not found in the contract`);
  return v;
}

/** 본문이 계약의 스키마에 맞는지(어긋난 곳을 메시지로). */
export function expectSchema(name: string, body: unknown): void {
  const v = contractSchema(name);
  const ok = v(body);
  expect(v.errors ?? [], `${name}: ${JSON.stringify(v.errors)}`).toEqual([]);
  expect(ok).toBe(true);
}

/** 계약의 오류 응답(Problem)인지 보고 본문을 돌려준다. */
export async function expectProblem(res: Response, code: ErrorCode): Promise<Record<string, unknown>> {
  const text = await res.text();
  expect(res.status, text).toBe(ERRORS[code].status);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = JSON.parse(text) as Record<string, unknown>;
  expectSchema("Problem", body);
  expect(body.code).toBe(code);
  return body;
}

/** traceId·instance를 뺀 본문(같은 응답인지 견줄 때). */
export function comparableProblem(body: Record<string, unknown>): Record<string, unknown> {
  const { traceId: _t, instance: _i, ...rest } = body;
  return rest;
}
