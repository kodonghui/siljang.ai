import { expect, it } from "vitest";
import { buildLedgerCheckpoint, compareLedgerCheckpoint } from "../src/ledger-checkpoint";
import { Secret } from "../src/settings";

it("장부 비교 기준은 주문 원문 없이 HMAC만 저장하고 내용 변경과 다른 대상을 구분한다", async () => {
  const key = new Secret("synthetic-hmac-key"),
    context = {
      file: "synthetic_sheet_1234567890",
      tab: "장부",
      eventId: crypto.randomUUID(),
      orderId: crypto.randomUUID(),
    };
  const row = [
    "ABC123",
    "합성 이름",
    "010-0000-0000",
    "",
    "",
    "",
    0,
    "",
    "",
    0,
    "",
    "",
    "old",
    context.orderId.replaceAll("-", ""),
  ];
  const sent = [...row.slice(0, 12), context.eventId.replaceAll("-", ""), row[13] ?? ""];
  const checkpoint = await buildLedgerCheckpoint(key, context, [row], sent);
  expect(JSON.stringify(checkpoint)).not.toContain("합성 이름");
  expect(JSON.stringify(checkpoint)).not.toContain("010-0000-0000");
  expect((await compareLedgerCheckpoint(key, context, checkpoint, [row])).changed).toBe(false);
  const edited = [...row];
  edited[1] = "수정";
  expect((await compareLedgerCheckpoint(key, context, checkpoint, [edited])).affectedOrderIds).toContain(
    context.orderId,
  );
  await expect(compareLedgerCheckpoint(key, { ...context, tab: "다른 탭" }, checkpoint, [row])).rejects.toThrow();
});
