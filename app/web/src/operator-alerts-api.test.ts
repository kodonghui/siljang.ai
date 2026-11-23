import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchOperatorAlerts, OPERATOR_ALERT_LABELS } from "./operator-alerts-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const responses = api.paths["/operator/alerts"].get.responses;
const page = () => structuredClone(responses[200].content["application/json"].examples.alerts.value);
const rows = Object.entries(responses).flatMap(([code, response]) =>
  Object.entries(
    Object.values(
      (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
    )[0]?.examples ?? {},
  ).map(([name, row]) => ({ status: code === "default" ? 500 : Number(code), name, body: row.value })),
);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());
it("API-015 원본5응답과 알림3종 이름을 빠짐없이 사용한다", () => {
  expect(rows).toHaveLength(5);
  expect(OPERATOR_ALERT_LABELS).toEqual({
    channel_already_linked: "다른 가게에 이미 연결된 채널",
    privacy_transfer_missing: "처리방침 국외 이전 항목 누락",
    ai_failure_burst: "AI 실패 반복(5분에 5번)",
  });
});
it.each(rows)("API-015 $status $name", async (row) => {
  const fetch = vi.fn(async () => json(row.body, row.status));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  const result = await fetchOperatorAlerts({ limit: 20, cursor: "synthetic_cursor" }, signal);
  expect(result.ok).toBe(row.status === 200);
  if (!result.ok) expect(result.status).toBe(row.status);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  const parsed = new URL(url, "https://example.org");
  expect(parsed.pathname).toBe("/api/operator/alerts");
  expect(parsed.searchParams.get("limit")).toBe("20");
  expect(parsed.searchParams.get("cursor")).toBe("synthetic_cursor");
  expect(init.credentials).toBe("same-origin");
  expect(init.cache).toBe("no-store");
  expect(init.signal).toBe(signal);
});
it.each([
  { alertId: "bad" },
  { kind: "toString" },
  { kind: "__proto__" },
  { kind: "private_kind" },
  { shop: {} },
  { shop: { shopId: "bad", name: "합성 가게" } },
  { shop: { shopId: "11111111-1111-4111-8111-111111111111", name: "가".repeat(41) } },
  { count: -1 },
  { count: 1000001 },
  { count: 1.5 },
  { count: "5" },
  { createdAt: "invalid" },
])("계약 밖 알림 행은 출력하지 않는다 %#", async (patch) => {
  const value = page();
  value.items[0] = { ...value.items[0], ...patch };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(value)),
  );
  expect(await fetchOperatorAlerts({ limit: 20, cursor: null })).toMatchObject({ ok: false, status: 502 });
});
it("가게 없는 알림과0·1,000,000건을 허용하되 내용·주문·연락처는 버린다", async () => {
  const value = page();
  value.items[0] = {
    ...value.items[0],
    shop: null,
    count: 0,
    message: "합성 손님 내용",
    order: "합성 주문",
    phone: "합성 연락처",
  };
  value.items[1].count = 1000000;
  value.items[1].shop.phone = "합성 연락처";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(value)),
  );
  const result = await fetchOperatorAlerts({ limit: 20, cursor: null });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.items[0]?.shop).toBeNull();
  expect(result.data.items[0]?.count).toBe(0);
  expect(result.data.items[1]?.count).toBe(1000000);
  expect(JSON.stringify(result.data)).not.toContain("합성 손님 내용");
  expect(JSON.stringify(result.data)).not.toContain("합성 주문");
  expect(JSON.stringify(result.data)).not.toContain("합성 연락처");
});
it.each(["duplicate", "over_limit", "cursor", "missing_cursor", "loop"])("중복/페이지 경계 %s", async (kind) => {
  const value = page();
  if (kind === "duplicate") value.items = [value.items[0], value.items[0]];
  else if (kind === "over_limit")
    value.items = Array.from({ length: 21 }, (_, index) => ({
      ...value.items[0],
      alertId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    }));
  else if (kind === "cursor") value.nextCursor = "bad/cursor";
  else if (kind === "missing_cursor") delete value.nextCursor;
  else value.nextCursor = "synthetic_cursor";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(value)),
  );
  expect(await fetchOperatorAlerts({ limit: 20, cursor: "synthetic_cursor" })).toMatchObject({
    ok: false,
    status: 502,
  });
});
