import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchBookingLink } from "./booking-link-api";
import { isCardPaymentUrl } from "./payment-destination-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
afterEach(() => vi.unstubAllGlobals());
it.each([
  ["https://name@example.org/s/cake", true, false],
  ["HTTPS://example.org/s/cake", false, true],
] as const)("공통 검사에서도 기존 두 주소 계약의 차이를 지킨다: %s", async (url, card, booking) => {
  expect(isCardPaymentUrl(url)).toBe(card);
  const value = structuredClone(
    api.paths["/owner/booking-link"].get.responses[200].content["application/json"].examples.issued.value,
  );
  value.url = url;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  expect((await fetchBookingLink()).ok).toBe(booking);
});
