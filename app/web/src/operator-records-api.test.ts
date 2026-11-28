import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  fetchOperatorConsultation,
  fetchOperatorOrder,
  fetchOperatorRecords,
  type OperatorOriginalInput,
  type OperatorRecordKind,
  openOperatorOriginal,
} from "./operator-records-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const paths = [
  "/operator/shops/{shopId}/records",
  "/operator/shops/{shopId}/consultations/{consultationId}",
  "/operator/shops/{shopId}/orders/{orderId}",
  "/operator/shops/{shopId}/originals",
] as const;
const shop = "2dc42524-54e3-5d3d-847f-efdb54aa8706",
  key = "ui-synthetic-record-open-12345678";
const sample = (i: number, name: string) =>
  structuredClone(
    api.paths[paths[i] as string][i === 3 ? "post" : "get"].responses[200].content["application/json"].examples[name]
      .value,
  );
const consultation = sample(1, "consultation"),
  order = sample(2, "order"),
  original = sample(3, "masked_value");
const rows = paths.flatMap((path, i) =>
  Object.entries(api.paths[path][i === 3 ? "post" : "get"].responses).flatMap(([code, response]) =>
    Object.entries(
      Object.values(
        (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
      )[0]?.examples ?? {},
    ).map(([name, example]) => ({
      path,
      index: i,
      status: code === "default" ? 500 : Number(code),
      name,
      body: example.value,
    })),
  ),
);
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());
it("API074~077 원본 응답32개를 대조한다", () => expect(rows).toHaveLength(32));
it.each(rows)("$path $status $name의 요청 경계", async (row) => {
  const fetch = vi.fn(async () => reply(row.body, row.status));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal,
    value = row.body as Record<string, unknown>;
  const input: OperatorOriginalInput = {
    targetKind: (value.targetKind ?? "masked_value") as OperatorOriginalInput["targetKind"],
    targetId: (value.targetId ?? original.targetId) as string,
    reason: "손님 문의: 기록 확인",
    ...(value.targetKind === "consultation_text" ? { cursor: consultation.textCursor } : {}),
  };
  const result =
    row.index === 0
      ? await fetchOperatorRecords(shop, (value.kind ?? "orders") as OperatorRecordKind, undefined, signal)
      : row.index === 1
        ? await fetchOperatorConsultation(shop, consultation.consultationId, undefined, signal)
        : row.index === 2
          ? await fetchOperatorOrder(shop, order.orderId, signal)
          : await openOperatorOriginal(shop, input, key, signal);
  expect(result.ok).toBe(row.status === 200);
  if (!result.ok) expect(result.status).toBe(row.status);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit],
    parsed = new URL(url, "https://siljang.example");
  expect(parsed.pathname).toBe(
    `/api${row.path.replace("{shopId}", shop).replace("{consultationId}", consultation.consultationId).replace("{orderId}", order.orderId)}`,
  );
  expect(init.credentials).toBe("same-origin");
  expect(init.cache).toBe("no-store");
  expect(init.signal).toBe(signal);
  if (row.index === 3) {
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(key);
    expect(JSON.parse(String(init.body))).toEqual(input);
  } else {
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  }
});
it.each([
  null,
  [],
  {},
  { kind: "orders", orders: [], consultations: [], nextCursor: 7 },
  { ...sample(0, "orders"), orders: [{ ...sample(0, "orders").orders[0], orderId: "wrong" }] },
  { ...sample(0, "orders"), orders: [{ ...sample(0, "orders").orders[1], customerNameMasked: "보관 주문 원문" }] },
])("잘못된 목록 %j를 성공으로 반환하지 않는다", async (body) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply(body)),
  );
  expect((await fetchOperatorRecords(shop, "orders")).ok).toBe(false);
});
it("메타데이터의 글/알레르기/원문 필드를 복사하지 않는다", async () => {
  const hidden = "합성 원문: 개인정보 비노출 확인",
    data = sample(1, "consultation");
  data.body = hidden;
  data.items[0].text = hidden;
  data.items[0].allergy = hidden;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply(data)),
  );
  const result = await fetchOperatorConsultation(shop, consultation.consultationId);
  expect(JSON.stringify(result)).not.toContain(hidden);
});
it("가린 주문 응답의 숨은 이름/계좌/참고 사진 주소를 복사하지 않는다", async () => {
  const hidden = "합성 숨은 원문",
    data = sample(2, "order");
  data.customerName = hidden;
  data.refundAccount = hidden;
  data.photoUrl = hidden;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply(data)),
  );
  expect(JSON.stringify(await fetchOperatorOrder(shop, order.orderId))).not.toContain(hidden);
});
it("다른 대상/종류의 열기 응답은 성공으로 반환하지 않는다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply({ ...original, targetId: order.orderId })),
  );
  expect(
    (
      await openOperatorOriginal(
        shop,
        { targetKind: "masked_value", targetId: original.targetId, reason: "합성 대상 일치 확인" },
        key,
      )
    ).ok,
  ).toBe(false);
});
it("다음 페이지는 커서를 인코딩하고 API075에만 쓴다", async () => {
  const fetch = vi.fn(async () => reply(consultation));
  vi.stubGlobal("fetch", fetch);
  await fetchOperatorConsultation(shop, consultation.consultationId, "opaque_cursor.1234567890");
  const url = new URL((fetch.mock.calls[0] as unknown as [string])[0], "https://siljang.example");
  expect(url.searchParams.get("cursor")).toBe("opaque_cursor.1234567890");
  expect(url.searchParams.get("limit")).toBe("20");
});
it("응답 검증 스키마는 현재 OpenAPI 원본과 같다", async () => {
  const schemas = (await import("./operator-record-schemas.json")).default;
  for (const [name, schema] of Object.entries(schemas)) expect(schema).toEqual(api.components.schemas[name]);
});
it("열기 응답 안의 다른 상담 ID는 거부한다", async () => {
  const data = sample(3, "consultation_text");
  data.consultationText.consultationId = "f8471919-f9c2-5b67-9a89-b047fb281ba4";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply(data)),
  );
  expect(
    (
      await openOperatorOriginal(
        shop,
        {
          targetKind: "consultation_text",
          targetId: data.targetId,
          reason: "손님 문의 확인",
          cursor: consultation.textCursor,
        },
        key,
      )
    ).ok,
  ).toBe(false);
});
it("카드번호의 원문 보관 표시와 삭제 상담의 메시지는 거부한다", async () => {
  const data = sample(1, "consultation");
  data.maskedValues[1].originalKept = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply(data)),
  );
  expect((await fetchOperatorConsultation(shop, data.consultationId)).ok).toBe(false);
  data.maskedValues[1].originalKept = false;
  data.status = "deleted";
  expect((await fetchOperatorConsultation(shop, data.consultationId)).ok).toBe(false);
});
