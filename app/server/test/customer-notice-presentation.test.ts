import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { createOrderConfirmedNotice } from "../src/customer-notice-store";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { KAKAO_HANDOFF_TEXT } from "../src/kakao-reply";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey, singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";
import { MemoryStore } from "./support/storage";

const NOW = new Date("2026-11-26T00:00:00Z");
describeDb("저장된 손님 안내의 두 실제 수신 경로 표시", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  let requestCount = 0;
  let clock = NOW;
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    requestCount = 0;
    clock = NOW;
    shop = await createShop(isolated.db, "합성 저장 안내 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  async function call(mode: "event" | "message", id: string) {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 안내에서 실제 발신 금지"));
    try {
      const response = await createApp({
        connect: () => isolated.connect(),
        services: { now: () => clock },
        logSink: () => {},
      }).request(
        `/api/kakao/skills/${mode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: mode === "event" ? "" : `합성 안내 확인 ${++requestCount}`,
              params: mode === "event" ? { noticeKey: id } : {},
              block: { id: "conversation" },
              user: { id: shop.userKey, type: "botUserKey" },
            },
            action: { id: "synthetic-presentation", params: {} },
          }),
        },
        env,
      );
      expect(network).not.toHaveBeenCalled();
      return response;
    } finally {
      network.mockRestore();
    }
  }
  async function confirm() {
    const paid = newUuid();
    await isolated.db.transaction(async (db) => {
      await db.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2 WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await db.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paid, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await db.query("UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1", [
        shop.orderId,
        NOW,
        paid,
      ]);
    });
  }
  async function notice(kind: string, body: string, at = NOW) {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,scheduled_for,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'deferred',$9,$10)",
      [
        id,
        shop.shopId,
        shop.customerId,
        shop.consultationId,
        shop.orderId,
        kind,
        `notice:synthetic:${id}`,
        body,
        kind === "review_request" ? NOW : null,
        at,
      ],
    );
    return id;
  }
  it("여러 앞선 안내가 자리를 쓰면 대기한 현재 답도 새 답보다 먼저 전한다", async () => {
    await confirm();
    await isolated.db.query(
      "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',1,'합성 대기 규정','합성 조건','합성 대기 규정') ON CONFLICT(operating_rules_id,position) DO UPDATE SET effect_text=EXCLUDED.effect_text",
      [shop.shopId, shop.operatingRulesId],
    );
    const older = await notice("owner_reply", "합성 가장 오래된 안내", new Date(NOW.getTime() - 1000));
    const db = shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
    const confirmed = await db.transaction((tx) => createOrderConfirmedNotice(tx, shop.orderId, NOW));
    if (!confirmed) throw new Error("합성 확정 안내 없음");
    clock = new Date(NOW.getTime() + 1000);
    const first = (await (await call("message", older)).json()) as { template: { outputs: unknown[] } };
    expectSchema("SkillTemplateResponse", first);
    expect(first.template.outputs).toEqual([{ simpleText: { text: "합성 가장 오래된 안내" } }]);
    clock = new Date(NOW.getTime() + 2000);
    const second = (await (await call("message", confirmed.id)).json()) as { template: { outputs: unknown[] } };
    expectSchema("SkillTemplateResponse", second);
    expect(second.template.outputs).toHaveLength(2);
    expect(JSON.stringify(second)).toContain("합성 대기 규정");
    expect(JSON.stringify(second)).not.toContain(KAKAO_HANDOFF_TEXT);
    clock = new Date(NOW.getTime() + 3000);
    const third = (await (await call("message", confirmed.id)).json()) as { template: { outputs: unknown[] } };
    expectSchema("SkillTemplateResponse", third);
    expect(third.template.outputs).toEqual(
      Array.from({ length: 3 }, () => ({ simpleText: { text: KAKAO_HANDOFF_TEXT } })),
    );
    expect(
      (
        await isolated.db.query(
          "SELECT count(*)::int AS n FROM messages m JOIN consultations c ON c.shop_id=m.shop_id AND c.id=m.consultation_id WHERE m.shop_id=$1 AND c.customer_id=$2 AND m.direction='outbound' AND m.delivery='deferred'",
          [shop.shopId, shop.customerId],
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
  });
  async function prepareLongConfirmedNotice(legacy: boolean) {
    await confirm();
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
    const previous = legacy
      ? await scoped.transaction((tx) => createOrderConfirmedNotice(tx, shop.orderId, NOW))
      : undefined;
    if (previous)
      await isolated.db.query("UPDATE notifications SET template_key='order_confirmed:v1',body=$2 WHERE id=$1", [
        previous.id,
        `주문이 확정됐어요\n주문번호 AB1234CD\n결제가 확인된 금액 35,000원\n상호 합성 보존된 신원${"가".repeat(48)}\n대표자 ${"나".repeat(30)}\n사업장 주소 ${"다".repeat(200)}\n전화번호 02-0000-0000`,
      ]);
    await isolated.db.query(
      "UPDATE shops SET business_name=$2,representative_name=$3,business_address=$4 WHERE id=$1",
      [shop.shopId, `합성${"가".repeat(58)}`, `합성${"나".repeat(28)}`, "다".repeat(200)],
    );
    await isolated.db.query(
      "UPDATE order_details SET design_notes=$2,lettering=$3,colors=$4 WHERE order_id=$1 AND version=1",
      [shop.orderId, "라".repeat(500), "마".repeat(50), "바".repeat(100)],
    );
    for (let i = 0; i < 35; i++) {
      const id = newUuid();
      await isolated.db.query(
        "INSERT INTO price_options(id,shop_id,price_list_id,option_group,name,price_kind,amount,in_standard,position) VALUES($1,$2,$3,'extra',$4,'fixed',1000,true,$5)",
        [id, shop.shopId, shop.priceListId, `합성${String(i).padStart(2, "0")} ${"사".repeat(25)}`, 100 + i],
      );
      await isolated.db.query(
        "INSERT INTO order_detail_extras(shop_id,order_detail_id,price_list_id,option_id) SELECT shop_id,id,price_list_id,$2 FROM order_details WHERE order_id=$1 AND version=1",
        [shop.orderId, id],
      );
    }
    for (let position = 1; position <= 2; position++)
      await isolated.db.query(
        "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',$3,$4,'합성 조건',$5)",
        [shop.shopId, shop.operatingRulesId, position, `합성 보존 규정${position}`, "아".repeat(850)],
      );
    const created = previous ?? (await scoped.transaction((tx) => createOrderConfirmedNotice(tx, shop.orderId, NOW)));
    if (!created) throw new Error("missing synthetic long confirmation");
    const saved = (
      await isolated.db.query<{ body: string; template_key: string }>(
        "SELECT body,template_key FROM notifications WHERE id=$1",
        [created.id],
      )
    ).rows[0];
    if (!saved) throw new Error("missing stored synthetic notice");
    expect([...saved.body].length).toBeLessThanOrEqual(2000);
    if (!legacy) expect(saved.body).not.toContain("라".repeat(500));
    return created;
  }
  it.each(
    (["event", "message"] as const).flatMap((mode) =>
      ([false, true] as const).map((legacy) => [mode, legacy] as const),
    ),
  )("확정 본문2000자 밖의 주문 내용도 원문/규정을 보존한다(%s/이전 %s)", async (mode, legacy) => {
    const created = await prepareLongConfirmedNotice(legacy);
    const response = await call(mode, created.id);
    expect(response.status).toBe(200);
    const result = await response.json();
    expectSchema("SkillTemplateResponse", result);
    type Output = { simpleText?: { text: string }; carousel?: { items: { title: string; description?: string }[] } };
    const outputs = (result as { template: { outputs: Output[] } }).template.outputs;
    expect(outputs.length).toBeLessThanOrEqual(3);
    const text = outputs
      .map(
        (o) =>
          o.simpleText?.text ??
          o.carousel?.items
            .map((item) => item.title.replace(/^확정 안내 \d+\n/, "") + (item.description ?? ""))
            .join("") ??
          "",
      )
      .join("");
    for (const expected of [
      "라".repeat(500),
      "마".repeat(50),
      "바".repeat(100),
      "합성 보존 규정1",
      "합성 보존 규정2",
      "35,000원",
    ])
      expect(text).toContain(expected);
    for (let i = 0; i < 35; i++) expect(text).toContain(`합성${String(i).padStart(2, "0")} ${"사".repeat(25)}`);
    if (legacy) expect(text).toContain("합성 보존된 신원");
    const next = await notice("owner_reply", "합성 긴 확정 뒤 정상 안내", new Date(NOW.getTime() + 500));
    clock = new Date(NOW.getTime() + 1000);
    expect(JSON.stringify(await (await call(mode, next)).json())).toContain("합성 긴 확정 뒤 정상 안내");
  });
  it("확정 당시 버전2와 신원은 뒤 버전3/현재 신원으로 바뀌지 않는다", async () => {
    await confirm();
    await isolated.db.query(
      "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',1,'합성 확정 규정','합성 조건','합성 확정 당시 규정')",
      [shop.shopId, shop.operatingRulesId],
    );
    const version = async (value: number, note: string) =>
      isolated.db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO order_details SELECT(jsonb_populate_record(NULL::order_details,to_jsonb(d)||$2::jsonb)).* FROM order_details d WHERE d.order_id=$1 AND d.version=1",
          [
            shop.orderId,
            JSON.stringify({
              id: newUuid(),
              version: value,
              source: "owner_amount_change",
              amount_change_reason: "합성 확정 내용 고침",
              design_notes: note,
            }),
          ],
        );
        await tx.query("UPDATE orders SET version=$2 WHERE id=$1", [shop.orderId, value]);
      });
    await version(2, "합성 확정 당시 버전 둘");
    const db = shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
    const created = await db.transaction((tx) => createOrderConfirmedNotice(tx, shop.orderId, NOW));
    if (!created) throw new Error("missing synthetic versioned notice");
    expect(
      (await isolated.db.query("SELECT template_key FROM notifications WHERE id=$1", [created.id])).rows[0]
        ?.template_key,
    ).toBe("order_confirmed:v3:2");
    await version(3, "합성 나중 버전 셋");
    await isolated.db.query("UPDATE shops SET business_name='합성 나중 상호' WHERE id=$1", [shop.shopId]);
    const body = await (await call("event", created.id)).json();
    expectSchema("SkillTemplateResponse", body);
    expect(JSON.stringify(body)).toContain("합성 확정 당시 버전 둘");
    expect(JSON.stringify(body)).not.toContain("합성 나중 버전 셋");
    expect(JSON.stringify(body)).not.toContain("합성 나중 상호");
  });
  it.each(["inline", "callback"] as const)(
    "사진 %s는 세 출력 확정 안내를 먼저 전하고 사진 답을 한 번 대기로 보존한다",
    async (mode) => {
      const created = await prepareLongConfirmedNotice(false),
        storage = new MemoryStore(),
        { fc } = singleKeyCrypto(),
        jobs: KakaoCallbackJob[] = [];
      const photo = "https://t1.daumcdn.net/synthetic/confirmed-photo.png",
        callback = "https://bot-api.kakao.com/v1/callback/synthetic_confirmed_photo";
      const image = new Uint8Array(readFileSync(new URL("./fixtures/photos/metadata.png", import.meta.url)));
      let sent: unknown;
      const network = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        if (String(url) === photo) return new Response(image, { headers: { "Content-Type": "image/png" } });
        if (String(url) === callback) {
          sent = JSON.parse(String(init?.body));
          return Response.json({ status: "SUCCESS" });
        }
        throw new Error("합성 확정 사진에서 예상 밖 외부 요청");
      });
      try {
        const response = await createApp({
          connect: () => isolated.connect(),
          services: {
            now: () => clock,
            storage,
            fieldCrypto: fc,
            ...(mode === "callback"
              ? {
                  kakaoCallbackQueue: {
                    send: async (job: KakaoCallbackJob) => {
                      jobs.push(job);
                    },
                  },
                }
              : {}),
          },
          logSink: () => {},
        }).request(
          "/api/kakao/skills/message",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
            body: JSON.stringify({
              bot: { id: shop.botId },
              userRequest: {
                utterance: photo,
                ...(mode === "callback" ? { callbackUrl: callback } : {}),
                block: { id: "conversation" },
                user: { id: shop.userKey, type: "botUserKey" },
              },
              action: { id: "synthetic-confirmed-photo", params: {} },
            }),
          },
          env,
        );
        expect(response.status).toBe(200);
        if (mode === "callback") {
          expect(response.headers.get("Siljang-Outcome")).toBe("callback_pending");
          expect(jobs).toHaveLength(1);
          const job = jobs[0];
          if (!job) throw new Error("missing synthetic photo callback");
          clock = new Date(NOW.getTime() + 1000);
          expect(
            await consumeKakaoCallback(job, env, {
              connect: () => isolated.connect(),
              now: () => clock,
              fetch: network,
              services: { storage, fieldCrypto: fc },
            }),
          ).toBe("done");
        } else sent = await response.json();
        expectSchema("SkillTemplateResponse", sent);
        expect(sent).toHaveProperty("template.outputs.length", 3);
        expect(JSON.stringify(sent)).toContain("합성 보존 규정1");
        expect(JSON.stringify(sent)).not.toContain("사진");
        const reply = (
          await isolated.db.query(
            "SELECT id,delivery,sent_at FROM messages WHERE shop_id=$1 AND direction='outbound' AND kind='photo'",
            [shop.shopId],
          )
        ).rows[0];
        expect(reply).toMatchObject({ delivery: "deferred", sent_at: null });
        expect(
          (await isolated.db.query("SELECT status FROM notifications WHERE id=$1", [created.id])).rows[0]?.status,
        ).toBe("delivered_on_reply");
        expect(network.mock.calls.filter(([url]) => String(url) === photo)).toHaveLength(1);
        expect(network.mock.calls.filter(([url]) => String(url) === callback)).toHaveLength(
          mode === "callback" ? 1 : 0,
        );
        network.mockRestore();
        clock = new Date(NOW.getTime() + 2000);
        const later = await (await call("message", created.id)).json();
        expectSchema("SkillTemplateResponse", later);
        expect(JSON.stringify(later)).toContain("사진");
        expect(
          (await isolated.db.query("SELECT delivery FROM messages WHERE id=$1", [reply?.id])).rows[0]?.delivery,
        ).toBe("delivered_later");
        expect(
          (await isolated.db.query("SELECT id FROM reference_photos WHERE shop_id=$1", [shop.shopId])).rows,
        ).toHaveLength(1);
      } finally {
        network.mockRestore();
      }
    },
  );
  for (const mode of ["event", "message"] as const) {
    it(`${mode}: 긴 확정 내용과 두 규정이 후속 안내를 막지 않는다`, async () => {
      await confirm();
      await isolated.db.query(
        "UPDATE order_details SET design_notes=$2,lettering=$3,colors=$4 WHERE order_id=$1 AND version=1",
        [shop.orderId, "가".repeat(500), "나".repeat(50), "다".repeat(100)],
      );
      for (let i = 0; i < 20; i++) {
        const optionId = newUuid();
        await isolated.db.query(
          "INSERT INTO price_options(id,shop_id,price_list_id,option_group,name,price_kind,amount,in_standard,position) VALUES($1,$2,$3,'extra',$4,'fixed',1000,true,$5)",
          [optionId, shop.shopId, shop.priceListId, `합성${i} ${"라".repeat(24)}`, 100 + i],
        );
        await isolated.db.query(
          "INSERT INTO order_detail_extras(shop_id,order_detail_id,price_list_id,option_id) SELECT shop_id,id,price_list_id,$2 FROM order_details WHERE order_id=$1 AND version=1",
          [shop.orderId, optionId],
        );
      }
      for (let position = 1; position <= 2; position++)
        await isolated.db.query(
          "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',$3,$4,'합성 조건',$5) ON CONFLICT(operating_rules_id,position) DO UPDATE SET title=EXCLUDED.title,effect_text=EXCLUDED.effect_text",
          [shop.shopId, shop.operatingRulesId, position, `합성 긴 규정${position}`, "마".repeat(850)],
        );
      const db = shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
      const confirmed = await db.transaction((tx) => createOrderConfirmedNotice(tx, shop.orderId, NOW));
      if (!confirmed) throw new Error("합성 긴 확정 안내 없음");
      const saved = (
        await isolated.db.query<{ body: string }>("SELECT body FROM notifications WHERE id=$1", [confirmed.id])
      ).rows[0]?.body;
      expect([...(saved ?? "")].length).toBeLessThanOrEqual(2000);
      expect(saved).toContain("주문이 확정됐어요");
      expect(saved).not.toContain("가".repeat(500));
      const first = await call(mode, confirmed.id);
      expect(first.status).toBe(200);
      const body = await first.json();
      expectSchema("SkillTemplateResponse", body);
      const outputs = (body as { template: { outputs: unknown[] } }).template.outputs;
      expect(outputs.length).toBeLessThanOrEqual(3);
      expect(JSON.stringify(body)).toContain('"type":"textCard"');
      const following = await notice("owner_reply", "합성 긴 확정 뒤의 안내", new Date(NOW.getTime() + 500));
      clock = new Date(NOW.getTime() + 1000);
      const next = await call(mode, following);
      expect(next.status).toBe(200);
      expect(JSON.stringify(await next.json())).toContain("합성 긴 확정 뒤의 안내");
    });
    it(`${mode}: 공백인 분할 조각 뒤의 안내도 막히지 않는다`, async () => {
      const original = `${"가".repeat(1000)}\n`;
      const first = await notice("owner_reply", original, new Date(NOW.getTime() - 2000));
      const next = await notice("custom_rejected", "합성 후속 안내", new Date(NOW.getTime() - 1000));
      const response = await call(mode, first);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { template: { outputs: { simpleText: { text: string } }[] } };
      expectSchema("SkillTemplateResponse", body);
      expect(
        body.template.outputs
          .slice(0, 2)
          .map((o) => o.simpleText.text)
          .join(""),
      ).toBe(original);
      const again = await call(mode, next);
      expect(again.status).toBe(200);
      expect(JSON.stringify(await again.json())).toContain("합성 후속 안내");
    });
    for (const legacy of [false, true])
      it(`${mode}: 확정 시점 내용·신원과 주문의 예전 규정을 전한다(이전 자료 ${legacy})`, async () => {
        await confirm();
        await isolated.db.query(
          "UPDATE order_details SET design_notes='합성 처음 디자인',lettering='합성 처음 문구',colors='합성 처음 색' WHERE shop_id=$1 AND order_id=$2 AND version=1",
          [shop.shopId, shop.orderId],
        );
        await isolated.db.query(
          "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',1,'합성 규정','합성 조건','합성 원래 주문 규정') ON CONFLICT(operating_rules_id,position) DO UPDATE SET clause_key='custom',effect_text='합성 원래 주문 규정'",
          [shop.shopId, shop.operatingRulesId],
        );
        if (!legacy) {
          await isolated.db.query(
            "UPDATE rule_clauses SET effect_text=$3 WHERE shop_id=$1 AND operating_rules_id=$2 AND position=1",
            [shop.shopId, shop.operatingRulesId, `합성 원래 주문 규정${"나".repeat(700)}`],
          );
          await isolated.db.query(
            "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',2,'합성 추가 규정','합성 조건',$3)",
            [shop.shopId, shop.operatingRulesId, `합성 두번째 규정${"다".repeat(700)}`],
          );
        }
        const db = shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
        const created = await db.transaction((tx) => createOrderConfirmedNotice(tx, shop.orderId, NOW));
        expect(created?.created).toBe(true);
        const id = created?.id ?? "";
        if (legacy) {
          const saved = (await isolated.db.query<{ body: string }>("SELECT body FROM notifications WHERE id=$1", [id]))
            .rows[0];
          if (!saved) throw new Error("합성 안내 없음");
          await isolated.db.query("UPDATE notifications SET template_key='order_confirmed:v1',body=$2 WHERE id=$1", [
            id,
            saved.body.split("\n주문 내용\n")[0],
          ]);
        }
        const newerRules = newUuid();
        await isolated.db.transaction(async (tx) => {
          await tx.query(
            "UPDATE shops SET business_name='합성 바뀐 상호',business_address='합성 바뀐 주소' WHERE id=$1",
            [shop.shopId],
          );
          await tx.query("UPDATE operating_rules SET superseded_at=$2 WHERE id=$1", [shop.operatingRulesId, NOW]);
          await tx.query(
            "INSERT INTO operating_rules SELECT (jsonb_populate_record(NULL::operating_rules,to_jsonb(r)||jsonb_build_object('id',$2::uuid,'version',2,'superseded_at',NULL))).* FROM operating_rules r WHERE r.id=$1",
            [shop.operatingRulesId, newerRules],
          );
          await tx.query(
            "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',1,'합성 최신 규정','합성 조건','합성 최신 규정')",
            [shop.shopId, newerRules],
          );
          await tx.query(
            "INSERT INTO order_details SELECT (jsonb_populate_record(NULL::order_details,to_jsonb(d)||jsonb_build_object('id',$3::uuid,'version',2,'source','owner_amount_change','amount_change_reason','합성 변경','design_notes','합성 바뀐 디자인','lettering','합성 바뀐 문구'))).* FROM order_details d WHERE d.shop_id=$1 AND d.order_id=$2 AND d.version=1",
            [shop.shopId, shop.orderId, newUuid()],
          );
          await tx.query("UPDATE orders SET version=2 WHERE id=$1", [shop.orderId]);
        });
        const response = await call(mode, id);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { template: { outputs: readonly unknown[] } };
        expectSchema("SkillTemplateResponse", body);
        const text = JSON.stringify(body);
        if (!legacy) {
          expect(body.template.outputs).toHaveLength(3);
          expect(text).toContain("합성 두번째 규정");
        }
        for (const word of ["합성 처음 디자인", "합성 처음 문구", "합성 원래 주문 규정", "35,000원"])
          expect(text).toContain(word);
        for (const word of ["합성 최신 규정", "합성 바뀐 상호", "합성 바뀐 주소", "합성 바뀐 디자인", "합성 바뀐 문구"])
          expect(text).not.toContain(word);
      });
    it(`${mode}: 저장된 후기 부탁도 주문번호와 연결 채널의 후기 버튼을 전한다`, async () => {
      await confirm();
      await isolated.db.transaction(async (tx) => {
        await tx.query("UPDATE orders SET status='received' WHERE id=$1", [shop.orderId]);
        await tx.query(
          "INSERT INTO productions(shop_id,order_id,handed_over_at,handover_kind) VALUES($1,$2,$3,'pickup')",
          [shop.shopId, shop.orderId, new Date(NOW.getTime() - 86400000)],
        );
      });
      const id = await notice("review_request", "합성 후기 부탁 저장 본문");
      const response = await call(mode, id);
      expect(response.status).toBe(200);
      const body = await response.json();
      expectSchema("SkillTemplateResponse", body);
      const text = JSON.stringify(body);
      const order = (
        await isolated.db.query<{ order_no: string }>("SELECT order_no FROM orders WHERE id=$1", [shop.orderId])
      ).rows[0];
      expect(text).toContain("후기 남기기");
      expect(text).toContain('"blockId":"review"');
      expect(text).toContain(order?.order_no);
      for (const value of [shop.orderId, shop.customerId, shop.shopId]) expect(text).not.toContain(value);
    });
  }
});
