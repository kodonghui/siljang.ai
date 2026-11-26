import { expect, it } from "vitest";
import { FieldCryptoError } from "../src/field-crypto";
import {
  OperatorRecordCursorError,
  type OperatorRecordCursorScope,
  openOperatorRecordCursor,
  sealOperatorRecordCursor,
} from "../src/operator-record-cursor";
import { newFieldKey, singleKeyCrypto, testFieldCrypto } from "./support/field-keys";

const SHOP = crypto.randomUUID(),
  RESOURCE = crypto.randomUUID(),
  ROW = crypto.randomUUID();
const AT = "2026-11-28T06:00:00.000001Z";
const scope: OperatorRecordCursorScope = { shopId: SHOP, resourceId: RESOURCE, kind: "messages" };
const position = { at: AT, key: "9007199254740993" };
it.each(["orders", "consultations", "messages"] as const)(
  "%s 커서는 마이크로초와 큰 순번·ID를 보존하고 개인정보 없는 고정 길이 봉투다",
  async (kind) => {
    const { fc } = singleKeyCrypto(),
      context = { ...scope, kind };
    const current = { at: AT, key: kind === "messages" ? position.key : ROW };
    const token = await sealOperatorRecordCursor(fc, context, current);
    expect(token).toMatch(/^[A-Za-z0-9_-]{1,200}$/);
    expect(token).toHaveLength(179);
    expect(token).not.toContain(AT);
    expect(token).not.toContain(current.key);
    expect(await openOperatorRecordCursor(fc, context, token)).toEqual(current);
    expect(await sealOperatorRecordCursor(fc, context, current)).not.toBe(token);
  },
);
it.each([{ shopId: crypto.randomUUID() }, { resourceId: crypto.randomUUID() }, { kind: "orders" as const }])(
  "다른 가게·대상·종류의 커서는 열리지 않는다(%j)",
  async (changed) => {
    const { fc } = singleKeyCrypto(),
      token = await sealOperatorRecordCursor(fc, scope, position);
    await expect(openOperatorRecordCursor(fc, { ...scope, ...changed }, token)).rejects.toBeInstanceOf(
      OperatorRecordCursorError,
    );
  },
);
it("변조·채움·초과 길이·빈 커서는 원문 없는 같은 오류다", async () => {
  const { fc } = singleKeyCrypto(),
    token = await sealOperatorRecordCursor(fc, scope, position);
  for (const bad of [
    "",
    "x".repeat(201),
    `${token}=`,
    `${token.slice(0, -12)}AAAAAAAAAAAA`,
    token.replace(/^v1_/, "v2_"),
  ]) {
    await expect(openOperatorRecordCursor(fc, scope, bad)).rejects.toMatchObject({
      name: "OperatorRecordCursorError",
      message: "invalid operator record cursor",
    });
  }
});
it("키를 바꾼 뒤 앞 버전은 읽고 새 봉투는 새 버전으로 쓰며 사장님 커서와 용도가 나뉜다", async () => {
  const first = newFieldKey(),
    second = newFieldKey(),
    old = testFieldCrypto(new Map([[1, first]]), 1);
  const current = testFieldCrypto(
    new Map([
      [1, first],
      [2, second],
    ]),
    2,
  );
  const token = await sealOperatorRecordCursor(old, scope, position);
  expect(await openOperatorRecordCursor(current, scope, token)).toEqual(position);
  expect(await sealOperatorRecordCursor(current, scope, position)).toMatch(/^v2_/);
  await expect(
    old.open(token.replace(/^v1_/, "v1:"), {
      purpose: "consultations.message_cursor",
      shopId: SHOP,
      recordId: RESOURCE,
    }),
  ).rejects.toBeInstanceOf(FieldCryptoError);
});
it.each([
  { at: "2026-02-30T06:00:00.000001Z", key: "1" },
  { at: "0000-01-01T00:00:00.000000Z", key: "1" },
  { at: "2026-11-28T06:00:00Z", key: "1" },
  { at: AT, key: "0" },
  { at: AT, key: "-1" },
  { at: AT, key: "9223372036854775808" },
])("잘못된 시각·순번은 봉투로 쓰지 않는다(%j)", async (bad) => {
  const { fc } = singleKeyCrypto();
  await expect(sealOperatorRecordCursor(fc, scope, bad)).rejects.toBeInstanceOf(OperatorRecordCursorError);
});
