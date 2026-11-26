/** 장부 응답에는 열/상태만 두고 시크릿 저장소의 참조와 OAuth 토큰은 반환하지 않는다. */
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
  return (
    await db.run<LedgerRow>(
      `SELECT l.id,l.status,l.spreadsheet_id,l.sheet_name,l.our_columns,l.linked_at,l.unlinked_at,l.xmin::text AS revision,
      (SELECT min(w.first_failed_at) FROM ledger_writes w WHERE w.shop_id=$1 AND w.status<>'written') AS failing_since,
      (SELECT least(count(*),100000)::int FROM ledger_writes wc WHERE wc.shop_id=$1 AND wc.status<>'written') AS unwritten_count
     FROM ledger_links l WHERE l.shop_id=$1
     ORDER BY (l.status<>'unlinked') DESC,l.linked_at DESC,l.id DESC LIMIT 1`,
    )
  ).rows[0];
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
