import { readBytesLimited } from "./body";
import { GoogleLedgerUnavailableError } from "./ledger-google-auth";
import { googleLedgerSheets, type LedgerSheetSnapshot } from "./ledger-google-sheet";
import {
  LEDGER_HEADERS,
  type LedgerColumnPlan,
  LedgerColumnsOverflowError,
  planLedgerColumns,
  signLedgerColumns,
  verifyLedgerColumns,
} from "./ledger-sheet-columns";
import type { Secret } from "./settings";
import { isUuid } from "./shop-scope";
export interface LedgerSheetSetup {
  readonly sheetId: number;
  readonly start: number;
  readonly end: number;
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
  function result(sheetId: number, plan: LedgerColumnPlan, ownershipToken: string): LedgerSheetSetup {
    return {
      sheetId,
      start: plan.start,
      end: plan.end,
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
      if (!LEDGER_HEADERS.every((header, index) => snapshot.headers[marker.start + index] === header)) continue;
      const plan = planLedgerColumns(snapshot.columnCount, snapshot.headers, verified);
      if (!plan.needsWrite) return result(snapshot.sheetId, plan, marker.token);
    }
    return null;
  }
  return {
    async connect(access: Secret, shopId: string, file: string, tab: string): Promise<LedgerSheetSetup | null> {
      if (!isUuid(shopId)) throw new TypeError("invalid ledger shop scope");
      try {
        const snapshot = await sheets.inspect(access, file, tab);
        if (snapshot === null) return null;
        const reused = await existing(snapshot, shopId, file);
        if (reused !== null) return reused;
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
                    location: { dimensionRange: { ...range, endIndex: plan.start + 1 } },
                  },
                },
              },
            ],
          }),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if ([400, 401, 403, 404].includes(response.status)) return null;
          throw new GoogleLedgerUnavailableError();
        }
        const bytes = await readBytesLimited(response, 65536, () => new GoogleLedgerUnavailableError()),
          raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
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
        if (checked === null) throw new GoogleLedgerUnavailableError();
        const verified = await existing(checked, shopId, file);
        if (verified === null || verified.sheetId !== snapshot.sheetId || verified.ownershipToken !== token)
          throw new GoogleLedgerUnavailableError();
        return verified;
      } catch (error) {
        if (error instanceof LedgerColumnsOverflowError) return null;
        throw new GoogleLedgerUnavailableError();
      }
    },
  };
}
