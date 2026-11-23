import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchIdentityChanges, fetchReviewShops } from "./operator-shops-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const paths = ["/operator/shops", "/operator/identity-changes"];
const example = (path: string) =>
  structuredClone(api.paths[path].get.responses[200].content["application/json"].examples.pending.value);
const rows = paths.flatMap((path) =>
  Object.entries(api.paths[path].get.responses).flatMap(([status, response]) =>
    Object.entries(
      Object.values(
        (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
      )[0]?.examples ?? {},
    ).map(([name, row]) => ({ path, status: status === "default" ? 500 : Number(status), name, value: row.value })),
  ),
);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const load = (path: string, signal?: AbortSignal) =>
  path.endsWith("shops")
    ? fetchReviewShops({ status: "pending", cursor: "synthetic_cursor" }, signal)
    : fetchIdentityChanges({ status: "pending", cursor: "synthetic_cursor" }, signal);
afterEach(() => vi.unstubAllGlobals());
it.each(rows)("$path $status $name 응답과 조회 경계", async (row) => {
  const transport = vi.fn(async () => json(row.value, row.status));
  vi.stubGlobal("fetch", transport);
  const signal = new AbortController().signal,
    result = await load(row.path, signal);
  expect(result.ok).toBe(row.status === 200);
  if (!result.ok) expect(result.status).toBe(row.status);
  const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  const parsed = new URL(url, "https://example.org");
  expect(parsed.pathname).toBe(`/api${row.path}`);
  expect(parsed.searchParams.get("status")).toBe("pending");
  expect(parsed.searchParams.get("cursor")).toBe("synthetic_cursor");
  expect(parsed.searchParams.get("limit")).toBe("20");
  expect(init.credentials).toBe("same-origin");
  expect(init.cache).toBe("no-store");
  expect(init.signal).toBe(signal);
});
it.each([
  { shopId: "not-an-id" },
  { name: "" },
  { name: "가".repeat(41) },
  { businessName: "가".repeat(61) },
  { representativeName: "가".repeat(31) },
  { businessRegNo: "1" },
  { foodLicenseNo: "" },
  { foodBusinessType: "internal" },
  { licenseStatus: "internal" },
  { duplicateBusinessRegNo: "false" },
  { createdAt: "invalid" },
  { revision: "bad/value" },
])("잘못된 신고 목록 행은 쓰지 않는다 %#", async (patch) => {
  const value = example(paths[0] as string);
  value.items[0] = { ...value.items[0], ...patch };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(value)),
  );
  expect(await load(paths[0] as string)).toMatchObject({ ok: false, status: 502 });
});
it.each([
  { changeId: "bad" },
  { shop: null },
  { status: "internal" },
  { previous: {} },
  { requestedAt: "invalid" },
  {
    paymentAccount: { bankName: "가짜은행", holderName: "합성 예금주", accountLast4: "12345", holderMatchesNew: true },
  },
  {
    paymentAccount: { bankName: "가짜은행", holderName: "합성 예금주", accountLast4: "1234", holderMatchesNew: "true" },
  },
])("잘못된 정보 변경 요약은 쓰지 않는다 %#", async (patch) => {
  const value = example(paths[1] as string);
  value.items[0] = { ...value.items[0], ...patch };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(value)),
  );
  expect(await load(paths[1] as string)).toMatchObject({ ok: false, status: 502 });
});
it.each(paths)("%s의 중복/페이지 초과/깨진 커서는 거부한다", async (path) => {
  for (const kind of ["duplicate", "over_limit", "cursor", "missing_cursor"]) {
    const value = example(path);
    if (kind === "duplicate") value.items = [value.items[0], value.items[0]];
    else if (kind === "over_limit")
      value.items = Array.from({ length: 21 }, (_, index) => ({
        ...value.items[0],
        [path.endsWith("shops") ? "shopId" : "changeId"]: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      }));
    else if (kind === "cursor") value.nextCursor = "bad/cursor";
    else delete value.nextCursor;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(value)),
    );
    expect(await load(path)).toMatchObject({ ok: false, status: 502 });
  }
});
it("목록 DTO에는 연락처/계좌 전체/증빙 주소를 남기지 않는다", async () => {
  const value = example(paths[1] as string);
  value.items[0].phone = "합성 연락처";
  value.items[0].paymentAccount.accountNumber = "합성 전체 계좌";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(value)),
  );
  const result = await fetchIdentityChanges({ status: "pending" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.items[0]).not.toHaveProperty("phone");
  expect(result.data.items[0]).not.toHaveProperty("evidencePhotoUrl");
  expect(result.data.items[0]?.paymentAccount).not.toHaveProperty("accountNumber");
  expect(result.data.items[1]?.paymentAccount?.holderMatchesNew).toBe(false);
});
