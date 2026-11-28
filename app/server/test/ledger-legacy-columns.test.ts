import { expect, it, vi } from "vitest";
import { toBase64Url } from "../src/encoding";
import { LEDGER_HEADERS, LEDGER_STORAGE_HEADERS, signLedgerColumns } from "../src/ledger-sheet-columns";
import { ledgerSheetSetup } from "../src/ledger-sheet-setup";
import { Secret } from "../src/settings";

it.each(["끝", "사장님 열 뒤에 있음", "응답 유실", "ID 열 삭제"])(
  "기존 서명된 열을 유지하고 숨김 ID 열을 더한다: %s",
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
        expect(req[0].insertDimension.range).toEqual({ sheetId, dimension: "COLUMNS", startIndex: 14, endIndex: 16 });
        expect(req[1].updateCells.start.columnIndex).toBe(14);
        expect(req[2].updateDimensionProperties.properties.hiddenByUser).toBe(true);
        expect(req[3].updateDeveloperMetadata.dataFilters[0].developerMetadataLookup.metadataValue).toBe(token);
        token = req[3].updateDeveloperMetadata.developerMetadata.metadataValue;
        headers.splice(14, 0, ...LEDGER_STORAGE_HEADERS.slice(12));
        count += 2;
        if (scenario === "응답 유실") throw new Error("response lost");
        return Response.json({ spreadsheetId: file, replies: [{}, {}, {}, {}] });
      }
      if (url.pathname.includes("/values/")) return Response.json({ values: [headers] });
      return Response.json({
        sheets: [
          {
            properties: {
              sheetId,
              title: "장부",
              sheetType: "GRID",
              gridProperties: { columnCount: count, rowCount: 5000 },
            },
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
    expect(setup).toMatchObject({ start, end: 16, movedRight: true });
    expect(headers.slice(start, 16)).toEqual(LEDGER_STORAGE_HEADERS);
    if (scenario === "사장님 열 뒤에 있음") expect(headers[16]).toBe("별도 자료");
    expect(writes).toBe(1);
  },
);

it("쓰기가 꺼진 기존 시트는 열 한도에 닿아도 서명된 12열만 재연결하고 쓰지 않는다", async () => {
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
  const token = `c1.${start.toString(36)}.1.${toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", hmac, bytes)))}`;
  let writes = 0;
  const fetch = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(raw));
    if (init?.method === "POST") {
      writes++;
      throw new Error("숨김 열 추가 금지");
    }
    if (url.origin === "https://www.googleapis.com")
      return Response.json({
        id: file,
        mimeType: "application/vnd.google-apps.spreadsheet",
        capabilities: { canEdit: true },
      });
    if (url.pathname.includes("/values/")) return Response.json({ values: [["기존 자료", "", ...LEDGER_HEADERS]] });
    return Response.json({
      sheets: [
        {
          properties: {
            sheetId,
            title: "장부",
            sheetType: "GRID",
            gridProperties: { columnCount: 18278, rowCount: 5000 },
          },
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
  const setup = await ledgerSheetSetup(key, { fetch }).connect(access, shop, file, "장부", { purpose: "link" });
  expect(setup).toMatchObject({ start: 2, end: 14, movedRight: true, ownershipToken: token });
  expect(setup?.columns).toHaveLength(12);
  expect(writes).toBe(0);
});

it("새 연결도 쓰기 전에는 서명된 12열만 만들고 나중에 첫 쓰기 때 숨김 열을 넣는다", async () => {
  const shop = crypto.randomUUID(),
    file = "synthetic_sheet_1234567890",
    sheetId = 7,
    key = new Secret("synthetic key"),
    access = new Secret("synthetic-access");
  let headers: unknown[] = [],
    count = 26,
    token = "",
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
      if (writes === 1) {
        expect(req).toHaveLength(3);
        expect(req[0].insertDimension.range).toMatchObject({ startIndex: 26, endIndex: 38 });
        expect(
          req[1].updateCells.rows[0].values.map(
            (x: { userEnteredValue: { stringValue: string } }) => x.userEnteredValue.stringValue,
          ),
        ).toEqual(LEDGER_HEADERS);
        token = req[2].createDeveloperMetadata.developerMetadata.metadataValue;
        headers = [...Array(26).fill(""), ...LEDGER_HEADERS];
        count = 38;
        return Response.json({ spreadsheetId: file, replies: [{}, {}, {}] });
      }
      expect(req).toHaveLength(4);
      expect(req[0].insertDimension.range).toMatchObject({ startIndex: 38, endIndex: 40 });
      token = req[3].updateDeveloperMetadata.developerMetadata.metadataValue;
      headers = [...headers, ...LEDGER_STORAGE_HEADERS.slice(12)];
      count = 40;
      return Response.json({ spreadsheetId: file, replies: [{}, {}, {}, {}] });
    }
    if (url.pathname.includes("/values/")) return Response.json({ values: [headers] });
    return Response.json({
      sheets: [
        {
          properties: {
            sheetId,
            title: "장부",
            sheetType: "GRID",
            gridProperties: { columnCount: count, rowCount: 5000 },
          },
          developerMetadata: token
            ? [
                {
                  metadataKey: "siljang_columns_v1",
                  metadataValue: token,
                  visibility: "PROJECT",
                  location: { dimensionRange: { sheetId, dimension: "COLUMNS", startIndex: 26, endIndex: 27 } },
                },
              ]
            : [],
        },
      ],
    });
  });
  const service = ledgerSheetSetup(key, { fetch });
  expect(await service.connect(access, shop, file, "장부", { purpose: "link" })).toMatchObject({ start: 26, end: 38 });
  expect(writes).toBe(1);
  expect(await service.connect(access, shop, file, "장부", { purpose: "write" })).toMatchObject({ start: 26, end: 40 });
  expect(writes).toBe(2);
});
