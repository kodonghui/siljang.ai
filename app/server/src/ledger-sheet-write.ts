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
export class LedgerConflictError extends Error {
  override readonly name = "LedgerConflictError";
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
      ids = await read(input.setup.end - 2, Math.max(2, lastRow - 9999), lastRow),
      event = input.eventId.replaceAll("-", "").toLowerCase();
    const idCount = ids.filter((row) => row[0] === event).length;
    const orderCount = orders.filter((row, index) => index > 0 && row[0] === input.values[0]).length;
    if (idCount > 1 || orderCount > 1) return "duplicate";
    return orderCount === 0 ? "missing" : "ok";
  } catch {
    throw new GoogleLedgerUnavailableError();
  }
}

/** 쓰기 전후 우리 열을 비교해 협업 중 사라지거나 바뀐 행을 감지한다. */
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
    readonly orderId: string;
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
    !isUuid(input.orderId) ||
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
  const eventId = input.eventId.replaceAll("-", "").toLowerCase();
  const orderId = input.orderId.replaceAll("-", "").toLowerCase();
  const last = ledgerColumnName(input.setup.end - 1);
  type Cell = string | number | boolean;
  async function read(range: string): Promise<Cell[][]> {
    const url = new URL(`${base}/values/${encodeURIComponent(`${tab}!${range}`)}`);
    url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    const data = await request(url.href, "GET");
    const rows = data?.values ?? [];
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          !Array.isArray(row) ||
          row.length > LEDGER_STORAGE_HEADERS.length ||
          row.some((cell: unknown) => !["string", "number", "boolean"].includes(typeof cell)),
      )
    )
      throw new GoogleLedgerUnavailableError();
    return rows as Cell[][];
  }
  async function snapshot(): Promise<Cell[][]> {
    const rows = await read(`${first}:${last}`);
    if (rows.length > 5001) throw new LedgerConflictError("ledger row limit");
    return rows.slice(1).map((row) => Array.from({ length: LEDGER_STORAGE_HEADERS.length }, (_, i) => row[i] ?? ""));
  }
  function key(row: Cell[]): string {
    return typeof row[13] === "string" && row[13] ? `id:${row[13]}` : `number:${String(row[0])}`;
  }
  function indexed(rows: Cell[][]): Map<string, Cell[]> {
    const map = new Map<string, Cell[]>();
    for (const row of rows) {
      if (row.every((cell) => cell === "")) continue;
      const k = key(row);
      if (map.has(k)) throw new LedgerDuplicateError();
      map.set(k, row);
    }
    return map;
  }
  function cells(values: readonly Cell[]) {
    return values.map((value) => ({
      userEnteredValue:
        typeof value === "number"
          ? { numberValue: value }
          : typeof value === "boolean"
            ? { boolValue: value }
            : { stringValue: value },
    }));
  }
  async function sendWrite(write: unknown): Promise<void> {
    let result: Record<string, unknown> | null;
    try {
      result = await request(`${base}:batchUpdate`, "POST", JSON.stringify({ requests: [write] }));
    } catch (error) {
      if (error instanceof LedgerDefiniteError) throw error;
      throw new LedgerUncertainError();
    }
    if (result?.spreadsheetId !== input.file || !Array.isArray(result.replies) || result.replies.length !== 1)
      throw new LedgerUncertainError();
  }
  try {
    const before = await snapshot(),
      prior = indexed(before);
    const matches = before.flatMap((row, index) => (row[0] === input.values[0] ? [index] : []));
    if (matches.length > 1) throw new LedgerDuplicateError();
    const target = matches[0];
    if (input.uncertain && before.some((row) => row[12] === eventId && row[13] === orderId)) return;
    if (target !== undefined) {
      if (before[target]?.[13] !== orderId) throw new LedgerConflictError("order ID changed");
      const idColumn = ledgerColumnName(input.setup.end - 1);
      const check = await read(`${idColumn}${target + 2}:${idColumn}${target + 2}`);
      if (check[0]?.[0] !== orderId) throw new LedgerConflictError("order moved");
    } else if (prior.has(`id:${orderId}`)) throw new LedgerConflictError("order number changed");
    const values = [...input.values, eventId, orderId];
    const write =
      target === undefined
        ? {
            appendCells: {
              sheetId: input.setup.sheetId,
              rows: [{ values: [...Array.from({ length: input.setup.start }, () => ({})), ...cells(values)] }],
              fields: "userEnteredValue",
            },
          }
        : {
            updateCells: {
              start: { sheetId: input.setup.sheetId, rowIndex: target + 1, columnIndex: input.setup.start },
              rows: [{ values: cells(values) }],
              fields: "userEnteredValue",
            },
          };
    await sendWrite(write);
    let after: Cell[][];
    try {
      after = await snapshot();
    } catch (error) {
      if (error instanceof LedgerConflictError) throw error;
      throw new LedgerUncertainError();
    }
    let observed: Map<string, Cell[]>;
    try {
      observed = indexed(after.filter((row) => row[13] !== orderId));
    } catch {
      throw new LedgerConflictError("rows changed");
    }
    const missing: Cell[][] = [];
    let changed = false;
    for (const [id, old] of prior) {
      if (id === `id:${orderId}`) continue;
      const current = observed.get(id);
      if (!current) missing.push(old);
      else if (JSON.stringify(current) !== JSON.stringify(old)) changed = true;
    }
    const targetRows = after.filter((row) => row[13] === orderId);
    if (
      missing.length ||
      changed ||
      targetRows.length !== 1 ||
      after.filter((row) => row[0] === input.values[0]).length !== 1 ||
      JSON.stringify(targetRows[0]) !== JSON.stringify(values) ||
      (target !== undefined && after[target]?.[13] !== orderId)
    ) {
      if (
        missing.length &&
        missing.every((row) => row.every((cell) => typeof cell !== "string" || !cell.startsWith("=")))
      ) {
        try {
          await sendWrite({
            appendCells: {
              sheetId: input.setup.sheetId,
              rows: missing.map((row) => ({
                values: [...Array.from({ length: input.setup.start }, () => ({})), ...cells(row)],
              })),
              fields: "userEnteredValue",
            },
          });
          const restored = indexed((await snapshot()).filter((row) => row[13] !== orderId));
          if (missing.some((row) => JSON.stringify(restored.get(key(row))) !== JSON.stringify(row)))
            throw new Error("restore mismatch");
          for (const [id, previous] of observed)
            if (JSON.stringify(restored.get(id)) !== JSON.stringify(previous)) throw new Error("restore changed");
        } catch {
          /* 복원 실패도 할 일로 알린다. */
        }
      }
      throw new LedgerConflictError("ledger changed");
    }
  } catch (error) {
    if (
      error instanceof LedgerDuplicateError ||
      error instanceof LedgerUncertainError ||
      error instanceof LedgerConflictError
    )
      throw error;
    throw new GoogleLedgerUnavailableError();
  }
}
