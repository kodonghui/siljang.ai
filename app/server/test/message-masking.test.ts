import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FieldCryptoError } from "../src/field-crypto";
import { MaskingFailedError, openMaskedValue } from "../src/masked-values";
import { maskMessageText, messageNumbers } from "../src/message-masking";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture } from "./support/shops";

describe("SPEC-021 메시지 번호 분류", () => {
  it.each([
    ["010-1234-5678", "phone", "01012345678"],
    ["010\u200d1234\u200b5678", "phone", "01012345678"],
    ["공일공-1234", "phone", "0101234"],
    ["공일공일이삼사오육칠팔", "phone", "01012345678"],
    ["０１０－１２３４－５６７８", "phone", "01012345678"],
    ["٠١٠ ١٢٣٤ ٥٦٧٨", "phone", "01012345678"],
    ["𝟘𝟙𝟘-𝟙𝟚𝟛𝟜-𝟝𝟞𝟟𝟠", "phone", "01012345678"],
    ["+82 10-1234-5678", "phone", "01012345678"],
    ["02-123-4567", "phone", "021234567"],
    ["031-123-4567", "phone", "0311234567"],
    ["0507-1234-5678", "phone", "050712345678"],
    ["1588-1234", "phone", "15881234"],
    ["계좌 123-456-789012", "account", "123456789012"],
    ["국민 1234567890", "account", "1234567890"],
    ["카드 4111 1111 1111 1111", "card", "4111111111111111"],
    ["계좌 4111-1111-1111-1111", "card", "4111111111111111"],
    ["900101-1234567", "long_number", "9001011234567"],
    ["000229-3123456", "long_number", "0002293123456"],
    ["은행 계좌 900101-1234567", "long_number", "9001011234567"],
    ["123456789", "long_number", "123456789"],
  ])("%s → %s", (text, kind, digits) => {
    expect(messageNumbers(text).map(({ kind, digits }) => ({ kind, digits }))).toEqual([{ kind, digits }]);
  });

  it.each(["K7Q3M9", "12345678", "01012345", "주문번호 12345678이요", "케이크2개에 5000원", "일이 잘되면 내일 봬요"])(
    "주문번호/짧은 수/일반 문장은 보존함(%s)",
    (text) => {
      expect(messageNumbers(text)).toEqual([]);
    },
  );

  it("이모지/조사와 숫자 경계를 보존함", () => {
    const text = "🎂 01012345678이고 주문번호 K7Q3M9입니다";
    const n = messageNumbers(text)[0];
    expect(n?.digits).toBe("01012345678");
    expect(text.slice(n?.start, n?.end)).toBe("01012345678");
  });

  it("공백으로 이어 쓴 두 전화번호를 각각 분류함", () => {
    expect(messageNumbers("010 1234 5678 010 8765 4321").map(({ kind, digits }) => ({ kind, digits }))).toEqual([
      { kind: "phone", digits: "01012345678" },
      { kind: "phone", digits: "01087654321" },
    ]);
  });

  it("환불 계좌 문맥에서10~16자리를 계좌로 봄", () => {
    expect(messageNumbers("1234567890", { refundAccount: true })[0]?.kind).toBe("account");
    expect(messageNumbers("1234567890")[0]?.kind).toBe("long_number");
  });

  it.each(["우리 가게 123456789012", "하나 더 123456789012", "기업 주문 123456789012", "계123456789012좌"])(
    "일반 단어를 은행 이름으로 세어 원본을 보관하지 않음(%s)",
    (text) => {
      expect(messageNumbers(text).map(({ kind, digits }) => ({ kind, digits }))).toEqual([
        { kind: "long_number", digits: "123456789012" },
      ]);
    },
  );

  it("은행 이름 끝의 '일'을 계좌 숫자에 붙이지 않음", () => {
    expect(messageNumbers("SC제일 1234567890").map(({ kind, digits }) => ({ kind, digits }))).toEqual([
      { kind: "account", digits: "1234567890" },
    ]);
  });

  it("번호 끝의 한글 숫자를 조사로 잘라내지 않음", () => {
    expect(messageNumbers("공일공-1234-567팔로 연락 주세요").map(({ kind, digits }) => ({ kind, digits }))).toEqual([
      { kind: "phone", digits: "01012345678" },
    ]);
    expect(messageNumbers("010-1234-567이로 연락 주세요").map(({ kind, digits }) => ({ kind, digits }))).toEqual([
      { kind: "phone", digits: "01012345672" },
    ]);
  });
});

describeDb("마스킹한 메시지와 원본 최소 보존(TASK-028)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  let shop: ShopFixture;
  const { fc } = singleKeyCrypto();
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    shop = await createShop(isolated.db, "메시지 마스킹 시험");
  }, 30_000);
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = (target = shop) =>
    shopRequestDb(createShopScope(target.shopId, { kind: "customer", channelId: target.channelId }), isolated.db);

  it("형식이 다른 같은 전화/계좌는 한 행과 같은 플레이스홀더이고 원문은 암호화함", async () => {
    const text = "전화 공일공-1234-5678, +82 10 1234 5678, 계좌 123-456-789012, 계좌 123456789012";
    const result = await scoped().transaction((tx) => maskMessageText(tx, () => fc, shop.consultationId, text));
    expect(result).toBe("전화 [전화번호1], [전화번호1], 계좌 [계좌번호1], 계좌 [계좌번호1]");
    const { rows } = await isolated.db.query(
      "SELECT kind, placeholder, original_enc, last4 FROM masked_values WHERE shop_id = $1",
      [shop.shopId],
    );
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("01012345678");
    expect(JSON.stringify(rows)).not.toContain("123456789012");
    expect(await scoped().transaction((tx) => openMaskedValue(tx, fc, shop.consultationId, "[전화번호1]"))).toEqual({
      kind: "phone",
      original: "01012345678",
      last4: "5678",
    });
    expect(await scoped().transaction((tx) => maskMessageText(tx, () => fc, shop.consultationId, "01012345678"))).toBe(
      "[전화번호1]",
    );
  });

  it("카드는 끝4자리만, 주민등록번호 모양/긴 숫자는 원본/해시/끝4자리 없이 남김", async () => {
    const target = await createShop(isolated.db, "보관하지 않는 숫자 시험");
    const result = await scoped(target).transaction((tx) =>
      maskMessageText(
        tx,
        () => fc,
        target.consultationId,
        "4111 1111 1111 1111, 4111111111111111, 900101-1234567, 123456789",
      ),
    );
    expect(result).toBe("[카드번호1], [카드번호2], [긴숫자1], [긴숫자2]");
    const { rows } = await isolated.db.query(
      "SELECT kind, original_enc, value_hmac, last4 FROM masked_values WHERE shop_id = $1 ORDER BY placeholder",
      [target.shopId],
    );
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.kind === "card")).toEqual([
      { kind: "card", original_enc: null, value_hmac: null, last4: "1111" },
      { kind: "card", original_enc: null, value_hmac: null, last4: "1111" },
    ]);
    expect(rows.filter((row) => row.kind === "long_number")).toEqual([
      { kind: "long_number", original_enc: null, value_hmac: null, last4: null },
      { kind: "long_number", original_enc: null, value_hmac: null, last4: null },
    ]);
  });

  it("다른 가게의 상담에는 번호를 남기지 않음", async () => {
    const other = await createShop(isolated.db, "다른 가게 마스킹 시험");
    await expect(
      scoped().transaction((tx) => maskMessageText(tx, () => fc, other.consultationId, "010-9876-5432")),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await isolated.db.query("SELECT id FROM masked_values WHERE shop_id = $1", [other.shopId])).rowCount).toBe(
      0,
    );
  });

  it("중간 암호화 실패는 앞에서 넣은 값도 롤백함", async () => {
    const target = await createShop(isolated.db, "암호화 실패 롤백");
    let count = 0;
    const broken = {
      ...fc,
      seal: async (...args: Parameters<typeof fc.seal>) => {
        count += 1;
        if (count === 2) throw new FieldCryptoError("synthetic field failure");
        return fc.seal(...args);
      },
    };
    await expect(
      scoped(target).transaction((tx) =>
        maskMessageText(tx, () => broken, target.consultationId, "010-1111-2222, 010-3333-4444"),
      ),
    ).rejects.toBeInstanceOf(FieldCryptoError);
    expect((await isolated.db.query("SELECT id FROM masked_values WHERE shop_id = $1", [target.shopId])).rowCount).toBe(
      0,
    );
  });

  it("가릴 값이 없으면 키를 열거나 값을 쓰지 않음", async () => {
    const keys = vi.fn(() => {
      throw new Error("키를 열면 안 됨");
    });
    expect(
      await scoped().transaction((tx) => maskMessageText(tx, keys, shop.consultationId, "주문번호 K7Q3M9 케이크2개")),
    ).toBe("주문번호 K7Q3M9 케이크2개");
    expect(keys).not.toHaveBeenCalled();
  });

  it("1,000개 카드 번호는 DB를 쓰기 전에 실패함", async () => {
    const target = await createShop(isolated.db, "마스킹 개수 한도");
    await expect(
      scoped(target).transaction((tx) =>
        maskMessageText(tx, () => fc, target.consultationId, Array(1000).fill("4111-1111-1111-1111").join(", ")),
      ),
    ).rejects.toBeInstanceOf(MaskingFailedError);
    expect((await isolated.db.query("SELECT id FROM masked_values WHERE shop_id = $1", [target.shopId])).rowCount).toBe(
      0,
    );
  });

  it("같은 전화번호1,000번은 한 플레이스홀더/행만 사용함", async () => {
    const target = await createShop(isolated.db, "같은 번호 반복");
    const result = await scoped(target).transaction((tx) =>
      maskMessageText(tx, () => fc, target.consultationId, Array(1000).fill("010-1234-5678").join(", ")),
    );
    expect(result).toBe(Array(1000).fill("[전화번호1]").join(", "));
    expect((await isolated.db.query("SELECT id FROM masked_values WHERE shop_id = $1", [target.shopId])).rowCount).toBe(
      1,
    );
  });
});
