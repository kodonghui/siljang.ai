import { expect, it, vi } from "vitest";
import { auditLedgerSheet, writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

it("늦은 최초 추가와 재시도로 중복되면 삭제하지 않고 사후 확인이 발견한다", async () => {
  const eventId = crypto.randomUUID(),
    token = eventId.replaceAll("-", ""),
    file = "synthetic_sheet_1234567890";
  const input = {
    file,
    tab: "장부",
    access: new Secret("fake"),
    setup: { sheetId: 7, start: 26, end: 39, movedRight: false, ownershipToken: "proof", columns: [] },
    shopId: crypto.randomUUID(),
    linkId: crypto.randomUUID(),
    eventId,
    values: ["ABC123", "이름", "010-0000-0000", "", "", "", 1000, "", "", 0, "", ""],
  };
  const rows: { order: string; id: string }[] = [];
  let late: (() => void) | null = null,
    first = true,
    writes = 0;
  const send = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") {
      const isId = decodeURIComponent(String(raw)).includes("!AM");
      return Response.json({
        values: [...(isId ? [] : [["주문번호"]]), ...rows.map((row) => [isId ? row.id : row.order])],
      });
    }
    writes++;
    if (first) {
      first = false;
      late = () => {
        rows.push({ order: "ABC123", id: token });
      };
      throw new Error("timeout");
    }
    rows.push({ order: "ABC123", id: token });
    return Response.json({ spreadsheetId: file, replies: [{}] });
  });
  await expect(writeLedgerSheet(input, { fetch: send })).rejects.toThrow();
  await writeLedgerSheet({ ...input, uncertain: true }, { fetch: send });
  if (late) (late as () => void)();
  expect(rows).toHaveLength(2);
  expect(await auditLedgerSheet(input, { fetch: send })).toBe("duplicate");
  expect(rows).toHaveLength(2);
  expect(writes).toBe(2);
});
