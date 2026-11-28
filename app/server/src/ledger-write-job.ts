import type { DueItem, LeaseContext } from "./job-runner";
import { openLedgerJobCredential } from "./ledger-job-credential";
import { googleLedgerRefresh } from "./ledger-refresh";
import { ledgerSheetSetup } from "./ledger-sheet-setup";
import { writeLedgerSheet } from "./ledger-sheet-write";
import { createLedgerWriteHandler, type LedgerWriteSnapshot } from "./ledger-write-handler";
import type { Services } from "./services";
import type { Settings } from "./settings";
import type { ShopDb } from "./shop-scope";

/** 실행기는 임대한 주문의 현재 스냅샷만 외부로 보내고 원문을 로그에 남기지 않는다. */
export function ledgerWriteJob(settings: Settings, services: Services) {
  return createLedgerWriteHandler({
    async claim(db: ShopDb, item: DueItem, ctx: LeaseContext): Promise<LedgerWriteSnapshot | null> {
      const result = await db.run<{ link_id: string; spreadsheet_id: string; sheet_name: string; row_values: unknown }>(
        "SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)",
        [item.id, ctx.leaseUntil],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (
        !Array.isArray(row.row_values) ||
        row.row_values.length !== 12 ||
        row.row_values.some((v: unknown) => typeof v !== "string" && typeof v !== "number")
      )
        throw new Error("invalid ledger snapshot");
      return {
        shopId: db.scope.shopId,
        linkId: row.link_id,
        file: row.spreadsheet_id,
        tab: row.sheet_name,
        values: row.row_values as (string | number)[],
      };
    },
    credential(db, linkId, writeId, lease) {
      return openLedgerJobCredential(db, services.fieldCrypto(), linkId, writeId, lease);
    },
    async write(row, credential) {
      if (settings.ledgerOAuth === null) throw new Error("ledger OAuth is not configured");
      const key = settings.secrets.REQUEST_HASH_KEY;
      if (key === null) throw new Error("ledger key is not configured");
      const deadline = AbortSignal.timeout(15000);
      const bounded: typeof fetch = (request, init) => {
        deadline.throwIfAborted();
        return fetch(request, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });
      };
      const access = await googleLedgerRefresh(settings.ledgerOAuth, credential, { fetch: bounded });
      if (access === null) return { status: "auth_lost" };
      const setup = await ledgerSheetSetup(key, { fetch: bounded }).connect(access, row.shopId, row.file, row.tab);
      if (setup === null) return { status: "auth_lost" };
      await writeLedgerSheet({ file: row.file, tab: row.tab, access, setup, values: row.values }, { fetch: bounded });
      return {
        status: "written",
        columns: { columns: setup.columns, movedRight: setup.movedRight, ownershipToken: setup.ownershipToken },
      };
    },
    async finish(db, item, ctx, result) {
      await db.run("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,$6::jsonb)", [
        item.id,
        ctx.leaseUntil,
        result.status,
        ctx.now,
        result.status === "written" ? JSON.stringify(result.columns) : null,
      ]);
    },
  });
}
