import { describe, expect, it } from "vitest";
import {
  AI_TURN_OUTPUT_SCHEMA,
  checkTurnOutput,
  normalizeProviderOutput,
  providerOutputSchema,
} from "../src/ai-turn-output";
import { contract, contractSchema } from "./support/contract";

// AI 출력 하나의 모양(TASK-026; 06 DEC-17 AiTurnOutput, 04 AI-1 '서버가 확인함'). 손으로 옮긴 스키마가 06과 같은지,
// 서버 확인이 회사와 상관없이 같은지 본다. 글은 합성 시험 글.

type Json = Record<string, unknown>;
const schemas = (contract as unknown as { components: { schemas: Record<string, Json> } }).components.schemas;

/** 06 스키마에서 설명·예시·x-corthex 표시를 빼고 $ref(ChangeSet)를 풀어 넣는다. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value !== "object" || value === null) return value;
  const node = value as Json;
  if (typeof node.$ref === "string") {
    const name = node.$ref.replace("#/components/schemas/", "");
    const target = schemas[name];
    if (target === undefined) throw new Error(`unresolved ${node.$ref}`);
    return normalize(target);
  }
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "description" || k === "example" || k === "examples" || k === "title" || k.startsWith("x-")) continue;
    out[k] = normalize(v);
  }
  return out;
}

const VALID = {
  reply: "1호 생크림은 35,000원이에요. 픽업 날짜를 알려 주시겠어요?",
  draft_patch: { size: "1호", flavor: "생크림", extras: ["초"], pickup_day: "2026-12-24", pickup_time: "14:30" },
  quote_request: { size: "1호", flavor: "생크림" },
  handoff: { reason: "customer_request" },
  issue_patch: { order_no: "A1B2C3", photo_positions: [1, 2] },
  refund_account_patch: { account_number: "[계좌번호1]", bank_name: "시험은행" },
  card: {
    kind: "change_request",
    order_no: "A1B2C3",
    changes: { lettering: "축하해", pickupAt: "2026-12-24T14:30:00+09:00" },
  },
};

describe("AiTurnOutput(06 DEC-17)", () => {
  it("손으로 옮긴 스키마는 06 AiTurnOutput과 같다(설명·예시 빼고, ChangeSet 풀어 넣음)", () => {
    expect(schemas.AiTurnOutput).toBeDefined();
    expect(AI_TURN_OUTPUT_SCHEMA).toEqual(normalize(schemas.AiTurnOutput));
  });

  it("서버 확인은 06 계약 검사(ajv)와 같은 답을 낸다", () => {
    const v = contractSchema("AiTurnOutput");
    const cases: unknown[] = [
      VALID,
      { reply: "" },
      { reply: "가".repeat(600) },
      { reply: "가".repeat(601) },
      { reply: "안녕하세요", extra: 1 },
      { draft_patch: { size: "1호" } },
      { reply: "x", draft_patch: {} },
      { reply: "x", draft_patch: { extras: ["초", "초"] } },
      { reply: "x", card: { kind: "change_request", changes: { extras: ["초", "초"] } } },
      { reply: "x", draft_patch: { pickup_time: "24:00" } },
      { reply: "x", draft_patch: { pickup_day: "2026-02-30" } },
      { reply: "x", handoff: { reason: "unknown" } },
      { reply: "x", issue_patch: { photo_positions: [0] } },
      { reply: "x", issue_patch: { order_no: "a1b2c3" } },
      { reply: "x", refund_account_patch: { account_number: "110-123-456789" } },
      { reply: "x", card: { kind: "cancel" } },
      { reply: "x", card: { kind: "payment_claim", changes: {} } },
      { reply: "x", card: { kind: "change_request", changes: { pickupAt: "내일" } } },
    ];
    for (const value of cases) {
      const ours = checkTurnOutput(value);
      expect(ours.ok, JSON.stringify(value).slice(0, 80)).toBe(v(value));
    }
  });

  it("어긋나면 위치만 알려 준다(값·글은 싣지 않음)", () => {
    const bad = checkTurnOutput({ reply: "비밀 글".repeat(200), card: { kind: "없는종류" } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.paths).toEqual(expect.arrayContaining(["#/reply", "#/card/kind"]));
      for (const p of bad.paths) expect(p).toMatch(/^#(\/[a-z_]+)*$/);
      expect(JSON.stringify(bad)).not.toContain("비밀");
      expect(JSON.stringify(bad)).not.toContain("없는종류");
    }
    for (const notObject of [null, "글", 3, [VALID]])
      expect(checkTurnOutput(notObject)).toEqual({ ok: false, paths: ["#"] });
  });

  it("OpenAI strict 꼴: 모든 객체가 필드를 다 required로, 없을 수 있는 필드는 null 허용, 다른 필드 금지, 받지 않는 낱말 없음", () => {
    const strict = providerOutputSchema("openai");
    const walk = (node: Json, path: string) => {
      for (const word of ["minLength", "maxLength", "uniqueItems", "minProperties"]) {
        expect(node[word], `${path}.${word}`).toBeUndefined();
      }
      if (node.type === "object") {
        const props = node.properties as Record<string, Json>;
        expect(node.additionalProperties, path).toBe(false);
        expect(node.required, path).toEqual(Object.keys(props));
        for (const [name, prop] of Object.entries(props)) {
          const inner = Array.isArray(prop.anyOf) ? (prop.anyOf[0] as Json) : prop;
          if (Array.isArray(prop.anyOf)) expect(prop.anyOf[1]).toEqual({ type: "null" });
          walk(inner, `${path}.${name}`);
        }
      }
      if (node.items !== undefined) walk(node.items as Json, `${path}[]`);
    };
    walk(strict, "#");
    // 06에서 필수인 필드는 null을 받지 않는다.
    const props = strict.properties as Record<string, Json>;
    expect(props.reply).toEqual({ type: "string" });
  });

  it("Anthropic의 구조화 출력은 선택 필드 24개·유니언 16개 한도를 지키고 같은 필드를 보낸다", () => {
    let optional = 0;
    let unions = 0;
    const walk = (wire: Json, contractNode: Json) => {
      if (Array.isArray(wire.anyOf)) {
        unions += 1;
        expect(wire.anyOf[1]).toEqual({ type: "null" });
        walk(wire.anyOf[0] as Json, contractNode);
        return;
      }
      expect(wire.type).toBe(contractNode.type);
      if (wire.type !== "object") return;
      const props = wire.properties as Record<string, Json>;
      const originalProps = contractNode.properties as Record<string, Json>;
      const required = (wire.required ?? []) as string[];
      expect(Object.keys(props)).toEqual(Object.keys(originalProps));
      expect(wire.additionalProperties).toBe(false);
      expect(required).toEqual(expect.arrayContaining((contractNode.required ?? []) as string[]));
      optional += Object.keys(props).length - required.length;
      for (const [name, prop] of Object.entries(props)) walk(prop, originalProps[name] as Json);
    };
    walk(providerOutputSchema("anthropic"), AI_TURN_OUTPUT_SCHEMA);
    expect(optional).toBeLessThanOrEqual(24);
    expect(unions).toBeLessThanOrEqual(16);
  });

  it("Anthropic이 채운 빈 문자열과 null을 지우고, 계약에서 허용한 빈 값과 실제 수정 내용은 남긴다", () => {
    const output = {
      reply: "",
      draft_patch: { size: "1호", flavor: "", pickup_day: null, pickup_time: "", lettering: "" },
      quote_request: { size: "", pickup_day: null },
      handoff: { reason: "customer_request", requested_day: null },
      issue_patch: { order_no: "", health_concern: false, photo_positions: [] },
      card: { kind: "change_request", order_no: "A1B2C3", changes: { design: "", pickupAt: null } },
    };
    const cleaned = normalizeProviderOutput("anthropic", output);
    expect(cleaned).toEqual({
      reply: "",
      draft_patch: { size: "1호", lettering: "" },
      handoff: { reason: "customer_request" },
      issue_patch: { health_concern: false, photo_positions: [] },
      card: { kind: "change_request", order_no: "A1B2C3" },
    });
    expect(checkTurnOutput(cleaned).ok).toBe(true);
    expect(
      checkTurnOutput(normalizeProviderOutput("anthropic", { reply: "", issue_patch: { photo_positions: [0] } })).ok,
    ).toBe(false);
    expect(
      checkTurnOutput(normalizeProviderOutput("anthropic", { reply: "", draft_patch: { lettering: null } })).ok,
    ).toBe(false);
  });

  it("OpenAI가 null로 채운 '없음'은 지운 뒤 확인하면 같은 출력", () => {
    const filled = {
      reply: VALID.reply,
      draft_patch: { size: "1호", flavor: null, extras: ["초"], pickup_day: null },
      quote_request: null,
      handoff: null,
      issue_patch: null,
      refund_account_patch: null,
      card: null,
    };
    const cleaned = normalizeProviderOutput("openai", filled);
    expect(cleaned).toEqual({ reply: VALID.reply, draft_patch: { size: "1호", extras: ["초"] } });
    expect(checkTurnOutput(cleaned).ok).toBe(true);
  });
});
