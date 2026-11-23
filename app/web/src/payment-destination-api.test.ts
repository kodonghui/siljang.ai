import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchPaymentDestination, isCardPaymentUrl, savePaymentDestination } from "./payment-destination-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const path = "/owner/payment-destination";
const fixture = () =>
  structuredClone(api.paths[path].get.responses[200].content["application/json"].examples.account.value);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());
it("같은 출처의 비캐시 조회와 요청 키를 가진 PUT으로만 계좌를 다룬다", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit) => {
      calls.push({ path: String(input), init });
      return json(calls.length === 1 ? fixture() : { outcome: "created", paymentDestination: fixture() });
    }),
  );
  expect(await fetchPaymentDestination(controller.signal)).toMatchObject({ ok: true, data: fixture() });
  const body = {
    baseRevision: null,
    bankName: "합성 은행",
    accountNumber: "000000000000",
    holderName: "합성 예금주",
    cardPaymentUrl: "https://pay.example.test/synthetic",
    confirm: ["holder_mismatch"],
  };
  expect(await savePaymentDestination(body, "synthetic-payment-key-053")).toMatchObject({
    ok: true,
    data: { outcome: "created" },
  });
  expect(calls.map((c) => c.path)).toEqual(["/api/owner/payment-destination", "/api/owner/payment-destination"]);
  expect(calls[0]?.init).toMatchObject({
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: controller.signal,
  });
  expect(calls[1]?.init).toMatchObject({ method: "PUT", credentials: "same-origin" });
  expect(new Headers(calls[1]?.init.headers).get("Idempotency-Key")).toBe("synthetic-payment-key-053");
  expect(JSON.parse(String(calls[1]?.init.body))).toEqual(body);
});
it.each(["created", "unchanged"])("저장 결과 %s는 검증한 계좌만 돌려준다", async (outcome) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ outcome, paymentDestination: fixture() })),
  );
  expect(await savePaymentDestination({}, "synthetic-payment-key-053")).toMatchObject({
    ok: true,
    data: { outcome, paymentDestination: fixture() },
  });
});
it.each([
  ["bankName", ""],
  ["bankName", "가".repeat(31)],
  ["holderName", " "],
  ["holderName", "가\0나"],
  ["accountNumber", "123456789"],
  ["accountNumber", "12345678901234567"],
  ["accountNumber", "123456789x"],
  ["accountNumber", `${"-".repeat(31)}1234567890`],
  ["cardPaymentUrl", "http://pay.example.test"],
  ["cardPaymentUrl", "javascript:alert(1)"],
  ["cardPaymentUrl", "https://bad url.example.test"],
  ["holderMismatchConfirmed", "true"],
  ["createdAt", "not-a-date"],
  ["revision", "bad revision"],
])("잘못된 성공 응답 %s를 계좌 화면에 쓰지 않는다", async (field, value) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ...fixture(), [String(field)]: value })),
  );
  expect(await fetchPaymentDestination()).toMatchObject({ ok: false, status: 502 });
});
it("추가 성공 필드는 계좌 자료에 섞지 않는다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ...fixture(), internalNote: "synthetic-private-note" })),
  );
  expect(await fetchPaymentDestination()).toMatchObject({ ok: true, data: fixture() });
  const result = await fetchPaymentDestination();
  if (!result.ok) throw new Error("합성 성공 응답 없음");
  expect(Object.keys(result.data)).toHaveLength(7);
});
for (const method of ["get", "put"] as const) {
  const examples = Object.entries(api.paths[path][method].responses).flatMap(([status, response]) => {
    if (status === "200") return [];
    const content = (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content[
      "application/problem+json"
    ];
    return Object.entries(content?.examples ?? {}).map(([name, example]) => ({
      status: Number(status === "default" ? 500 : status),
      name,
      value: example.value,
    }));
  });
  it.each(examples)(`${method} $status/$name 응답을 공통 오류로 전달`, async (p) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(p.value, p.status)),
    );
    const result =
      method === "get"
        ? await fetchPaymentDestination()
        : await savePaymentDestination({}, "synthetic-payment-key-053");
    expect(result).toMatchObject({ ok: false, status: p.status });
  });
}

it("카드 링크 한도는 서버와 같은 코드 포인트2048자를 받는다", async () => {
  const prefix = "https://pay.example.test/";
  const value = prefix + "😀".repeat(2048 - [...prefix].length);
  expect([...value]).toHaveLength(2048);
  expect(isCardPaymentUrl(value)).toBe(true);
  expect(isCardPaymentUrl(`${value}a`)).toBe(false);
});
