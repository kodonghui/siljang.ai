import { afterEach, expect, it, vi } from "vitest";
import { fetchShopSettings, saveShopSettings } from "./shop-settings-api";
import { shopFixture } from "./test-fixtures/shop-settings";

afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
it.each(["verified", "pending", "on_hold", "identity_change_pending", "identity_change_on_hold"])(
  "가게 조회 계약의 %s 성공 응답을 읽음",
  async (name) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(shopFixture(`get_${name}`))),
    );
    const result = await fetchShopSettings();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.shopId).toBe(shopFixture().shopId);
  },
);
it.each(["updated", "unchanged"])("가게 저장 계약의 %s 응답과 요청 키를 보존함", async (name) => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(shopFixture(`patch_${name}`)));
  vi.stubGlobal("fetch", fetch);
  const body = { baseRevision: "4821", name: "새 합성 가게" };
  const result = await saveShopSettings(body, "ui-synthetic-settings-request");
  expect(result.ok).toBe(true);
  const init = fetch.mock.calls[0]?.[1] as RequestInit;
  expect(init.method).toBe("PATCH");
  expect(new Headers(init.headers).get("Idempotency-Key")).toBe("ui-synthetic-settings-request");
  expect(JSON.parse(String(init.body))).toEqual(body);
});

it("요약이 없는 이전 계약 응답도 읽고 잘못된 요약은 공통 실패로 처리함", async () => {
  const legacy = shopFixture();
  delete legacy.settingsSummary;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(legacy)),
  );
  expect((await fetchShopSettings()).ok).toBe(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ...shopFixture(), settingsSummary: { priceListVersion: "3" } })),
  );
  expect(await fetchShopSettings()).toMatchObject({ ok: false, status: 502 });
});
it.each([
  { shopId: "wrong" },
  { licenseStatus: "unknown" },
  { idleCloseHours: "24" },
  { ownerWaitMinutes: 1.5 },
  { completionPhotoEnabled: 1 },
  { revision: null },
])("계약을 벗어난 성공 응답 %j를 공통 실패로 처리함", async (changed) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ...shopFixture(), ...changed })),
  );
  expect(await fetchShopSettings()).toMatchObject({ ok: false, status: 502 });
});
it.each([
  [401, "unauthenticated"],
  [404, "shop_not_registered"],
  [500, "internal"],
] as const)("조회 실패 %s/%s를 화면에 전달함", async (status, code) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ code, traceId: "0123456789abcdef0123456789abcdef" }, status)),
  );
  expect(await fetchShopSettings()).toMatchObject({ ok: false, status, problem: { code } });
});
