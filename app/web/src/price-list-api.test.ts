import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchPriceList, savePriceList, uploadDesignImage } from "./price-list-api";

const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const current = () =>
  structuredClone(
    contract.paths["/owner/price-list"].get.responses[200].content["application/json"].examples.current.value,
  );
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());
it("현재 버전과 두 저장 결과를 계약 예시 그대로 읽고 같은 출처로 전송", async () => {
  const seen: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_: unknown, init: RequestInit) => {
      seen.push(init);
      return reply(
        seen.length === 1 ? current() : { outcome: seen.length === 2 ? "created" : "unchanged", priceList: current() },
        seen.length === 2 ? 201 : 200,
      );
    }),
  );
  expect((await fetchPriceList()).ok).toBe(true);
  expect(await savePriceList({ baseRevision: "synthetic-v4" }, "synthetic-key")).toMatchObject({
    ok: true,
    data: { outcome: "created" },
  });
  expect(await savePriceList({ baseRevision: "synthetic-v4" }, "synthetic-key")).toMatchObject({
    ok: true,
    data: { outcome: "unchanged" },
  });
  expect(new Headers(seen[1]?.headers).get("Idempotency-Key")).toBe("synthetic-key");
  expect(seen.every((x) => x.credentials === "same-origin")).toBe(true);
});
it.each([
  [
    "숫자 문자열",
    (p: ReturnType<typeof current>) => {
      p.options[0].amount = "35000";
    },
  ],
  [
    "도안의 실행 주소",
    (p: ReturnType<typeof current>) => {
      p.designs[0].imageUrl = "javascript:alert(1)";
    },
  ],
  [
    "비밀번호 포함 주소",
    (p: ReturnType<typeof current>) => {
      p.designs[0].imageUrl = "https://test:secret@files.example/test.png";
    },
  ],
  [
    "도안의 없는 연결 옵션",
    (p: ReturnType<typeof current>) => {
      p.designs[0].optionId = "00000000-0000-4000-8000-000000000049";
    },
  ],
  [
    "이전 버전",
    (p: ReturnType<typeof current>) => {
      p.current = false;
      p.supersededAt = "2026-11-23T10:00:00Z";
    },
  ],
  [
    "잘못된 시각",
    (p: ReturnType<typeof current>) => {
      p.createdAt = "not-a-date";
    },
  ],
])("%s 응답은 편집하지 않고 공통 실패로 처리", async (_, alter) => {
  const value = current();
  alter(value);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply(value)),
  );
  expect(await fetchPriceList()).toMatchObject({ ok: false, status: 502 });
});
it.each([
  [401, "unauthenticated"],
  [404, "shop_not_registered"],
  [404, "not_set"],
  [500, "internal"],
])("조회 실패 %s/%s를 화면이 구분하도록 보존", async (status, code) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply({ code }, status)),
  );
  expect(await fetchPriceList()).toMatchObject({ ok: false, status, problem: { code } });
});
it.each([
  [401, "unauthenticated"],
  [404, "shop_not_registered"],
  [409, "version_conflict"],
  [409, "request_in_progress"],
  [422, "validation_failed"],
  [422, "idempotency_key_reused"],
  [500, "internal"],
])("저장 실패 %s/%s를 재시도 정책과 함께 보존", async (status, code) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply({ code }, status)),
  );
  expect(await savePriceList({}, "synthetic-key")).toMatchObject({ ok: false, status, problem: { code } });
});
it("도안은 design_image multipart로 올리고 요청 키/Content-Type을 직접 만들지 않음", async () => {
  let body: RequestInit | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_: unknown, init: RequestInit) => {
      body = init;
      return reply(
        { uploadId: "upl_synthetic000000000000000049", purpose: "design_image", expiresAt: "2026-11-23T13:00:00Z" },
        201,
      );
    }),
  );
  const file = new File(["synthetic"], "synthetic.png", { type: "image/png" });
  expect(await uploadDesignImage(file)).toMatchObject({ ok: true, data: { purpose: "design_image" } });
  if (!(body?.body instanceof FormData)) throw new Error("도안 multipart 본문 없음");
  expect(body.body.get("purpose")).toBe("design_image");
  expect(body.body.get("file")).toBe(file);
  expect(new Headers(body?.headers).has("Content-Type")).toBe(false);
  expect(new Headers(body?.headers).has("Idempotency-Key")).toBe(false);
});
it.each(["license_photo", "completion_photo"])("다른 용도의 %s 성공은 도안에 쓰지 않음", async (purpose) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      reply({ uploadId: "upl_synthetic000000000000000049", purpose, expiresAt: "2026-11-23T13:00:00Z" }, 201),
    ),
  );
  expect(await uploadDesignImage(new File(["synthetic"], "synthetic.png"))).toMatchObject({ ok: false, status: 502 });
});
