import type { Secret } from "./settings";
export interface LedgerSheetSetup {
  readonly sheetId: number;
  readonly start: number;
  readonly end: number;
  readonly movedRight: boolean;
  readonly ownershipToken: string;
  readonly columns: readonly { readonly header: string; readonly column: string }[];
}
export function ledgerSheetSetup(
  _key: Secret,
  _options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
) {
  return {
    async connect(_access: Secret, _shopId: string, _file: string, _tab: string): Promise<LedgerSheetSetup | null> {
      return null;
    },
  };
}
