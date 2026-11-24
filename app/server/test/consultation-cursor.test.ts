import { describe, expect, it } from "vitest";
import { ConsultationCursorError, openConsultationCursor, sealConsultationCursor } from "../src/consultation-cursor";
import { fromBase64Url, toBase64Url } from "../src/encoding";
import { FieldCryptoError } from "../src/field-crypto";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";

const SHOP = crypto.randomUUID(),
  CONSULTATION = crypto.randomUUID();
const position = { at: "1795500000123456", sequence: "19" },
  snapshot = { transaction: "100:200:101,150", ceiling: "30" };
const key = newFieldKey(),
  fc = testFieldCrypto(new Map([[1, key]]), 1);
const seal = () => sealConsultationCursor(fc, SHOP, CONSULTATION, position, snapshot);
describe("상담 암호 커서(TASK-077)", () => {
  it("고정200자이며 위치와 데이터베이스 가시성을 그대로 복원", async () => {
    const token = await seal();
    expect(token).toMatch(/^[A-Za-z0-9_-]{200}$/);
    expect(await openConsultationCursor(fc, SHOP, CONSULTATION, token)).toEqual({ ...position, snapshot });
  });
  it("같은 위치라도 새 nonce로 봉투가 다름", async () => {
    expect(await seal()).not.toBe(await seal());
  });
  it("다른 가게와 다른 상담에서는 풀리지 않음", async () => {
    const token = await seal();
    await expect(openConsultationCursor(fc, crypto.randomUUID(), CONSULTATION, token)).rejects.toBeInstanceOf(
      FieldCryptoError,
    );
    await expect(openConsultationCursor(fc, SHOP, crypto.randomUUID(), token)).rejects.toBeInstanceOf(FieldCryptoError);
  });
  it.each([0, 12, 149])("바이트%d를 바꾸면 거절", async (index) => {
    const bytes = fromBase64Url(await seal());
    if (bytes === null) throw new Error("시험 커서 없음");
    bytes[index] = (bytes[index] ?? 0) ^ 1;
    await expect(openConsultationCursor(fc, SHOP, CONSULTATION, toBase64Url(bytes))).rejects.toBeInstanceOf(Error);
  });
  it("키 교체 뒤에도 남겨 둔 이전 버전으로 풀림", async () => {
    const old = await seal(),
      next = testFieldCrypto(
        new Map([
          [1, key],
          [2, newFieldKey()],
        ]),
        2,
      );
    expect(await openConsultationCursor(next, SHOP, CONSULTATION, old)).toEqual({ ...position, snapshot });
    const fresh = await sealConsultationCursor(next, SHOP, CONSULTATION, position, snapshot);
    await expect(openConsultationCursor(fc, SHOP, CONSULTATION, fresh)).rejects.toBeInstanceOf(FieldCryptoError);
  });
  it.each(["-9223372036854775808", "0", "9223372036854775807"])("마이크로초 정수%s를 보존", async (at) => {
    const token = await sealConsultationCursor(fc, SHOP, CONSULTATION, { ...position, at }, snapshot);
    expect((await openConsultationCursor(fc, SHOP, CONSULTATION, token)).at).toBe(at);
  });
  it("진행 중 트랜잭션이 없는 시점도 보존", async () => {
    const empty = { ...snapshot, transaction: "100:100:" };
    const token = await sealConsultationCursor(fc, SHOP, CONSULTATION, position, empty);
    expect((await openConsultationCursor(fc, SHOP, CONSULTATION, token)).snapshot).toEqual(empty);
  });
  it("진행 중60개를 압축하고 출력 길이는 그대로", async () => {
    const busy = {
      ...snapshot,
      transaction: `10000:10100:${Array.from({ length: 60 }, (_, i) => 10000 + i).join(",")}`,
    };
    const token = await sealConsultationCursor(fc, SHOP, CONSULTATION, position, busy);
    expect(token).toHaveLength(200);
    expect((await openConsultationCursor(fc, SHOP, CONSULTATION, token)).snapshot).toEqual(busy);
  });
  it("용량을 넘으면 메타데이터 없는 고정 오류로 멈춤", async () => {
    const busy = {
      ...snapshot,
      transaction: `10000:11000:${Array.from({ length: 140 }, (_, i) => 10000 + i).join(",")}`,
    };
    await expect(sealConsultationCursor(fc, SHOP, CONSULTATION, position, busy)).rejects.toThrow(
      "consultation cursor capacity exceeded",
    );
  });
  it.each(["0:100:", "200:100:", "100:200:101,101", "100:200:150,101", "100:200:200", "100:200:-1"])(
    "잘못된 스냅샷%s를 봉투로 만들지 않음",
    async (transaction) => {
      await expect(
        sealConsultationCursor(fc, SHOP, CONSULTATION, position, { ...snapshot, transaction }),
      ).rejects.toBeInstanceOf(ConsultationCursorError);
    },
  );
  it("상담 용도에는 상담 바인딩이 꼭 필요하고 기존 저장 봉투에 붙이지 못함", async () => {
    await expect(fc.seal("합성", { purpose: "consultations.message_cursor", shopId: SHOP })).rejects.toBeInstanceOf(
      FieldCryptoError,
    );
    await expect(
      fc.seal("합성", { purpose: "masked_values.original", shopId: SHOP, recordId: CONSULTATION }),
    ).rejects.toBeInstanceOf(FieldCryptoError);
  });
});
