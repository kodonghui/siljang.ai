import { afterAll, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import * as policyTemplate from "../src/privacy-policy-body";
import type { PrivacyPolicySettings } from "../src/privacy-policy-settings";
import { readPrivacyPolicySettings } from "../src/privacy-policy-settings";
import { ApiError } from "../src/problem";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { MemoryLimiter } from "./support/rate-limit";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const db = testDb(),
  NOW = new Date("2026-11-23T04:00:00Z"),
  ORIGIN = "https://siljang.example";
const env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
const POLICY = readPrivacyPolicySettings(
  {
    PUBLIC_APP_ORIGIN: ORIGIN,
    PRIVACY_TRANSFER_SETTINGS: JSON.stringify(
      ["anthropic", "supabase", "cloudflare"].map((provider) => ({
        provider,
        recipient: `${provider} 합성 회사`,
        country: "합성 국가",
        whenAndHow: "이용 시 암호화 전송",
        purposeAndRetention: "합성 목적과 기간",
        howToRefuse: "가게에 거부하면 온라인 상담을 쓰지 않습니다.",
      })),
    ),
  },
  "anthropic",
) as PrivacyPolicySettings;

async function fixture() {
  const shop = await createShop(db, "재발행 합성 가게");
  await linkTestChannel(db, shop.channelId);
  await issueTestBookingLink(db, shop);
  await db.query("UPDATE shops SET booking_slug=NULL,booking_issued_at=NULL WHERE id=$1", [shop.shopId]);
  function app(policy: PrivacyPolicySettings | null = POLICY) {
    return createApp({
      scopes: {
        owner: async (c) => {
          if (c.req.header("x-test-owner") !== shop.ownerId) throw new ApiError("unauthenticated");
          return createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId });
        },
      },
      services: {
        now: () => NOW,
        publicAppOrigin: ORIGIN,
        privacyPolicy: policy,
        limiters: { PUBLIC_PRIVACY_RATE_LIMITER: new MemoryLimiter(1000) },
      },
      logSink: () => {},
    });
  }
  const main = app();
  const issued = await main.request(
    `${ORIGIN}/api/owner/booking-link`,
    { headers: { "x-test-owner": shop.ownerId } },
    env,
  );
  expect(issued.status, await issued.clone().text()).toBe(200);
  const url = ((await issued.json()) as { url: string }).url;
  const slug = new URL(url).pathname.split("/").at(-1);
  const publicGet = (api = main) => api.request(`${ORIGIN}/api/public/shops/${slug}/privacy-policy`, {}, env);
  const settings = async () => {
    const r = await main.request(`${ORIGIN}/api/owner/shop`, { headers: { "x-test-owner": shop.ownerId } }, env);
    expect(r.status).toBe(200);
    return (await r.json()) as { revision: string; name: string };
  };
  const patch = async (changes: Record<string, unknown>, api = main) =>
    api.request(
      `${ORIGIN}/api/owner/shop`,
      {
        method: "PATCH",
        headers: {
          "x-test-owner": shop.ownerId,
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": newRequestKey(),
        },
        body: JSON.stringify({ baseRevision: (await settings()).revision, ...changes }),
      },
      env,
    );
  const policies = () =>
    db.query<{ version: number; body: string; overseas_transfers: unknown }>(
      "SELECT version,body,overseas_transfers FROM privacy_policies WHERE shop_id=$1 ORDER BY version",
      [shop.shopId],
    );
  return { shop, main, app, publicGet, settings, patch, policies };
}

describeDb("TASK-184 처리방침 본문 비교와 재발행", () => {
  afterAll(async () => db.close());
  for (const [field, value] of [
    ["name", "바뀐 합성 가게"],
    ["contactPhone", "010-0000-1234"],
    ["contactEmail", "changed@example.com"],
  ] as const)
    it(`${field}만 저장해도 새 버전/이전 글·상담 고지 버전을 보존함`, async () => {
      const h = await fixture();
      const before = (await h.policies()).rows;
      const result = await h.patch({ [field]: value });
      expect(result.status, await result.clone().text()).toBe(200);
      const after = (await h.policies()).rows;
      expect(after).toHaveLength(before.length + 1);
      expect(after.slice(0, -1)).toEqual(before);
      const latest = after.at(-1);
      expect(latest?.body).toContain(value);
      const response = await h.publicGet();
      expect(response.status).toBe(200);
      expectSchema("PrivacyPolicy", await response.clone().json());
      expect(((await response.json()) as { version: number }).version).toBe(latest?.version);
      expect(
        (await db.query("SELECT ai_disclosed_policy_version FROM consultations WHERE id=$1", [h.shop.consultationId]))
          .rows[0]?.ai_disclosed_policy_version,
      ).toBe(1);
    });
  it("설정이 바뀐 새 배포의 첫 공개 읽기부터 새 회사·나라·기간을 쓰고 같은 글은 더 만들지 않음", async () => {
    const h = await fixture(),
      before = (await h.policies()).rows;
    const changed: PrivacyPolicySettings = {
      transfers: POLICY.transfers.map((t, i) => ({
        ...t,
        recipient: `${t.recipient} 새 배포`,
        country: i === 0 ? "새 합성 국가" : t.country,
        purposeAndRetention: "새 합성 보유 기간",
      })),
    };
    const deployed = h.app(changed);
    for (let i = 0; i < 3; i++) {
      const response = await h.publicGet(deployed);
      expect(response.status, await response.clone().text()).toBe(200);
      const p = (await response.json()) as { version: number; body: string };
      expect(p.version).toBe((before.at(-1)?.version ?? 0) + 1);
      expect(p.body).toContain("새 합성 국가");
      expect(p.body).toContain("새 합성 보유 기간");
    }
    expect((await h.policies()).rows).toHaveLength(before.length + 1);
  });
  it("같은 설정/같은 값 저장과20개 동시 읽기는 같은 한 버전을 씀", async () => {
    const h = await fixture(),
      before = (await h.policies()).rows;
    expect((await h.patch({ name: (await h.settings()).name })).status).toBe(200);
    const changed = { transfers: POLICY.transfers.map((t) => ({ ...t, whenAndHow: "동시 시험 새 전송 시기" })) };
    const results = await Promise.all(Array.from({ length: 20 }, () => h.publicGet(h.app(changed))));
    const bodies = await Promise.all(
      results.map(async (r) => {
        expect(r.status, await r.clone().text()).toBe(200);
        return (await r.json()) as { version: number };
      }),
    );
    expect(new Set(bodies.map((x) => x.version)).size).toBe(1);
    const after = (await h.policies()).rows;
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, -1)).toEqual(before);
  });
  it("새 배포를 여러 발급 가게가 읽어도 각자 한 버전만 만들고 미발급 가게에는 만들지 않음", async () => {
    const issued = [await fixture(), await fixture(), await fixture()],
      unissued = await createShop(db, "미발급 합성 가게"),
      changed = { transfers: POLICY.transfers.map((t) => ({ ...t, recipient: `${t.recipient} 새 배포` })) };
    await db.query("UPDATE shops SET booking_slug=NULL,booking_issued_at=NULL WHERE id=$1", [unissued.shopId]);
    await db.query("UPDATE consultations SET ai_disclosed_at=NULL,ai_disclosed_policy_version=NULL WHERE shop_id=$1", [
      unissued.shopId,
    ]);
    await db.query("DELETE FROM privacy_policies WHERE shop_id=$1", [unissued.shopId]);
    const deployed = issued[0]?.app(changed);
    if (!deployed) throw new Error("발급 가게가 없어요");
    for (const h of issued) {
      const before = (await h.policies()).rows;
      for (let i = 0; i < 2; i++) {
        const response = await h.publicGet(deployed);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { version: number; body: string };
        expect(body.version).toBe((before.at(-1)?.version ?? 0) + 1);
        expect(body.body).toContain("새 배포");
      }
      const after = (await h.policies()).rows;
      expect(after).toHaveLength(before.length + 1);
      expect(after.slice(0, -1)).toEqual(before);
    }
    expect(
      (await db.query("SELECT count(*)::int n FROM privacy_policies WHERE shop_id=$1", [unissued.shopId])).rows[0]?.n,
    ).toBe(0);
  });
  it("동시 저장 충돌 뒤 다시 저장하면 처리방침 번호가 빠지거나 겹치지 않음", async () => {
    const h = await fixture(),
      before = (await h.policies()).rows,
      baseRevision = (await h.settings()).revision,
      changes = [{ name: "동시 저장 합성 하나" }, { contactEmail: "concurrent@example.com" }],
      responses = await Promise.all(changes.map((change) => h.patch({ ...change, baseRevision })));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = responses.findIndex((r) => r.status === 409);
    expect((await h.patch(changes[conflict] ?? {})).status).toBe(200);
    const after = (await h.policies()).rows;
    expect(after).toHaveLength(before.length + 2);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.map((p) => p.version)).toEqual(Array.from({ length: after.length }, (_, i) => i + 1));
    expect(after.at(-1)?.body).toContain("동시 저장 합성 하나");
    expect(after.at(-1)?.body).toContain("concurrent@example.com");
  });
  it("이미 발급한 가게에서 설정이 없으면 옛 글을 내지 않고 연락처 저장도 전부 롤백함", async () => {
    const h = await fixture(),
      before = (await h.policies()).rows;
    await expectProblem(await h.publicGet(h.app(null)), "internal");
    await expectProblem(await h.patch({ name: "저장되면 안 되는 합성 이름" }, h.app(null)), "internal");
    expect((await h.settings()).name).toBe("재발행 합성 가게");
    expect((await h.policies()).rows).toEqual(before);
  });
  it("고정 문장만 바뀐 배포도 새 전체 본문으로 한 번 재발행함", async () => {
    const h = await fixture(),
      before = (await h.policies()).rows;
    const original = policyTemplate.privacyPolicyBody;
    const template = vi
      .spyOn(policyTemplate, "privacyPolicyBody")
      .mockImplementation((shop, transfers) => `${original(shop, transfers)}\n\n배포에서 바뀐 합성 고정 문장`);
    try {
      for (let i = 0; i < 2; i++) {
        const response = await h.publicGet();
        expect(response.status).toBe(200);
        expect(((await response.json()) as { body: string }).body).toContain("배포에서 바뀐 합성 고정 문장");
      }
      const after = (await h.policies()).rows;
      expect(after).toHaveLength(before.length + 1);
      expect(after.slice(0, -1)).toEqual(before);
    } finally {
      template.mockRestore();
    }
  });
  it("미발급 가게 설정 저장은 처리방침/모델 설정 없이 되고 다른 가게 버전을 만들지 않음", async () => {
    const h = await fixture(),
      other = await createShop(db, "다른 합성 가게"),
      before = (await h.policies()).rows;
    await db.query("UPDATE shops SET booking_slug=NULL,booking_issued_at=NULL WHERE id=$1", [h.shop.shopId]);
    expect((await h.patch({ contactEmail: "unissued@example.com" }, h.app(null))).status).toBe(200);
    expect((await h.policies()).rows).toEqual(before);
    expect(
      (await db.query("SELECT count(*)::int n FROM privacy_policies WHERE shop_id=$1", [other.shopId])).rows[0]?.n,
    ).toBe(1);
  });
});
