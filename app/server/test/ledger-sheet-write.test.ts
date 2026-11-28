import { describe, expect, it, vi } from "vitest";
import { writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

const file = "synthetic_sheet_1234567890";
const access = new Secret("synthetic-access");
const setup = { sheetId: 7, start: 26, end: 38, movedRight: false, ownershipToken: "proof", columns: [] };
const input = {
  file,
  tab: "장부's",
  access,
  setup,
  values: ["ABC123", "이름", "010-1234-5678", "2026-11-28", "케이크", "=1+1", 10000, "확인", "취소", 0, "", "취소됨"],
};

describe("장부 행 쓰기", () => {
  it("주문번호를 찾아 기존 행만 RAW 값으로 갱신한다", async () => {
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === "PUT"
        ? Response.json({ updatedRows: 1 })
        : Response.json({ values: [["주문번호"], ["OTHER1"], ["ABC123"]] }),
    );
    await writeLedgerSheet(input, { fetch: send });
    expect(send).toHaveBeenCalledTimes(2);
    const url = new URL(String(send.mock.calls[1]?.[0]));
    expect(decodeURIComponent(url.pathname)).toContain("'장부''s'!AA3:AL3");
    expect(url.searchParams.get("valueInputOption")).toBe("RAW");
    expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body)).values).toEqual([input.values]);
  });
  it("주문번호가 없으면 한 행 추가하고 중복 번호는 안전하게 실패한다", async () => {
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ updates: { updatedRows: 1 } })
        : Response.json({ values: [["주문번호"]] }),
    );
    await writeLedgerSheet(input, { fetch: send });
    expect(String(send.mock.calls[1]?.[0])).toContain(":append");
    await expect(
      writeLedgerSheet(input, { fetch: async () => Response.json({ values: [["주문번호"], ["ABC123"], ["ABC123"]] }) }),
    ).rejects.toThrow();
  });
  it("추가 응답이 유실된 뒤 재시도하면 기존 주문 행을 고친다", async () => {
    let stored = false;
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET")
        return Response.json({ values: stored ? [["주문번호"], ["ABC123"]] : [["주문번호"]] });
      if (init?.method === "POST") {
        stored = true;
        throw new Error("response lost");
      }
      return Response.json({ updatedRows: 1 });
    });
    await expect(writeLedgerSheet(input, { fetch: send })).rejects.toThrow();
    await writeLedgerSheet(input, { fetch: send });
    expect(send.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(send.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
});
