/**
 * AI 출력 하나의 모양(TASK-026; 06 DEC-17 `components.schemas.AiTurnOutput`, 04 AI-1 '출력'·'서버가 확인함').
 *
 * - AI_TURN_OUTPUT_SCHEMA는 06 계약의 AiTurnOutput을 손으로 옮긴 것이다. card.changes는 06의 ChangeSet을 그 자리에 풀어 넣었다.
 *   설명(description)·예시·x-corthex 표시만 빼고 06과 같은지 시험(test/ai-turn-output.test.ts)이 본다. 06이 바뀌면 시험이 실패한다.
 * - 회사마다 구조화 출력의 제약에 맞춘 스키마를 보낸다. Anthropic은 선택 필드 수를 줄이고, OpenAI는 모든 필드를 필수로 둔다.
 * - 받은 뒤에는 회사와 상관없이 같은 계약 스키마로 서버가 다시 확인한다(Workers에서 eval 없이 도는 @cfworker/json-schema).
 *   맞지 않으면 AI-1의 `schema_invalid`(ai_calls.fallback_reason).
 */
import { Validator } from "@cfworker/json-schema";
import type { AiProvider } from "./ai-prices";

type Json = Record<string, unknown>;

const str = (min: number, max: number): Json => ({ type: "string", minLength: min, maxLength: max });
const ORDER_NO: Json = { type: "string", minLength: 6, maxLength: 8, pattern: "^[0-9A-Z]{6,8}$" };
const EXTRAS = (unique: boolean): Json => ({
  type: "array",
  items: str(1, 30),
  minItems: 0,
  maxItems: 20,
  ...(unique ? { uniqueItems: true } : {}),
});

/** 06 `components.schemas.AiTurnOutput`(ChangeSet을 풀어 넣음). 바꾸지 말고 06을 바꾼 뒤 옮긴다. */
export const AI_TURN_OUTPUT_SCHEMA: Json = {
  type: "object",
  required: ["reply"],
  properties: {
    reply: str(0, 600),
    draft_patch: {
      type: "object",
      properties: {
        pickup_day: { type: "string", format: "date" },
        pickup_time: { type: "string", minLength: 5, maxLength: 5, pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
        courier_pickup: { type: "boolean" },
        size: str(1, 30),
        flavor: str(1, 30),
        design_option: str(1, 30),
        design: str(1, 30),
        extras: EXTRAS(true),
        design_notes: str(0, 500),
        lettering: str(0, 50),
        colors: str(0, 100),
        excluded_ingredients: str(0, 200),
      },
      additionalProperties: false,
      minProperties: 1,
    },
    quote_request: {
      type: "object",
      properties: {
        size: str(1, 30),
        flavor: str(1, 30),
        design_option: str(1, 30),
        design: str(1, 30),
        extras: EXTRAS(true),
        pickup_day: { type: "string", format: "date" },
      },
      additionalProperties: false,
      minProperties: 1,
    },
    handoff: {
      type: "object",
      required: ["reason"],
      properties: {
        reason: {
          type: "string",
          enum: ["edibility", "cannot_answer", "closed_day", "legal_medical", "customer_request", "pre_receipt_issue"],
        },
        requested_day: { type: "string", format: "date" },
      },
      additionalProperties: false,
    },
    issue_patch: {
      type: "object",
      properties: {
        order_no: ORDER_NO,
        photo_positions: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 5 },
          minItems: 0,
          maxItems: 5,
          uniqueItems: true,
        },
        health_concern: { type: "boolean" },
      },
      additionalProperties: false,
      minProperties: 1,
    },
    refund_account_patch: {
      type: "object",
      required: ["account_number"],
      properties: {
        bank_name: str(1, 30),
        account_number: { type: "string", minLength: 1, maxLength: 20, pattern: "^\\[계좌번호[0-9]{1,3}\\]$" },
        holder_name: str(1, 30),
      },
      additionalProperties: false,
    },
    card: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: {
          type: "string",
          enum: ["order_request", "payment_claim", "change_request", "cancel", "issue_report", "consent_withdrawal"],
        },
        order_no: ORDER_NO,
        changes: {
          type: "object",
          properties: {
            size: str(1, 30),
            flavor: str(1, 30),
            design: str(1, 30),
            extras: EXTRAS(false),
            designNotes: str(0, 500),
            lettering: str(0, 50),
            colors: str(0, 100),
            pickupAt: { type: "string", format: "date-time" },
            courierPickup: { type: "boolean" },
          },
          additionalProperties: false,
          minProperties: 1,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

/** 계약에 맞은 출력. 필드 뜻은 06 AiTurnOutput과 04 AI-1 '출력'. */
export interface AiTurnOutput {
  readonly reply: string;
  readonly draft_patch?: Readonly<Record<string, unknown>>;
  readonly quote_request?: Readonly<Record<string, unknown>>;
  readonly handoff?: { readonly reason: string; readonly requested_day?: string };
  readonly issue_patch?: Readonly<Record<string, unknown>>;
  readonly refund_account_patch?: {
    readonly account_number: string;
    readonly bank_name?: string;
    readonly holder_name?: string;
  };
  readonly card?: {
    readonly kind: string;
    readonly order_no?: string;
    readonly changes?: Readonly<Record<string, unknown>>;
  };
}

const validator = new Validator(AI_TURN_OUTPUT_SCHEMA, "2020-12", false);

export type TurnOutputCheck =
  | { readonly ok: true; readonly value: AiTurnOutput }
  /** 어긋난 곳의 위치만(값·글은 싣지 않음, G6). */
  | { readonly ok: false; readonly paths: readonly string[] };

/** 계약 스키마로 다시 확인한다. 회사가 무엇이든 같은 검사다. */
export function checkTurnOutput(value: unknown): TurnOutputCheck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, paths: ["#"] };
  const result = validator.validate(value);
  if (result.valid) return { ok: true, value: value as AiTurnOutput };
  const paths = [...new Set(result.errors.map((e) => e.instanceLocation))].sort();
  return { ok: false, paths };
}

/** OpenAI strict 구조화 출력이 받지 않는 낱말(공식 문서 'Supported schemas', 2026-11-16 확인). 서버 확인이 대신 본다. */
const OPENAI_DROPPED = ["minLength", "maxLength", "uniqueItems", "minProperties"] as const;

function openaiStrict(schema: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(schema)) {
    if ((OPENAI_DROPPED as readonly string[]).includes(key)) continue;
    if (key === "properties" || key === "required") continue;
    out[key] = key === "items" && typeof value === "object" && value !== null ? openaiStrict(value as Json) : value;
  }
  if (schema.type === "object") {
    const props = (schema.properties ?? {}) as Record<string, Json>;
    const required = new Set((schema.required ?? []) as string[]);
    const strictProps: Record<string, Json> = {};
    for (const [name, prop] of Object.entries(props)) {
      const inner = openaiStrict(prop);
      // 없을 수 있는 필드는 null을 받게 하고, 받은 뒤 null을 지운다(withoutNulls).
      strictProps[name] = required.has(name) ? inner : { anyOf: [inner, { type: "null" }] };
    }
    out.properties = strictProps;
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

const OPENAI_SCHEMA = openaiStrict(AI_TURN_OUTPUT_SCHEMA);

/** Anthropic은 선택 필드 24개·유니언 16개까지 받는다. 계약에서 비어 있으면 틀리는 문자열은 빈 문자열을 '없음'으로 쓴다. */
function anthropicAbsence(field: Json): "" | null | undefined {
  if (typeof field.format === "string") return null;
  if (typeof field.minLength === "number" && field.minLength > 0) return "";
  return undefined;
}

function anthropicSchema(schema: Json): Json {
  if (schema.type !== "object") return schema;
  const required = [...((schema.required ?? []) as string[])];
  const properties: Record<string, Json> = {};
  for (const [name, field] of Object.entries(schema.properties as Record<string, Json>)) {
    const absence = required.includes(name) ? undefined : anthropicAbsence(field);
    if (absence === undefined) {
      properties[name] = anthropicSchema(field);
      continue;
    }
    required.push(name);
    properties[name] =
      absence === null
        ? { anyOf: [field, { type: "null" }], description: "Return null when this field is absent." }
        : {
            ...field,
            description: "Return an empty string when absent. The constraints below apply to nonempty values.",
          };
  }
  return { ...schema, properties, required };
}

const ANTHROPIC_SCHEMA = anthropicSchema(AI_TURN_OUTPUT_SCHEMA);

/** 회사에 보낼 출력 스키마. 받은 뒤의 확인은 언제나 계약 스키마(checkTurnOutput)다. */
export function providerOutputSchema(provider: AiProvider): Json {
  return provider === "openai" ? OPENAI_SCHEMA : ANTHROPIC_SCHEMA;
}

function stripOpenaiNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOpenaiNulls);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null)
      .map(([name, entry]) => [name, stripOpenaiNulls(entry)]),
  );
}

function stripAnthropicPlaceholders(schema: Json, value: unknown): unknown {
  if (schema.type !== "object" || typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const properties = schema.properties as Record<string, Json>;
  const required = (schema.required ?? []) as string[];
  const normalized: [string, unknown][] = [];
  const entries = Object.entries(value);
  for (const [name, entry] of entries) {
    if (!Object.hasOwn(properties, name)) {
      normalized.push([name, entry]);
      continue;
    }
    const field = properties[name] as Json;
    const absence = required.includes(name) ? undefined : anthropicAbsence(field);
    if (absence !== undefined && entry === absence) continue;
    const clean = stripAnthropicPlaceholders(field, entry);
    if (clean !== undefined) normalized.push([name, clean]);
  }
  // 자리표만 있던 선택 수정 항목은 생략한다. 실제 빈 객체와 틀린 값은 계약 검사에서 거른다.
  if (schema.minProperties === 1 && normalized.length === 0 && entries.length > 0) return undefined;
  return Object.fromEntries(normalized);
}

/** 회사 스키마에서 '없음'을 나타내는 값을 없앤 후 계약 스키마로 검증한다. */
export function normalizeProviderOutput(provider: AiProvider, value: unknown): unknown {
  return provider === "openai" ? stripOpenaiNulls(value) : stripAnthropicPlaceholders(AI_TURN_OUTPUT_SCHEMA, value);
}
