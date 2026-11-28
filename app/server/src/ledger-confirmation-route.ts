import { GoogleLedgerUnavailableError } from "./ledger-google-auth";
import { LedgerConflictError, LedgerDuplicateError } from "./ledger-sheet-write";
import { ApiError } from "./problem";
import type { ShopRequest } from "./routes";
import { Secret } from "./settings";
import { isUuid } from "./shop-scope";

/** 사장님이 해당 주문을 확인한 순간의 행 서명만 남기고 주문 하나를 다시 연다. */
export async function confirmOwnerLedgerOrder(r: ShopRequest): Promise<Response> {
  const owner = r.scope.via,
    taskId = r.pathId("taskId"),
    expected = r.req.header("X-Expected-Shop-Id");
  if (owner.kind !== "owner") throw new ApiError("unauthenticated");
  if (expected !== undefined && (!isUuid(expected) || expected.toLowerCase() !== r.scope.shopId))
    throw new ApiError("unauthenticated");
  const enabled = (
    await r.db.run<{ enabled: boolean }>("SELECT s.ledger_write_enabled AS enabled FROM shops s WHERE s.id=$1")
  ).rows[0]?.enabled;
  if (!enabled) throw new ApiError("not_found");
  return r.command({
    command: "API-084",
    pathIds: [taskId],
    body: null,
    async execute(db) {
      const prepared = (
        await db.run<{
          link_id: string;
          spreadsheet_id: string;
          sheet_name: string;
          envelope: string;
          order_id: string;
          order_no: string;
        }>("SELECT * FROM siljang_ledger_private.prepare_ledger_confirmation($1,$2,$3)", [owner.ownerId, taskId])
      ).rows[0];
      if (!prepared || !prepared.envelope) throw new ApiError("not_found");
      try {
        const token = await r.services.fieldCrypto().open(prepared.envelope, {
          purpose: "ledger_links.oauth_token",
          shopId: db.scope.shopId,
          recordId: prepared.link_id,
        });
        const confirmed = await r.services.ledgerConfirmation().inspect({
          shopId: db.scope.shopId,
          linkId: prepared.link_id,
          orderId: prepared.order_id,
          orderNo: prepared.order_no,
          file: prepared.spreadsheet_id,
          tab: prepared.sheet_name,
          refreshToken: new Secret(token),
        });
        const saved = await db.run<{ ok: boolean }>(
          "SELECT siljang_ledger_private.confirm_ledger_order($1,$2,$3,$4,$5,$6,$7,$8) AS ok",
          [
            owner.ownerId,
            taskId,
            prepared.link_id,
            confirmed.targetKey,
            confirmed.eventId,
            confirmed.digest,
            confirmed.keyVersion,
          ],
        );
        if (!saved.rows[0]?.ok) throw new ApiError("version_conflict");
        return { status: 200, code: "confirmed", ref: {}, body: { outcome: "confirmed" } };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof LedgerConflictError || error instanceof LedgerDuplicateError)
          throw new ApiError("version_conflict");
        if (error instanceof GoogleLedgerUnavailableError) throw new ApiError("google_unavailable");
        throw error;
      }
    },
    async render() {
      return { outcome: "confirmed" };
    },
  });
}
