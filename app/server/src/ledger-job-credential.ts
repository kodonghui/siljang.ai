import type { FieldCrypto } from "./field-crypto";
import { Secret } from "./settings";
import type { ShopDb } from "./shop-scope";

/** 작업 임대와 가게·연결을 확인한 함수의 암호문만 앱에서 연다. */
export async function openLedgerJobCredential(
  db: ShopDb,
  fields: FieldCrypto,
  linkId: string,
  writeId: string,
  leaseUntil: Date,
): Promise<Secret | null> {
  if (db.scope.via.kind !== "job" || db.scope.via.job !== "ledger_write")
    throw new TypeError("ledger job scope required");
  const result = await db.run<{ envelope: string | null }>(
    "SELECT siljang_ledger_private.read_leased_ledger_credential($1,$2,$3,$4) AS envelope",
    [linkId, writeId, leaseUntil],
  );
  const envelope = result.rows[0]?.envelope;
  if (!envelope) return null;
  return new Secret(
    await fields.open(envelope, { purpose: "ledger_links.oauth_token", shopId: db.scope.shopId, recordId: linkId }),
  );
}
