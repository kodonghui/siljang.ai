import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { recordAiCall } from "../src/ai-calls";
import type { AiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import {
  type ConfirmCardCommand,
  prepareConfirmCardInTransaction,
  readConfirmCardDelivery,
  showConfirmCard,
} from "../src/confirm-card-store";
import { CustomerNoticeTemporarilyUnavailable } from "../src/customer-notice-content";
import { createPaymentRequestNotice } from "../src/customer-notice-store";
import { pgConnector } from "../src/db";
import { deliverKakaoCallback } from "../src/kakao-callback";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import * as cardDelivery from "../src/kakao-card-delivery";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { deferredKakaoBatch, deferredKakaoTexts, markDeferredKakaoMessages } from "../src/kakao-deferred";
import { expandKakaoMessageContents } from "../src/kakao-message-content";
import { kakaoConfirmAnswerMessage } from "../src/kakao-order-request-message";
import * as paymentMessages from "../src/kakao-payment-message";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, type ShopDb, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_DATABASE_URL, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-26T01:00:00Z");
describeDb("입금자 전용 블록의 표시와 명령 경계(TASK-107)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string, clock: Date;
  const role = `task107_${newUuid().replaceAll("-", "")}`;
  let roleUrl: string,
    restricted = false;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");
    await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
    const database = (await isolated.db.query<{ name: string }>("SELECT current_database() AS name")).rows[0];
    if (!database) throw new Error("합성 데이터베이스 없음");
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${database.name}`;
    url.username = role;
    url.password = "";
    roleUrl = url.toString();
  }, 30000);
  beforeEach(async () => {
    restricted = false;
    await isolated.db.query(`REVOKE SELECT (changes,base_version,amount_delta) ON change_requests FROM "${role}"`);
    clock = NOW;
    shop = await createShop(isolated.db, "합성 입금자 입력 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    await isolated.db.query(
      "UPDATE payment_requests SET issued_at=$2,delivered_at=$2,due_at=$3,due_cap_at=$4 WHERE id=$1",
      [shop.paymentRequestId, NOW, new Date(NOW.getTime() + 43200000), new Date(NOW.getTime() + 86400000)],
    );
  });
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });
  const show = (kind: "payment_claim" | "cancel" = "payment_claim", sourceMessageId?: string) =>
    showConfirmCard(shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind,
      ...(sourceMessageId === undefined ? {} : { sourceMessageId }),
      orderId: shop.orderId,
      now: NOW,
    });
  const state = async () => ({
    cards: (
      await isolated.db.query("SELECT id,used_at,outcome,payload FROM confirm_cards WHERE shop_id=$1 ORDER BY id", [
        shop.shopId,
      ])
    ).rows,
    payments: (await isolated.db.query("SELECT * FROM payment_requests WHERE shop_id=$1 ORDER BY id", [shop.shopId]))
      .rows,
    messages: (await isolated.db.query("SELECT * FROM messages WHERE shop_id=$1 ORDER BY id", [shop.shopId])).rows,
  });
  async function call(
    cardKey: string,
    value: unknown,
    execute: ConfirmCardCommand,
    blockId = "depositor",
    userId = shop.userKey,
  ) {
    const logs: unknown[] = [];
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 카드 시험에서 실제 발신 금지"));
    try {
      const response = await createApp({
        connect: () => (restricted ? pgConnector(new Secret(roleUrl)) : isolated.connect()),
        services: { now: () => clock, confirmCardCommand: execute },
        logSink: (line) => {
          logs.push(line);
        },
      }).request(
        "/api/kakao/skills/card",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: typeof value === "string" && !value.includes("\0") ? value : "합성 입금자 입력",
              block: { id: blockId },
              user: { id: userId, type: "botUserKey" },
            },
            action: {
              id: "synthetic-depositor-input",
              params: value === undefined ? {} : { depositor_name: value },
              clientExtra: { cardKey, choice: "confirm" },
            },
          }),
        },
        testEnv(),
      );
      expect(network).not.toHaveBeenCalled();
      return { response, logs };
    } finally {
      network.mockRestore();
    }
  }
  it.each([undefined, "", "   ", "가".repeat(31), "🎂".repeat(31), null, 123, "합성\0입금자"])(
    "잘못된 입금자 값은 아무것도 쓰지 않고 같은 전용 버튼으로 다시 묻는다(%j)",
    async (value) => {
      const card = await show(),
        before = await state(),
        execute = vi.fn<ConfirmCardCommand>();
      const { response, logs } = await call(card.cardKey, value, execute);
      expect(response.status).toBe(200);
      expect(response.headers.get("Siljang-Outcome")).toBe("input_invalid");
      const body = await response.json();
      expectSchema("SkillTemplateResponse", body);
      expect(body).toMatchObject({
        template: {
          outputs: [
            {
              textCard: {
                description: "입금자 이름은 1~30자로 넣어 주세요",
                buttons: [{ label: "입금자 이름 넣기", blockId: "depositor", extra: { cardKey: card.cardKey } }],
              },
            },
          ],
        },
      });
      expect(await state()).toEqual(before);
      expect(execute).not.toHaveBeenCalled();
      for (const content of [JSON.stringify(body), JSON.stringify(logs)]) {
        expect(content).not.toContain("시험손님");
        if (typeof value === "string" && value.trim().length > 3) expect(content).not.toContain(value);
      }
    },
  );
  it.each(["합성 전용 입금자", "🎂".repeat(30)])(
    "유효한 전용 입력만 명령에 전달하고 저장 카드/메시지/로그에는 남기지 않는다(%s)",
    async (value) => {
      const card = await show();
      const execute = vi.fn<ConfirmCardCommand>(async () => ({
        outcome: "payment_claimed",
        text: "사장님께 알렸어요. 확인되면 알려 드릴게요",
      }));
      const { response, logs } = await call(card.cardKey, value, execute);
      expect(response.headers.get("Siljang-Outcome")).toBe("payment_claimed");
      const body = await response.json();
      expectSchema("SkillTemplateResponse", body);
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0]?.[1]).toMatchObject({
        kind: "payment_claim",
        orderId: shop.orderId,
        depositorName: value,
      });
      expect(JSON.stringify(await state())).not.toContain(value);
      expect(JSON.stringify(logs)).not.toContain(value);
      expect(JSON.stringify(body)).not.toContain(value);
      const again = await call(card.cardKey, value, execute);
      expect(again.response.headers.get("Siljang-Outcome")).toBe("card_used");
      expect(await again.response.json()).toEqual(body);
      expect(execute).toHaveBeenCalledOnce();
    },
  );
  it("일반 카드 블록에 넣은 입금자 값은 명령의 이름을 바꾸지 않는다", async () => {
    const card = await show();
    const execute = vi.fn<ConfirmCardCommand>(async () => ({
      outcome: "payment_claimed",
      text: "사장님께 알렸어요. 확인되면 알려 드릴게요",
    }));
    const { response } = await call(card.cardKey, "합성 넣어 바꾼 이름", execute, "blk-card");
    expect(response.headers.get("Siljang-Outcome")).toBe("payment_claimed");
    expect(execute.mock.calls[0]?.[1]).not.toHaveProperty("depositorName");
  });
  it("전용 블록으로 다른 종류의 카드를 실행하거나 다른 사용자의 카드를 누르지 못한다", async () => {
    const card = await show("cancel"),
      execute = vi.fn<ConfirmCardCommand>(),
      before = await state();
    const first = await call(card.cardKey, "합성 입금자", execute);
    const second = await call(card.cardKey, "합성 입금자", execute, "depositor", "합성 다른 사용자");
    expect(first.response.headers.get("Siljang-Outcome")).toBe("card_not_yours");
    expect(await second.response.json()).toEqual(await first.response.json());
    expect(await state()).toEqual(before);
    expect(execute).not.toHaveBeenCalled();
  });
  it("전용 이름 입력도30분 정각이면 새 카드이며 명령을 실행하지 않는다", async () => {
    const card = await show(),
      execute = vi.fn<ConfirmCardCommand>();
    clock = new Date(NOW.getTime() + 1800000);
    const { response } = await call(card.cardKey, "", execute);
    expect(response.headers.get("Siljang-Outcome")).toBe("card_expired");
    expect(JSON.stringify(await response.json())).toContain("시간이 지나 새 카드를 보내 드려요");
    expect(execute).not.toHaveBeenCalled();
  });
  it("전달 뒤 결제 시계가 시작됐어도 잘못된 이름은 카드 결합 자료를 쓰지 않는다", async () => {
    await isolated.db.query("UPDATE payment_requests SET delivered_at=NULL,due_at=due_cap_at WHERE id=$1", [
      shop.paymentRequestId,
    ]);
    const card = await show();
    await isolated.db.query("UPDATE payment_requests SET delivered_at=$2,due_at=$3 WHERE id=$1", [
      shop.paymentRequestId,
      NOW,
      new Date(NOW.getTime() + 43200000),
    ]);
    const before = await state(),
      execute = vi.fn<ConfirmCardCommand>();
    const { response } = await call(card.cardKey, "", execute);
    expect(response.headers.get("Siljang-Outcome")).toBe("input_invalid");
    expect(await state()).toEqual(before);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ...(["custom", "difference"] as const).flatMap((kind) =>
      (["press", "prepare", "replay", "deferred", "callback", "legacy"] as const).map((mode) => [kind, mode] as const),
    ),
    ["difference", "blocked-deferred"] as const,
    ["difference", "bounded-unavailable"] as const,
    ["custom", "pending-callback"] as const,
    ["difference", "pending-callback"] as const,
    ["difference", "current-legacy"] as const,
    ["difference", "prepare-legacy"] as const,
    ["custom", "bounded-duplicates"] as const,
    ["difference", "current-legacy-empty"] as const,
    ["difference", "prepare-legacy-empty"] as const,
    ["difference", "late-legacy"] as const,
    ...([23, 24, 25] as const).map((count) => ["custom", `boundary-${count}`] as const),
    ...([50, 200, 2000] as const).map((count) => ["difference", `source-query-plan-${count}`] as const),
  ])("새 금액 미확인의 결제 확인 표시는 기존 새 금액 카드로 바뀐다(%s/%s)", async (kind, mode) => {
    const sourceMessageId = newUuid();
    const original = await show("payment_claim", sourceMessageId);
    const amountId = newUuid(),
      amountKey = `ck_${amountId}`,
      paymentId = kind === "custom" ? shop.paymentRequestId : newUuid();
    await isolated.db.query(
      "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'amount_confirm',$6,2,'{}',$7,$8)",
      [
        amountId,
        shop.shopId,
        shop.consultationId,
        shop.customerId,
        amountKey,
        shop.orderId,
        NOW,
        new Date(NOW.getTime() + 1800000),
      ],
    );
    if (kind === "custom") {
      await isolated.db.query(
        "INSERT INTO order_details SELECT(jsonb_populate_record(NULL::order_details,to_jsonb(d)||$2::jsonb)).* FROM order_details d WHERE d.order_id=$1 AND d.version=1",
        [
          shop.orderId,
          JSON.stringify({
            id: newUuid(),
            version: 2,
            source: "owner_amount_change",
            amount: 55000,
            amount_change_reason: "합성 장식을 추가해요",
          }),
        ],
      );
      await isolated.db.query(
        "UPDATE orders SET kind='custom',version=2,amount=55000,accepted_at=$2,accepted_version=2 WHERE id=$1",
        [shop.orderId, NOW],
      );
      await isolated.db.query(
        "UPDATE payment_requests SET amount=55000,requested_amount=35000,needs_amount_confirm=true,amount_confirmed_at=NULL,delivered_at=NULL,due_at=due_cap_at,amount_card_id=$2 WHERE id=$1",
        [shop.paymentRequestId, amountId],
      );
    } else {
      const payment = newUuid(),
        change = newUuid(),
        changeCard = newUuid();
      await isolated.db.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount,issued_at=$3 WHERE id=$1",
        [shop.paymentRequestId, NOW, new Date(NOW.getTime() - 1000)],
      );
      await isolated.db.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [payment, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await isolated.db.query(
        "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1",
        [shop.orderId, NOW, payment],
      );
      await isolated.db.query("UPDATE confirm_cards SET order_version=1 WHERE id=$1", [amountId]);
      await isolated.db.query(
        "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'change_request',$6,1,'{}',$7,$8)",
        [
          changeCard,
          shop.shopId,
          shop.consultationId,
          shop.customerId,
          `ck_${changeCard}`,
          shop.orderId,
          NOW,
          new Date(NOW.getTime() + 1800000),
        ],
      );
      await isolated.db.query(
        "INSERT INTO change_requests(id,shop_id,order_id,card_id,base_version,changes,status,amount_delta,decided_at) VALUES($1,$2,$3,$4,1,$5::jsonb,'awaiting_difference',20000,$6)",
        [change, shop.shopId, shop.orderId, changeCard, JSON.stringify({ lettering: "합성 변경 문구" }), NOW],
      );
      await isolated.db.query(
        "INSERT INTO payment_requests SELECT(jsonb_populate_record(NULL::payment_requests,to_jsonb(p)||$2::jsonb)).* FROM payment_requests p WHERE p.id=$1",
        [
          shop.paymentRequestId,
          JSON.stringify({
            id: paymentId,
            kind: "difference",
            change_request_id: change,
            event_key: `pay:${change}:difference`,
            status: "open",
            amount: 20000,
            requested_amount: null,
            needs_amount_confirm: true,
            amount_confirmed_at: null,
            amount_card_id: amountId,
            delivered_at: null,
            issued_at: NOW.toISOString(),
            due_at: new Date(NOW.getTime() + 86400000).toISOString(),
            due_cap_at: new Date(NOW.getTime() + 86400000).toISOString(),
            paid_at: null,
            arrived_at: null,
            arrived_amount: null,
          }),
        ],
      );
    }
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
    const notice = await scoped.transaction((tx) => createPaymentRequestNotice(tx, paymentId, NOW));
    if (!notice) throw new Error("합성 금액 확인 안내 없음");
    // 새 안내의 전달과 별개로, 이미 보인 결제 확인 카드 자체를 다시 읽는 경로를 가른다.
    if (mode === "pending-callback")
      await isolated.db.query("UPDATE notifications SET status='deferred',created_at=$2,sent_at=NULL WHERE id=$1", [
        notice.id,
        NOW,
      ]);
    else
      await isolated.db.query("UPDATE notifications SET status='delivered_on_reply',sent_at=$2 WHERE id=$1", [
        notice.id,
        NOW,
      ]);
    const beforePayment = (await state()).payments;
    if (mode.startsWith("source-query-plan-")) {
      const backlog = Number(mode.slice("source-query-plan-".length));
      await isolated.db.query("UPDATE consultations SET ai_disclosed_at=$2 WHERE id=$1", [shop.consultationId, NOW]);
      await isolated.db.query(
        `WITH ids AS MATERIALIZED (SELECT gen_random_uuid() AS id,gen_random_uuid() AS source FROM generate_series(1,$5::integer)),
        cards AS (
          INSERT INTO confirm_cards
          SELECT (jsonb_populate_record(NULL::confirm_cards,to_jsonb(c)||jsonb_build_object(
            'id',ids.id,'card_key','ck_'||ids.id::text,
            'payload',c.payload||jsonb_build_object('sourceMessageId',ids.source)))).*
          FROM confirm_cards c CROSS JOIN ids WHERE c.card_key=$1
          RETURNING payload
        )
        INSERT INTO messages(shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,created_at)
        SELECT $2,$3,'outbound','system','card',payload->>'sourceMessageId','결제 확인 요청','deferred',$4 FROM cards`,
        [original.cardKey, shop.shopId, shop.consultationId, NOW, backlog],
      );
      await isolated.db.query("ANALYZE confirm_cards; ANALYZE messages");
      const runtime = pgConnector(new Secret(roleUrl));
      try {
        const queries: { sql: string; params: readonly unknown[] }[] = [];
        const lookups: { sql: string; params: readonly unknown[] }[] = [];
        const limited = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), runtime);
        const observe = (tx: ShopDb): ShopDb => ({
          ...tx,
          run: async <R>(sql: string, params?: readonly unknown[]) => {
            if (sql.includes("FROM messages m") && sql.includes("FOR UPDATE OF m"))
              queries.push({ sql, params: params ?? [] });
            if (sql.includes("payload->>'sourceMessageId'=$4")) lookups.push({ sql, params: params ?? [] });
            return tx.run<R>(sql, params);
          },
        });
        await limited.transaction(async (tx) => {
          const batch = await deferredKakaoBatch(observe(tx), shop.customerId, { now: NOW });
          expect(batch.messages).toHaveLength(0);
        });
        const query = queries[0];
        if (query === undefined) throw new Error("합성 제한 역할의 카드 조회 없음");
        const plan = await runtime.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query.sql}`, [
          shop.shopId,
          ...query.params,
        ]);
        const data = plan.rows[0]?.["QUERY PLAN"] as { Plan: Record<string, unknown>; "Execution Time": number }[];
        const nodes: Record<string, unknown>[] = [];
        const walk = (node: Record<string, unknown>) => {
          nodes.push(node);
          for (const child of (node.Plans ?? []) as Record<string, unknown>[]) walk(child);
        };
        const top = data[0];
        if (top === undefined) throw new Error("합성 실행 계획 없음");
        walk(top.Plan);
        console.info(
          "TASK107 source lookup plan",
          JSON.stringify({
            rows: backlog,
            executionMs: top["Execution Time"],
            buffers: top.Plan["Shared Hit Blocks"],
            cardNodes: nodes
              .filter((n) => n["Relation Name"] === "confirm_cards")
              .map((n) => ({
                type: n["Node Type"],
                alias: n.Alias,
                index: n["Index Name"],
                loops: n["Actual Loops"],
                removed: n["Rows Removed by Filter"],
              })),
          }),
        );
        const amountNodes = nodes.filter((n) => n.Alias === "a");
        expect(amountNodes.length).toBeGreaterThan(0);
        const amountLookups = amountNodes.reduce((sum, n) => sum + Number(n["Actual Loops"] ?? 0), 0);
        expect(amountLookups).toBeLessThanOrEqual(1);
        const referenceNodes = nodes.filter((n) => n.Alias === "cc");
        expect(referenceNodes.length).toBeGreaterThan(0);
        expect(referenceNodes.reduce((sum, n) => sum + Number(n["Actual Loops"] ?? 0), 0)).toBeLessThanOrEqual(1);
        await expect(
          limited.transaction((tx) =>
            readConfirmCardDelivery(observe(tx), {
              customerId: shop.customerId,
              consultationId: shop.consultationId,
              sourceMessageId,
              now: NOW,
            }),
          ),
        ).rejects.toBeInstanceOf(CustomerNoticeTemporarilyUnavailable);
        const lookup = lookups[0];
        if (lookup === undefined) throw new Error("합성 저장 카드의 수신 참조 조회 없음");
        const pointPlan = await runtime.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${lookup.sql}`, [
          shop.shopId,
          ...lookup.params,
        ]);
        const pointData = (pointPlan.rows[0]?.["QUERY PLAN"] ?? []) as typeof data;
        const point = pointData[0];
        if (point === undefined) throw new Error("합성 저장 카드의 실행 계획 없음");
        nodes.length = 0;
        walk(point.Plan);
        console.info(
          "TASK107 stored card point lookup",
          JSON.stringify({
            executionMs: point["Execution Time"],
            buffers: point.Plan["Shared Hit Blocks"],
            nodes: nodes.map((n) => ({
              type: n["Node Type"],
              index: n["Index Name"],
              rows: n["Actual Rows"],
              removed: n["Rows Removed by Filter"],
            })),
          }),
        );
        // 작은 테이블은 순차 조회가 더 쌀 수 있다. 기존 큰 대기열의 참조 인덱스 검사를 유지한다.
        if (backlog === 2000)
          expect(
            nodes.some((n) => typeof n["Index Cond"] === "string" && n["Index Cond"].includes("sourceMessageId")),
          ).toBe(true);
        expect(
          (
            await isolated.db.query(
              "SELECT count(*)::int AS n FROM messages WHERE shop_id=$1 AND kind='card' AND delivery='deferred'",
              [shop.shopId],
            )
          ).rows[0]?.n,
        ).toBe(backlog);
      } finally {
        await runtime.close();
      }
      return;
    }
    if (mode === "blocked-deferred" || mode === "bounded-unavailable") {
      await isolated.db.query("UPDATE consultations SET ai_disclosed_at=$2 WHERE id=$1", [shop.consultationId, NOW]);
      const blocked: string[] = [],
        normal: string[] = [];
      for (let i = 0; i < (mode === "bounded-unavailable" ? 36 : 3); i++) {
        const source = i === 0 ? sourceMessageId : newUuid();
        if (i > 0) {
          const clonedId = newUuid(),
            clonedKey = `ck_${newUuid()}`;
          await isolated.db.query(
            "INSERT INTO confirm_cards SELECT(jsonb_populate_record(NULL::confirm_cards,to_jsonb(c)||$2::jsonb)).* FROM confirm_cards c WHERE c.card_key=$1",
            [original.cardKey, JSON.stringify({ id: clonedId, card_key: clonedKey })],
          );
          await isolated.db.query(
            "UPDATE confirm_cards SET payload=jsonb_set(jsonb_set(payload,'{sourceMessageId}',$2::jsonb),'{presentation,cardKey}',$3::jsonb) WHERE id=$1",
            [clonedId, JSON.stringify(source), JSON.stringify(clonedKey)],
          );
        }
        const id = newUuid();
        blocked.push(id);
        await isolated.db.query(
          "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','card',$4,'결제 확인 요청','deferred',$5)",
          [id, shop.shopId, shop.consultationId, source, new Date(NOW.getTime() + i)],
        );
      }
      await isolated.db.query(
        "UPDATE messages SET created_at=$2::timestamptz + array_position($1::uuid[],id) * INTERVAL '1 microsecond' WHERE id=ANY($1::uuid[])",
        [blocked, NOW],
      );
      for (let i = 0; i < 3; i++) {
        const id = newUuid();
        normal.push(id);
        await isolated.db.query(
          "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','text',$4,'deferred',$5)",
          [id, shop.shopId, shop.consultationId, `합성 뒤의 정상 안내 ${i}`, new Date(NOW.getTime() + 100 + i)],
        );
      }
      const runtime = pgConnector(new Secret(roleUrl));
      try {
        const limited = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), runtime);
        const batch = await limited.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: NOW }));
        expect(batch.messages.map((m) => m.id)).toEqual(normal.slice(0, 2));
        expect(batch.currentBlocked).toBe(true);
        await limited.transaction((tx) => markDeferredKakaoMessages(tx, shop.customerId, batch.messages, NOW));
        const tail = await limited.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: NOW }));
        expect(tail.messages.map((m) => m.id)).toEqual(normal.slice(2));
        expect(tail.currentBlocked).toBe(false);
        await limited.transaction((tx) => markDeferredKakaoMessages(tx, shop.customerId, tail.messages, NOW));
        expect(
          (await isolated.db.query("SELECT delivery,sent_at FROM messages WHERE id=ANY($1::uuid[])", [blocked])).rows,
        ).toEqual(blocked.map(() => ({ delivery: "deferred", sent_at: null })));
        await isolated.db.query(`GRANT SELECT (changes,base_version,amount_delta) ON change_requests TO "${role}"`);
        const recovered = await limited.transaction((tx) =>
          deferredKakaoBatch(tx, shop.customerId, { now: NOW, allowFullOrderCard: true }),
        );
        if (mode === "bounded-unavailable") {
          expect(recovered.messages.length).toBeLessThanOrEqual(24);
          await limited.transaction((tx) => markDeferredKakaoMessages(tx, shop.customerId, recovered.messages, NOW));
          const last = await limited.transaction((tx) =>
            deferredKakaoBatch(tx, shop.customerId, { now: NOW, allowFullOrderCard: true }),
          );
          expect([...recovered.messages, ...last.messages].map((m) => m.id).sort()).toEqual([...blocked].sort());
        } else expect(recovered.messages.map((m) => m.id).sort()).toEqual([...blocked].sort());
        const shown = JSON.stringify(
          kakaoConsultationMessage({ state: "normal", contents: deferredKakaoTexts(recovered.messages) }),
        );
        expect(shown).toContain(amountKey);
        expect(shown).toContain("합성 변경 문구");
        expect((await state()).payments).toEqual(beforePayment);
      } finally {
        await runtime.close();
      }
      return;
    }
    if (
      [
        "pending-callback",
        "current-legacy",
        "prepare-legacy",
        "bounded-duplicates",
        "current-legacy-empty",
        "prepare-legacy-empty",
        "late-legacy",
        "boundary-23",
        "boundary-24",
        "boundary-25",
      ].includes(mode)
    ) {
      const legacy = mode.includes("legacy"),
        prepareLegacy = mode.startsWith("prepare-legacy"),
        empty = mode.endsWith("-empty") || mode.startsWith("boundary-"),
        late = mode === "late-legacy";
      const lateRead = late
        ? vi
            .spyOn(cardDelivery, "readClaimedKakaoCard")
            .mockRejectedValueOnce(new CustomerNoticeTemporarilyUnavailable())
        : undefined;
      const { fc, keys } = singleKeyCrypto(),
        fieldKey = keys.get(1);
      if (fieldKey === undefined) throw new Error("합성 암호화 키 없음");
      const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: fieldKey });
      const jobs: KakaoCallbackJob[] = [];
      await isolated.db.query("UPDATE consultations SET ai_disclosed_at=$2 WHERE id=$1", [shop.consultationId, NOW]);
      const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 중복 카드에서 실제 발신 금지"));
      try {
        const response = await createApp({
          connect: () => isolated.connect(),
          services: {
            now: () => NOW,
            fieldCrypto: fc,
            kakaoCallbackQueue: {
              send: async (job) => {
                jobs.push(job);
              },
            },
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
                utterance: "합성 기존 금액 카드 보기",
                callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_amount_dedup",
                block: { id: "conversation" },
                user: { id: shop.userKey, type: "botUserKey" },
              },
              action: { id: "synthetic-amount-dedup", params: {} },
            }),
          },
          env,
        );
        expect(response.headers.get("Siljang-Outcome")).toBe("callback_pending");
        const job = jobs[0];
        if (!job) throw new Error("합성 콜백 작업 없음");
        const replayIds: string[] = [];
        const replayCount = mode.startsWith("boundary-")
          ? Number(mode.slice("boundary-".length))
          : mode === "bounded-duplicates"
            ? 36
            : late
              ? 0
              : 3;
        for (let i = 0; i < replayCount; i++) {
          const ccId = newUuid(),
            ccKey = `ck_${newUuid()}`,
            source = newUuid(),
            messageId = newUuid();
          replayIds.push(messageId);
          await isolated.db.query(
            "INSERT INTO confirm_cards SELECT(jsonb_populate_record(NULL::confirm_cards,to_jsonb(c)||$2::jsonb)).* FROM confirm_cards c WHERE c.card_key=$1",
            [original.cardKey, JSON.stringify({ id: ccId, card_key: ccKey })],
          );
          await isolated.db.query(
            "UPDATE confirm_cards SET payload=jsonb_set(jsonb_set(payload,'{sourceMessageId}',$2::jsonb),'{presentation,cardKey}',$3::jsonb) WHERE id=$1",
            [ccId, JSON.stringify(source), JSON.stringify(ccKey)],
          );
          await isolated.db.query(
            "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','card',$4,'결제 확인 요청','deferred',$5)",
            [messageId, shop.shopId, shop.consultationId, source, new Date(NOW.getTime() + 10 + i)],
          );
        }
        const normalId = newUuid();
        if (!empty)
          await isolated.db.query(
            "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','text','합성 중복 뒤의 정상 안내','deferred',$4)",
            [normalId, shop.shopId, shop.consultationId, new Date(NOW.getTime() + 100)],
          );
        if (mode.startsWith("boundary-")) {
          const batch = await scoped.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: NOW }));
          expect(batch.messages.filter((m) => m.source === "message")).toHaveLength(Math.min(24, replayCount));
          expect(deferredKakaoTexts(batch.messages).length).toBeLessThan(3);
          expect(batch.currentBlocked).toBe(replayCount > 24);
          await scoped.transaction((tx) => markDeferredKakaoMessages(tx, shop.customerId, batch.messages, NOW));
          expect(
            (
              await isolated.db.query(
                "SELECT count(*)::int AS n FROM messages WHERE id=ANY($1::uuid[]) AND delivery='deferred'",
                [replayIds],
              )
            ).rows[0]?.n,
          ).toBe(Math.max(0, replayCount - 24));
          return;
        }
        if (mode === "bounded-duplicates") {
          const render = vi.spyOn(paymentMessages, "kakaoPaymentMessage");
          try {
            const batch = await scoped.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: NOW }));
            expect(batch.messages.length).toBeLessThanOrEqual(24);
            expect(render.mock.calls.length).toBeLessThanOrEqual(100);
            expect(batch.currentBlocked).toBe(true);
            await scoped.transaction((tx) => markDeferredKakaoMessages(tx, shop.customerId, batch.messages, NOW));
            expect(
              (
                await isolated.db.query(
                  "SELECT count(*)::int AS n FROM messages WHERE id=ANY($1::uuid[]) AND delivery='deferred'",
                  [replayIds],
                )
              ).rows[0]?.n,
            ).toBeGreaterThan(0);
            const next = await scoped.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: NOW }));
            expect(next.messages.some((m) => m.id === normalId)).toBe(true);
          } finally {
            render.mockRestore();
          }
          return;
        }
        const replyId = newUuid();
        if (!prepareLegacy) {
          await isolated.db.query(
            "UPDATE confirm_cards SET payload=jsonb_set(payload,'{sourceMessageId}',$2::jsonb) WHERE card_key=$1",
            [original.cardKey, JSON.stringify(job.messageId)],
          );
          await isolated.db.query(
            "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','card',$4,'결제 확인 요청','deferred',$5)",
            [replyId, shop.shopId, shop.consultationId, job.messageId, new Date(NOW.getTime() + 200)],
          );
        }
        const call = vi.fn<AiModel["call"]>().mockRejectedValue(new Error("저장된 답이 있어 모델 호출 금지"));
        if (prepareLegacy)
          call.mockImplementation(async (input) => {
            const aiCallId = await recordAiCall(input.db, {
              consultationId: input.consultationId,
              traceId: input.traceId,
              attempt: input.attempt,
              provider: "anthropic",
              model: "claude-haiku-5-5",
              promptVersion: input.promptVersion,
              reasoning: {},
              sentAt: NOW,
              firstTokenMs: 0,
              totalMs: 1,
              tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              cost: { usd: "0.00", krw: "0.00", basis: "synthetic" },
              result: "success",
              stopReason: null,
              errorKind: null,
              fallbackReason: null,
            });
            return { ok: true, aiCallId, output: { reply: "합성 카드 제안", card: { kind: "payment_claim" } } };
          });
        const send = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
        const at = new Date(NOW.getTime() + 1000);
        const options = {
          connect: () => (legacy && !late ? pgConnector(new Secret(roleUrl)) : isolated.connect()),
          now: () => at,
          fetch: send,
          logSink: () => {},
          services: { fieldCrypto: fc, aiModel: { provider: "anthropic" as const, model: "claude-haiku-5-5", call } },
        };
        expect(await consumeKakaoCallback(job, env, options)).toBe("done");
        expect(send).toHaveBeenCalledTimes(empty ? 0 : 1);
        expect(network).not.toHaveBeenCalled();
        if (prepareLegacy) expect(call).toHaveBeenCalledTimes(1);
        else expect(call).not.toHaveBeenCalled();
        if (legacy) {
          if (!empty) {
            const sent = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
            expectSchema("SkillTemplateResponse", sent);
            expect(JSON.stringify(sent)).toContain("합성 중복 뒤의 정상 안내");
            expect(JSON.stringify(sent)).not.toContain(amountKey);
          }
          expect(
            (await isolated.db.query("SELECT delivery,sent_at FROM messages WHERE id=ANY($1::uuid[])", [replayIds]))
              .rows,
          ).toEqual(replayIds.map(() => ({ delivery: "deferred", sent_at: null })));
          const pending = (
            await isolated.db.query(
              "SELECT id,delivery,sent_at FROM messages WHERE trace_id=$1 AND direction='outbound'",
              [job.messageId],
            )
          ).rows;
          expect(pending).toHaveLength(1);
          expect(pending[0]).toMatchObject({ delivery: "deferred", sent_at: null });
          if (!empty)
            expect(
              (await isolated.db.query("SELECT delivery FROM messages WHERE id=$1", [normalId])).rows[0]?.delivery,
            ).toBe("delivered_later");
          await isolated.db.query(`GRANT SELECT (changes,base_version,amount_delta) ON change_requests TO "${role}"`);
          const runtime = pgConnector(new Secret(roleUrl));
          try {
            const limited = shopRequestDb(
              createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }),
              runtime,
            );
            const recovered = await limited.transaction((tx) =>
              deferredKakaoBatch(tx, shop.customerId, { now: at, allowFullOrderCard: true }),
            );
            expect(
              JSON.stringify(
                kakaoConsultationMessage({ state: "normal", contents: deferredKakaoTexts(recovered.messages) }),
              ),
            ).toContain(amountKey);
            expect(recovered.messages.map((m) => m.id)).toContain(pending[0]?.id);
          } finally {
            await runtime.close();
          }
          expect(await consumeKakaoCallback(job, env, options)).toBe("done");
          expect(send).toHaveBeenCalledTimes(empty ? 0 : 1);
          expect((await state()).payments).toEqual(beforePayment);
          return;
        }
        expect(network).not.toHaveBeenCalled();
        const sent = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
        expectSchema("SkillTemplateResponse", sent);
        expect(JSON.stringify(sent)).toContain("합성 중복 뒤의 정상 안내");
        expect(
          (
            await isolated.db.query("SELECT delivery,sent_at FROM messages WHERE id=ANY($1::uuid[])", [
              [...replayIds, normalId],
            ])
          ).rows,
        ).toEqual([...replayIds, normalId].map(() => ({ delivery: "delivered_later", sent_at: at })));

        const outputs = sent.template.outputs as { textCard?: { buttons: unknown[] } }[];
        expect(
          outputs.filter((o) => o.textCard?.buttons.some((b) => JSON.stringify(b).includes(amountKey))),
        ).toHaveLength(1);
        expect(
          (await isolated.db.query("SELECT status,sent_at FROM notifications WHERE id=$1", [notice.id])).rows,
        ).toEqual([{ status: "delivered_on_reply", sent_at: at }]);
        expect((await isolated.db.query("SELECT delivery,sent_at FROM messages WHERE id=$1", [replyId])).rows).toEqual([
          { delivery: "callback", sent_at: at },
        ]);
        expect((await state()).payments).toEqual(beforePayment);
        expect(await consumeKakaoCallback(job, env, options)).toBe("done");
        expect(send).toHaveBeenCalledTimes(1);
      } finally {
        lateRead?.mockRestore();
        network.mockRestore();
      }
      return;
    }
    const execute = vi.fn<ConfirmCardCommand>();
    let body: unknown;
    if (mode === "press" || mode === "legacy") {
      if (mode === "legacy") {
        restricted = true;
        if (kind === "difference") {
          const before = await state();
          const pending = await call(original.cardKey, "", execute, "blk-card");
          expect(pending.response.headers.get("Siljang-Outcome")).toBe("retry_needed");
          expect(JSON.stringify(await pending.response.json())).not.toContain(amountKey);
          expect(await state()).toEqual(before);
          expect(JSON.stringify(pending.logs)).toContain("CustomerNoticeTemporarilyUnavailable");
          expect(JSON.stringify(pending.logs)).not.toContain("42501");
          await isolated.db.query(`GRANT SELECT (changes,base_version,amount_delta) ON change_requests TO "${role}"`);
        }
      }
      const result = await call(original.cardKey, "", execute, "blk-card");
      expect(result.response.headers.get("Siljang-Outcome")).toBe("not_allowed_now");
      body = await result.response.json();
    } else if (mode === "prepare") {
      const prepared = await scoped.transaction((tx) =>
        prepareConfirmCardInTransaction(tx, {
          customerId: shop.customerId,
          consultationId: shop.consultationId,
          orderId: shop.orderId,
          kind: "payment_claim",
          sourceMessageId: newUuid(),
          now: NOW,
        }),
      );
      expect(prepared).not.toHaveProperty("unavailable");
      if ("unavailable" in prepared) throw new Error("새 금액 카드가 필요한데 고정 문구만 반환함");
      body = kakaoConsultationMessage({ state: "normal", contents: [prepared] });
    } else if (mode === "deferred") {
      await isolated.db.query("UPDATE consultations SET ai_disclosed_at=$2 WHERE id=$1", [shop.consultationId, NOW]);
      await isolated.db.query(
        "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','card',$4,'결제 확인 요청','deferred',$5)",
        [newUuid(), shop.shopId, shop.consultationId, sourceMessageId, NOW],
      );
      const batch = await scoped.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: NOW }));
      body = kakaoConsultationMessage({ state: "normal", contents: deferredKakaoTexts(batch.messages) });
    } else {
      const delivery = await scoped.transaction((tx) =>
        readConfirmCardDelivery(tx, {
          customerId: shop.customerId,
          consultationId: shop.consultationId,
          sourceMessageId,
          now: NOW,
        }),
      );
      const contents = [delivery.card ?? delivery.text];
      body = kakaoConsultationMessage({ state: "normal", contents });
      if (mode === "callback") {
        const expected = body;
        expect(
          await deliverKakaoCallback(
            { url: new URL("https://bot-api.kakao.com/v1/callback/synthetic_amount_redirect"), deadline: 10000 },
            contents,
            {
              now: () => 100,
              fetch: async (_url, init) => {
                body = JSON.parse(String(init?.body));
                return Response.json({ status: "SUCCESS" });
              },
            },
          ),
        ).toBe("delivered");
        expect(body).toEqual(expected);
      }
    }
    expectSchema("SkillTemplateResponse", body);
    const shown = JSON.stringify(body);
    for (const text of [
      "새 금액 확인",
      "55,000원",
      amountKey,
      ...(kind === "custom"
        ? ["요청하신 견적 35,000원", "합성 장식을 추가해요", "이 금액으로 할게요", "안 할래요"]
        : ["지금 35,000원", "차액 20,000원", "변경 마감", "합성 변경 문구", "바꿀게요", "그대로 둘래요"]),
    ])
      expect(shown).toContain(text);
    for (const text of ["결제 확인 요청", "입금자 이름이 달라요", "시험손님", "계좌번호", original.cardKey])
      expect(shown).not.toContain(text);
    expect((await state()).payments).toEqual(beforePayment);
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify((await state()).cards)).not.toContain("시험손님");
    expect(JSON.stringify((await state()).cards)).not.toContain("amountConfirmation");
    expect(JSON.stringify((await state()).cards)).not.toContain("합성 장식을 추가해요");
  });

  it("결제 확인 카드에 연결한 긴 차액 원문은 세 출력으로 일반/누르기/모의 콜백에서 같다", async () => {
    const changes = "🎂".repeat(1500);
    const wrapper = {
      kind: "payment_claim",
      cardKey: "synthetic_claim_wrapper_key",
      title: "결제 확인 요청",
      description: "서버 참조",
      confirmLabel: "결제 확인 요청",
      blockId: "blk-card",
      amountConfirmation: {
        state: "amount-confirm",
        kind: "difference",
        cardKey: "synthetic_amount_wrapper_key",
        blockId: "blk-card",
        expiresAt: "2026-11-26T01:30:00Z",
        timeZone: "Asia/Seoul",
        changes,
        currentAmount: 35000,
        newAmount: 55000,
        difference: 20000,
        changeDeadline: "2026-11-26T12:00:00Z",
      },
    } as const;
    const expanded = expandKakaoMessageContents([wrapper]);
    expect(expanded).toHaveLength(3);
    expect(expandKakaoMessageContents(expanded)).toEqual(expanded);
    const normal = kakaoConsultationMessage({ state: "normal", contents: [wrapper] });
    const pressed = kakaoConfirmAnswerMessage({
      outcome: "not_allowed_now",
      text: "새 금액을 먼저 확인해 주세요",
      card: wrapper,
    });
    expect(pressed).toEqual(normal);
    expectSchema("SkillTemplateResponse", normal);
    if (normal.template === undefined) throw new Error("합성 응답의 전송 형식 없음");
    const shown = normal.template.outputs
      .map((o) => ("simpleText" in o ? o.simpleText.text : "textCard" in o ? o.textCard.description : ""))
      .join("");
    expect(shown).toContain(changes);
    expect(JSON.stringify(normal)).not.toContain(wrapper.cardKey);
    expect(JSON.stringify(normal)).toContain(wrapper.amountConfirmation.cardKey);
    let sent: unknown;
    expect(
      await deliverKakaoCallback(
        { url: new URL("https://bot-api.kakao.com/v1/callback/synthetic_long_amount"), deadline: 10000 },
        [wrapper],
        {
          now: () => 100,
          fetch: async (_url, init) => {
            sent = JSON.parse(String(init?.body));
            return Response.json({ status: "SUCCESS" });
          },
        },
      ),
    ).toBe("delivered");
    expect(sent).toEqual(normal);
  });
});
