import { describe, expect, it, vi } from "vitest";
import { GoogleLedgerUnavailableError } from "../src/ledger-google-auth";
import { LEDGER_HEADERS, signLedgerColumns } from "../src/ledger-sheet-columns";
import { ledgerSheetSetup } from "../src/ledger-sheet-setup";
import { Secret } from "../src/settings";

const shop = "fa0c3210-37b4-4434-8000-000000000001",
  file = "synthetic_sheet_1234567890",
  tab = "합성 장부",
  sheetId = 7;
function fixture() {
  const key = new Secret(crypto.randomUUID() + crypto.randomUUID()),
    access = new Secret(crypto.randomUUID() + crypto.randomUUID());
  let headers: unknown[] = ["주문번호", "사장님 자료"],
    count = 26,
    markers: Record<string, unknown>[] = [],
    lost = false,
    writeStatus = 200,
    badId = false,
    collaborate = false,
    corruptReadback = false;
  const writes: Record<string, unknown>[] = [];
  const send = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://sheets.googleapis.com");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${access.reveal()}`);
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      writes.push(body);
      if (writeStatus !== 200)
        return new Response("synthetic private Google error", {
          status: writeStatus,
          headers: { location: "https://other.example/collect" },
        });
      if (collaborate) {
        headers[26] = "협업자가 방금 넣은 자료";
        count = 27;
      }
      const insert = body.requests[0]?.insertDimension,
        write = body.requests[1]?.updateCells,
        metadata = body.requests[2]?.createDeveloperMetadata?.developerMetadata;
      expect(insert).toEqual({
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: count === 27 ? 26 : count,
          endIndex: (count === 27 ? 26 : count) + 12,
        },
        inheritFromBefore: true,
      });
      const start = insert.range.startIndex;
      headers = Array.from({ length: count }, (_, index) => headers[index] ?? "");
      headers.splice(start, 0, ...Array(12).fill(""));
      count += 12;
      expect(write.fields).toBe("userEnteredValue");
      expect(write.start).toEqual({ sheetId, rowIndex: 0, columnIndex: start });
      expect(write.rows).toEqual([
        { values: LEDGER_HEADERS.map((value) => ({ userEnteredValue: { stringValue: value } })) },
      ]);
      for (let i = 0; i < 12; i++) headers[start + i] = write.rows[0].values[i].userEnteredValue.stringValue;
      expect(metadata.metadataKey).toBe("siljang_columns_v1");
      expect(metadata.visibility).toBe("PROJECT");
      expect(metadata.location.dimensionRange.endIndex - metadata.location.dimensionRange.startIndex).toBe(1);
      markers.push(metadata);
      expect(JSON.stringify(body)).not.toContain(key.reveal());
      expect(JSON.stringify(body)).not.toContain(access.reveal());
      if (lost) throw new Error("synthetic response lost after apply");
      return new Response(
        JSON.stringify({
          spreadsheetId: badId ? "other_file_1234567890" : file,
          replies: [{}, {}, { createDeveloperMetadata: { developerMetadata: metadata } }],
        }),
      );
    }
    if (url.pathname.includes("/values/"))
      return new Response(JSON.stringify({ values: [corruptReadback && writes.length ? ["changed"] : headers] }));
    return new Response(
      JSON.stringify({
        sheets: [
          {
            properties: { sheetId, title: tab, sheetType: "GRID", gridProperties: { columnCount: count } },
            developerMetadata: markers,
          },
        ],
      }),
    );
  });
  const marker = (token: string, start: number) => ({
    metadataKey: "siljang_columns_v1",
    metadataValue: token,
    visibility: "PROJECT",
    location: { dimensionRange: { sheetId, dimension: "COLUMNS", startIndex: start, endIndex: start + 1 } },
  });
  return {
    key,
    access,
    send,
    writes,
    marker,
    get headers() {
      return headers;
    },
    set headers(value: unknown[]) {
      headers = value;
    },
    set count(value: number) {
      count = value;
    },
    set markers(value: Record<string, unknown>[]) {
      markers = value;
    },
    set lost(value: boolean) {
      lost = value;
    },
    set writeStatus(value: number) {
      writeStatus = value;
    },
    set badId(value: boolean) {
      badId = value;
    },
    set collaborate(value: boolean) {
      collaborate = value;
    },
    set corruptReadback(value: boolean) {
      corruptReadback = value;
    },
  };
}
describe("장부 헤더 쓰기: 새 열 삽입/서명/재시도", () => {
  it("기존 표 너비 뒤에 새 열을 삽입하고 헤더/서명 메타데이터를 함께 쓴 뒤 다시 읽는다", async () => {
    const f = fixture(),
      result = await ledgerSheetSetup(f.key, { fetch: f.send }).connect(f.access, shop, file, tab);
    expect(result).toMatchObject({
      sheetId,
      start: 26,
      end: 38,
      movedRight: true,
      columns: LEDGER_HEADERS.map((header, i) => ({ header, column: `A${String.fromCharCode(65 + i)}` })),
    });
    expect(result?.ownershipToken).toMatch(/^c1\./);
    expect(f.writes).toHaveLength(1);
    expect(f.send).toHaveBeenCalledTimes(5);
    expect(f.headers.slice(0, 2)).toEqual(["주문번호", "사장님 자료"]);
  });
  it("읽은 뒤 협업자가 추가한 자료도 새 열 삽입으로 밀어 보존한다", async () => {
    const f = fixture();
    f.collaborate = true;
    expect(await ledgerSheetSetup(f.key, { fetch: f.send }).connect(f.access, shop, file, tab)).not.toBeNull();
    expect(f.headers[38]).toBe("협업자가 방금 넣은 자료");
  });
  it("유효한 자기 서명과 실제 헤더가 있으면 기존 열을 재사용하고 쓰지 않는다", async () => {
    const f = fixture(),
      token = await signLedgerColumns(f.key, { shopId: shop, spreadsheetId: file, sheetId }, 26, true);
    f.count = 38;
    f.headers = [...Array(26).fill(""), ...LEDGER_HEADERS];
    f.markers = [f.marker(token, 26)];
    expect(await ledgerSheetSetup(f.key, { fetch: f.send }).connect(f.access, shop, file, tab)).toMatchObject({
      start: 26,
      end: 38,
      ownershipToken: token,
      movedRight: true,
    });
    expect(f.writes).toHaveLength(0);
  });
  it("열 한도에 닿아도 헤더가 바뀐 후보를 건너뛰고 실제 자기 열을 재사용한다", async () => {
    const f = fixture(),
      valid = await signLedgerColumns(f.key, { shopId: shop, spreadsheetId: file, sheetId }, 26, true),
      changed = await signLedgerColumns(f.key, { shopId: shop, spreadsheetId: file, sheetId }, 10000, false);
    f.count = 18278;
    f.headers = Array(18278).fill("");
    for (let i = 0; i < 12; i++) f.headers[26 + i] = LEDGER_HEADERS[i];
    f.markers = [f.marker(valid, 26), f.marker(changed, 10000)];
    expect(await ledgerSheetSetup(f.key, { fetch: f.send }).connect(f.access, shop, file, tab)).toMatchObject({
      start: 26,
      end: 38,
      ownershipToken: valid,
    });
    expect(f.writes).toHaveLength(0);
  });
  it.each(["forged", "other_shop", "changed_headers"] as const)(
    "%s의 메타데이터/헤더는 덮지 않고 새 열을 쓴다",
    async (kind) => {
      const f = fixture(),
        signed = await signLedgerColumns(
          f.key,
          {
            shopId: kind === "other_shop" ? "fa0c3210-37b4-4434-8000-000000000002" : shop,
            spreadsheetId: file,
            sheetId,
          },
          26,
          true,
        );
      f.count = 38;
      f.headers = [...Array(26).fill(""), ...LEDGER_HEADERS];
      if (kind === "changed_headers") f.headers[26] = "사장님이 바꾼 헤더";
      const before = [...f.headers];
      f.markers = [f.marker(kind === "forged" ? signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A") : signed, 26)];
      expect(await ledgerSheetSetup(f.key, { fetch: f.send }).connect(f.access, shop, file, tab)).toMatchObject({
        start: 38,
        end: 50,
      });
      expect(f.headers.slice(0, 38)).toEqual(before);
      expect(f.writes).toHaveLength(1);
    },
  );
  it("적용 뒤 응답이 유실되면 다음 연결은 서명 열을 재사용해 중복 열을 만들지 않는다", async () => {
    const f = fixture();
    f.lost = true;
    const service = ledgerSheetSetup(f.key, { fetch: f.send });
    await expect(service.connect(f.access, shop, file, tab)).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
    f.lost = false;
    expect(await service.connect(f.access, shop, file, tab)).toMatchObject({ start: 26, end: 38 });
    expect(f.writes).toHaveLength(1);
  });
  it.each([400, 401, 403, 404])("헤더 쓰기 HTTP%s는 연결하지 않는다", async (status) => {
    const f = fixture();
    f.writeStatus = status;
    expect(await ledgerSheetSetup(f.key, { fetch: f.send }).connect(f.access, shop, file, tab)).toBeNull();
    expect(f.writes).toHaveLength(1);
  });
  it.each([302, 429, 503])("헤더 쓰기 HTTP%s는 리디렉션/원문 노출 없이 닫는다", async (status) => {
    const f = fixture();
    f.writeStatus = status;
    const result = ledgerSheetSetup(f.key, { fetch: f.send }).connect(f.access, shop, file, tab);
    await expect(result).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
    await expect(result).rejects.not.toThrow("synthetic private Google error");
    expect(f.writes).toHaveLength(1);
  });
  it("응답의 파일ID가 다르거나 다시 읽은 헤더가 바뀌면 연결하지 않는다", async () => {
    for (const kind of ["bad_id", "readback"]) {
      const f = fixture();
      f.badId = kind === "bad_id";
      f.corruptReadback = kind === "readback";
      await expect(
        ledgerSheetSetup(f.key, { fetch: f.send }).connect(f.access, shop, file, tab),
      ).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
    }
  });
  it("없는 가게 형식은 외부 호출 전에 거절한다", async () => {
    const f = fixture();
    await expect(ledgerSheetSetup(f.key, { fetch: f.send }).connect(f.access, "not-a-uuid", file, tab)).rejects.toThrow(
      TypeError,
    );
    expect(f.send).not.toHaveBeenCalled();
  });
});
