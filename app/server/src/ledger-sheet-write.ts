import { readBytesLimited } from "./body";
import { GoogleLedgerUnavailableError } from "./ledger-google-auth";
import { LEDGER_HEADERS, LEDGER_STORAGE_HEADERS, ledgerColumnName } from "./ledger-sheet-columns";
import type { LedgerSheetSetup } from "./ledger-sheet-setup";
import type { Secret } from "./settings";
import { isUuid } from "./shop-scope";

export class LedgerDuplicateError extends Error {
  override readonly name = "LedgerDuplicateError";
}
export class LedgerUncertainError extends Error {
  override readonly name = "LedgerUncertainError";
}
class LedgerDefiniteError extends Error {}

/** 중복을 탐지할 뿐 시트의 행을 삭제하거나 수정하지 않는다. */
export async function auditLedgerSheet(
  input: Parameters<typeof writeLedgerSheet>[0],
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<"ok" | "duplicate" | "missing"> {
  if (
    !/^[A-Za-z0-9_-]{20,100}$/.test(input.file) ||
    !/^[0-9A-Z]{6,8}$/.test(String(input.values[0])) ||
    input.setup.end !== input.setup.start + LEDGER_STORAGE_HEADERS.length ||
    !isUuid(input.eventId)
  )
    throw new TypeError("invalid ledger audit");
  const tab = `'${input.tab.replaceAll("'", "''")}'`,
    base = `https://sheets.googleapis.com/v4/spreadsheets/${input.file}/values/`;
  async function read(index: number, start?: number, end?: number): Promise<unknown[][]> {
    const column = ledgerColumnName(index),
      range = start === undefined ? `${column}:${column}` : `${column}${start}:${column}${end}`,
      url = new URL(base + encodeURIComponent(`${tab}!${range}`));
    url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    const response = await (options.fetch ?? fetch)(url.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      headers: { Authorization: `Bearer ${input.access.reveal()}` },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new GoogleLedgerUnavailableError();
    }
    const raw: unknown = JSON.parse(
      new TextDecoder().decode(
        await readBytesLimited(response, 2 * 1024 * 1024, () => new GoogleLedgerUnavailableError()),
      ),
    );
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new GoogleLedgerUnavailableError();
    const rows = (raw as Record<string, unknown>).values ?? [];
    if (!Array.isArray(rows) || rows.length > 100000 || rows.some((row) => !Array.isArray(row) || row.length > 1))
      throw new GoogleLedgerUnavailableError();
    return rows as unknown[][];
  }
  try {
    const orders = await read(input.setup.start),
      lastRow = Math.max(2, orders.length),
      ids = await read(input.setup.end - 1, Math.max(2, lastRow - 9999), lastRow),
      event = input.eventId.replaceAll("-", "").toLowerCase();
    const idCount = ids.filter((row) => row[0] === event).length;
    const orderCount = orders.filter((row, index) => index > 0 && row[0] === input.values[0]).length;
    if (idCount > 1 || orderCount > 1) return "duplicate";
    return orderCount === 0 ? "missing" : "ok";
  } catch {
    throw new GoogleLedgerUnavailableError();
  }
}

/** 주문번호 열만 조회하고 숨김 ID는 불확실할 때만 조회한다. */
export async function writeLedgerSheet(
  input: {
    readonly file: string;
    readonly tab: string;
    readonly access: Secret;
    readonly setup: LedgerSheetSetup;
    readonly values: readonly (string | number)[];
    readonly shopId: string;
    readonly linkId: string;
    readonly eventId: string;
    readonly uncertain?: boolean;
  },
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<void> {
  if (
    !/^[A-Za-z0-9_-]{20,100}$/.test(input.file) ||
    !/^[0-9A-Z]{6,8}$/.test(String(input.values[0])) ||
    input.values.length !== LEDGER_HEADERS.length ||
    input.setup.end !== input.setup.start + LEDGER_STORAGE_HEADERS.length ||
    !isUuid(input.shopId) ||
    !isUuid(input.linkId) ||
    !isUuid(input.eventId) ||
    input.tab.length < 1 ||
    input.tab.length > 100
  )
    throw new TypeError("invalid ledger row");
  const first = ledgerColumnName(input.setup.start),
    tab = `'${input.tab.replaceAll("'", "''")}'`,
    base = `https://sheets.googleapis.com/v4/spreadsheets/${input.file}`,
    send = options.fetch ?? fetch;
  async function request(
    url: string,
    method: string,
    body?: string,
    allowMissing = false,
  ): Promise<Record<string, unknown> | null> {
    const response = await send(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      headers: {
        Authorization: `Bearer ${input.access.reveal()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (allowMissing && response.status === 404) return null;
      if (response.status >= 400 && response.status < 500 && response.status !== 408) throw new LedgerDefiniteError();
      throw new GoogleLedgerUnavailableError();
    }
    const raw: unknown = JSON.parse(
      new TextDecoder().decode(
        await readBytesLimited(response, 2 * 1024 * 1024, () => new GoogleLedgerUnavailableError()),
      ),
    );
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new GoogleLedgerUnavailableError();
    return raw as Record<string, unknown>;
  }
  try {
    const eventId = input.eventId.replaceAll("-", "").toLowerCase();
    async function readColumn(column: string, start?: number, end?: number): Promise<unknown[][]> {
      const range = start === undefined ? `${column}:${column}` : `${column}${start}:${column}${end}`;
      const url = new URL(`${base}/values/${encodeURIComponent(`${tab}!${range}`)}`);
      url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
      const data = await request(url.href, "GET"),
        rows = data?.values ?? [];
      if (!Array.isArray(rows) || rows.length > 100000 || rows.some((row) => !Array.isArray(row) || row.length > 1))
        throw new GoogleLedgerUnavailableError();
      return rows as unknown[][];
    }
    const rows = await readColumn(first);
    let writtenRow: number | undefined;
    if (input.uncertain) {
      const lastRow = Math.max(2, rows.length),
        startRow = Math.max(2, lastRow - 9999);
      const ids = await readColumn(ledgerColumnName(input.setup.end - 1), startRow, lastRow);
      const matches = ids.flatMap((row, index) => (row[0] === eventId ? [startRow - 1 + index] : []));
      if (matches.length > 1) throw new LedgerDuplicateError();
      writtenRow = matches[0];
    }
    const matches = rows.flatMap((row, index) => (index > 0 && row[0] === input.values[0] ? [index] : []));
    if (matches.length > 1) throw new LedgerDuplicateError();
    if (writtenRow !== undefined) {
      if (matches.length === 1 && matches[0] === writtenRow) return;
      throw new LedgerDuplicateError();
    }
    const row = matches[0];
    const cells = [...input.values, eventId].map((value) => ({
      userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: value },
    }));
    const write =
      row === undefined
        ? {
            appendCells: {
              sheetId: input.setup.sheetId,
              rows: [{ values: [...Array.from({ length: input.setup.start }, () => ({})), ...cells] }],
              fields: "userEnteredValue",
            },
          }
        : {
            updateCells: {
              start: { sheetId: input.setup.sheetId, rowIndex: row, columnIndex: input.setup.start },
              rows: [{ values: cells }],
              fields: "userEnteredValue",
            },
          };
    let result: Record<string, unknown> | null;
    try {
      result = await request(`${base}:batchUpdate`, "POST", JSON.stringify({ requests: [write] }));
    } catch (error) {
      if (error instanceof LedgerDefiniteError) throw error;
      throw new LedgerUncertainError();
    }
    if (result?.spreadsheetId !== input.file || !Array.isArray(result.replies) || result.replies.length !== 1)
      throw new LedgerUncertainError();
  } catch (error) {
    if (error instanceof LedgerDuplicateError || error instanceof LedgerUncertainError) throw error;
    throw new GoogleLedgerUnavailableError();
  }
}
