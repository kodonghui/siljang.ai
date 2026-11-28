import { describe, expect, it, vi } from "vitest";
import { GoogleLedgerUnavailableError } from "../src/ledger-google-auth";
import { googleLedgerSheets } from "../src/ledger-google-sheet";
import { Secret } from "../src/settings";

const file = "synthetic_sheet_1234567890",
  tab = "사장님 '장부' ! A1",
  key = "siljang_columns_v1";
function token() {
  return new Secret(crypto.randomUUID() + crypto.randomUUID());
}
function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function metadata() {
  return {
    sheets: [
      {
        properties: { sheetId: 7, title: tab, sheetType: "GRID", gridProperties: { columnCount: 26 } },
        developerMetadata: [] as Record<string, unknown>[],
      },
    ],
  };
}
function sequence(values: Response[]) {
  const send = vi.fn(async () => {
    const value = values.shift();
    if (!value) throw new Error("unexpected extra Google request");
    return value;
  });
  return send;
}
describe("구글 장부 조회: 고정 주소/첫 행/토큰 비노출", () => {
  it("고른 탭의 메타데이터와 첫 행만 읽고 토큰은 Authorization 헤더에만 넣는다", async () => {
    const access = token(),
      send = sequence([
        reply(metadata()),
        reply({ range: "ignored", majorDimension: "ROWS", values: [["주문번호", 7, true]] }),
      ]);
    const result = await googleLedgerSheets({ fetch: send }).inspect(access, file, tab);
    expect(result).toEqual({
      sheetId: 7,
      sheetName: tab,
      columnCount: 26,
      headers: ["주문번호", 7, true],
      markers: [],
    });
    expect(send).toHaveBeenCalledTimes(2);
    const calls = send.mock.calls as unknown as [string, RequestInit][];
    for (const [url, init] of calls) {
      expect(new URL(url).origin).toBe("https://sheets.googleapis.com");
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${access.reveal()}`);
      expect(url).not.toContain(access.reveal());
      expect(init.body).toBeUndefined();
    }
    const first = new URL(calls[0]?.[0] ?? "");
    expect(first.pathname).toBe(`/v4/spreadsheets/${file}`);
    expect(first.searchParams.get("fields")).toContain("developerMetadata");
    expect(first.searchParams.get("fields")).not.toContain("rowData");
    const second = new URL(calls[1]?.[0] ?? "");
    expect(decodeURIComponent(second.pathname)).toBe(`/v4/spreadsheets/${file}/values/'사장님 ''장부'' ! A1'!1:1`);
    expect(second.searchParams.get("valueRenderOption")).toBe("UNFORMATTED_VALUE");
    expect(JSON.stringify(result)).not.toContain(access.reveal());
  });
  it("기존 장부는 같은 토큰으로 Drive의 파일 편집 권한을 확인한다", async () => {
    const access = token();
    const send = sequence([
      reply({ id: file, mimeType: "application/vnd.google-apps.spreadsheet", capabilities: { canEdit: true } }),
    ]);
    expect(await googleLedgerSheets({ fetch: send }).canEdit(access, file)).toBe(true);
    const [address, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(address);
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(url.pathname).toBe(`/drive/v3/files/${file}`);
    expect(url.searchParams.get("fields")).toBe("id,mimeType,capabilities(canEdit)");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${access.reveal()}`);
    expect(address).not.toContain(access.reveal());
  });
  it("Drive의 읽기 전용·권한 거절은 재연결을 거부하고 잘못된 응답은 오류로 닫는다", async () => {
    for (const response of [
      reply({ id: file, mimeType: "application/vnd.google-apps.spreadsheet", capabilities: { canEdit: false } }),
      reply({}, 403),
      reply({}, 404),
    ])
      expect(await googleLedgerSheets({ fetch: sequence([response]) }).canEdit(token(), file)).toBe(false);
    for (const response of [
      reply({ id: "other", mimeType: "application/vnd.google-apps.spreadsheet", capabilities: { canEdit: true } }),
      reply({ id: file, mimeType: "application/vnd.google-apps.spreadsheet" }),
      reply({}, 503),
    ])
      await expect(googleLedgerSheets({ fetch: sequence([response]) }).canEdit(token(), file)).rejects.toBeInstanceOf(
        GoogleLedgerUnavailableError,
      );
  });
  it("빈 첫 행도 자료 아래를 덮지 않도록 실제 표 너비를 유지한다", async () => {
    const send = sequence([reply(metadata()), reply({})]);
    expect(await googleLedgerSheets({ fetch: send }).inspect(token(), file, tab)).toMatchObject({
      columnCount: 26,
      headers: [],
    });
  });
  it("서명 검증에 넘길 후보만 고른 탭의 PROJECT 열 메타데이터에서 추린다", async () => {
    const data = metadata();
    const valid = {
      metadataKey: key,
      metadataValue: "c1.fixture.signed",
      visibility: "PROJECT",
      location: { dimensionRange: { sheetId: 7, dimension: "COLUMNS", startIndex: 2, endIndex: 3 } },
    };
    const selected = data.sheets[0];
    if (!selected) throw new Error("합성 탭 없음");
    selected.developerMetadata = [
      valid,
      { ...valid, metadataKey: "other" },
      { ...valid, visibility: "DOCUMENT" },
      { ...valid, location: { dimensionRange: { ...valid.location.dimensionRange, sheetId: 8 } } },
      { ...valid, location: { dimensionRange: { ...valid.location.dimensionRange, endIndex: 27 } } },
    ];
    const result = await googleLedgerSheets({ fetch: sequence([reply(data), reply({})]) }).inspect(token(), file, tab);
    expect(result?.markers).toEqual([{ token: "c1.fixture.signed", start: 2, end: 14 }]);
  });
  it.each([400, 401, 403, 404])("메타데이터 HTTP%s는 연결하지 않고 오류 본문을 반환하지 않는다", async (status) => {
    const send = sequence([reply({ error: crypto.randomUUID() }, status)]);
    expect(await googleLedgerSheets({ fetch: send }).inspect(token(), file, tab)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("첫 행의 권한 거절도 연결하지 않는다", async () => {
    const send = sequence([reply(metadata()), reply({ error: "synthetic" }, 403)]);
    expect(await googleLedgerSheets({ fetch: send }).inspect(token(), file, tab)).toBeNull();
  });
  it.each([302, 307, 429, 500, 503])("HTTP%s의 리디렉션/오류 본문은 따르거나 노출하지 않는다", async (status) => {
    const hidden = crypto.randomUUID(),
      send = sequence([new Response(hidden, { status, headers: { Location: "https://other.example/collect" } })]),
      result = googleLedgerSheets({ fetch: send }).inspect(token(), file, tab);
    await expect(result).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
    await expect(result).rejects.not.toThrow(hidden);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("탭이 없거나 GRID가 아니면 첫 행을 읽지 않는다", async () => {
    for (const data of [
      { sheets: [] },
      { sheets: [{ properties: { sheetId: 7, title: tab, sheetType: "OBJECT" } }] },
    ]) {
      const send = sequence([reply(data)]);
      expect(await googleLedgerSheets({ fetch: send }).inspect(token(), file, tab)).toBeNull();
      expect(send).toHaveBeenCalledTimes(1);
    }
  });
  it.each([
    null,
    [],
    {},
    { sheets: "wrong" },
    { sheets: [{ properties: { sheetId: 7, title: tab, sheetType: "GRID", gridProperties: { columnCount: 18279 } } }] },
  ])("잘못된 메타데이터 %j는 서비스 오류로 닫는다", async (data) => {
    await expect(
      googleLedgerSheets({ fetch: sequence([reply(data)]) }).inspect(token(), file, tab),
    ).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
  });
  it.each([{ values: "wrong" }, { values: [["a"], ["b"]] }, { values: [[{}]] }, { values: [Array(27).fill("x")] }])(
    "잘못된 첫 행 %j는 연결하지 않는다",
    async (data) => {
      await expect(
        googleLedgerSheets({ fetch: sequence([reply(metadata()), reply(data)]) }).inspect(token(), file, tab),
      ).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
    },
  );
  it("너무 큰 응답과 통신/시간 초과는 원래 오류나 토큰 없이 서비스 오류다", async () => {
    const hidden = crypto.randomUUID();
    for (const send of [
      async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
      async () => {
        throw new Error(hidden);
      },
      async () => {
        throw new DOMException(hidden, "TimeoutError");
      },
    ]) {
      const result = googleLedgerSheets({ fetch: send }).inspect(token(), file, tab);
      await expect(result).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
      await expect(result).rejects.not.toThrow(hidden);
    }
  });
  it.each(["https://other.example/collect", "../bad-file", ""])(
    "설정 밖 파일ID %s는 호출 전에 거절한다",
    async (id) => {
      const send = vi.fn();
      await expect(googleLedgerSheets({ fetch: send }).inspect(token(), id, tab)).rejects.toThrow(TypeError);
      expect(send).not.toHaveBeenCalled();
    },
  );
});
