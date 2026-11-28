import { expect, it } from "vitest";
import { writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

const file = "synthetic_sheet_1234567890",
  orderId = crypto.randomUUID(),
  otherId = crypto.randomUUID(),
  eventId = crypto.randomUUID();
const input = {
  file,
  tab: "장부",
  access: new Secret("fake"),
  setup: { sheetId: 1, start: 0, end: 14, movedRight: false, ownershipToken: "test", columns: [] },
  values: ["ABC123", "이름", "", "", "", "", 0, "", "", 0, "", ""],
  shopId: crypto.randomUUID(),
  linkId: crypto.randomUUID(),
  eventId,
  orderId,
};
const prior = (order: string, id: string) => [
  order,
  `기존 ${order}`,
  "",
  "",
  "",
  "",
  0,
  "",
  "",
  0,
  "",
  "",
  "event",
  id.replaceAll("-", ""),
];

it("다른 주문이 대상 위치로 이동해 덮였으면 원래 값을 빈 행에 되살리고 알린다", async () => {
  let rows: (string | number)[][] = [prior("ABC123", orderId), prior("XYZ789", otherId)];
  const beforeOther = prior("XYZ789", otherId);
  let writes = 0,
    reads = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") {
      reads++;
      const path = decodeURIComponent(String(raw));
      if (path.includes("!A:A")) return Response.json({ values: [["주문번호"], ...rows.map((r) => [r[0]])] });
      if (path.includes("!N")) return Response.json({ values: rows.map((r) => [r[13]]) });
      return Response.json({ values: [["header"], ...rows] });
    }
    const req = JSON.parse(String(init?.body)).requests[0];
    writes++;
    if (writes === 1) {
      rows = [rows[1] ?? [], rows[0] ?? []];
      rows[0] = req.updateCells.rows[0].values.map(
        (v: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
          v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? "",
      );
    } else if (req.appendCells)
      rows.push(
        req.appendCells.rows[0].values.map(
          (v: { userEnteredValue?: { stringValue?: string; numberValue?: number } }) =>
            v.userEnteredValue?.stringValue ?? v.userEnteredValue?.numberValue ?? "",
        ),
      );
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(input, { fetch: send })).rejects.toThrow();
  expect(rows).toContainEqual(beforeOther);
  expect(writes).toBe(2);
  expect(reads).toBe(4);
});
it("우리 열 5000행을 넘으면 어떠한 쓰기도 하지 않는다", async () => {
  let writes = 0;
  const rows = Array.from({ length: 5002 }, (_, i) => [i === 0 ? "주문번호" : `X${String(i).padStart(6, "0")}`]);
  const send = async (_raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") return Response.json({ values: rows });
    writes++;
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(input, { fetch: send })).rejects.toThrow();
  expect(writes).toBe(0);
});
it("다른 주문의 우리 열이 수정되면 덮어쓰거나 복원하지 않고 멈춘다", async () => {
  const rows: (string | number)[][] = [prior("ABC123", orderId), prior("XYZ789", otherId)];
  let writes = 0,
    reads = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") {
      reads++;
      if (decodeURIComponent(String(raw)).includes("!N2:N2"))
        return Response.json({ values: [[orderId.replaceAll("-", "")]] });
      return Response.json({ values: [["header"], ...rows] });
    }
    writes++;
    const req = JSON.parse(String(init?.body)).requests[0];
    rows[0] = req.updateCells.rows[0].values.map(
      (v: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
        v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? "",
    );
    rows[1] = [...(rows[1] ?? [])];
    rows[1][1] = "사장님 수정";
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(input, { fetch: send })).rejects.toThrow();
  expect(writes).toBe(1);
  expect(rows[1]?.[1]).toBe("사장님 수정");
  expect(reads).toBe(3);
});
it("쓰기 직전 주문 ID가 다르면 쓰지 않고 멈춘다", async () => {
  let writes = 0;
  const row = prior("ABC123", orderId);
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET")
      return Response.json({
        values: decodeURIComponent(String(raw)).includes("!N2:N2")
          ? [[otherId.replaceAll("-", "")]]
          : [["header"], row],
      });
    writes++;
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(input, { fetch: send })).rejects.toThrow();
  expect(writes).toBe(0);
});
