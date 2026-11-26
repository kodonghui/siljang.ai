import type { Secret } from "./settings";

export interface LedgerSheetSnapshot {
  readonly sheetId: number;
  readonly sheetName: string;
  readonly columnCount: number;
  readonly headers: readonly unknown[];
  readonly markers: readonly { readonly token: string; readonly start: number; readonly end: number }[];
}
export function googleLedgerSheets(_options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {}) {
  return {
    async inspect(
      _accessToken: Secret,
      _spreadsheetId: string,
      _sheetName: string,
    ): Promise<LedgerSheetSnapshot | null> {
      return null;
    },
  };
}
