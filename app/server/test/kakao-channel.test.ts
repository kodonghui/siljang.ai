import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { ApiError } from "../src/problem";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";

const ORIGIN = "https://siljang.example";
const PATH = "/owner/kakao-channel";
const NOW = new Date("2026-11-22T05:00:00Z");
const OWNER = "x-test-owner";
const db = testDb();

function input(botId = newUuid().replaceAll("-", "").slice(0, 24), baseRevision: string | null = null) {
  return {
    baseRevision,
    botId,
    channelPublicId: "_synthetic",
    blockIds: {
      card: "card",
      ordererInfo: "orderer",
      allergyAnswer: "allergy",
      depositorName: "depositor",
      review: "review",
    },
  };
}

async function fixture() {
  const ownerId = newUuid(),
    shopId = newUuid();
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO owners(id,kakao_account_id) VALUES($1,$2)", [
      ownerId,
      BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(),
    ]);
    await tx.query(
      `INSERT INTO shops (id,owner_id,name,contact_phone,contact_email,business_address,business_name,representative_name,business_reg_no,mail_order_exemption,food_license_no,food_business_type,license_photo_key,entrustment_terms_version,entrustment_consented_at)
      VALUES ($1,$2,'채널 합성 가게','010-0000-0000','channel@example.com','서울 합성로1','합성 제과','시험사장','1234567890','합성 면제','2026-0001','bakery','license/synthetic.jpg','test-v1',$3)`,
      [shopId, ownerId, NOW],
    );
  });
  const clock = { now: NOW };
  const app = createApp({
    scopes: {
      owner: async (c) => {
        if (c.req.header(OWNER) !== ownerId) throw new ApiError("unauthenticated");
        return createShopScope(shopId, { kind: "owner", ownerId });
      },
    },
    services: { now: () => clock.now },
    logSink: () => {},
  });
  const call = (method: string, path = PATH, body?: unknown, key = newRequestKey(), authenticated = true) =>
    app.request(
      `${ORIGIN}/api${path}`,
      {
        method,
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": key,
          ...(authenticated ? { [OWNER]: ownerId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      testEnv(),
    );
  return { ownerId, shopId, clock, app, call };
}

describeDb("TASK-042 채널 설정과 스킬 키 API-030/031/079", () => {
  afterAll(async () => db.close());

  it("새 가게의 연결은404 not_set임", async () => {
    const h = await fixture();
    await expectProblem(await h.call("GET"), "not_set");
  });

  it.each([
    ["GET", PATH],
    ["PUT", PATH],
    ["POST", `${PATH}/skill-key`],
  ])("인증 없는 %s %s는401임", async (method, path) => {
    const h = await fixture();
    await expectProblem(
      await h.call(method, path, method === "GET" ? undefined : input(), newRequestKey(), false),
      "unauthenticated",
    );
  });

  it("새 연결의 키는 생성/같은 키 재전송에만 보이고 조회에는 버전만 있음", async () => {
    const h = await fixture();
    const body = input(),
      key = newRequestKey();
    const response = await h.call("PUT", PATH, body, key);
    expect(response.status, await response.clone().text()).toBe(200);
    const value = (await response.json()) as {
      kakaoChannel: { connectionId: string; revision: string };
      skillKey: { headerValue: string; keyVersion: number };
    };
    expectSchema("KakaoChannelResult", value);
    expect(value).toMatchObject({
      outcome: "created",
      kakaoChannel: {
        botId: body.botId,
        status: "pending",
        proofPhrase: null,
        claimExpiresAt: "2026-11-22T14:30:00+09:00",
      },
      skillKey: { headerName: "Siljang-Skill-Key", keyVersion: 1 },
    });
    const stored = await db.query("SELECT row_to_json(c) AS row FROM kakao_channels c WHERE c.shop_id=$1", [h.shopId]);
    expect(JSON.stringify(stored.rows)).not.toContain(value.skillKey.headerValue);
    const read = await h.call("GET");
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expectSchema("KakaoChannel", readBody);
    expect(JSON.stringify(readBody)).not.toContain(value.skillKey.headerValue);
    const replay = await h.call("PUT", PATH, body, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(value);
  });
});
