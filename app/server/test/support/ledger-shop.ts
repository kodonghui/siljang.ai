import { createShop as createOrdinaryShop } from "./shops";

/** 장부 실행 경로의 기존 시험은 관리자가 켠 시험 가게를 명시한다. */
export async function createLedgerShop(...args: Parameters<typeof createOrdinaryShop>) {
  const shop = await createOrdinaryShop(...args);
  await args[0].query("UPDATE shops SET ledger_write_enabled=true WHERE id=$1", [shop.shopId]);
  return shop;
}
