import { expect, it } from "vitest";
import { writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

it("행 조회 직후 다른 주문이 그 위치로 이동해도 덮어쓰지 않는다", async () => {
  let otherOrderOverwritten = false;
  const file = "synthetic_sheet_1234567890";
  const send = async (_raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") return Response.json({ values: [["주문번호"], ["ABC123"]] });
    // 마지막 확인 다음과 서버 쓰기 적용 사이에 사장님이 행을 정렬한다.
    const actualOrderAtTarget: string = String("XYZ789");
    const request = JSON.parse(String(init?.body));
    if (request.requests[0]?.updateCells && actualOrderAtTarget !== "ABC123") otherOrderOverwritten = true;
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await writeLedgerSheet(
    {
      file,
      tab: "장부",
      access: new Secret("fake"),
      setup: { sheetId: 1, start: 0, end: 13, movedRight: false, ownershipToken: "test", columns: [] },
      values: ["ABC123", "", "", "", "", "", 0, "", "", 0, "", ""],
      shopId: crypto.randomUUID(),
      linkId: crypto.randomUUID(),
      eventId: crypto.randomUUID(),
    },
    { fetch: send },
  );
  expect(otherOrderOverwritten).toBe(false);
});
