import { expect, it } from "vitest";
import { type FieldContext, FieldCryptoError } from "../src/field-crypto";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";

it("장부 토큰은 가게와 연결에 묶어 암호화하며 다른 연결에서는 풀 수 없다", async () => {
  const crypto = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
  const context = {
    purpose: "ledger_links.oauth_token",
    shopId: globalThis.crypto.randomUUID(),
    recordId: globalThis.crypto.randomUUID(),
  } as FieldContext;
  const token = `synthetic-${"x".repeat(8000)}`;
  const envelope = await crypto.seal(token, context);
  expect(envelope).not.toContain(token);
  expect(await crypto.open(envelope, context)).toBe(token);
  await expect(crypto.open(envelope, { ...context, shopId: globalThis.crypto.randomUUID() })).rejects.toBeInstanceOf(
    FieldCryptoError,
  );
  await expect(crypto.open(envelope, { ...context, recordId: globalThis.crypto.randomUUID() })).rejects.toBeInstanceOf(
    FieldCryptoError,
  );
});
