import { type DbConnector, pgConnector } from "./db";
import type { DueItem, LeaseContext } from "./job-runner";
import type { LedgerCheckpoint } from "./ledger-checkpoint";
import { guardedLedgerFetch } from "./ledger-guarded-fetch";
import { openLedgerJobCredential } from "./ledger-job-credential";
import { googleLedgerRefresh } from "./ledger-refresh";
import { ledgerSheetSetup } from "./ledger-sheet-setup";
import { auditLedgerSheet, LedgerConflictError, ledgerRowDigest, writeLedgerSheet } from "./ledger-sheet-write";
import { createLedgerWriteHandler, type LedgerWriteSnapshot } from "./ledger-write-handler";
import type { Services } from "./services";
import type { Settings } from "./settings";
import type { ShopDb } from "./shop-scope";

/** 실행기는 임대한 주문의 현재 스냅샷만 외부로 보내고 원문을 로그에 남기지 않는다. */
export function ledgerWriteJob(settings: Settings, services: Services, connect: DbConnector = pgConnector) {
  return createLedgerWriteHandler({
    async claim(db: ShopDb, item: DueItem, ctx: LeaseContext): Promise<LedgerWriteSnapshot | null> {
      const result = await db.run<{
        link_id: string;
        spreadsheet_id: string;
        sheet_name: string;
        row_values: unknown;
        uncertain: boolean;
        auditing: boolean;
        order_id: string;
        expected_hash: string | null;
        expected_hashes: Record<string, Record<string, string>>;
        checkpoint_hashes: LedgerCheckpoint | null;
        sheet_key_version: string | null;
        confirmed_target_key: string | null;
      }>("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [item.id, ctx.leaseUntil]);
      const row = result.rows[0];
      if (!row) return null;
      if (
        !Array.isArray(row.row_values) ||
        row.row_values.length !== 12 ||
        row.row_values.some((v: unknown) => typeof v !== "string" && typeof v !== "number")
      )
        throw new Error("invalid ledger snapshot");
      const key = settings.secrets.REQUEST_HASH_KEY;
      if (key === null) throw new Error("ledger key is not configured");
      const targetKey = await ledgerRowDigest(key, ["ledger-target", row.spreadsheet_id, row.sheet_name]);
      return {
        leaseUntil: ctx.leaseUntil,
        checkpoint: row.checkpoint_hashes,
        signatureVersion: row.sheet_key_version,
        confirmedTarget: row.confirmed_target_key,
        expectedDigests: row.expected_hashes?.[targetKey] ?? {},
        shopId: db.scope.shopId,
        eventId: item.id,
        orderId: row.order_id,
        expectedDigest: row.expected_hash,
        uncertain: row.uncertain,
        auditing: row.auditing,
        linkId: row.link_id,
        file: row.spreadsheet_id,
        tab: row.sheet_name,
        values: row.row_values as (string | number)[],
      };
    },
    credential(db, linkId, writeId, lease) {
      return openLedgerJobCredential(db, services.fieldCrypto(), linkId, writeId, lease);
    },
    async guard(db, row, item, ctx) {
      const result = await db.run<{ allowed: boolean }>(
        "SELECT siljang_ledger_private.guard_ledger_write($1,$2,$3,$4,$5,$6) AS allowed",
        [row.linkId, item.id, ctx.leaseUntil, row.file, row.tab],
      );
      return result.rows[0]?.allowed === true;
    },
    async write(row, credential, guard) {
      if (!guard) throw new Error("ledger guard is not available");
      if (settings.ledgerOAuth === null) throw new Error("ledger OAuth is not configured");
      const key = settings.secrets.REQUEST_HASH_KEY;
      if (key === null) throw new Error("ledger key is not configured");
      const keyVersion = await ledgerRowDigest(key, ["ledger-key-version-v1"]);
      if (
        ((row.expectedDigest || row.confirmedTarget) && row.signatureVersion !== keyVersion) ||
        (row.checkpoint && row.checkpoint.keyVersion !== keyVersion) ||
        (row.confirmedTarget &&
          row.confirmedTarget !== (await ledgerRowDigest(key, ["ledger-target", row.file, row.tab])))
      )
        return row.auditing
          ? { status: "audit_retry" }
          : { status: "conflict", affectedOrderIds: row.checkpoint?.affectedOrderIds ?? [] };
      const deadline = AbortSignal.timeout(15000);
      const bounded = guardedLedgerFetch(guard, deadline);
      const access = await googleLedgerRefresh(settings.ledgerOAuth, credential, { fetch: bounded });
      if (access === null) return { status: row.auditing ? "audit_retry" : "auth_lost" };
      const setup = await ledgerSheetSetup(key, { fetch: bounded }).connect(access, row.shopId, row.file, row.tab);
      if (setup === null) return { status: row.auditing ? "audit_retry" : "auth_lost" };
      const input = {
        file: row.file,
        tab: row.tab,
        access,
        setup,
        values: row.values,
        shopId: row.shopId,
        linkId: row.linkId,
        eventId: row.eventId,
        orderId: row.orderId,
        uncertain: row.uncertain,
        hashKey: key,
        expectedDigest: row.expectedDigest ?? null,
        confirmedExisting: Boolean(row.confirmedTarget && row.expectedDigest),
        expectedDigests: row.expectedDigests ?? {},
        checkpoint: row.checkpoint ?? null,
        purgedOrders: async (ids: readonly string[]) => {
          if (!row.leaseUntil) throw new Error("ledger lease is not available");
          guard.signal.throwIfAborted();
          const lookup = connect(settings.secrets.DATABASE_URL);
          try {
            const found = await lookup.query<{ id: string }>(
              "SELECT siljang_ledger_private.ledger_purged_orders($1,$2,$3,$4,$5::uuid[]) AS id",
              [row.shopId, row.linkId, row.eventId, row.leaseUntil, ids],
            );
            guard.signal.throwIfAborted();
            return new Set(found.rows.map((entry) => entry.id));
          } finally {
            await lookup.close();
          }
        },
        saveCheckpoint: async (checkpoint: import("./ledger-sheet-write").LedgerCheckpoint) => {
          if (!row.leaseUntil) throw new Error("ledger lease is not available");
          guard.signal.throwIfAborted();
          const checkpointData = JSON.stringify(checkpoint);
          guard.signal.throwIfAborted();
          const checkpointDb = connect(settings.secrets.DATABASE_URL);
          try {
            const result = await checkpointDb.query<{ saved: boolean }>(
              "SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5::jsonb) AS saved",
              [row.shopId, row.eventId, row.leaseUntil, row.linkId, checkpointData],
            );
            if (result.rows[0]?.saved !== true) throw new Error("ledger checkpoint was not saved");
          } finally {
            await checkpointDb.close();
          }
          guard.signal.throwIfAborted();
        },
      };
      if (row.auditing) {
        const result = await auditLedgerSheet(input, { fetch: bounded });
        return { status: result === "ok" ? "audit_ok" : result === "missing" ? "audit_missing" : "audit_duplicate" };
      }
      let verifiedDigest: string | null = null;
      try {
        await writeLedgerSheet(
          {
            ...input,
            verifiedDigest: (digest) => {
              verifiedDigest = digest;
            },
          },
          { fetch: bounded },
        );
      } catch (error) {
        if (error instanceof LedgerConflictError)
          return { status: "conflict", affectedOrderIds: error.affectedOrderIds };
        throw error;
      }
      if (verifiedDigest === null) throw new Error("ledger verification is not complete");
      const sheetHash: string = verifiedDigest;
      return {
        status: "written",
        columns: {
          columns: setup.columns,
          movedRight: setup.movedRight,
          ownershipToken: setup.ownershipToken,
          sheetHash,
          keyVersion,
          targetKey: await ledgerRowDigest(key, ["ledger-target", row.file, row.tab]),
        },
      };
    },
    async finish(db, item, ctx, result) {
      await db.run("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,$6::jsonb)", [
        item.id,
        ctx.leaseUntil,
        result.status,
        ctx.now,
        result.status === "written"
          ? JSON.stringify(result.columns)
          : result.status === "conflict"
            ? JSON.stringify({ affectedOrderIds: result.affectedOrderIds ?? [] })
            : null,
      ]);
    },
  });
}
