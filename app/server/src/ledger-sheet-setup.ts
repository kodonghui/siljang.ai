import { readBytesLimited } from "./body";
import { GoogleLedgerUnavailableError } from "./ledger-google-auth";
import { googleLedgerDenied, googleLedgerSheets, type LedgerSheetSnapshot } from "./ledger-google-sheet";
import {
  LEDGER_HEADERS,
  LEDGER_MAX_COLUMNS,
  LEDGER_STORAGE_HEADERS,
  type LedgerColumnPlan,
  LedgerColumnsOverflowError,
  ledgerColumnName,
  planLedgerColumns,
  signLedgerColumns,
  signLegacyLedgerColumns,
  verifyLedgerColumns,
  verifyLegacyLedgerColumns,
} from "./ledger-sheet-columns";
import type { Secret } from "./settings";
import { isUuid } from "./shop-scope";
export interface LedgerSheetSetup {
  readonly sheetId: number;
  readonly start: number;
  readonly end: number;
  readonly sheetColumnCount: number;
  readonly sheetRowCount?: number;
  readonly movedRight: boolean;
  readonly ownershipToken: string;
  readonly columns: readonly { readonly header: string; readonly column: string }[];
}
export function ledgerSheetSetup(
  key: Secret,
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
) {
  const send = options.fetch ?? fetch,
    sheets = googleLedgerSheets(options);
  function result(
    sheetId: number,
    plan: LedgerColumnPlan,
    ownershipToken: string,
    sheetColumnCount: number,
    sheetRowCount: number,
  ): LedgerSheetSetup {
    return {
      sheetId,
      start: plan.start,
      end: plan.end,
      sheetColumnCount,
      sheetRowCount,
      movedRight: plan.movedRight,
      columns: plan.columns,
      ownershipToken,
    };
  }
  async function existing(snapshot: LedgerSheetSnapshot, shopId: string, spreadsheetId: string) {
    for (const marker of [...snapshot.markers].sort((a, b) => b.start - a.start)) {
      const verified = await verifyLedgerColumns(
        key,
        { shopId, spreadsheetId, sheetId: snapshot.sheetId },
        marker.token,
        marker.start,
        marker.end,
      );
      if (verified === null) continue;
      if (!LEDGER_STORAGE_HEADERS.every((header, index) => snapshot.headers[marker.start + index] === header)) continue;
      const plan = planLedgerColumns(snapshot.columnCount, snapshot.headers, verified);
      if (!plan.needsWrite)
        return result(snapshot.sheetId, plan, marker.token, snapshot.columnCount, snapshot.rowCount);
    }
    return null;
  }
  async function legacyExisting(
    snapshot: LedgerSheetSnapshot,
    shopId: string,
    spreadsheetId: string,
  ): Promise<LedgerSheetSetup | null> {
    for (const marker of [...snapshot.markers].sort((a, b) => b.start - a.start)) {
      const scope = { shopId, spreadsheetId, sheetId: snapshot.sheetId };
      const legacy = await verifyLegacyLedgerColumns(key, scope, marker.token, marker.start);
      const current =
        legacy === null ? await verifyLedgerColumns(key, scope, marker.token, marker.start, marker.end) : null;
      if ((!legacy && !current) || !LEDGER_HEADERS.every((header, i) => snapshot.headers[marker.start + i] === header))
        continue;
      return {
        sheetId: snapshot.sheetId,
        start: marker.start,
        end: marker.start + LEDGER_HEADERS.length,
        sheetColumnCount: snapshot.columnCount,
        sheetRowCount: snapshot.rowCount,
        movedRight: (legacy ?? current)?.movedRight ?? false,
        ownershipToken: marker.token,
        columns: LEDGER_HEADERS.map((header, i) => ({ header, column: ledgerColumnName(marker.start + i) })),
      };
    }
    return null;
  }
  return {
    async connect(
      access: Secret,
      shopId: string,
      file: string,
      tab: string,
      mode: { readonly purpose: "link" | "write" } = { purpose: "write" },
    ): Promise<LedgerSheetSetup | null> {
      if (!isUuid(shopId)) throw new TypeError("invalid ledger shop scope");
      try {
        const snapshot = await sheets.inspect(access, file, tab);
        if (snapshot === null) return null;
        const reused = await existing(snapshot, shopId, file);
        if (reused !== null) {
          if (!(await sheets.canEdit(access, file))) return null;
          return reused;
        }
        if (mode.purpose === "link") {
          const legacy = await legacyExisting(snapshot, shopId, file);
          if (legacy) {
            if (!(await sheets.canEdit(access, file))) return null;
            return legacy;
          }
          const start = snapshot.columnCount;
          if (start + LEDGER_HEADERS.length > LEDGER_MAX_COLUMNS) throw new LedgerColumnsOverflowError();
          const movedRight = snapshot.headers.some(
            (header) => typeof header === "string" && (LEDGER_HEADERS as readonly string[]).includes(header),
          );
          const token = await signLegacyLedgerColumns(
            key,
            { shopId, spreadsheetId: file, sheetId: snapshot.sheetId },
            start,
            movedRight,
          );
          const range = {
            sheetId: snapshot.sheetId,
            dimension: "COLUMNS",
            startIndex: start,
            endIndex: start + LEDGER_HEADERS.length,
          };
          const response = await send(`https://sheets.googleapis.com/v4/spreadsheets/${file}:batchUpdate`, {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
            headers: { Authorization: `Bearer ${access.reveal()}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              includeSpreadsheetInResponse: false,
              requests: [
                { insertDimension: { range, inheritFromBefore: true } },
                {
                  updateCells: {
                    start: { sheetId: snapshot.sheetId, rowIndex: 0, columnIndex: start },
                    rows: [{ values: LEDGER_HEADERS.map((value) => ({ userEnteredValue: { stringValue: value } })) }],
                    fields: "userEnteredValue",
                  },
                },
                {
                  createDeveloperMetadata: {
                    developerMetadata: {
                      metadataKey: "siljang_columns_v1",
                      metadataValue: token,
                      visibility: "PROJECT",
                      location: { dimensionRange: { ...range, endIndex: start + 1 } },
                    },
                  },
                },
              ],
            }),
          });
          if (!response.ok && (await googleLedgerDenied(response))) return null;
          const raw: unknown = JSON.parse(
            new TextDecoder().decode(await readBytesLimited(response, 65536, () => new GoogleLedgerUnavailableError())),
          );
          if (
            typeof raw !== "object" ||
            raw === null ||
            Array.isArray(raw) ||
            (raw as Record<string, unknown>).spreadsheetId !== file ||
            !Array.isArray((raw as Record<string, unknown>).replies) ||
            ((raw as Record<string, unknown>).replies as unknown[]).length !== 3
          )
            throw new GoogleLedgerUnavailableError();
          const checked = await sheets.inspect(access, file, tab);
          if (!checked) throw new GoogleLedgerUnavailableError();
          const created = await legacyExisting(checked, shopId, file);
          if (!created || created.sheetId !== snapshot.sheetId || created.ownershipToken !== token)
            throw new GoogleLedgerUnavailableError();
          return created;
        }
        for (const marker of [...snapshot.markers].sort((a, b) => b.start - a.start)) {
          const scope = { shopId, spreadsheetId: file, sheetId: snapshot.sheetId };
          const legacy = await verifyLegacyLedgerColumns(key, scope, marker.token, marker.start);
          const current =
            legacy === null ? await verifyLedgerColumns(key, scope, marker.token, marker.start, marker.end) : null;
          if (
            (!legacy && !current) ||
            !LEDGER_HEADERS.every((header, i) => snapshot.headers[marker.start + i] === header)
          )
            continue;
          const firstInternal = marker.start + LEDGER_HEADERS.length;
          const record = LEDGER_STORAGE_HEADERS[LEDGER_HEADERS.length],
            order = LEDGER_STORAGE_HEADERS[LEDGER_HEADERS.length + 1];
          const suffix = snapshot.headers[firstInternal];
          const repair = legacy
            ? [record, order]
            : suffix === record
              ? [order]
              : suffix === order
                ? [record]
                : [record, order];
          const idColumn = !legacy && suffix === record ? firstInternal + 1 : firstInternal;
          if (snapshot.columnCount + repair.length > LEDGER_MAX_COLUMNS) throw new LedgerColumnsOverflowError();
          if (!(await sheets.canEdit(access, file))) return null;
          const token = legacy ? await signLedgerColumns(key, scope, marker.start, legacy.movedRight) : marker.token;
          const response = await send(`https://sheets.googleapis.com/v4/spreadsheets/${file}:batchUpdate`, {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
            headers: { Authorization: `Bearer ${access.reveal()}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: [
                {
                  insertDimension: {
                    range: {
                      sheetId: snapshot.sheetId,
                      dimension: "COLUMNS",
                      startIndex: idColumn,
                      endIndex: idColumn + repair.length,
                    },
                    inheritFromBefore: true,
                  },
                },
                {
                  updateCells: {
                    start: { sheetId: snapshot.sheetId, rowIndex: 0, columnIndex: idColumn },
                    rows: [
                      {
                        values: repair.map((header) => ({
                          userEnteredValue: { stringValue: header },
                          note: "실장님이 중복 기록을 막는 데 쓰는 열, 지우거나 바꾸지 마세요",
                        })),
                      },
                    ],
                    fields: "userEnteredValue,note",
                  },
                },
                {
                  updateDimensionProperties: {
                    range: {
                      sheetId: snapshot.sheetId,
                      dimension: "COLUMNS",
                      startIndex: idColumn,
                      endIndex: idColumn + repair.length,
                    },
                    properties: { hiddenByUser: true },
                    fields: "hiddenByUser",
                  },
                },
                {
                  updateDeveloperMetadata: {
                    dataFilters: [
                      {
                        developerMetadataLookup: {
                          metadataKey: "siljang_columns_v1",
                          metadataValue: marker.token,
                          visibility: "PROJECT",
                        },
                      },
                    ],
                    developerMetadata: { metadataValue: token },
                    fields: "metadataValue",
                  },
                },
              ],
            }),
          });
          if (!response.ok) {
            if (await googleLedgerDenied(response)) return null;
          }
          const raw: unknown = JSON.parse(
            new TextDecoder().decode(await readBytesLimited(response, 65536, () => new GoogleLedgerUnavailableError())),
          );
          if (
            typeof raw !== "object" ||
            raw === null ||
            Array.isArray(raw) ||
            (raw as Record<string, unknown>).spreadsheetId !== file ||
            !Array.isArray((raw as Record<string, unknown>).replies) ||
            ((raw as Record<string, unknown>).replies as unknown[]).length !== 4
          )
            throw new GoogleLedgerUnavailableError();
          const checked = await sheets.inspect(access, file, tab);
          if (checked === null) return null;
          const upgraded = await existing(checked, shopId, file);
          if (upgraded === null) throw new GoogleLedgerUnavailableError();
          return upgraded;
        }
        const plan = planLedgerColumns(snapshot.columnCount, snapshot.headers),
          range = { sheetId: snapshot.sheetId, dimension: "COLUMNS", startIndex: plan.start, endIndex: plan.end };
        const token = await signLedgerColumns(
          key,
          { shopId, spreadsheetId: file, sheetId: snapshot.sheetId },
          plan.start,
          plan.movedRight,
        );
        const response = await send(`https://sheets.googleapis.com/v4/spreadsheets/${file}:batchUpdate`, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
          headers: { Authorization: `Bearer ${access.reveal()}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            includeSpreadsheetInResponse: false,
            requests: [
              { insertDimension: { range, inheritFromBefore: true } },
              {
                updateCells: {
                  start: { sheetId: snapshot.sheetId, rowIndex: 0, columnIndex: plan.start },
                  rows: [
                    {
                      values: LEDGER_STORAGE_HEADERS.map((value, index) => ({
                        userEnteredValue: { stringValue: value },
                        ...(index >= LEDGER_HEADERS.length
                          ? { note: "실장님이 중복 기록을 막는 데 쓰는 열, 지우거나 바꾸지 마세요" }
                          : {}),
                      })),
                    },
                  ],
                  fields: "userEnteredValue,note",
                },
              },
              {
                updateDimensionProperties: {
                  range: {
                    sheetId: snapshot.sheetId,
                    dimension: "COLUMNS",
                    startIndex: plan.end - 2,
                    endIndex: plan.end,
                  },
                  properties: { hiddenByUser: true },
                  fields: "hiddenByUser",
                },
              },
              {
                createDeveloperMetadata: {
                  developerMetadata: {
                    metadataKey: "siljang_columns_v1",
                    metadataValue: token,
                    visibility: "PROJECT",
                    location: { dimensionRange: { ...range, endIndex: plan.start + 1 } },
                  },
                },
              },
            ],
          }),
        });
        if (!response.ok) {
          if (await googleLedgerDenied(response)) return null;
        }
        const bytes = await readBytesLimited(response, 65536, () => new GoogleLedgerUnavailableError()),
          raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
          typeof raw !== "object" ||
          raw === null ||
          Array.isArray(raw) ||
          (raw as Record<string, unknown>).spreadsheetId !== file ||
          !Array.isArray((raw as Record<string, unknown>).replies) ||
          ((raw as Record<string, unknown>).replies as unknown[]).length !== 4
        )
          throw new GoogleLedgerUnavailableError();
        const checked = await sheets.inspect(access, file, tab);
        if (checked === null) throw new GoogleLedgerUnavailableError();
        const verified = await existing(checked, shopId, file);
        if (verified === null || verified.sheetId !== snapshot.sheetId || verified.ownershipToken !== token)
          throw new GoogleLedgerUnavailableError();
        return verified;
      } catch (error) {
        if (error instanceof LedgerColumnsOverflowError) {
          if (mode.purpose === "write") throw error;
          return null;
        }
        throw new GoogleLedgerUnavailableError();
      }
    },
  };
}
