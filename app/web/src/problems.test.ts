// G7 표(problems.ts)를 06 계약(api/openapi.yaml)과 08 화면 정의(docs/08-screens/SCR-*.md)에 견준다(TASK-029).
// 06에 오류 코드·필드 사유·확인할 것이 늘거나 말이 바뀌면, 08의 응답→상태가 바뀌면 여기서 실패한다.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  CONFIRMATIONS,
  classify,
  confirmText,
  DAY_PATTERN,
  ERROR_CODES,
  type ErrorCode,
  FIELD_PATTERN,
  FIELD_REASONS,
  fieldReasonText,
  type Outcome,
  parseProblem,
  TRACE_PATTERN,
} from "./problems";

const ROOT = new URL("../../../", import.meta.url);

interface ContractError {
  readonly status: number;
  readonly message: string;
  readonly client: string;
}
interface Contract {
  readonly components: {
    readonly "x-corthex": {
      readonly errors: Record<string, ContractError>;
      readonly fieldErrors: Record<string, string>;
      readonly confirmations: Record<string, { readonly message: string }>;
    };
    readonly schemas: Record<string, { readonly properties: Record<string, Record<string, unknown>> }>;
  };
}
const contract = parse(readFileSync(new URL("api/openapi.yaml", ROOT), "utf8")) as Contract;
const x = contract.components["x-corthex"];
const schemas = contract.components.schemas;
const prop = (schema: string, name: string): Record<string, unknown> => {
  const p = schemas[schema]?.properties[name];
  if (p === undefined) throw new Error(`06에 ${schema}.${name}가 없음`);
  return p;
};
const sorted = (keys: Iterable<string>) => [...keys].sort();
const codes = Object.keys(ERROR_CODES) as ErrorCode[];

/** 06 client가 적은 G7 결과의 이름 → 표의 결과(06에만 있는 '동의 필요'·'이미 다른 가게'도) */
const G7_LABELS: Record<string, Outcome> = {
  "필드 오류": "field",
  "동의 필요": "field",
  "이미 처리됨": "already_done",
  "이미 바뀜": "changed",
  "그 상태에서는 할 수 없음": "not_allowed",
  "이미 다른 가게": "not_allowed",
  "찾을 수 없음": "not_found",
  "서버 실패": "server",
};

/** 사장님 화면 글에 쓰지 않는 말(작업 규칙의 금지 낱말과 WBS 생성기의 제품 용어) */
const BANNED = [
  "여쭙",
  "정책",
  "DB",
  "입금",
  "홀드",
  "자리 잡기",
  "회원",
  "정한 것",
  "칸",
  "고객",
  "관리자",
  "리뷰",
  "판매자",
];

describe("06 오류 코드 37개", () => {
  it("표의 코드가 06 errors·Problem.code enum과 같다", () => {
    expect(codes).toHaveLength(37);
    expect(sorted(codes)).toEqual(sorted(Object.keys(x.errors)));
    expect(sorted(codes)).toEqual(sorted(prop("Problem", "code").enum as string[]));
  });

  it("상태 코드와 화면의 말이 06과 같다", () => {
    for (const code of codes) {
      const c = x.errors[code];
      expect(ERROR_CODES[code].status, code).toBe(c?.status);
      expect(ERROR_CODES[code].message, code).toBe(c?.message);
    }
  });

  it("06 client가 G7 결과를 적은 코드는 표도 그 결과다", () => {
    let labelled = 0;
    for (const code of codes) {
      const label = /G7 ([^)]+)\)/.exec(x.errors[code]?.client ?? "")?.[1];
      if (label === undefined) continue;
      labelled++;
      expect(G7_LABELS[label], `${code}: 06 'G7 ${label}'`).toBe(ERROR_CODES[code].outcome);
    }
    expect(labelled).toBe(8);
  });

  it("G7의 실패 결과 여섯이 모두 쓰이고, 결과마다 화면 상태가 하나다", () => {
    const g7: Outcome[] = ["field", "already_done", "changed", "not_allowed", "not_found", "server"];
    for (const outcome of g7) {
      expect(
        codes.some((c) => ERROR_CODES[c].outcome === outcome),
        outcome,
      ).toBe(true);
    }
    // 같은 결과는 화면에 같은 방식으로 알림(08 상태가 결과마다 정해짐: 이미 처리됨·이미 바뀜·그 상태에서는 할 수 없음은
    // stale, 단 06에서 '빈 입력 화면'·'설정을 먼저'인 것은 empty·error)
    expect(ERROR_CODES.version_conflict.state).toBe("stale");
    expect(ERROR_CODES.already_decided.state).toBe("stale");
    expect(ERROR_CODES.invalid_state.state).toBe("stale");
    expect(ERROR_CODES.not_found.state).toBe("error");
    expect(ERROR_CODES.validation_failed.state).toBe("error");
    expect(ERROR_CODES.internal.state).toBe("error");
  });

  it("다시 보내는 법이 06 client와 같다(새 요청 키·같은 요청 키·다시 보내지 않음)", () => {
    for (const code of codes) {
      const client = x.errors[code]?.client ?? "";
      const expected = client.includes("새 요청 키")
        ? "new"
        : /같은 요청 키|다시 시도 버튼|Retry-After 초 뒤에 다시/.test(client)
          ? "same"
          : "none";
      expect(ERROR_CODES[code].retry, `${code}: ${client}`).toBe(expected);
    }
  });
});

describe("08 화면 정의의 응답과 상태", () => {
  // 08이 그 화면에서만 다르게 정한 것(표의 기본값과 다른 행). 08이 바뀌면 이 목록도 함께 고친다.
  const EXCEPTIONS: Record<string, readonly string[]> = {
    // 사진 올리기(API-007)의 한도는 사진 필드 옆 오류로 보이고 Retry-After 뒤 다시 올림(06 DEC-16)
    "rate_limited→error": ["SCR-015", "SCR-030", "SCR-035", "SCR-036"],
    // 인도 기록: 이미 인도한 주문은 '됨'으로 보임
    "already_decided→done": ["SCR-031"],
    // 폼 화면의 읽기 실패는 폼을 보일 수 없어 load-failed(저장 실패는 error)
    "internal→load-failed": ["SCR-032", "SCR-033", "SCR-034", "SCR-036", "SCR-038", "SCR-040"],
  };

  it("오류 응답 행의 상태가 표의 state와 같다(위 예외만 다름)", () => {
    const dir = new URL("docs/08-screens/", ROOT);
    const differ: Record<string, Set<string>> = {};
    let rows = 0;
    for (const name of readdirSync(dir).filter((n) => /^SCR-\d+\.md$/.test(n))) {
      const text = readFileSync(new URL(name, dir), "utf8");
      const start = text.indexOf("## 응답과 상태");
      if (start === -1) continue;
      const end = text.indexOf("\n## ", start + 5);
      const section = text.slice(start, end === -1 ? undefined : end);
      for (const m of section.matchAll(/^\| API-\d+#(\w+):([a-z_]+) \| (SCR-\d+)#([a-z-]+) \|/gm)) {
        const [, status, code, screen, state] = m;
        if (status === undefined || status.startsWith("2") || code === undefined || screen === undefined) continue;
        expect(code in ERROR_CODES, `${screen}: 표에 없는 오류 코드 ${code}`).toBe(true);
        rows++;
        if (ERROR_CODES[code as ErrorCode].state !== state) {
          const key = `${code}→${state}`;
          differ[key] ??= new Set();
          differ[key].add(screen);
        }
      }
    }
    expect(rows).toBeGreaterThan(400);
    expect(Object.fromEntries(Object.entries(differ).map(([k, v]) => [k, sorted(v)]))).toEqual(EXCEPTIONS);
  });
});

describe("필드 오류 사유 24개", () => {
  it("사유 목록이 06 fieldErrors·FieldError.code enum과 같다", () => {
    const reasons = Object.keys(FIELD_REASONS);
    expect(reasons).toHaveLength(24);
    expect(sorted(reasons)).toEqual(sorted(Object.keys(x.fieldErrors)));
    expect(sorted(reasons)).toEqual(sorted(prop("FieldError", "code").enum as string[]));
  });

  it("사유마다 다른 한국어 글이고 08 말투(…요)이며 금지 낱말이 없다", () => {
    const texts = Object.values(FIELD_REASONS);
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of texts) {
      expect(t, t).toMatch(/요$/);
      expect(t, t).toMatch(/[가-힣]/);
      for (const word of BANNED) expect(t.includes(word), `${t}: ${word}`).toBe(false);
    }
  });

  it("화면이 준 글이 먼저다", () => {
    expect(fieldReasonText("bad_format")).toBe(FIELD_REASONS.bad_format);
    expect(fieldReasonText("bad_format", { bad_format: "10자리 숫자로 넣어 주세요" })).toBe(
      "10자리 숫자로 넣어 주세요",
    );
  });
});

describe("확인할 것 8개", () => {
  it("목록과 글이 06 confirmations·ConfirmationNeeded.kind enum과 같다", () => {
    const kinds = Object.keys(CONFIRMATIONS);
    expect(kinds).toHaveLength(8);
    expect(sorted(kinds)).toEqual(sorted(Object.keys(x.confirmations)));
    expect(sorted(kinds)).toEqual(sorted(prop("ConfirmationNeeded", "kind").enum as string[]));
    for (const [kind, text] of Object.entries(CONFIRMATIONS)) expect(text, kind).toBe(x.confirmations[kind]?.message);
  });

  it("관련 주문 수를 채우고 날짜가 있으면 앞에 붙인다", () => {
    expect(confirmText({ kind: "closed_day_with_orders", count: 1200 })).toBe(
      "이날 확정 주문 1,200건은 그대로 남아요. 휴무로 바꿀까요?",
    );
    expect(confirmText({ kind: "closed_day_with_orders", count: 2, day: "2026-11-20" })).toBe(
      "11월 20일: 이날 확정 주문 2건은 그대로 남아요. 휴무로 바꿀까요?",
    );
    expect(confirmText({ kind: "overbooking" })).toBe(CONFIRMATIONS.overbooking);
  });
});

describe("06 꼴", () => {
  it("필드 위치·추적 ID 꼴이 06과 같다", () => {
    expect(FIELD_PATTERN.source).toBe(new RegExp(prop("FieldError", "field").pattern as string).source);
    expect(TRACE_PATTERN.source).toBe(new RegExp(prop("Problem", "traceId").pattern as string).source);
    expect(prop("ConfirmationNeeded", "day").format).toBe("date");
    expect(DAY_PATTERN.test("2026-11-20")).toBe(true);
    expect(prop("Problem", "retryAfterSeconds")).toMatchObject({ minimum: 1, maximum: 3600 });
    expect(prop("ConfirmationNeeded", "count")).toMatchObject({ minimum: 0, maximum: 10000 });
    expect(prop("Problem", "detail")).toMatchObject({ maxLength: 1000 });
  });
});

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

describe("parseProblem", () => {
  it("06 Problem을 읽고 틀린 꼴의 항목은 버린다", () => {
    const p = parseProblem(
      {
        type: "/problems/validation_failed",
        title: "입력한 내용을 확인해 주세요",
        status: 422,
        code: "validation_failed",
        traceId: TRACE,
        errors: [
          { field: "/dailyLimit", code: "out_of_range" },
          { field: "dailyLimit", code: "out_of_range" },
          { field: "/name", code: "no_such_reason" },
          { field: "header:Content-Type", code: "not_allowed" },
          "/x",
        ],
      },
      422,
    );
    expect(p?.code).toBe("validation_failed");
    expect(p?.traceId).toBe(TRACE);
    expect(p?.errors).toEqual([
      { field: "/dailyLimit", code: "out_of_range" },
      { field: "header:Content-Type", code: "not_allowed" },
    ]);
  });

  it("확인할 것의 틀린 수·날짜는 빼고 모르는 것은 버린다", () => {
    const p = parseProblem(
      {
        code: "confirmation_required",
        confirm: [
          { kind: "closed_day_with_orders", count: 2, day: "2026-11-20" },
          { kind: "closed_day_with_orders", count: -1, day: "11/20" },
          { kind: "unknown_kind" },
        ],
      },
      409,
    );
    expect(p?.confirm).toEqual([
      { kind: "closed_day_with_orders", count: 2, day: "2026-11-20" },
      { kind: "closed_day_with_orders" },
    ]);
  });

  it("06에 없는 코드·객체가 아닌 본문은 null, 틀린 추적 ID·긴 detail은 비움, Retry-After는 3600초까지", () => {
    expect(parseProblem({ code: "teapot" }, 418)).toBeNull();
    expect(parseProblem("Bad Gateway", 502)).toBeNull();
    expect(parseProblem(null, 500)).toBeNull();
    expect(parseProblem([{ code: "internal" }], 500)).toBeNull();
    const p = parseProblem(
      { code: "rate_limited", traceId: "XYZ", detail: "가".repeat(1001), retryAfterSeconds: 99999 },
      429,
    );
    expect(p?.traceId).toBeNull();
    expect(p?.detail).toBeNull();
    expect(p?.retryAfterSeconds).toBe(3600);
    expect(parseProblem({ code: "rate_limited", retryAfterSeconds: 0.5 }, 429)?.retryAfterSeconds).toBeNull();
  });
});

describe("classify(G7)", () => {
  const problem = (code: ErrorCode, extra: Record<string, unknown> = {}) => {
    const p = parseProblem({ code, traceId: TRACE, ...extra }, ERROR_CODES[code].status);
    if (p === null) throw new Error(code);
    return p;
  };

  it("연결 실패와 5xx의 Problem 아닌 응답은 서버 실패, 같은 요청 키로 다시 시도", () => {
    for (const status of [0, 502, 503]) {
      const f = classify(status, null, null);
      expect(f).toMatchObject({ outcome: "server", state: "error", retry: "same", code: null });
      expect(f.message).toBe(ERROR_CODES.internal.message);
    }
    expect(classify(400, null, null).retry).toBe("none");
  });

  it("화면에 오지 않는 코드(스킬 키)는 일반 서버 실패", () => {
    const f = classify(401, problem("skill_key_invalid"), null);
    expect(f).toMatchObject({ outcome: "server", retry: "none", message: ERROR_CODES.internal.message });
  });

  it("코드마다 표의 결과·상태·말·다시 보내는 법", () => {
    for (const code of codes) {
      if ("screens" in ERROR_CODES[code]) continue;
      const f = classify(ERROR_CODES[code].status, problem(code), null);
      expect(f, code).toMatchObject({
        outcome: ERROR_CODES[code].outcome,
        state: ERROR_CODES[code].state,
        retry: ERROR_CODES[code].retry,
        message: ERROR_CODES[code].message,
        traceId: TRACE,
      });
    }
  });

  it("Retry-After는 헤더 값이 먼저", () => {
    expect(classify(429, problem("rate_limited", { retryAfterSeconds: 30 }), 12).retryAfterSeconds).toBe(12);
    expect(classify(429, problem("rate_limited", { retryAfterSeconds: 30 }), null).retryAfterSeconds).toBe(30);
  });
});
