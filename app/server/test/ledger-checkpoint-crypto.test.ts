import { expect, it } from "vitest";
import { openLedgerCheckpoint, sealLedgerCheckpoint } from "../src/ledger-checkpoint";
import { singleKeyCrypto } from "./support/field-keys";

it("비교 기준은 가게와 쓰기 ID에 묶인 앱 암호문으로만 저장하고 크기가 큰 정상 기준도 풀 수 있다", async () => {
  const fields = singleKeyCrypto().fc,
    shopId = crypto.randomUUID(),
    writeId = crypto.randomUUID();
  const context = { shopId, writeId, file: "synthetic_sheet_1234567890", tab: "장부" };
  const original = {
    before: [["ABC123", "합성 이름", "X".repeat(1000), "", "", "", 0, "", "", 0, "", "", "", ""]],
    values: ["ABC123", "이름", "", "", "", "", 0, "", "", 0, "", ""],
  };
  const envelope = await sealLedgerCheckpoint(fields, context, original);
  expect(envelope).not.toContain("합성 이름");
  expect(await openLedgerCheckpoint(fields, context, envelope)).toEqual(original);
  await expect(openLedgerCheckpoint(fields, { ...context, writeId: crypto.randomUUID() }, envelope)).rejects.toThrow();
  await expect(
    openLedgerCheckpoint(fields, { ...context, file: "another_sheet_1234567890" }, envelope),
  ).rejects.toThrow();
});
