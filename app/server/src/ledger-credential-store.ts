import type { FieldCrypto } from "./field-crypto";
import { ApiError } from "./problem";
import type { Secret } from "./settings";
import type { ShopDb } from "./shop-scope";

/** 토큰을 앱 키로 감싼 뒤 가게 소유 확인 함수에 암호문만 전달한다. */
export async function storeLedgerCredential(
  db: ShopDb,
  fields: FieldCrypto,
  linkId: string,
  token: Secret,
): Promise<void> {
  if (db.scope.via.kind !== "owner") throw new ApiError("unauthenticated");
  const envelope = await fields.seal(token.reveal(), {
    purpose: "ledger_links.oauth_token",
    shopId: db.scope.shopId,
    recordId: linkId,
  });
  const result = await db.run<{ ok: boolean }>("SELECT private.store_ledger_credential($1,$2,$3,$4) AS ok", [
    db.scope.via.ownerId,
    linkId,
    envelope,
  ]);
  if (!result.rows[0]?.ok) throw new ApiError("not_set");
}
