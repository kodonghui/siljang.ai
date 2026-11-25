import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchConsultationMessages, parseConsultationMessagesSearch } from "./consultation-messages-api";

const api = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8"));
const examples =
  api.paths["/owner/consultations/{consultationId}/messages"].get.responses[200].content["application/json"].examples;
const SHOP = "00000000-0000-4000-8000-000000000089";
const query = { limit: 20, cursor: null };
let value: Record<string, unknown> & { consultationId: string; items: Record<string, unknown>[] };
beforeEach(() => {
  value = structuredClone(examples.messages.value);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
});
afterEach(() => vi.unstubAllGlobals());
it.each(Object.keys(examples))("API043의 실제 계약 예시 %s를 읽는다", async (name) => {
  value = structuredClone(examples[name].value);
  const signal = new AbortController().signal;
  const result = await fetchConsultationMessages(value.consultationId, query, SHOP, signal);
  expect(result.ok).toBe(true);
  expect(vi.mocked(fetch).mock.calls[0]).toMatchObject([
    `/api/owner/consultations/${value.consultationId}/messages?limit=20`,
    { credentials: "same-origin", cache: "no-store", signal },
  ]);
  expect(new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).get("X-Expected-Shop-Id")).toBe(SHOP);
});
it.each([
  "?limit=0",
  "?limit=101",
  "?limit=1.5",
  "?limit=x",
  "?limit=1&limit=2",
  "?cursor=",
  "?cursor=a&cursor=b",
  "?cursor=%2Fprivate",
  `?cursor=${"a".repeat(201)}`,
])("잘못된 페이지 주소 %s는 요청 전에 거른다", (search) => expect(parseConsultationMessagesSearch(search)).toBeNull());
it("기본20개와100개/불투명 커서를 읽는다", () => {
  expect(parseConsultationMessagesSearch("")).toEqual(query);
  expect(parseConsultationMessagesSearch("?limit=100&cursor=opaque_1")).toEqual({ limit: 100, cursor: "opaque_1" });
});
it("다른 상담 응답은 원래 값을 UI로 넘기지 않는다", async () => {
  const requested = value.consultationId;
  value.consultationId = SHOP;
  expect(await fetchConsultationMessages(requested, query, SHOP)).toEqual({
    ok: false,
    status: 502,
    problem: null,
    retryAfterSeconds: null,
  });
});
it("화면은 최근부터 이전 페이지를 요청하고 같은 페이지의 재조회 기준을 보존한다", async () => {
  value.reloadCursor = "synthetic_page_anchor";
  const result = await fetchConsultationMessages(value.consultationId, { ...query, direction: "backward" }, SHOP);
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
    `/api/owner/consultations/${value.consultationId}/messages?limit=20&direction=backward`,
  );
  expect(result.ok && result.data.reloadCursor).toBe("synthetic_page_anchor");
});
it.each([
  [
    "중복 메시지",
    (v: typeof value) => {
      if (v.items[0]) v.items.push(structuredClone(v.items[0]));
    },
  ],
  [
    "잘못된 발신자",
    (v: typeof value) => {
      if (v.items[0]) v.items[0].author = "__proto__";
    },
  ],
  [
    "잘못된 전달 상태",
    (v: typeof value) => {
      if (v.items[0]) v.items[0].delivery = "other";
    },
  ],
  [
    "긴 글 상한",
    (v: typeof value) => {
      if (v.items[0]) v.items[0].text = "가".repeat(100001);
    },
  ],
  [
    "자바스크립트 사진 주소",
    (v: typeof value) => {
      if (v.items[0]) v.items[0].photos = [{ url: "javascript:alert(1)" }];
    },
  ],
  [
    "사용자 정보가 있는 사진 주소",
    (v: typeof value) => {
      if (v.items[0]) v.items[0].photos = [{ url: "https://example:secret@images.example/p" }];
    },
  ],
  [
    "삭제한 상담의 남은 글",
    (v: typeof value) => {
      v.status = "deleted";
    },
  ],
] as const)("잘못된 성공 본문 %s를 공통 실패로 처리한다", async (_, mutate) => {
  mutate(value);
  const result = await fetchConsultationMessages(value.consultationId, query, SHOP);
  expect(result).toEqual({ ok: false, status: 502, problem: null, retryAfterSeconds: null });
});
it("틀린 상담 ID는 네트워크 요청을 보내지 않는다", async () => {
  const result = await fetchConsultationMessages("../other", query, SHOP);
  expect(result).toEqual({ ok: false, status: 404, problem: null, retryAfterSeconds: null });
  expect(fetch).not.toHaveBeenCalled();
});
