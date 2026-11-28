import { expect, it } from "vitest";
import { openLedgerJobCredential } from "../src/ledger-job-credential";
import type { ShopDb } from "../src/shop-scope";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";

it("임대한 연결의 암호문만 함수로 읽어 가게와 연결에 묶어 복호화한다", async () => {
  const shopId = crypto.randomUUID(),
    linkId = crypto.randomUUID(),
    writeId = crypto.randomUUID();
  const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
  const envelope = await fields.seal("test-refresh-token", {
    purpose: "ledger_links.oauth_token",
    shopId,
    recordId: linkId,
  });
  let sql = "",
    params: readonly unknown[] = [];
  const db = {
    scope: { shopId, via: { kind: "job", job: "ledger_write" } },
    run: async (s: string, p: readonly unknown[]) => {
      sql = s;
      params = p;
      return { rows: [{ envelope }], rowCount: 1 };
    },
  } as unknown as ShopDb;
  const lease = new Date("2026-11-28T00:02:00Z");
  expect((await openLedgerJobCredential(db, fields, linkId, writeId, lease))?.reveal()).toBe("test-refresh-token");
  expect(sql).toContain("siljang_ledger_private.read_leased_ledger_credential");
  expect(params).toEqual([linkId, writeId, lease]);
  const wrong = { ...db, scope: { shopId, via: { kind: "owner", ownerId: crypto.randomUUID() } } } as unknown as ShopDb;
  await expect(openLedgerJobCredential(wrong, fields, linkId, writeId, lease)).rejects.toThrow();
});
