import { readBytesLimited } from "./body";
import { GoogleLedgerUnavailableError } from "./ledger-google-auth";
import { LEDGER_HEADERS, LEDGER_MAX_COLUMNS } from "./ledger-sheet-columns";
import type { Secret } from "./settings";

export interface LedgerSheetSnapshot {
  readonly sheetId: number;
  readonly sheetName: string;
  readonly columnCount: number;
  readonly headers: readonly unknown[];
  readonly markers: readonly { readonly token: string; readonly start: number; readonly end: number }[];
}
const DENIED = Symbol("sheet not accessible"),
  MAX_BYTES = 2 * 1024 * 1024;
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function googleLedgerSheets(options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {}) {
  const send = options.fetch ?? fetch;
  async function read(url: URL, accessToken: Secret): Promise<unknown> {
    const response = await send(url.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      headers: { Authorization: `Bearer ${accessToken.reveal()}` },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([400, 401, 403, 404].includes(response.status)) return DENIED;
      throw new GoogleLedgerUnavailableError();
    }
    const bytes = await readBytesLimited(response, MAX_BYTES, () => new GoogleLedgerUnavailableError());
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return {
    async inspect(accessToken: Secret, spreadsheetId: string, sheetName: string): Promise<LedgerSheetSnapshot | null> {
      if (
        !/^[A-Za-z0-9_-]{20,100}$/.test(spreadsheetId) ||
        [...sheetName].length < 1 ||
        [...sheetName].length > 100 ||
        [...sheetName].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
        !accessToken.reveal() ||
        [...accessToken.reveal()].some((char) => char.charCodeAt(0) < 33 || char.charCodeAt(0) > 126)
      )
        throw new TypeError("invalid Google ledger target");
      try {
        const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
          url = new URL(base);
        url.searchParams.set(
          "fields",
          "sheets(properties(sheetId,title,sheetType,gridProperties(columnCount)),developerMetadata(metadataKey,metadataValue,location,visibility))",
        );
        const raw = await read(url, accessToken);
        if (raw === DENIED) return null;
        const data = object(raw);
        if (!data || !Array.isArray(data.sheets)) throw new GoogleLedgerUnavailableError();
        const matches = data.sheets.filter((sheet: unknown) => object(object(sheet)?.properties)?.title === sheetName);
        if (matches.length === 0) return null;
        if (matches.length !== 1) throw new GoogleLedgerUnavailableError();
        const selected = object(matches[0]),
          props = object(selected?.properties),
          grid = object(props?.gridProperties);
        if (props?.sheetType !== "GRID") return null;
        const sheetId = props.sheetId,
          columnCount = grid?.columnCount;
        if (
          typeof sheetId !== "number" ||
          !Number.isSafeInteger(sheetId) ||
          sheetId < 0 ||
          sheetId > 2147483647 ||
          typeof columnCount !== "number" ||
          !Number.isSafeInteger(columnCount) ||
          columnCount < 1 ||
          columnCount > LEDGER_MAX_COLUMNS
        )
          throw new GoogleLedgerUnavailableError();
        const markers: { token: string; start: number; end: number }[] = [];
        if (selected?.developerMetadata !== undefined && !Array.isArray(selected.developerMetadata))
          throw new GoogleLedgerUnavailableError();
        for (const value of (selected?.developerMetadata ?? []) as unknown[]) {
          const entry = object(value),
            range = object(object(entry?.location)?.dimensionRange),
            start = range?.startIndex,
            end = range?.endIndex;
          if (
            entry?.metadataKey !== "siljang_columns_v1" ||
            entry.visibility !== "PROJECT" ||
            typeof entry.metadataValue !== "string" ||
            entry.metadataValue.length > 200 ||
            range?.sheetId !== sheetId ||
            range.dimension !== "COLUMNS" ||
            typeof start !== "number" ||
            !Number.isSafeInteger(start) ||
            start < 0 ||
            typeof end !== "number" ||
            !Number.isSafeInteger(end) ||
            end !== start + 1 ||
            start + LEDGER_HEADERS.length > columnCount
          )
            continue;
          markers.push({ token: entry.metadataValue, start, end: start + LEDGER_HEADERS.length });
        }
        const headerUrl = new URL(`${base}/values/${encodeURIComponent(`'${sheetName.replaceAll("'", "''")}'!1:1`)}`);
        headerUrl.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
        headerUrl.searchParams.set("majorDimension", "ROWS");
        headerUrl.searchParams.set("fields", "values,majorDimension");
        const headerRaw = await read(headerUrl, accessToken);
        if (headerRaw === DENIED) return null;
        const headerData = object(headerRaw);
        if (!headerData) throw new GoogleLedgerUnavailableError();
        const rows = headerData.values ?? [];
        if (!Array.isArray(rows) || rows.length > 1 || (rows.length === 1 && !Array.isArray(rows[0])))
          throw new GoogleLedgerUnavailableError();
        const headers = (rows[0] ?? []) as unknown[];
        if (
          headers.length > columnCount ||
          headers.some(
            (value) =>
              !(
                typeof value === "string" ||
                typeof value === "boolean" ||
                (typeof value === "number" && Number.isFinite(value))
              ),
          )
        )
          throw new GoogleLedgerUnavailableError();
        return { sheetId, sheetName, columnCount, headers: [...headers], markers };
      } catch {
        throw new GoogleLedgerUnavailableError();
      }
    },
  };
}
