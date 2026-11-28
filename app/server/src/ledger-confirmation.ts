import { GoogleLedgerUnavailableError } from "./ledger-google-auth";
import { googleLedgerSheets } from "./ledger-google-sheet";
import { googleLedgerRefresh } from "./ledger-refresh";
import { LEDGER_STORAGE_HEADERS, planLedgerColumns, verifyLedgerColumns } from "./ledger-sheet-columns";
import { type LedgerCell, ledgerRowDigest, writeLedgerSheet } from "./ledger-sheet-write";
import type { Secret } from "./settings";

export interface LedgerConfirmationInput {
  readonly shopId: string;
  readonly linkId: string;
  readonly orderId: string;
  readonly orderNo: string;
  readonly file: string;
  readonly tab: string;
  readonly refreshToken: Secret;
}
export interface LedgerConfirmationResult {
  readonly eventId: string | null;
  readonly digest: string | null;
  readonly targetKey: string;
  readonly keyVersion: string;
}
/** 확인 버튼이 눌린 요청 안에서 기존 장부를 읽고 원문 대신 서명만 반환한다. */
export function ledgerConfirmation(
  key: Secret,
  config: { readonly clientId: Secret; readonly clientSecret: Secret },
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
) {
  return {
    async inspect(input: LedgerConfirmationInput): Promise<LedgerConfirmationResult> {
      const deadline = AbortSignal.timeout(options.timeoutMs ?? 15000),
        send = options.fetch ?? fetch;
      const bounded: typeof fetch = async (request, init) =>
        send(request, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });
      const access = await googleLedgerRefresh(config, input.refreshToken, { fetch: bounded });
      if (!access) throw new GoogleLedgerUnavailableError();
      const sheets = googleLedgerSheets({ fetch: bounded }),
        snapshot = await sheets.inspect(access, input.file, input.tab);
      if (!snapshot || !(await sheets.canEdit(access, input.file))) throw new GoogleLedgerUnavailableError();
      let setup: {
        sheetId: number;
        start: number;
        end: number;
        sheetColumnCount: number;
        sheetRowCount: number;
        movedRight: boolean;
        ownershipToken: string;
        columns: readonly { header: string; column: string }[];
      } | null = null;
      for (const marker of [...snapshot.markers].sort((a, b) => b.start - a.start)) {
        const verified = await verifyLedgerColumns(
          key,
          { shopId: input.shopId, spreadsheetId: input.file, sheetId: snapshot.sheetId },
          marker.token,
          marker.start,
          marker.end,
        );
        if (!verified || !LEDGER_STORAGE_HEADERS.every((header, i) => snapshot.headers[marker.start + i] === header))
          continue;
        const plan = planLedgerColumns(snapshot.columnCount, snapshot.headers, verified);
        if (!plan.needsWrite) {
          setup = {
            sheetId: snapshot.sheetId,
            start: plan.start,
            end: plan.end,
            sheetColumnCount: snapshot.columnCount,
            sheetRowCount: snapshot.rowCount,
            movedRight: plan.movedRight,
            ownershipToken: marker.token,
            columns: plan.columns,
          };
          break;
        }
      }
      if (!setup) throw new GoogleLedgerUnavailableError();
      let row: readonly LedgerCell[] | null = null;
      await writeLedgerSheet(
        {
          file: input.file,
          tab: input.tab,
          access,
          setup,
          values: [input.orderNo, ...Array.from({ length: 11 }, () => "")],
          shopId: input.shopId,
          linkId: input.linkId,
          eventId: crypto.randomUUID(),
          orderId: input.orderId,
          hashKey: key,
          confirmRow: async (value) => {
            row = value;
          },
        },
        { fetch: bounded },
      );
      const confirmed: readonly LedgerCell[] | null = row;
      return {
        eventId: confirmed === null ? null : String(confirmed[12]),
        digest: confirmed === null ? null : await ledgerRowDigest(key, confirmed),
        targetKey: await ledgerRowDigest(key, ["ledger-target", input.file, input.tab]),
        keyVersion: await ledgerRowDigest(key, ["ledger-key-version-v1"]),
      };
    },
  };
}
