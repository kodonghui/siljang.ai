import { readBytesLimited } from "./body";
import { toBase64Url } from "./encoding";
import {
  buildLedgerCheckpoint,
  compareLedgerCheckpoint,
  type LedgerCell,
  type LedgerCheckpoint,
} from "./ledger-checkpoint";
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
  constructor(
    message: string,
    readonly affectedOrderIds: readonly string[] = [],
  ) {
    super(message);
  }
}
class LedgerDefiniteError extends Error {}

export type { LedgerCell, LedgerCheckpoint } from "./ledger-checkpoint";
export async function ledgerRowDigest(key: Secret, row: readonly LedgerCell[]): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key.reveal()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(JSON.stringify(["ledger-row-v1", row]))),
    ),
  );
}

/** 중복을 탐지할 뿐 시트의 행을 삭제하거나 수정하지 않는다. */
export async function auditLedgerSheet(
  input: Parameters<typeof writeLedgerSheet>[0],
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<"ok" | "duplicate" | "missing"> {
  if (
    !/^[A-Za-z0-9_-]{20,100}$/.test(input.file) ||
    !/^[0-9A-Z]{6,8}$/.test(String(input.values[0])) ||
    input.setup.end !== input.setup.start + LEDGER_STORAGE_HEADERS.length ||
    !Number.isInteger(input.setup.sheetColumnCount) ||
    input.setup.sheetColumnCount < input.setup.end ||
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
    readonly resumeApproved?: boolean;
    readonly hashKey: Secret;
    readonly expectedDigest?: string | null;
    readonly expectedDigests?: Readonly<Record<string, string>>;
    readonly checkpoint?: LedgerCheckpoint | null;
    readonly saveCheckpoint?: (checkpoint: LedgerCheckpoint) => Promise<void>;
    readonly verifiedDigest?: (digest: string) => void;
  },
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<void> {
  if (
    !/^[A-Za-z0-9_-]{20,100}$/.test(input.file) ||
    !/^[0-9A-Z]{6,8}$/.test(String(input.values[0])) ||
    input.values.length !== LEDGER_HEADERS.length ||
    input.setup.end !== input.setup.start + LEDGER_STORAGE_HEADERS.length ||
    !Number.isInteger(input.setup.sheetColumnCount) ||
    input.setup.sheetColumnCount < input.setup.end ||
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
    sizeLimitConflict = false,
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
        await readBytesLimited(response, 2 * 1024 * 1024, () =>
          sizeLimitConflict ? new LedgerConflictError("ledger row limit") : new GoogleLedgerUnavailableError(),
        ),
      ),
    );
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new GoogleLedgerUnavailableError();
    return raw as Record<string, unknown>;
  }
  const eventId = input.eventId.replaceAll("-", "").toLowerCase();
  const orderId = input.orderId.replaceAll("-", "").toLowerCase();
  const last = ledgerColumnName(input.setup.end - 1);
  type Cell = LedgerCell;
  async function read(range: string): Promise<Cell[][]> {
    const url = new URL(`${base}/values/${encodeURIComponent(`${tab}!${range}`)}`);
    url.searchParams.set("valueRenderOption", "FORMULA");
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
    const parsed = rows as Cell[][];
    // FORMULA는 수식과 '='로 시작하는 일반 문자열을 구분하지 못한다.
    // 해당 셀이 있을 때만 userEnteredValue를 읽어 수식과 문자를 보존한다.
    if (parsed.some((row) => row.some((cell) => typeof cell === "string" && cell.startsWith("=")))) {
      const gridUrl = new URL(base);
      gridUrl.searchParams.set("ranges", `${tab}!${range}`);
      gridUrl.searchParams.set("fields", "sheets(data(rowData(values(userEnteredValue))))");
      const grid = await request(gridUrl.href, "GET");
      const sheets = grid?.sheets;
      if (!Array.isArray(sheets) || sheets.length !== 1) throw new GoogleLedgerUnavailableError();
      const data = sheets[0]?.data;
      const rowData = Array.isArray(data) && data.length === 1 ? data[0]?.rowData : undefined;
      if (!Array.isArray(rowData)) throw new GoogleLedgerUnavailableError();
      for (let r = 0; r < parsed.length; r++)
        for (let c = 0; c < (parsed[r]?.length ?? 0); c++) {
          const value = parsed[r]?.[c];
          if (typeof value !== "string" || !value.startsWith("=")) continue;
          const entered = rowData[r]?.values?.[c]?.userEnteredValue;
          const parsedRow = parsed[r];
          if (!parsedRow) throw new GoogleLedgerUnavailableError();
          if (entered?.formulaValue === value) parsedRow[c] = { formula: value };
          else if (entered?.stringValue !== value) throw new GoogleLedgerUnavailableError();
        }
    }
    return parsed;
  }
  async function snapshot(): Promise<Cell[][]> {
    const rows = await read(`${first}:${last}`);
    if (rows.length > 5001) throw new LedgerConflictError("ledger row limit");
    return rows.slice(1).map((row) => Array.from({ length: LEDGER_STORAGE_HEADERS.length }, (_, i) => row[i] ?? ""));
  }
  async function ensureAppendFits(count: number): Promise<void> {
    const lastColumn = ledgerColumnName(input.setup.sheetColumnCount - 1);
    if (count < 1 || count > 4999) throw new LedgerConflictError("ledger row limit");
    if (input.setup.sheetRowCount !== undefined && input.setup.sheetRowCount < 5001 - count) return;
    const url = new URL(`${base}/values/${encodeURIComponent(`${tab}!A${5001 - count}:${lastColumn}`)}`);
    url.searchParams.set("valueRenderOption", "FORMULA");
    const data = await request(url.href, "GET", undefined, false, true);
    const rows = data?.values ?? [];
    if (!Array.isArray(rows)) throw new GoogleLedgerUnavailableError();
    if (rows.some((row) => !Array.isArray(row) || row.some((cell: unknown) => cell !== "" && cell !== null)))
      throw new LedgerConflictError("ledger row limit");
  }
  function key(row: Cell[]): string | null {
    return typeof row[13] === "string" && row[13] ? `id:${row[13]}` : row[0] ? `number:${String(row[0])}` : null;
  }
  function indexed(rows: Cell[][]): Map<string, Cell[][]> {
    const map = new Map<string, Cell[][]>();
    for (const row of rows) {
      if (row.every((cell) => cell === "")) continue;
      const k = key(row);
      if (k === null) continue;
      const group = map.get(k) ?? [];
      group.push(row);
      map.set(k, group);
    }
    return map;
  }
  function cells(values: readonly Cell[]) {
    return values.map((value) => ({
      userEnteredValue:
        typeof value === "object"
          ? { formulaValue: value.formula }
          : typeof value === "number"
            ? { numberValue: value }
            : typeof value === "boolean"
              ? { boolValue: value }
              : { stringValue: value },
    }));
  }
  function sameRows(left: Cell[][] | undefined, right: Cell[][]): boolean {
    return (
      JSON.stringify((left ?? []).map((row) => JSON.stringify(row)).sort()) ===
      JSON.stringify(right.map((row) => JSON.stringify(row)).sort())
    );
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
    const current = await snapshot();
    const saved = input.uncertain ? input.checkpoint : null;
    if (input.uncertain && !saved) throw new LedgerConflictError("missing comparison baseline");
    const context = { file: input.file, tab: input.tab, eventId: input.eventId, orderId: input.orderId };
    const matches = current.flatMap((row, index) => (row[0] === input.values[0] ? [index] : []));
    const idMatches = current.flatMap((row, index) => (row[13] === orderId ? [index] : []));
    if (saved) {
      const alreadySent = current.some((row) => row[12] === eventId && row[13] === orderId);
      let comparison: Awaited<ReturnType<typeof compareLedgerCheckpoint>>;
      try {
        comparison = await compareLedgerCheckpoint(input.hashKey, context, saved, current, alreadySent);
      } catch {
        throw new LedgerConflictError(
          "invalid comparison baseline",
          Array.isArray(saved.affectedOrderIds) ? saved.affectedOrderIds.filter(isUuid) : [],
        );
      }
      if (saved.conflicted || comparison.changed)
        throw new LedgerConflictError("comparison baseline changed", [
          ...new Set([...saved.affectedOrderIds, ...comparison.affectedOrderIds]),
        ]);
      if (matches.length > 1 || idMatches.length > 1) throw new LedgerDuplicateError();
      if (alreadySent) {
        const found = current.find((row) => row[12] === eventId && row[13] === orderId);
        if (!found || (await ledgerRowDigest(input.hashKey, found)) !== saved.sentDigest)
          throw new LedgerConflictError("uncertain row changed");
        input.verifiedDigest?.(saved.sentDigest);
        return;
      }
    }
    if (matches.length > 1 || idMatches.length > 1) throw new LedgerDuplicateError();
    const before = current,
      prior = indexed(before),
      target = matches[0];
    const values = [...input.values, eventId, orderId];
    if (target !== undefined) {
      const old = current[target];
      if (!old || old[13] !== orderId) throw new LedgerConflictError("order ID changed");
      const expected = input.expectedDigests ? input.expectedDigests[String(old[12])] : input.expectedDigest;
      if (!input.resumeApproved && (!expected || (await ledgerRowDigest(input.hashKey, old)) !== expected))
        throw new LedgerConflictError("target edited");
    } else if (prior.has(`id:${orderId}`)) throw new LedgerConflictError("order number changed");
    const checkpoint = input.saveCheckpoint
      ? await buildLedgerCheckpoint(input.hashKey, context, before, values)
      : null;
    if (checkpoint && input.saveCheckpoint) await input.saveCheckpoint(checkpoint);
    if (target === undefined) await ensureAppendFits(1);
    else {
      const check = await read(`${first}${target + 2}:${last}${target + 2}`);
      const checked = Array.from({ length: LEDGER_STORAGE_HEADERS.length }, (_, i) => check[0]?.[i] ?? "");
      if (JSON.stringify(checked) !== JSON.stringify(current[target]))
        throw new LedgerConflictError("order moved or edited");
    }
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
    const observed = indexed(after.filter((row) => row[13] !== orderId));
    const missing: Cell[][] = [];
    const affected = new Set<string>();
    const markAffected = (row: Cell[]) => {
      const id = row[13];
      if (typeof id === "string" && /^[0-9a-f]{32}$/i.test(id))
        affected.add(
          `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`.toLowerCase(),
        );
    };
    let changed = false;
    for (const [id, oldRows] of prior) {
      if (id === `id:${orderId}`) continue;
      const remaining = [...(observed.get(id) ?? [])];
      for (const old of oldRows) {
        const index = remaining.findIndex((row) => JSON.stringify(row) === JSON.stringify(old));
        if (index >= 0) remaining.splice(index, 1);
        else if (remaining.length === 0) {
          missing.push(old);
          markAffected(old);
        } else {
          changed = true;
          markAffected(old);
        }
      }
      if (remaining.length) {
        changed = true;
        for (const row of remaining) markAffected(row);
      }
    }
    for (const [id, rows] of observed)
      if (!prior.has(id)) {
        changed = true;
        for (const row of rows) markAffected(row);
      }
    const targetRows = after.filter((row) => row[13] === orderId);
    if (
      missing.length ||
      changed ||
      targetRows.length !== 1 ||
      after.filter((row) => row[0] === input.values[0]).length !== 1 ||
      JSON.stringify(targetRows[0]) !== JSON.stringify(values)
    ) {
      if (checkpoint && input.saveCheckpoint) {
        try {
          await input.saveCheckpoint({ ...checkpoint, conflicted: true, affectedOrderIds: [...affected] });
        } catch {
          throw new LedgerUncertainError();
        }
      }
      if (missing.length) {
        try {
          await ensureAppendFits(missing.length);
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
          if (
            missing.some(
              (row) => !restored.get(key(row) ?? "")?.some((value) => JSON.stringify(value) === JSON.stringify(row)),
            )
          )
            throw new Error("restore mismatch");
          for (const [id, previous] of observed)
            if (!sameRows(restored.get(id), previous)) throw new Error("restore changed");
        } catch {
          /* 복원 실패도 할 일로 알린다. */
        }
      }
      throw new LedgerConflictError("ledger changed", [...affected]);
    }
    input.verifiedDigest?.(await ledgerRowDigest(input.hashKey, values));
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
