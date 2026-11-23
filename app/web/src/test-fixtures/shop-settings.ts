/** 시험의 성공 응답은 OpenAPI 합성 예시를 직접 읽어 계약과 별도로 값을 만들지 않는다. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

type Operation = {
  responses: { "200": { content: { "application/json": { examples: Record<string, { value: unknown }> } } } };
};
const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8")) as {
  paths: { "/owner/shop": { get: Operation; patch: Operation } };
};
const examples = Object.fromEntries(
  (["get", "patch"] as const).flatMap((method) =>
    Object.entries(contract.paths["/owner/shop"][method].responses["200"].content["application/json"].examples).map(
      ([name, example]) => [`${method}_${name}`, example.value],
    ),
  ),
);
export function shopFixture(name = "get_verified"): Record<string, unknown> {
  if (!(name in examples)) throw new Error(`test example missing: ${name}`);
  return structuredClone(examples[name]) as Record<string, unknown>;
}
