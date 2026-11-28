import { expect, it, vi } from "vitest";
import { auditLedgerSheet, LedgerUncertainError, ledgerRowDigest, writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

const id = "11111111-1111-4111-8111-111111111111",
  orderId = "22222222-2222-4222-8222-222222222222";
const input = {
  file: "synthetic_sheet_1234567890",
  tab: "장부",
  access: new Secret("fake"),
  hashKey: new Secret("synthetic-hash-key"),
  setup: {
    sheetId: 7,
    start: 26,
    end: 40,
    sheetColumnCount: 40,
    movedRight: false,
    ownershipToken: "proof",
    columns: [],
  },
  shopId: crypto.randomUUID(),
  linkId: crypto.randomUUID(),
  eventId: id,
  orderId,
  values: ["ABC123", "이름", "010-0000-0000", "", "", "=1+1", 1000, "", "", 0, "", ""],
};
const initial = ["ABC123", "이전", "", "", "", "", 0, "", "", 0, "", "", "old", orderId.replaceAll("-", "")];
it("기존 행의 주문 ID와 전체 열을 전후 확인하고 ID를 원자적으로 쓴다", async () => {
  let row: (string | number)[] = initial;
  const calls: string[] = [];
  const send = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(raw));
    calls.push(url);
    if (init?.method === "GET") {
      if (url.includes("fields=sheets"))
        return Response.json({
          sheets: [
            { data: [{ rowData: [{}, { values: row.map((v) => ({ userEnteredValue: { stringValue: v } })) }] }] },
          ],
        });
      return Response.json({ values: url.includes("!AA2:AN2") ? [row] : [["헤더"], row] });
    }
    const body = JSON.parse(String(init?.body));
    const cells = body.requests[0].updateCells.rows[0].values;
    expect(cells[5].userEnteredValue).toEqual({ stringValue: "=1+1" });
    expect(cells[12].userEnteredValue).toEqual({ stringValue: id.replaceAll("-", "") });
    expect(cells[13].userEnteredValue).toEqual({ stringValue: orderId.replaceAll("-", "") });
    row = cells.map(
      (v: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
        v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? "",
    );
    return Response.json({ spreadsheetId: input.file, replies: [{}] });
  });
  await writeLedgerSheet({ ...input, expectedDigest: await ledgerRowDigest(input.hashKey, initial) }, { fetch: send });
  expect(calls).toHaveLength(5);
  expect(calls[0]).toContain("!AA:AN");
  expect(calls[1]).toContain("!AA2:AN2");
});
it("불확실한 쓰기의 이벤트와 주문 ID가 이미 있으면 다시 쓰지 않는다", async () => {
  const row = [...input.values, id.replaceAll("-", ""), orderId.replaceAll("-", "")];
  const send = vi.fn(async (raw: string | URL | Request) =>
    decodeURIComponent(String(raw)).includes("fields=sheets")
      ? Response.json({
          sheets: [
            { data: [{ rowData: [{}, { values: row.map((v) => ({ userEnteredValue: { stringValue: v } })) }] }] },
          ],
        })
      : Response.json({ values: [["헤더"], row] }),
  );
  await writeLedgerSheet({ ...input, uncertain: true }, { fetch: send });
  expect(send).toHaveBeenCalledTimes(2);
});
it("전송 후 연결 끊김만 불확실로 분류하고 명백한 요청 거절은 구분한다", async () => {
  const send = (status: "disconnect" | "bad_request") =>
    vi.fn(async (_raw: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET") return Response.json({ values: [["헤더"]] });
      if (status === "disconnect") throw new Error("connection closed");
      return new Response(null, { status: 400 });
    });
  await expect(writeLedgerSheet(input, { fetch: send("disconnect") })).rejects.toBeInstanceOf(LedgerUncertainError);
  await expect(writeLedgerSheet(input, { fetch: send("bad_request") })).rejects.not.toBeInstanceOf(
    LedgerUncertainError,
  );
});
it("사후 확인은 주문번호와 이벤트 ID 열만 읽고 중복을 감지하며 행을 지우지 않는다", async () => {
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe("GET");
    const ids = decodeURIComponent(String(url)).includes("!AM");
    return Response.json({
      values: ids ? [["new"], [id.replaceAll("-", "")]] : [["주문번호"], ["ABC123"], ["ABC123"]],
    });
  });
  expect(await auditLedgerSheet(input, { fetch: send })).toBe("duplicate");
  expect(send).toHaveBeenCalledTimes(2);
});
it("긴 시트 사후 확인의 이벤트 ID 조회는 최근 1만 행으로 제한한다", async () => {
  const rows = Array.from({ length: 10051 }, (_, i) => [i === 0 ? "주문번호" : i === 10050 ? "ABC123" : "OTHER1"]);
  const send = vi.fn(async (raw: string | URL | Request) => {
    const url = decodeURIComponent(String(raw));
    if (url.includes("!AA:AA")) return Response.json({ values: rows });
    expect(url).toContain("!AM52:AM10051");
    return Response.json({ values: [] });
  });
  expect(await auditLedgerSheet(input, { fetch: send })).toBe("ok");
  expect(send).toHaveBeenCalledTimes(2);
});
