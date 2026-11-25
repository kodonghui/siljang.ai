import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { prepareConfirmCardInTransaction, showConfirmCard } from "../src/confirm-card-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z");
const PROPOSED = { lettering: "합성 바뀐 문구" } as const;
const { fc } = singleKeyCrypto();
describeDb("변경 카드의 서버 준비 값과 실제 발급/갱신 API", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string, clock: Date;
  let beforeLettering: string;
  const execute = vi.fn(async () => ({
    outcome: "change_requested",
    text: "변경을 요청했어요. 사장님이 보고 알려 드려요",
  }));
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    clock = NOW;
    execute.mockClear();
    shop = await createShop(isolated.db, "합성 변경 카드 원본 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const payment = newUuid();
    await isolated.db.query(
      "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
      [shop.paymentRequestId, NOW],
    );
    await isolated.db.query(
      "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
      [payment, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
    );
    await isolated.db.query(
      "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1",
      [shop.orderId, NOW, payment],
    );
    beforeLettering =
      (
        await isolated.db.query<{ lettering: string | null }>(
          "SELECT lettering FROM order_details WHERE order_id=$1 AND version=1",
          [shop.orderId],
        )
      ).rows[0]?.lettering ?? "";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 변경 카드의 실제 발신 금지"));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const show = (sourceMessageId = newUuid(), proposedChanges: Readonly<Record<string, unknown>> = PROPOSED) => {
    const input = {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "change_request" as const,
      orderId: shop.orderId,
      sourceMessageId,
      proposedChanges,
      now: clock,
    };
    return showConfirmCard(scoped(), input);
  };
  const request = (kind: "message" | "card", cardKey?: string) =>
    createApp({
      connect: () => isolated.connect(),
      services: { now: () => clock, fieldCrypto: fc, confirmCardCommand: execute },
      logSink: () => {},
    }).request(
      `/api/kakao/skills/${kind}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance: kind === "message" ? "합성 변경 카드 보기" : "변경 요청",
            block: { id: kind === "card" ? "blk-card" : "conversation" },
            user: { id: shop.userKey, type: "botUserKey" },
          },
          action: {
            id: `synthetic-change-${kind}`,
            params: kind === "card" ? { lettering: "위조 변경 문구" } : {},
            ...(kind === "card" ? { clientExtra: { cardKey, choice: "confirm" } } : {}),
          },
        }),
      },
      testEnv(),
    );
  async function applyOtherChange() {
    const card = newUuid(),
      change = newUuid();
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,created_at,expires_at,used_at,outcome) VALUES($1,$2,$3,$4,$5,'change_request',$6,1,'{}',$7,$8,$7,'done')",
        [
          card,
          shop.shopId,
          shop.consultationId,
          shop.customerId,
          `ck_${card}`,
          shop.orderId,
          NOW,
          new Date(NOW.getTime() + 1800000),
        ],
      );
      await tx.query(
        "INSERT INTO change_requests(id,shop_id,order_id,card_id,base_version,changes,status,amount_delta,decided_at,applied_version,applied_at,created_at) VALUES($1,$2,$3,$4,1,$5::jsonb,'applied',0,$6,2,$6,$6)",
        [change, shop.shopId, shop.orderId, card, JSON.stringify({ colors: "합성 바뀐 색" }), NOW],
      );
      await tx.query(
        "INSERT INTO order_details SELECT(jsonb_populate_record(NULL::order_details,to_jsonb(d)||$2::jsonb)).* FROM order_details d WHERE d.order_id=$1 AND d.version=1",
        [
          shop.orderId,
          JSON.stringify({
            id: newUuid(),
            version: 2,
            source: "change_request",
            change_request_id: change,
            quote_id: null,
            colors: "합성 바뀐 색",
            created_at: NOW.toISOString(),
          }),
        ],
      );
      await tx.query("UPDATE orders SET version=2 WHERE id=$1", [shop.orderId]);
    });
  }
  it("API070은 저장소에서 발급한 카드의 실제 변경 전후·현재 버전·기한을 표시한다", async () => {
    const source = newUuid(),
      card = await show(source);
    clock = new Date(NOW.getTime() + 600000);
    await isolated.db.query(
      "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','card',$4,'변경 요청','deferred',$5)",
      [newUuid(), shop.shopId, shop.consultationId, source, NOW],
    );
    const response = await request("message"),
      body = await response.json();
    expect(response.status).toBe(200);
    expectSchema("SkillTemplateResponse", body);
    const text = JSON.stringify(body);
    for (const value of [
      `문구: ${beforeLettering || "없음"} → ${PROPOSED.lettering}`,
      "지금 버전 1",
      "15:30까지 눌러 주세요",
      card.cardKey,
    ])
      expect(text).toContain(value);
    expect(text).not.toContain("위조 변경 문구");
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(["expired", "stale"] as const)(
    "API071의 %s 갱신도 저장된 제안과 현재 주문으로 새 표시 값을 만든다",
    async (mode) => {
      const card = await show();
      if (mode === "expired") clock = new Date(NOW.getTime() + 1800000);
      else await applyOtherChange();
      const response = await request("card", card.cardKey),
        body = await response.json();
      expect(response.headers.get("Siljang-Outcome")).toBe(`card_${mode}`);
      expectSchema("SkillTemplateResponse", body);
      const text = JSON.stringify(body);
      for (const value of [
        `문구: ${beforeLettering || "없음"} → ${PROPOSED.lettering}`,
        `지금 버전 ${mode === "stale" ? 2 : 1}`,
        mode === "expired" ? "16:00까지 눌러 주세요" : "15:30까지 눌러 주세요",
      ])
        expect(text).toContain(value);
      expect(text).not.toContain(card.cardKey);
      expect(text).not.toContain("위조 변경 문구");
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it.each(["expired", "stale"] as const)("갱신된 %s 옛 카드 재클릭은 첫 안내만 한 번 보인다", async (mode) => {
    const card = await show();
    if (mode === "expired") clock = new Date(NOW.getTime() + 1800000);
    else await applyOtherChange();
    const first = await request("card", card.cardKey);
    expect(first.headers.get("Siljang-Outcome")).toBe(`card_${mode}`);
    const count = (
      await isolated.db.query("SELECT count(*)::int AS n FROM confirm_cards WHERE shop_id=$1", [shop.shopId])
    ).rows[0]?.n;
    const repeated = await request("card", card.cardKey),
      body = await repeated.json();
    expect(repeated.headers.get("Siljang-Outcome")).toBe("card_used");
    expectSchema("SkillTemplateResponse", body);
    expect(body).toHaveProperty("template.outputs", [
      {
        simpleText: {
          text: mode === "expired" ? "시간이 지나 새 카드를 보내 드려요" : "내용이 바뀌었어요. 새 카드를 확인해 주세요",
        },
      },
    ]);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rows[0]
        ?.n,
    ).toBe(count);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([{}, { amount: 1 }, { currentVersion: 999 }, { lettering: "" }])(
    "유효한 실제 변경이 없는 서버 제안은 카드와 변경 요청을 쓰지 않는다(%j)",
    async (proposedChanges) => {
      const result = await scoped().transaction((tx) =>
        prepareConfirmCardInTransaction(tx, {
          customerId: shop.customerId,
          consultationId: shop.consultationId,
          kind: "change_request",
          orderId: shop.orderId,
          proposedChanges,
          now: NOW,
        }),
      );
      expect(result).toHaveProperty("unavailable", true);
      expect(
        (await isolated.db.query("SELECT count(*)::int AS n FROM confirm_cards WHERE shop_id=$1", [shop.shopId]))
          .rows[0]?.n,
      ).toBe(0);
      expect(
        (await isolated.db.query("SELECT count(*)::int AS n FROM change_requests WHERE shop_id=$1", [shop.shopId]))
          .rows[0]?.n,
      ).toBe(0);
    },
  );
  it.each((["message", "card"] as const).flatMap((mode) => ["\r\n", "\r"].map((newline) => [mode, newline] as const)))(
    "디자인 설명의 유효한 줄바꿈을 실제 표시/갱신에서 보존한다(%s/%j)",
    async (mode, newline) => {
      const before = `합성 기존 첫 줄${newline}기존 둘째 줄`,
        after = `합성 바꾼 첫 줄${newline}바꾼 둘째 줄`;
      await isolated.db.query("UPDATE order_details SET design_notes=$2 WHERE order_id=$1 AND version=1", [
        shop.orderId,
        before,
      ]);
      const source = newUuid(),
        card = await show(source, { designNotes: after });
      if (mode === "message")
        await isolated.db.query(
          "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','card',$4,'변경 요청','deferred',$5)",
          [newUuid(), shop.shopId, shop.consultationId, source, NOW],
        );
      else clock = new Date(NOW.getTime() + 1800000);
      const response = await request(mode, card.cardKey),
        body = await response.json();
      expect(response.status).toBe(200);
      expectSchema("SkillTemplateResponse", body);
      const rendered = JSON.stringify(body);
      expect(rendered).toContain("합성 기존 첫 줄\\n기존 둘째 줄");
      expect(rendered).toContain("합성 바꾼 첫 줄\\n바꾼 둘째 줄");
      expect(rendered).not.toContain("\\r");
      expect(execute).not.toHaveBeenCalled();
      expect(
        (
          await isolated.db.query(
            "SELECT payload->'proposedChanges'->>'designNotes' AS value FROM confirm_cards WHERE card_key=$1",
            [card.cardKey],
          )
        ).rows[0]?.value,
      ).toBe(after);
    },
  );
  it("줄바꿈 형식만 다른 같은 제안으로 빈 변경 카드를 만들지 않는다", async () => {
    await isolated.db.query(
      "UPDATE order_details SET design_notes='합성 첫 줄'||chr(13)||chr(10)||'둘째 줄' WHERE order_id=$1 AND version=1",
      [shop.orderId],
    );
    const prepared = await scoped().transaction((tx) =>
      prepareConfirmCardInTransaction(tx, {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        kind: "change_request",
        orderId: shop.orderId,
        proposedChanges: { designNotes: "합성 첫 줄\n둘째 줄" },
        now: NOW,
      }),
    );
    expect(prepared).toHaveProperty("unavailable", true);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rows[0]
        ?.n,
    ).toBe(0);
  });
  it("다른 가게 주문은 표시 원본으로 사용할 수 없다", async () => {
    const other = await createShop(isolated.db, "합성 외부 변경 원본 가게");
    await expect(
      showConfirmCard(scoped(), {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        kind: "change_request",
        orderId: other.orderId,
        proposedChanges: PROPOSED,
        now: NOW,
      }),
    ).rejects.toThrow("card source unavailable");
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rows[0]
        ?.n,
    ).toBe(0);
  });
  it("결제 전 주문에는 R16 안내만 준비하고 카드를 만들지 않는다", async () => {
    const other = await createShop(isolated.db, "합성 결제 전 변경 가게");
    await linkTestChannel(isolated.db, other.channelId);
    const db = shopRequestDb(createShopScope(other.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
    const result = await db.transaction((tx) =>
      prepareConfirmCardInTransaction(tx, {
        customerId: other.customerId,
        consultationId: other.consultationId,
        kind: "change_request",
        orderId: other.orderId,
        proposedChanges: PROPOSED,
        now: NOW,
      }),
    );
    expect(result).toEqual({
      unavailable: true,
      text: "지금은 할 수 없어요: 결제 전 주문이에요. 주문 요청을 취소하고 다시 요청할 수 있어요",
    });
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM confirm_cards WHERE shop_id=$1", [other.shopId])).rows[0]
        ?.n,
    ).toBe(0);
  });
  it("먼저 보낸 변경 요청이 있으면 실행·갱신 없이 현재 상태만 보인다", async () => {
    const card = await show();
    await isolated.db.query(
      "INSERT INTO change_requests(shop_id,order_id,card_id,base_version,changes,status,created_at) SELECT $1,$2,id,1,$4::jsonb,'requested',$5 FROM confirm_cards WHERE card_key=$3",
      [shop.shopId, shop.orderId, card.cardKey, JSON.stringify(PROPOSED), NOW],
    );
    const response = await request("card", card.cardKey),
      body = await response.json();
    expect(response.headers.get("Siljang-Outcome")).toBe("not_allowed_now");
    expectSchema("SkillTemplateResponse", body);
    expect(body).toHaveProperty("template.outputs", [
      { simpleText: { text: "지금은 할 수 없어요: 앞의 변경 요청을 사장님이 보고 있어요" } },
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(
      (await isolated.db.query("SELECT used_at FROM confirm_cards WHERE card_key=$1", [card.cardKey])).rows[0]?.used_at,
    ).toBeNull();
  });
  it.each([false, true])(
    "픽업 날짜의 받기 상태를 서버에서 읽고 자리/변경 요청을 쓰지 않는다(마감 %s)",
    async (closed) => {
      const pickup = (
        await isolated.db.query<{ pickup_at: Date }>("SELECT pickup_at FROM orders WHERE id=$1", [shop.orderId])
      ).rows[0]?.pickup_at;
      if (!pickup) throw new Error("missing synthetic pickup");
      if (closed)
        await isolated.db.query("UPDATE business_calendars SET daily_capacity=0 WHERE shop_id=$1", [shop.shopId]);
      const before = await isolated.db.query("SELECT * FROM calendar_days WHERE shop_id=$1 ORDER BY day", [
        shop.shopId,
      ]);
      const card = await show(newUuid(), { pickupAt: new Date(pickup.getTime() + 86400000).toISOString() });
      expect(card.changeRequest?.requiresOwnerApproval).toBe(closed);
      expect(card.changeRequest?.changes.map((change) => change.label)).toContain("픽업 날짜");
      expect(
        (await isolated.db.query("SELECT * FROM calendar_days WHERE shop_id=$1 ORDER BY day", [shop.shopId])).rows,
      ).toEqual(before.rows);
      expect(
        (await isolated.db.query("SELECT count(*)::int AS n FROM change_requests WHERE shop_id=$1", [shop.shopId]))
          .rows[0]?.n,
      ).toBe(0);
    },
  );
  it("변경 마감 정각에는 원래 조문2062자를 모두 보이고 실행·새 카드가 없다", async () => {
    const card = await show(),
      title = "제".repeat(60),
      condition = "조".repeat(1000),
      effect = "문".repeat(1000);
    await isolated.db.query(
      "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'change_deadline',99,$3,$4,$5)",
      [shop.shopId, shop.operatingRulesId, title, condition, effect],
    );
    clock =
      (
        await isolated.db.query<{ deadline: Date }>(
          "SELECT pickup_at-interval '48 hours' AS deadline FROM orders WHERE id=$1",
          [shop.orderId],
        )
      ).rows[0]?.deadline ?? NOW;
    const response = await request("card", card.cardKey),
      body = await response.json();
    expect(response.headers.get("Siljang-Outcome")).toBe("not_allowed_now");
    expectSchema("SkillTemplateResponse", body);
    const text = (
      body as {
        template: {
          outputs: { simpleText?: { text: string }; carousel?: { items: { title: string; description?: string }[] } }[];
        };
      }
    ).template.outputs
      .map(
        (output: { simpleText?: { text: string }; carousel?: { items: { title: string; description?: string }[] } }) =>
          output.simpleText?.text ??
          output.carousel?.items
            .map((item) => item.title.replace(/^변경 내용 \d+\n/, "") + (item.description ?? ""))
            .join("") ??
          "",
      )
      .join("");
    expect(text).toContain([title, condition, effect].join("\n"));
    expect(text).toContain("변경 마감이 지나 바꿀 수 없어요");
    expect(execute).not.toHaveBeenCalled();
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rows[0]
        ?.n,
    ).toBe(1);
  });
});
