import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchPublicBooking } from "./public-booking-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const original = () =>
  structuredClone(api.paths["/public/shops/{slug}"].get.responses[200].content["application/json"].examples.page.value);
afterEach(() => vi.unstubAllGlobals());
function reply(value: unknown, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(value), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("공개 필드만 복사하고 내부 ID·손님·자리 수·주문 필드를 전달하지 않는다", async () => {
  const value = original();
  value.customerName = "노출 금지 합성 손님";
  value.shop.shopId = "internal-shop";
  value.days[0].remaining = 12;
  value.priceList.options[0].optionId = "internal-option";
  value.portfolio[0].orderId = "internal-order";
  const fetch = reply(value);
  const response = await fetchPublicBooking("moonlight-cake");
  expect(response.ok).toBe(true);
  for (const field of ["customerName", "shopId", "optionId", "remaining", "orderId", "노출 금지"])
    expect(JSON.stringify(response)).not.toContain(field);
  expect(fetch).toHaveBeenCalledWith(
    "/api/public/shops/moonlight-cake",
    expect.objectContaining({ cache: "no-store" }),
  );
});
it.each(["", "A/B", "../../owner/me", "UPPER", "<script>"])(
  "잘못된 주소 %s는 요청 전에 같은404로 닫는다",
  async (slug) => {
    const fetch = reply(original());
    const response = await fetchPublicBooking(slug);
    expect(response).toMatchObject({ ok: false, status: 404 });
    expect(fetch).not.toHaveBeenCalled();
  },
);
it.each([401, 404, 429, 500])("HTTP%d 오류를 성공 본문으로 취급하지 않는다", async (status) => {
  reply({ code: status === 429 ? "rate_limited" : "not_found" }, status);
  expect(await fetchPublicBooking("moonlight-cake")).toMatchObject({ ok: false, status });
});
it.each(["javascript:alert(1)", "data:image/png;base64,AA==", "https://name:password@files.example/photo"])(
  "실행/인증 정보가 든 사진 주소 %s를 거절한다",
  async (imageUrl) => {
    const value = original();
    value.portfolio[0].imageUrl = imageUrl;
    reply(value);
    expect((await fetchPublicBooking("moonlight-cake")).ok).toBe(false);
  },
);
it.each(["https://pf.kakao.com.evil.example/chat", "javascript:alert(1)", "http://pf.kakao.com/chat"])(
  "외부 문의 주소 %s를 거절한다",
  async (inquiryUrl) => {
    const value = original();
    value.inquiryUrl = inquiryUrl;
    reply(value);
    expect((await fetchPublicBooking("moonlight-cake")).ok).toBe(false);
  },
);
it("빈 사진·도안·옵션과 없는 문의 주소는 유효하며 가짜 주소를 만들지 않는다", async () => {
  const value = original();
  value.portfolio = [];
  value.priceList.designs = [];
  value.priceList.options = [];
  value.inquiryUrl = null;
  reply(value);
  const response = await fetchPublicBooking("moonlight-cake");
  expect(response.ok && response.data.inquiryUrl).toBeNull();
});
it.each(["short", "duplicate", "gap", "date", "status", "range", "limit"])(
  "계약 밖 %s 값은 오류로 닫는다",
  async (kind) => {
    const value = original();
    if (kind === "short") value.days = value.days.slice(0, 59);
    if (kind === "duplicate") value.days[1] = value.days[0];
    if (kind === "gap") value.days[1].day = "2026-11-15";
    if (kind === "date") value.days[0].day = "2026-02-30";
    if (kind === "status") value.days[0].status = "accepting-secret-capacity";
    if (kind === "range")
      value.priceList.options[0] = { ...value.priceList.options[0], priceKind: "range", amountMax: 1 };
    if (kind === "limit") value.priceList.designs = Array.from({ length: 51 }, () => value.priceList.designs[0]);
    reply(value);
    expect((await fetchPublicBooking("moonlight-cake")).ok).toBe(false);
  },
);
