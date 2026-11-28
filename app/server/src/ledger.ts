/** 장부 응답에는 열/상태만 두고 시크릿 저장소의 참조와 OAuth 토큰은 반환하지 않는다. */

import { requireJson } from "./body";
import { errorFields } from "./error-name";
import { storeLedgerCredential } from "./ledger-credential-store";
import type { GoogleLedgerCredential } from "./ledger-google-auth";
import { parseLedgerLink } from "./ledger-input";
import { LEDGER_COOKIE } from "./ledger-oauth";
import type { LedgerSheetSetup } from "./ledger-sheet-setup";
import { unlinkLedgerRecord } from "./ledger-unlink-store";
import { readCookie } from "./owner-oauth";
import { ApiError } from "./problem";
import type { ShopRequest } from "./routes";
import type { ShopDb } from "./shop-scope";
import { toShopIso } from "./time";

export interface LedgerRow {
  id: string;
  status: "linked" | "auth_lost" | "unlinked";
  spreadsheet_id: string;
  sheet_name: string;
  our_columns: unknown;
  linked_at: Date;
  unlinked_at: Date | null;
  revision: string;
  failing_since: Date | null;
  unwritten_count: number;
}
function columns(raw: unknown) {
  const object =
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const values = Array.isArray(raw) ? raw : object?.columns;
  if (!Array.isArray(values) || values.length < 1 || values.length > 30) throw new Error("invalid ledger columns");
  if (object?.movedRight !== undefined && typeof object.movedRight !== "boolean")
    throw new Error("invalid ledger columns");
  return {
    columns: values.map((value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("invalid ledger columns");
      const cell = value as Record<string, unknown>;
      if (
        typeof cell.header !== "string" ||
        [...cell.header].length < 1 ||
        [...cell.header].length > 40 ||
        typeof cell.column !== "string" ||
        !/^[A-Z]{1,3}$/.test(cell.column)
      )
        throw new Error("invalid ledger columns");
      return { header: cell.header, column: cell.column };
    }),
    movedRight: object?.movedRight === true,
  };
}
export async function currentLedger(db: ShopDb): Promise<LedgerRow | undefined> {
  if (db.scope.via.kind !== "owner") throw new ApiError("unauthenticated");
  return (await db.run<LedgerRow>("SELECT * FROM public.read_owner_ledger($1,$2,NULL)", [db.scope.via.ownerId]))
    .rows[0];
}
export async function renderLedger(db: ShopDb, row: LedgerRow) {
  const zone = (await db.found<{ time_zone: string }>("SELECT s.time_zone FROM shops s WHERE s.id=$1")).time_zone;
  return {
    status: row.status,
    spreadsheetId: row.spreadsheet_id,
    sheetName: row.sheet_name,
    ...columns(row.our_columns),
    failingSince: row.failing_since === null ? null : toShopIso(row.failing_since, zone),
    unwrittenCount: row.unwritten_count,
    linkedAt: toShopIso(row.linked_at, zone),
    unlinkedAt: row.unlinked_at === null ? null : toShopIso(row.unlinked_at, zone),
    revision: row.revision,
  };
}
export async function getLedger(r: ShopRequest): Promise<Response> {
  return r.json(
    await r.db.transaction(async (db) => {
      const row = await currentLedger(db);
      if (!row) throw new ApiError("not_set");
      return renderLedger(db, row);
    }),
  );
}

/** API-036: 연결과 Vault 암호문을 같은 트랜잭션에서 해제한다. */
export async function unlinkLedger(r: ShopRequest): Promise<Response> {
  return r.command({
    command: "API-036",
    pathIds: [],
    body: null,
    async execute(db) {
      const result = await unlinkLedgerRecord(db, r.services.now());
      const row = await currentLedger(db);
      if (!row) throw new ApiError("not_set");
      return {
        status: 200,
        code: result.outcome,
        ref: { linkId: result.linkId, keptWrites: result.keptWrites },
        body: { outcome: result.outcome, ledger: await renderLedger(db, row), keptWrites: result.keptWrites },
      };
    },
    async render(db, stored) {
      if (db.scope.via.kind !== "owner" || typeof stored.ref.linkId !== "string") throw new ApiError("not_set");
      const row = (
        await db.run<LedgerRow>("SELECT * FROM public.read_owner_ledger($1,$2,$3)", [
          db.scope.via.ownerId,
          stored.ref.linkId,
        ])
      ).rows[0];
      if (!row) throw new ApiError("not_set");
      return { outcome: stored.code, ledger: await renderLedger(db, row), keptWrites: stored.ref.keptWrites };
    },
  });
}

/** API-035: 인가·시트 준비와 암호문 저장을 가게 범위에서 처리한다. */
export async function linkLedger(r: ShopRequest): Promise<Response> {
  requireJson(r.req.raw);
  const raw = await r.body(),
    input = parseLedgerLink(raw),
    actor = r.scope.via;
  if (actor.kind !== "owner") throw new ApiError("unauthenticated");
  let verified: { redirect: string; verifier: string } | null = null;
  return r.command({
    command: "API-035",
    pathIds: [],
    body: raw,
    async prepare(db) {
      const locked = (
        await db.run<{ outcome: string }>("SELECT siljang_ledger_private.lock_owner_ledger($1,$2,$3) AS outcome", [
          actor.ownerId,
          input.baseRevision,
        ])
      ).rows[0];
      if (locked?.outcome === "conflict") throw new ApiError("version_conflict");
      if (locked?.outcome !== "ok") throw new ApiError("not_set");
      verified = await r.services
        .ledgerAuthorization()
        .verify(
          { shopId: db.scope.shopId, ownerId: actor.ownerId },
          input.state,
          readCookie(r.req.header("cookie"), LEDGER_COOKIE),
          r.services.now(),
        );
      if (verified === null) throw new ApiError("google_authorization_failed");
      r.services.fieldCrypto();
      r.services.ledgerSetup();
      r.services.ledgerGoogle();
      const vault = (
        await db.run<{ ready: boolean }>(
          "SELECT siljang_ledger_private.ledger_vault_ready() AS ready WHERE $1::uuid IS NOT NULL",
        )
      ).rows[0];
      if (!vault?.ready) throw new Error("ledger vault is unavailable");
      const fingerprint = await r.services.ledgerCodeFingerprint(input.code);
      const consumed = (
        await db.run<{ consumed: boolean }>(
          "SELECT siljang_ledger_private.consume_owner_ledger_code($1,$2,$3) AS consumed",
          [actor.ownerId, fingerprint],
        )
      ).rows[0];
      if (!consumed?.consumed) throw new ApiError("google_authorization_failed");
    },
    async execute(db) {
      const state = verified;
      if (state === null) throw new ApiError("google_authorization_failed");
      const locked = (
        await db.run<{ outcome: string }>("SELECT siljang_ledger_private.lock_owner_ledger($1,$2,$3) AS outcome", [
          actor.ownerId,
          input.baseRevision,
        ])
      ).rows[0];
      if (locked?.outcome === "conflict") throw new ApiError("version_conflict");
      if (locked?.outcome !== "ok") throw new ApiError("not_set");
      const fields = r.services.fieldCrypto();
      const sheets = r.services.ledgerSetup();
      let credential: GoogleLedgerCredential | null;
      let setup: LedgerSheetSetup | null;
      try {
        credential = await r.services.ledgerGoogle().exchange(input.code, state.redirect, state.verifier);
        if (credential === null) throw new ApiError("google_authorization_failed");
        setup = await sheets.connect(credential.accessToken, db.scope.shopId, input.spreadsheetId, input.sheetName);
        if (setup === null) throw new ApiError("sheet_not_accessible");
        const id = crypto.randomUUID();
        const created = (
          await db.run<{ outcome: string }>(
            "SELECT * FROM siljang_ledger_private.create_owner_ledger($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
            [
              actor.ownerId,
              id,
              input.spreadsheetId,
              input.sheetName,
              JSON.stringify({
                columns: setup.columns,
                movedRight: setup.movedRight,
                ownershipToken: setup.ownershipToken,
              }),
              input.baseRevision,
              r.services.now(),
            ],
          )
        ).rows[0];
        if (created?.outcome === "conflict") throw new ApiError("version_conflict");
        if (!created) throw new ApiError("not_set");
        await storeLedgerCredential(db, fields, id, credential.refreshToken);
        const row = await currentLedger(db);
        if (!row) throw new ApiError("not_set");
        return {
          status: 200,
          code: created.outcome,
          ref: { linkId: id },
          body: { outcome: created.outcome, ledger: await renderLedger(db, row) },
        };
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.code === "google_authorization_failed" || error.code === "sheet_not_accessible")
        )
          throw error;
        r.log("error", { event: "ledger_link_uncertain", traceId: r.traceId, ...errorFields(error) });
        throw new ApiError("google_unavailable");
      }
    },
    async render(db, stored) {
      if (db.scope.via.kind !== "owner" || typeof stored.ref.linkId !== "string") throw new ApiError("not_set");
      const row = (
        await db.run<LedgerRow>("SELECT * FROM public.read_owner_ledger($1,$2,$3)", [
          db.scope.via.ownerId,
          stored.ref.linkId,
        ])
      ).rows[0];
      if (!row) throw new ApiError("not_set");
      return { outcome: stored.code, ledger: await renderLedger(db, row) };
    },
  });
}
