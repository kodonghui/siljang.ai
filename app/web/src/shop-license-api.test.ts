import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchShopLicense, requestIdentityChange, resubmitLicense } from "./shop-license-api";

const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const example = (path: string, method: string, status: number, name: string) =>
  structuredClone(contract.paths[path][method].responses[status].content["application/json"].examples[name].value);
const shop = () => example("/owner/shop", "get", 200, "verified");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

it.each(["verified", "pending", "on_hold", "identity_change_pending", "identity_change_on_hold"])(
  "조회 %s의 신고증과 사업자 변경 정보를 계약에서 읽음",
  async (name) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(example("/owner/shop", "get", 200, name))),
    );
    const result = await fetchShopLicense();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.licensePhotoUrl).toBe(shop().licensePhotoUrl);
  },
);

it.each([
  { licensePhotoUrl: "javascript:alert(1)" },
  { foodBusinessType: "unknown" },
  { identityChange: { status: "pending" } },
  { licenseReviewedAt: "invalid-date" },
])("화면에 필요한 계약이 깨진 %j 응답은 공통 실패", async (changes) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ...shop(), ...changes })),
  );
  expect(await fetchShopLicense()).toMatchObject({ ok: false, status: 502 });
});

it("신고증 재제출은 PUT과 기준 revision/요청 키를 보냄", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    json(example("/owner/shop/license", "put", 200, "resubmitted")),
  );
  vi.stubGlobal("fetch", fetch);
  const body = {
    baseRevision: "synthetic-revision",
    foodLicenseNo: "합성-048",
    foodBusinessType: "bakery",
    licensePhotoUploadId: `upl_${"a".repeat(24)}`,
  };
  const result = await resubmitLicense(body, "ui-synthetic-license-request");
  expect(result.ok).toBe(true);
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/owner/shop/license");
  const init = fetch.mock.calls[0]?.[1];
  expect(init?.method).toBe("PUT");
  expect(JSON.parse(String(init?.body))).toEqual(body);
  expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("ui-synthetic-license-request");
});

it.each([
  [201, "requested"],
  [200, "unchanged"],
] as const)("사업자 변경 요청 %s/%s의 결과를 보존함", async (status, name) => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    json(example("/owner/shop/identity-changes", "post", status, name), status),
  );
  vi.stubGlobal("fetch", fetch);
  const body = {
    baseRevision: "synthetic-revision",
    businessName: "합성 가게",
    representativeName: "합성 사장님",
    businessRegNo: "1234567891",
    evidencePhotoUploadId: `upl_${"b".repeat(24)}`,
  };
  expect(await requestIdentityChange(body, "ui-synthetic-identity-request")).toMatchObject({
    ok: true,
    data: { outcome: name === "unchanged" ? "unchanged" : "done" },
  });
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/owner/shop/identity-changes");
  expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(body);
});

it.each([
  [401, "unauthenticated"],
  [404, "shop_not_registered"],
  [409, "version_conflict"],
  [422, "validation_failed"],
  [503, "storage_unavailable"],
] as const)("실패 %s/%s를 화면에 전달함", async (status, code) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ code, traceId: "0123456789abcdef0123456789abcdef" }, status)),
  );
  expect(await resubmitLicense({}, "ui-synthetic-failure-request")).toMatchObject({
    ok: false,
    status,
    problem: { code },
  });
});
