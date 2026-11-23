import { afterEach, expect, it, vi } from "vitest";
import { fetchShopLicense } from "./shop-license-api";
import { fetchShopSettings } from "./shop-settings-api";
import { shopFixture } from "./test-fixtures/shop-settings";

afterEach(() => vi.unstubAllGlobals());
it.each([{ dailyAiCostLimitKrw: "5000" }, { identityChange: { status: "pending" } }])(
  "같은 API009의 잘못된 계약 %j는 두 화면이 함께 거절",
  async (changes) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...shopFixture(), ...changes }), { status: 200 })),
    );
    expect((await fetchShopLicense()).ok).toBe(false);
    expect((await fetchShopSettings()).ok).toBe(false);
  },
);
