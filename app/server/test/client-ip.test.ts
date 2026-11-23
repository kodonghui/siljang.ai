import { Hono } from "hono";
import { expect, it } from "vitest";
import type { HonoEnv } from "../src/app";
import { APP_ROUTES, createApp } from "../src/app";
import { normalizedClientIp } from "../src/client-ip";
import { assertPublicShopRateCoverage, publicShopRateRule, resolvePublicShop } from "../src/public-shop";
import { PUBLIC_BOOKING_RATE, PUBLIC_PRIVACY_RATE } from "../src/rate-limit";
import { shopRoute } from "../src/routes";

it.each([
  ["192.0.2.1", "192.0.2.1"],
  ["::ffff:192.0.2.1", "192.0.2.1"],
  ["0:0:0:0:0:FFFF:c000:201", "192.0.2.1"],
  ["2001:db8:abcd:1234::99", "2001:db8:abcd:1234::/64"],
  ["2001:0DB8:ABCD:1234:0:0:0:1", "2001:db8:abcd:1234::/64"],
  ["::", "0:0:0:0::/64"],
])("접속지 %s의 한도 주소를 정규화함", (input, expected) => {
  expect(normalizedClientIp(input)).toBe(expected);
});

it.each([
  "local",
  "256.1.2.3",
  "192.168.001.1",
  "a.b.c.d",
  "2001:db8::1%eth0",
  "1:2:3",
  "127.0.0.1,1.2.3.4",
  "a".repeat(65),
])("CF 헤더로 쓸 수 없는 %s를 거절함", (input) => expect(normalizedClientIp(input)).toBeNull());

it("기본 공개 경로의 한도가 모두 선언돼 있고 빠진 새 경로는 시작 전 거절함", () => {
  expect(() => assertPublicShopRateCoverage(APP_ROUTES)).not.toThrow();
  const extra = shopRoute("GET", "/public/shops/:slug/undeclared", "public", async () => new Response());
  expect(() => assertPublicShopRateCoverage([...APP_ROUTES, extra])).toThrow("public route rate rule missing");
  expect(() => createApp({ routes: [...APP_ROUTES, extra] })).toThrow("public route rate rule missing");
});

it("Hono의 basePath가 바뀌어도 선언한 공개 한도를 찾고 HEAD도 GET 한도를 씀", () => {
  expect(publicShopRateRule("GET", "/v3/public/shops/:slug", "/v3")).toBe(PUBLIC_BOOKING_RATE);
  expect(publicShopRateRule("HEAD", "/changed/public/shops/:slug/privacy-policy", "/changed")).toBe(
    PUBLIC_PRIVACY_RATE,
  );
  expect(publicShopRateRule("GET", "/v3/public/shops/:slug/new", "/v3")).toBeUndefined();
});

it.each(["/undeclared", "/undeclared/:slug"])(
  "공개 해석기는 시작 검사와 별도로 잘못 선언한 %s도 닫음",
  async (path) => {
    const app = new Hono<HonoEnv>();
    app.get(path, async (c) => {
      await expect(resolvePublicShop(c)).rejects.toMatchObject({ code: "not_found" });
      return c.text("closed");
    });
    const response = await app.request(path.replace(":slug", "synthetic-shop"));
    expect(await response.text()).toBe("closed");
  },
);
