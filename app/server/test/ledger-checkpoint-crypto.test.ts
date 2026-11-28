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
it("비교 기준에는 키 버전이 있고 키가 바뀌면 검증할 수 없다", async () => {
  const context = {
    file: "synthetic_sheet_1234567890",
    tab: "장부",
    eventId: crypto.randomUUID(),
    orderId: crypto.randomUUID(),
  };
  const oldKey = new Secret("synthetic-old-key"),
    newKey = new Secret("synthetic-new-key");
  const before = await buildLedgerCheckpoint(oldKey, context, [], []);
  const after = await buildLedgerCheckpoint(newKey, context, [], []);
  expect(before).toHaveProperty("keyVersion");
  expect(before.keyVersion).not.toEqual(after.keyVersion);
  await expect(compareLedgerCheckpoint(newKey, context, before, [])).rejects.toThrow(/key version/);
});
it("주문 ID 없는 옛 시트 행은 삭제된 주문일 수 있어 서명을 다시 수집하지 않고 불확실 재개를 멈춘다", async () => {
  const key = new Secret("synthetic-hmac-key"),
    context = {
      file: "synthetic_sheet_1234567890",
      tab: "장부",
      eventId: crypto.randomUUID(),
      orderId: crypto.randomUUID(),
    };
  const old = ["ABC123", "오래된 이름", "010-0000-0000", "", "", "", 0, "", "", 0, "", "", "", ""];
  const checkpoint = await buildLedgerCheckpoint(key, context, [old], []);
  expect(checkpoint.rows).toEqual([]);
  expect(checkpoint).toHaveProperty("unidentifiedRows", true);
  expect((await compareLedgerCheckpoint(key, context, checkpoint, [old])).changed).toBe(true);
});
