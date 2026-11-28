import { expect, it } from "vitest";
import { storeLedgerCredential } from "../src/ledger-credential-store";
import { Secret } from "../src/settings";
import type { ShopDb } from "../src/shop-scope";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";

it("저장 요청에는 토큰 평문이 아니라 연결에 묶인 앱 암호문만 넘긴다", async () => {
  const shopId = crypto.randomUUID(),
    ownerId = crypto.randomUUID(),
    linkId = crypto.randomUUID();
  const token = `test-${"x".repeat(300)}`;
  const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
  let params: readonly unknown[] = [];
  const db = {
    scope: { shopId, via: { kind: "owner", ownerId } },
    run: async (_sql: string, values: readonly unknown[]) => {
      params = values;
      return { rows: [{ ok: true }], rowCount: 1 };
    },
  } as unknown as ShopDb;
  await storeLedgerCredential(db, fields, linkId, new Secret(token));
  expect(JSON.stringify(params)).not.toContain(token);
  expect(
    await fields.open(params[2] as string, { purpose: "ledger_links.oauth_token", shopId, recordId: linkId }),
  ).toBe(token);
});
