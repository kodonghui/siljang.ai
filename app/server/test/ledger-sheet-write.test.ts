import { expect, it, vi } from "vitest";
import { auditLedgerSheet, type LedgerCheckpoint, writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

it("늦은 최초 추가와 재시도로 중복되면 삭제하지 않고 사후 확인이 발견한다", async () => {
  const eventId = crypto.randomUUID(),
    orderId = crypto.randomUUID(),
    file = "synthetic_sheet_1234567890";
  const input = {
    file,
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
    eventId,
    orderId,
    values: ["ABC123", "이름", "010-0000-0000", "", "", "", 1000, "", "", 0, "", ""],
  };
  const wanted = [...input.values, eventId.replaceAll("-", ""), orderId.replaceAll("-", "")];
  const rows: (string | number)[][] = [];
  let saved: LedgerCheckpoint | null = null;
  let late: (() => void) | null = null,
    first = true,
    writes = 0;
  const send = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") {
      const url = decodeURIComponent(String(raw));
      if (url.includes("!A5000:AN")) return Response.json({ values: [] });
      if (url.includes("!AA:AA")) return Response.json({ values: [["주문번호"], ...rows.map((r) => [r[0]])] });
      if (url.includes("!AM")) return Response.json({ values: rows.map((r) => [r[12]]) });
      return Response.json({ values: [["헤더"], ...rows] });
    }
    writes++;
    if (first) {
      first = false;
      late = () => rows.push([...wanted]);
      throw new Error("timeout");
    }
    rows.push([...wanted]);
    return Response.json({ spreadsheetId: file, replies: [{}] });
  });
  await expect(
    writeLedgerSheet(
      {
        ...input,
        saveCheckpoint: async (value) => {
          saved = value;
        },
      },
      { fetch: send },
    ),
  ).rejects.toThrow();
  await writeLedgerSheet({ ...input, uncertain: true, checkpoint: saved }, { fetch: send });
  if (late) (late as () => void)();
  expect(rows).toHaveLength(2);
  expect(await auditLedgerSheet(input, { fetch: send })).toBe("duplicate");
  expect(rows).toHaveLength(2);
  expect(writes).toBe(2);
});
