import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchReviewShop, reviewIdentityChange, reviewLicense } from "./operator-shop-review-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const detailPath = "/operator/shops/{shopId}";
const licensePath = "/operator/shops/{shopId}/license-review";
const changePath = "/operator/identity-changes/{changeId}/review";
const detail = (name = "pending") =>
  structuredClone(api.paths[detailPath].get.responses[200].content["application/json"].examples[name].value);
const shopId = detail().shopId;
const changeId = detail("identity_change_pending").pendingIdentityChange.changeId;
const key = "synthetic-review-key-123456";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const rows = (
  [
    [detailPath, "get"],
    [licensePath, "post"],
    [changePath, "post"],
  ] as const
).flatMap(([path, method]) =>
  Object.entries(api.paths[path][method].responses).flatMap(([code, response]) =>
    Object.entries(
      Object.values(
        (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
      )[0]?.examples ?? {},
    ).map(([name, example]) => ({
      path,
      method,
      status: code === "default" ? 500 : Number(code),
      name,
      body: example.value,
    })),
  ),
);
afterEach(() => vi.unstubAllGlobals());
it("API-013/014/082 원본 응답35개를 대조한다(요청 키 누락 추가 예시 포함)", () => expect(rows).toHaveLength(35));
it.each(rows)("$path $status $name와 요청 경계", async (row) => {
  const fetch = vi.fn(async () => json(row.body, row.status));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  const body = {
    baseRevision: "synthetic-revision",
    decision: row.name === "on_hold" ? "on_hold" : row.path === changePath ? "applied" : "verified",
    ...(row.name === "on_hold" ? { holdReason: "합성 보류 이유" } : {}),
  };
  const result =
    row.path === detailPath
      ? await fetchReviewShop(shopId, signal)
      : row.path === licensePath
        ? await reviewLicense(shopId, body, key, signal)
        : await reviewIdentityChange(changeId, body, key, signal);
  expect(result.ok).toBe(row.status === 200);
  if (!result.ok) expect(result.status).toBe(row.status);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`/api${row.path.replace("{shopId}", shopId).replace("{changeId}", changeId)}`);
  expect(init.method).toBe(row.method.toUpperCase());
  expect(init.cache).toBe("no-store");
  expect(init.credentials).toBe("same-origin");
  expect(init.signal).toBe(signal);
  if (row.method === "post") {
    expect(JSON.parse(String(init.body))).toEqual(body);
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(key);
  }
});
it.each([
  { shopId: "invalid" },
  { name: "가".repeat(41) },
  { contactPhone: "bad" },
  { contactEmail: "bad" },
  { businessAddress: "" },
  { businessName: "가".repeat(61) },
  { representativeName: "가".repeat(31) },
  { businessRegNo: "123" },
  { mailOrderRegNo: "" },
  { mailOrderAuthority: "" },
  { mailOrderExemption: "가".repeat(201) },
  { foodLicenseNo: "" },
  { foodBusinessType: "internal" },
  { licensePhotoUrl: "javascript:alert(1)" },
  { licensePhotoUrl: "https://user:password@example.org/photo" },
  { licenseStatus: "internal" },
  { licenseHoldReason: "가".repeat(201) },
  { licenseReviewedAt: "invalid" },
  { licenseReviewedBy: {} },
  { pendingIdentityChange: {} },
  { duplicates: [{}] },
  { paymentAccount: {} },
  { createdAt: "invalid" },
  { revision: "bad/value" },
])("상세의 계약 밖 값은 성공으로 쓰지 않는다 %#", async (patch) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ...detail(), ...patch })),
  );
  expect(await fetchReviewShop(shopId)).toMatchObject({ ok: false, status: 502 });
});
it.each(["shop", "change"])("%s 성공 결과의 다른 대상/잘못된 outcome/빠진 값은 거부한다", async (kind) => {
  for (const fault of ["target", "outcome", "missing", "decision"]) {
    const value =
      kind === "shop"
        ? structuredClone(
            api.paths[licensePath].post.responses[200].content["application/json"].examples.verified.value,
          )
        : structuredClone(api.paths[changePath].post.responses[200].content["application/json"].examples.applied.value);
    if (fault === "target")
      value[kind][kind === "shop" ? "shopId" : "changeId"] = "11111111-1111-4111-8111-111111111111";
    else if (fault === "outcome") value.outcome = ["done"];
    else if (fault === "missing") delete value[kind];
    else value[kind][kind === "shop" ? "licenseStatus" : "status"] = "pending";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(value)),
    );
    const result =
      kind === "shop"
        ? await reviewLicense(shopId, { baseRevision: "synthetic", decision: "verified" }, key)
        : await reviewIdentityChange(changeId, { baseRevision: "synthetic", decision: "applied" }, key);
    expect(result).toMatchObject({ ok: false, status: 502 });
  }
});
it("형식이 틀린 대상 ID는 요청 주소로 보내지 않는다", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const id of ["../shops", "https://example.org", "", "bad/id"]) {
    expect((await fetchReviewShop(id)).ok).toBe(false);
    expect((await reviewLicense(id, {}, key)).ok).toBe(false);
    expect((await reviewIdentityChange(id, {}, key)).ok).toBe(false);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("계좌번호 전체와 응답의 내부 값은 DTO에 복사하지 않는다", async () => {
  const value = detail("identity_change_pending");
  value.paymentAccount.accountNumber = "합성 전체 계좌";
  value.pendingIdentityChange.paymentAccount.accountNumber = "합성 전체 계좌";
  value.internalSql = "합성 내부 값";
  value.duplicates = [
    {
      shopId: "11111111-1111-4111-8111-111111111111",
      name: "합성 중복 가게",
      licenseStatus: "pending",
      phone: "합성 비공개",
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(value)),
  );
  const result = await fetchReviewShop(shopId);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(JSON.stringify(result.data)).not.toContain("합성 전체 계좌");
  expect(JSON.stringify(result.data)).not.toContain("합성 내부 값");
  expect(JSON.stringify(result.data)).not.toContain("합성 비공개");
});
