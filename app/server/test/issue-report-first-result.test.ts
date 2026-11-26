/** 실제 신고 쓰기는 TASK140의 합성 명령으로 대체하고 카드 저장/전달 경계만 검사한다. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import {
  prepareConfirmCardInTransaction,
  pressConfirmCard,
  readConfirmCardDelivery,
  showConfirmCard,
} from "../src/confirm-card-store";
import { CustomerNoticeTemporarilyUnavailable } from "../src/customer-notice-content";
import { kakaoConfirmCardReply } from "../src/kakao-confirm-card";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopDb, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z");
describeDb("신고 카드의 실제 저장 첫 결과와 재전달(TASK-147)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string, detailsId: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 신고 첫 결과 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    const paid = newUuid();
    const confirmed = new Date(NOW.getTime() - 4 * 3600000);
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
        [shop.paymentRequestId, confirmed],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paid, shop.shopId, shop.orderId, shop.paymentRequestId, confirmed],
      );
      await tx.query(
        "UPDATE orders SET status='received',confirmed_at=$2,confirmed_payment_id=$3,finished_at=$4 WHERE id=$1",
        [shop.orderId, confirmed, paid, new Date(NOW.getTime() - 3 * 3600000)],
      );
      await tx.query(
        "INSERT INTO productions(shop_id,order_id,completed_at,handed_over_at,handover_kind,created_at) VALUES($1,$2,$3,$3,'pickup',$4)",
        [shop.shopId, shop.orderId, new Date(NOW.getTime() - 3 * 3600000), confirmed],
      );
    });
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    detailsId = newUuid();
    await isolated.db.query(
      "INSERT INTO issue_details(id,shop_id,consultation_id,order_id,description,health_concern) VALUES($1,$2,$3,$4,'합성 신고 설명',true)",
      [detailsId, shop.shopId, shop.consultationId, shop.orderId],
    );
    for (const position of [1, 2])
      await isolated.db.query(
        "INSERT INTO issue_photos(shop_id,issue_details_id,position,storage_key,content_type,byte_size) VALUES($1,$2,$3,$4,'image/jpeg',1)",
        [shop.shopId, detailsId, position, `synthetic-issue-${newUuid()}`],
      );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const prepare = () =>
    showConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "issue_report",
      orderId: shop.orderId,
      sourceMessageId: shop.messageId,
      now: NOW,
    });
  it("30분 경계에서는 지금 값의 새 카드만 보내고 명령을 실행하지 않는다", async () => {
    const card = await prepare(),
      at = new Date(NOW.getTime() + 30 * 60000);
    const execute = vi.fn(async () => ({ outcome: "issue_reported", text: "합성 신고 접수" }));
    const answer = await pressConfirmCard(
      scoped(),
      {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        cardKey: card.cardKey,
        choice: "confirm",
        now: at,
      },
      execute,
    );
    expect(answer.outcome).toBe("card_expired");
    expect(execute).not.toHaveBeenCalled();
    expect(answer.card?.cardKey).not.toBe(card.cardKey);
    expect(answer.card?.issueReport?.expiresAt).toBe(new Date(at.getTime() + 30 * 60000).toISOString());
    const response = kakaoConfirmCardReply(
      { json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }) },
      answer,
    );
    expect(JSON.stringify(await response.json())).toContain("시간이 지나 새 카드를 보내 드려요");
  });
  it("늦은 신고도 표시하며 신고 기한/원인/보상을 카드에서 판정하지 않는다", async () => {
    const at = new Date(NOW.getTime() + 30 * 86400000);
    const card = await showConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "issue_report",
      orderId: shop.orderId,
      now: at,
    });
    expect(card.issueReport?.receivedAt).toBe(new Date(NOW.getTime() - 3 * 3600000).toISOString());
    for (const name of ["late", "compensation", "problemKind"]) expect(card.issueReport).not.toHaveProperty(name);
    expect(card.issueReport?.expiresAt).toBe(new Date(at.getTime() + 30 * 60000).toISOString());
  });
  it("자료가 잠시 없어지면 전송 참조를 보류하고 복구 뒤 같은 카드를 읽는다", async () => {
    const card = await prepare();
    await isolated.db.query("UPDATE issue_details SET status='abandoned' WHERE id=$1", [detailsId]);
    const read = () =>
      scoped().transaction((tx) =>
        readConfirmCardDelivery(tx, {
          customerId: shop.customerId,
          consultationId: shop.consultationId,
          sourceMessageId: shop.messageId,
          now: NOW,
        }),
      );
    await expect(read()).rejects.toBeInstanceOf(CustomerNoticeTemporarilyUnavailable);
    await isolated.db.query("UPDATE issue_details SET status='collecting' WHERE id=$1", [detailsId]);
    expect((await read()).card?.cardKey).toBe(card.cardKey);
  });
  it("다른 상담의 모은 자료로 정상 카드를 만들거나 원문을 보이지 않는다", async () => {
    const other = newUuid();
    await isolated.db.query(
      "INSERT INTO consultations(id,shop_id,customer_id,status,ended_at) VALUES($1,$2,$3,'ended',$4)",
      [other, shop.shopId, shop.customerId, NOW],
    );
    await isolated.db.query("UPDATE issue_details SET consultation_id=$2 WHERE id=$1", [detailsId, other]);
    const result = await scoped().transaction((tx) =>
      prepareConfirmCardInTransaction(tx, {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        kind: "issue_report",
        orderId: shop.orderId,
        now: NOW,
      }),
    );
    expect(result).toMatchObject({ unavailable: true });
    expect(JSON.stringify(result)).not.toContain("합성 신고 설명");
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rows[0]
        ?.n,
    ).toBe(0);
  });
  it("실제 최소 역할로 표시하고 설명 권한이 없으면 원문 없이 일시 보류한다", async () => {
    await prepare();
    const role = `issue147_${newUuid().replaceAll("-", "")}`;
    let positive = false,
      revoked = false;
    await expect(
      isolated.db.transaction(async (raw) => {
        await raw.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
        await raw.query(
          readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8").replaceAll(
            ':"runtime_role"',
            `"${role}"`,
          ),
        );
        const db = shopDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), raw);
        const input = {
          customerId: shop.customerId,
          consultationId: shop.consultationId,
          sourceMessageId: shop.messageId,
          now: NOW,
        };
        await raw.query(`SET LOCAL ROLE "${role}"`);
        expect(
          (
            await raw.query(`SELECT has_column_privilege(current_user,'issue_details','description','UPDATE') AS description,
          has_column_privilege(current_user,'issue_details','health_concern','UPDATE') AS health,
          has_column_privilege(current_user,'issue_details','order_id','UPDATE') AS target,
          has_column_privilege(current_user,'issue_details','updated_at','UPDATE') AS clock`)
          ).rows[0],
        ).toEqual({ description: false, health: false, target: false, clock: true });
        expect((await readConfirmCardDelivery(db, input)).card?.issueReport?.description).toBe("합성 신고 설명");
        positive = true;
        await raw.query("SET LOCAL ROLE NONE");
        await raw.query(`REVOKE SELECT(description) ON issue_details FROM "${role}"`);
        await raw.query(`SET LOCAL ROLE "${role}"`);
        revoked = true;
        await readConfirmCardDelivery(db, input);
      }),
    ).rejects.toBeInstanceOf(CustomerNoticeTemporarilyUnavailable);
    expect(positive).toBe(true);
    expect(revoked).toBe(true);
  });
  it("모은 자료의1000자 그래핌도 진료 안내와 세 출력으로 표시한다", async () => {
    const description = `가${"\u0301".repeat(999)}`;
    await isolated.db.query("UPDATE issue_details SET description=$2 WHERE id=$1", [detailsId, description]);
    const card = await prepare();
    expect(card.issueReport?.description).toBe(description);
    const body = kakaoConsultationMessage({ state: "normal", contents: [card] });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template?.outputs).toHaveLength(3);
    expect(JSON.stringify(body)).toContain(description);
  });
  it("실제 모은 신고 자료와 받은 날을 준비 값으로 연결하고 원문을 카드 payload에 복사하지 않는다", async () => {
    const card = await prepare();
    expect(card.issueReport).toMatchObject({
      description: "합성 신고 설명",
      photoCount: 2,
      showMedicalNotice: true,
      receivedAt: new Date(NOW.getTime() - 3 * 3600000).toISOString(),
      timeZone: "Asia/Seoul",
      expiresAt: new Date(NOW.getTime() + 30 * 60000).toISOString(),
    });
    const payload = (
      await isolated.db.query("SELECT payload FROM confirm_cards WHERE shop_id=$1 AND card_key=$2", [
        shop.shopId,
        card.cardKey,
      ])
    ).rows[0]?.payload;
    expect(JSON.stringify(payload)).not.toContain("합성 신고 설명");
    const delivery = await scoped().transaction((tx) =>
      readConfirmCardDelivery(tx, {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        sourceMessageId: shop.messageId,
        now: NOW,
      }),
    );
    expect(delivery.card?.issueReport).toEqual(card.issueReport);
  });
  it.each(["description", "health", "photo"] as const)(
    "같은 주문 버전이어도 모은 신고 자료가 바뀌면 새 카드만 보내고 명령을 실행하지 않는다(%s)",
    async (field) => {
      const card = await prepare();
      if (field === "description")
        await isolated.db.query("UPDATE issue_details SET description='바뀐 합성 신고 설명' WHERE id=$1", [detailsId]);
      if (field === "health")
        await isolated.db.query("UPDATE issue_details SET health_concern=false WHERE id=$1", [detailsId]);
      if (field === "photo")
        await isolated.db.query(
          "INSERT INTO issue_photos(shop_id,issue_details_id,position,storage_key,content_type,byte_size) VALUES($1,$2,3,$3,'image/jpeg',1)",
          [shop.shopId, detailsId, `synthetic-issue-${newUuid()}`],
        );
      const execute = vi.fn(async () => ({ outcome: "issue_reported", text: "합성 신고 접수" }));
      const answer = await pressConfirmCard(
        scoped(),
        {
          customerId: shop.customerId,
          consultationId: shop.consultationId,
          cardKey: card.cardKey,
          choice: "confirm",
          now: NOW,
        },
        execute,
      );
      expect(answer.outcome).toBe("card_stale");
      expect(execute).not.toHaveBeenCalled();
      expect(answer.card?.cardKey).not.toBe(card.cardKey);
      expect(answer.card?.issueReport).toMatchObject({
        photoCount: field === "photo" ? 3 : 2,
        showMedicalNotice: field !== "health",
        description: field === "description" ? "바뀐 합성 신고 설명" : "합성 신고 설명",
      });
    },
  );
  it.each(["신고를 받았어요. 사장님이 보시고 정하실 거예요", "이전 합성 신고 접수 안내"])(
    "API071 재클릭과 카드 재전달이 현재/이전 첫 결과만 보이고 명령은 한 번이다(%s)",
    async (text) => {
      const sourceMessageId = newUuid();
      const card = await showConfirmCard(scoped(), {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        kind: "issue_report",
        orderId: shop.orderId,
        sourceMessageId,
        now: NOW,
      });
      const execute = vi.fn(async () => ({ outcome: "issue_reported", text }));
      const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 신고 첫 결과의 실제 발신 금지"));
      try {
        const call = () =>
          createApp({
            connect: () => isolated.connect(),
            services: { now: () => NOW, confirmCardCommand: execute },
            logSink: () => {},
          }).request(
            "/api/kakao/skills/card",
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
              body: JSON.stringify({
                bot: { id: shop.botId },
                userRequest: {
                  utterance: "문제 신고",
                  block: { id: "blk-card" },
                  user: { id: shop.userKey, type: "botUserKey" },
                },
                action: {
                  id: "synthetic-issue-first",
                  params: {},
                  clientExtra: { cardKey: card.cardKey, choice: "confirm" },
                },
              }),
            },
            testEnv(),
          );
        const first = await call(),
          repeated = await call();
        const initial: unknown = await first.json(),
          again: unknown = await repeated.json();
        const delivery = await scoped().transaction((tx) =>
          readConfirmCardDelivery(tx, {
            customerId: shop.customerId,
            consultationId: shop.consultationId,
            sourceMessageId,
            now: NOW,
          }),
        );
        expect(first.headers.get("Siljang-Outcome")).toBe("issue_reported");
        expect(repeated.headers.get("Siljang-Outcome")).toBe("card_used");
        expectSchema("SkillTemplateResponse", initial);
        expectSchema("SkillTemplateResponse", again);
        expect.soft(again).toEqual(initial);
        expect.soft(again).toHaveProperty("template.outputs", [{ simpleText: { text } }]);
        expect.soft(delivery).toEqual({ text });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(network).not.toHaveBeenCalled();
      } finally {
        network.mockRestore();
      }
    },
  );
});
