import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchBookingLink } from "./booking-link-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const responses = api.paths["/owner/booking-link"].get.responses;
const example = (name: string) => structuredClone(responses[200].content["application/json"].examples[name].value);
const cases = Object.entries(responses).flatMap(([status, response]) =>
  Object.entries(
    Object.values(
      (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
    )[0]?.examples ?? {},
  ).map(([name, row]) => ({ status: status === "default" ? 500 : Number(status), name, value: row.value })),
);
afterEach(() => vi.unstubAllGlobals());
it.each(cases)("$status $name 응답과 요청 경계", async (row) => {
  const transport = vi.fn(async () => new Response(JSON.stringify(row.value), { status: row.status }));
  vi.stubGlobal("fetch", transport);
  const controller = new AbortController(),
    result = await fetchBookingLink(controller.signal);
  expect(result.ok).toBe(row.status === 200);
  if (!result.ok) expect(result.status).toBe(row.status);
  const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/owner/booking-link");
  expect(init.credentials).toBe("same-origin");
  expect(init.cache).toBe("no-store");
  expect(init.signal).toBe(controller.signal);
  expect(new Headers(init.headers).get("Idempotency-Key")).toBeNull();
  expect(init.body).toBeUndefined();
});
it.each([
  "상태",
  "주소 형식",
  "주소 사용자 정보",
  "주소 공백",
  "주소 제어 문자",
  "주소 길이",
  "시각",
  "날짜 범위",
  "미충족 종류",
  "미충족 중복",
  "미충족 개수",
  "추천 종류",
  "추천 중복",
  "발급 뒤 미충족",
  "미발급 주소",
  "미발급 시각",
  "미발급 빈 조건",
])("잘못된 성공 응답 %s 거절", async (kind) => {
  const value = example(kind.startsWith("미발급") ? "not_ready" : "issued");
  if (kind === "상태") value.status = "other";
  if (kind === "주소 형식") value.url = "javascript:alert(1)";
  if (kind === "주소 사용자 정보") value.url = "https://name@example.org/s/cake";
  if (kind === "주소 공백") value.url = "https://example.org/s/a b";
  if (kind === "주소 제어 문자") value.url = "https://example.org/s/a\u0000b";
  if (kind === "주소 길이") value.url = `https://example.org/s/${"a".repeat(2048)}`;
  if (kind === "시각") value.issuedAt = "not-a-date";
  if (kind === "날짜 범위") value.issuedAt = "2026-02-30T12:00:00+09:00";
  if (kind === "미충족 종류") value.missing = [{ toString: null }];
  if (kind === "미충족 중복") value.missing = ["calendar", "calendar"];
  if (kind === "미충족 개수") value.missing = Array(8).fill("calendar");
  if (kind === "추천 종류") value.recommended = ["other"];
  if (kind === "추천 중복") value.recommended = ["pickup_address", "pickup_address"];
  if (kind === "발급 뒤 미충족") value.missing = ["calendar"];
  if (kind === "미발급 주소") value.url = "https://example.org/s/cake";
  if (kind === "미발급 시각") value.issuedAt = "2026-11-23T00:00:00Z";
  if (kind === "미발급 빈 조건") value.missing = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  const result = await fetchBookingLink();
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.status).toBe(502);
});
it("계약 밖 내부 필드는 화면 데이터에 복사하지 않는다", async () => {
  const value = example("issued");
  value.shopId = "synthetic-internal";
  value.ownerId = "synthetic-owner";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  const result = await fetchBookingLink();
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data).not.toHaveProperty("shopId");
    expect(result.data).not.toHaveProperty("ownerId");
  }
});
