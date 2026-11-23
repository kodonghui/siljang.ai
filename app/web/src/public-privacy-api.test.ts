import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchPublicPrivacy } from "./public-privacy-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const responses = api.paths["/public/shops/{slug}/privacy-policy"].get.responses;
const policy = () => structuredClone(responses[200].content["application/json"].examples.policy.value);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, ...(status === 429 ? { headers: { "Retry-After": "7" } } : {}) });
const rows = Object.entries(responses).flatMap(([code, response]) =>
  Object.entries(
    Object.values(
      (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
    )[0]?.examples ?? {},
  ).map(([name, row]) => ({ status: code === "default" ? 500 : Number(code), name, body: row.value })),
);
afterEach(() => vi.unstubAllGlobals());
it("API-039 원본4응답을 대조한다", () => expect(rows).toHaveLength(4));
it.each(rows)("API-039 $status $name", async (row) => {
  const fetch = vi.fn(async () => json(row.body, row.status));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  const result = await fetchPublicPrivacy("synthetic-shop", signal);
  expect(result.ok).toBe(row.status === 200);
  if (!result.ok) {
    expect(result.status).toBe(row.status);
    if (row.status === 429) expect(result.retryAfterSeconds).toBe(7);
  }
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/public/shops/synthetic-shop/privacy-policy");
  expect(init.method).toBe("GET");
  expect(init.cache).toBe("no-store");
  expect(init.signal).toBe(signal);
});
it.each([
  { shopName: "" },
  { shopName: "가".repeat(41) },
  { version: 0 },
  { version: 2147483648 },
  { version: 1.5 },
  { version: "1" },
  { body: " " },
  { body: "가".repeat(100001) },
  { overseasTransfers: [] },
  { overseasTransfers: Array.from({ length: 21 }, () => policy().overseasTransfers[0]) },
  { publishedAt: "invalid" },
])("계약 밖 처리방침은 빈 성공으로 출력하지 않는다 %#", async (patch) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ...policy(), ...patch })),
  );
  expect(await fetchPublicPrivacy("synthetic-shop")).toMatchObject({ ok: false, status: 502 });
});
it.each([
  ["recipient", 201],
  ["country", 101],
  ["personalData", 501],
  ["whenAndHow", 501],
  ["purposeAndRetention", 501],
  ["howToRefuse", 1001],
] as const)("국외 이전 %s는 비거나 상한을 넘으면 거부한다", async (field, length) => {
  for (const text of [" ", "가".repeat(length)]) {
    const value = policy();
    value.overseasTransfers[0][field] = text;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(value)),
    );
    expect(await fetchPublicPrivacy("synthetic-shop")).toMatchObject({ ok: false, status: 502 });
  }
});
it("본문10만자와 이전20행을 허용하며 내부 값은 복사하지 않는다", async () => {
  const value = policy();
  value.body = "가".repeat(100000);
  value.overseasTransfers = Array.from({ length: 20 }, () => ({
    ...value.overseasTransfers[0],
    secret: "합성 내부 값",
  }));
  value.ownerId = "합성 사장님 번호";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(value)),
  );
  const result = await fetchPublicPrivacy("synthetic-shop");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.body).toHaveLength(100000);
  expect(result.data.overseasTransfers).toHaveLength(20);
  expect(JSON.stringify(result.data)).not.toContain("합성 내부 값");
  expect(result.data).not.toHaveProperty("ownerId");
});
it.each(["a", "ABCD", "../bad", "bad/path", "-bad", "a".repeat(41), "https://example.org", "%2f"])(
  "틀린 공개 주소는 요청하지 않고404로 닫는다 %s",
  async (slug) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await fetchPublicPrivacy(slug)).toMatchObject({ ok: false, status: 404 });
    expect(fetch).not.toHaveBeenCalled();
  },
);
