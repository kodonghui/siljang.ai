/** 장부 응답에는 열/상태만 두고 시크릿 저장소의 참조와 OAuth 토큰은 반환하지 않는다. */
import { ApiError } from "./problem";
import type { ShopRequest } from "./routes";
import type { ShopDb } from "./shop-scope";
import { unlinkLedgerRecord } from "./ledger-unlink-store";
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
