import { expect, it, vi } from "vitest";
import { toBase64Url } from "../src/encoding";
import { LEDGER_HEADERS, LEDGER_STORAGE_HEADERS, signLedgerColumns } from "../src/ledger-sheet-columns";
import { ledgerSheetSetup } from "../src/ledger-sheet-setup";
import { Secret } from "../src/settings";

it.each(["끝", "사장님 열 뒤에 있음", "응답 유실", "ID 열 삭제"])(
  "기존 서명된 열을 유지하고 숨김 ID 열 하나만 더한다: %s",
  async (scenario) => {
    const shop = crypto.randomUUID(),
      file = "synthetic_sheet_1234567890",
      sheetId = 7,
      start = 2;
    const key = new Secret("synthetic key"),
      access = new Secret("synthetic-access");
    const hmac = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(key.reveal()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = new TextEncoder().encode(
      JSON.stringify(["ledger-columns", 1, shop, file, sheetId, start, start + 12, true, LEDGER_HEADERS]),
    );
    const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", hmac, bytes)));
    let token =
      scenario === "ID 열 삭제"
        ? await signLedgerColumns(key, { shopId: shop, spreadsheetId: file, sheetId }, start, true)
        : `c1.${start.toString(36)}.1.${signature}`;
    let headers = ["사장님 자료", "", ...LEDGER_HEADERS, ...(scenario === "사장님 열 뒤에 있음" ? ["별도 자료"] : [])],
      count = headers.length,
      writes = 0;
    const fetch = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(raw));
      if (url.origin === "https://www.googleapis.com")
        return Response.json({
          id: file,
          mimeType: "application/vnd.google-apps.spreadsheet",
          capabilities: { canEdit: true },
        });
      if (init?.method === "POST") {
        writes++;
        const req = JSON.parse(String(init.body)).requests;
        expect(req[0].insertDimension.range).toEqual({ sheetId, dimension: "COLUMNS", startIndex: 14, endIndex: 15 });
        expect(req[1].updateCells.start.columnIndex).toBe(14);
        expect(req[2].updateDimensionProperties.properties.hiddenByUser).toBe(true);
        expect(req[3].updateDeveloperMetadata.dataFilters[0].developerMetadataLookup.metadataValue).toBe(token);
        token = req[3].updateDeveloperMetadata.developerMetadata.metadataValue;
        headers.splice(14, 0, LEDGER_STORAGE_HEADERS[12]);
        count++;
        if (scenario === "응답 유실") throw new Error("response lost");
        return Response.json({ spreadsheetId: file, replies: [{}, {}, {}, {}] });
      }
      if (url.pathname.includes("/values/")) return Response.json({ values: [headers] });
      return Response.json({
        sheets: [
          {
            properties: { sheetId, title: "장부", sheetType: "GRID", gridProperties: { columnCount: count } },
            developerMetadata: [
              {
                metadataKey: "siljang_columns_v1",
                metadataValue: token,
                visibility: "PROJECT",
                location: { dimensionRange: { sheetId, dimension: "COLUMNS", startIndex: start, endIndex: start + 1 } },
              },
            ],
          },
        ],
      });
    });
    const service = ledgerSheetSetup(key, { fetch });
    if (scenario === "응답 유실") await expect(service.connect(access, shop, file, "장부")).rejects.toThrow();
    const setup = await service.connect(access, shop, file, "장부");
    expect(setup).toMatchObject({ start, end: 15, movedRight: true });
    expect(headers.slice(start, 15)).toEqual(LEDGER_STORAGE_HEADERS);
    if (scenario === "사장님 열 뒤에 있음") expect(headers[15]).toBe("별도 자료");
    expect(writes).toBe(1);
  },
);
