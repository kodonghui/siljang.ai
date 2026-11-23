import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchOperatingRules, saveOperatingRules } from "./operating-rules-api";

const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const get = contract.paths["/owner/operating-rules"].get;
const post = contract.paths["/owner/operating-rules/versions"].post;
const current = () => structuredClone(get.responses[200].content["application/json"].examples.current.value);
const template = () => structuredClone(get.responses[200].content["application/json"].examples.template.value);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());
it.each(["current", "template"])("API020 %s 계약 예시를 읽는다", async (name) => {
  const data = structuredClone(get.responses[200].content["application/json"].examples[name].value);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(data)));
  expect(await fetchOperatingRules()).toMatchObject({ ok: true, data });
});
it("현재 조회 취소와 저장 본문/확인 값/요청 키는 공통 전송 경로로만 보낸다", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(json(current()))
    .mockResolvedValueOnce(json({ outcome: "created", operatingRules: current() }, 201));
  vi.stubGlobal("fetch", send);
  const signal = new AbortController().signal;
  await fetchOperatingRules(signal);
  const body = { baseRevision: "synthetic-v2", confirm: ["lowered_refund"] };
  await saveOperatingRules(body, "synthetic-rules-key");
  expect(send.mock.calls[0]).toMatchObject([
    "/api/owner/operating-rules",
    { method: "GET", credentials: "same-origin", cache: "no-store", signal },
  ]);
  expect(send.mock.calls[1]).toMatchObject([
    "/api/owner/operating-rules/versions",
    { method: "POST", body: JSON.stringify(body), credentials: "same-origin" },
  ]);
  expect(new Headers(send.mock.calls[1]?.[1].headers).get("Idempotency-Key")).toBe("synthetic-rules-key");
});
it.each([
  ["created", 201],
  ["unchanged", 200],
] as const)("API021 %s 성공 계약", async (outcome, status) => {
  const data = post.responses[status].content["application/json"].examples[outcome].value;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(data, status)));
  expect(await saveOperatingRules({}, "synthetic-key")).toMatchObject({ ok: true, data });
});
it.each([
  [
    "숫자 문자열",
    (v: ReturnType<typeof current>) => {
      v.quoteValidHours = "72";
    },
  ],
  [
    "없는 버전",
    (v: ReturnType<typeof current>) => {
      v.version = 0;
    },
  ],
  [
    "기한 하한",
    (v: ReturnType<typeof current>) => {
      v.paymentDueHours = 0;
    },
  ],
  [
    "소수 시간",
    (v: ReturnType<typeof current>) => {
      v.issueReportHours = 24.5;
    },
  ],
  [
    "수수료 상한",
    (v: ReturnType<typeof current>) => {
      v.cancellationFeeKrw = 10000001;
    },
  ],
  [
    "환불 상한",
    (v: ReturnType<typeof current>) => {
      v.preProductionRefundPct = 101;
    },
  ],
  [
    "기준일",
    (v: ReturnType<typeof current>) => {
      v.dateChangeRefundBasis = "unknown";
    },
  ],
  [
    "확정 버전 빈 기준",
    (v: ReturnType<typeof current>) => {
      v.revision = null;
    },
  ],
  [
    "잘못된 날짜",
    (v: ReturnType<typeof current>) => {
      v.createdAt = "not-a-date";
    },
  ],
  [
    "현재의 교체 시각",
    (v: ReturnType<typeof current>) => {
      v.supersededAt = v.createdAt;
    },
  ],
  [
    "알 수 없는 조문",
    (v: ReturnType<typeof current>) => {
      v.clauses[0].key = "unknown";
    },
  ],
  [
    "긴 조문 이름",
    (v: ReturnType<typeof current>) => {
      v.clauses[0].title = "가".repeat(61);
    },
  ],
  [
    "긴 조문 조건",
    (v: ReturnType<typeof current>) => {
      v.clauses[0].conditionText = "가".repeat(1001);
    },
  ],
  [
    "빠진 효과",
    (v: ReturnType<typeof current>) => {
      v.clauses[0].effectText = null;
    },
  ],
  [
    "중복 순서",
    (v: ReturnType<typeof current>) => {
      v.clauses[1].position = v.clauses[0].position;
    },
  ],
  [
    "조문 한도",
    (v: ReturnType<typeof current>) => {
      v.clauses = Array.from({ length: 51 }, () => v.clauses[0]);
    },
  ],
  [
    "단계 한도",
    (v: ReturnType<typeof current>) => {
      v.refundTiers = Array.from({ length: 21 }, () => v.refundTiers[0]);
    },
  ],
  [
    "단계 시간",
    (v: ReturnType<typeof current>) => {
      v.refundTiers[0].hoursBeforeMin = -1;
    },
  ],
  [
    "단계 끝",
    (v: ReturnType<typeof current>) => {
      v.refundTiers[0].hoursBeforeMax = 0;
    },
  ],
  [
    "낮춘 확인 누락",
    (v: ReturnType<typeof current>) => {
      v.preProductionRefundPct = 50;
      v.preProductionLoweredAck = false;
    },
  ],
] as const)("%s인200은 양식을 열지 않는다", async (_label, change) => {
  const data = current();
  change(data);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(data)));
  expect((await fetchOperatingRules()).ok).toBe(false);
});
it.each([null, {}, [], { ...template(), version: 2 }, { ...template(), revision: "saved" }])(
  "잘못된 현재/템플릿 메타데이터",
  async (data) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(data)));
    expect((await fetchOperatingRules()).ok).toBe(false);
  },
);
it("옛 버전은 현재 조회에서 열지 않는다", async () => {
  const data = { ...current(), current: false, supersededAt: "2026-11-23T10:00:00Z" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(data)));
  expect((await fetchOperatingRules()).ok).toBe(false);
});
it.each([
  { outcome: "created", operatingRules: template() },
  { outcome: "other", operatingRules: current() },
])("저장 결과는 확정한 현재 버전만 받는다", async (data) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(data, 201)));
  expect((await saveOperatingRules({}, "synthetic-key")).ok).toBe(false);
});
type ProblemExamples = { examples: Record<string, { value: Record<string, unknown> }> };
const failures = Object.entries(post.responses).flatMap(([status, response]) => {
  if (["200", "201"].includes(status)) return [];
  const data = (response as { content: Record<string, ProblemExamples> }).content["application/problem+json"];
  if (!data) throw new Error(`실패 응답 매체 없음: ${status}`);
  return Object.entries(data.examples).map(([name, entry]) => ({
    status: status === "default" ? 500 : Number(status),
    name,
    data: entry.value,
  }));
});
it.each(failures)("API021 $status $name 실패를 보존", async (row) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(row.data, row.status)));
  const result = await saveOperatingRules({}, "synthetic-key");
  expect(result).toMatchObject({ ok: false, status: row.status, problem: { code: row.data.code } });
});
it.each([401, 404, 500])("API020 %s 실패를 보존", async (status) => {
  const code = status === 401 ? "unauthenticated" : status === 404 ? "shop_not_registered" : "internal";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ code }, status)));
  expect(await fetchOperatingRules()).toMatchObject({ ok: false, status, problem: { code } });
});
