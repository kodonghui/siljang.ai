import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob, KakaoCallbackQueue } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { describeDb, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";
import { MemoryStore } from "./support/storage";

const NOW = new Date("2026-11-25T00:00:00Z");
const PHOTO = "https://t1.daumcdn.net/synthetic/reference.png";
const CALLBACK = "https://bot-api.kakao.com/v1/callback/synthetic_photo_callback";
const IMAGE = new Uint8Array(readFileSync(new URL("./fixtures/photos/metadata.png", import.meta.url)));

describeDb("참고 사진의 실제 메시지 수신(TASK-065)", () => {
  const db = testDb();
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  let shop: ShopFixture, skillKey: string, userKey: string, store: MemoryStore;
  const call = vi.fn<AiModel["call"]>(async () => {
    throw new Error("사진의 AI 호출 금지");
  });
  const download = vi.fn<typeof fetch>(async () => new Response(IMAGE, { headers: { "Content-Type": "image/png" } }));
  beforeEach(async () => {
    shop = await createShop(db, "합성 참고 사진 가게");
    await db.query(
      "INSERT INTO business_calendars(shop_id,daily_capacity,order_cutoff_days,order_cutoff_time) VALUES($1,10,2,'18:00')",
      [shop.shopId],
    );
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    skillKey = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    userKey = crypto.randomUUID();
    store = new MemoryStore();
    call.mockClear();
    download.mockReset();
    download.mockImplementation(async () => new Response(IMAGE, { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", download);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => db.close());

  function request(url: string, queue?: KakaoCallbackQueue, callback = false) {
    const app = createApp({
      services: {
        now: () => NOW,
        storage: store,
        ...(queue === undefined ? {} : { kakaoCallbackQueue: queue }),
        aiModel: { provider: "anthropic", model: "claude-haiku-5-5", call },
      },
      logSink: () => {},
    });
    return app.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": skillKey },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance: url,
            ...(callback ? { callbackUrl: CALLBACK } : {}),
            block: { id: "conversation" },
            user: { id: userKey, type: "botUserKey" },
          },
          action: { id: "synthetic-photo", params: {} },
        }),
      },
      env,
    );
  }
  async function rows() {
    return (
      await db.query<{
        storage_key: string;
        byte_size: number;
        message_id: string;
        draft_id: string;
        body_masked: string | null;
      }>(
        "SELECT p.storage_key,p.byte_size,p.message_id,p.draft_id,m.body_masked FROM reference_photos p JOIN messages m ON m.id=p.message_id AND m.shop_id=p.shop_id WHERE p.shop_id=$1 ORDER BY p.created_at,p.id",
        [shop.shopId],
      )
    ).rows;
  }
  it("두 수신의 정리한 사진 두 장을 같은 상담 초안에 붙이고 AI에 보내지 않는다", async () => {
    for (const url of [PHOTO, `${PHOTO}?image=2`]) {
      const response = await request(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("Siljang-Outcome")).toBe("photo_received");
      expectSchema("SkillTemplateResponse", await response.json());
    }
    const photos = await rows();
    expect(photos).toHaveLength(2);
    expect(new Set(photos.map((p) => p.message_id)).size).toBe(2);
    expect(new Set(photos.map((p) => p.draft_id)).size).toBe(1);
    for (const photo of photos) {
      expect(photo.body_masked).not.toContain("https://");
      const stored = store.objects.get(photo.storage_key);
      expect(stored).toBeDefined();
      expect(stored?.body).not.toEqual(IMAGE);
      expect(stored?.body.byteLength).toBe(photo.byte_size);
    }
    expect(call).not.toHaveBeenCalled();
    expect(
      (await db.query("SELECT revision FROM order_drafts WHERE id=$1", [photos[0]?.draft_id])).rows[0]?.revision,
    ).toBe(3);
  });
  it("사진 아닌 바이트는 저장하거나 AI에 보내지 않는다", async () => {
    download.mockImplementation(async () => new Response("not an image"));
    const response = await request(PHOTO);
    expect(response.headers.get("Siljang-Outcome")).toBe("photo_rejected");
    expect(await rows()).toEqual([]);
    expect(store.objects.size).toBe(0);
    expect(call).not.toHaveBeenCalled();
  });
  it("두 번 내려받기에 실패하면 다시 보내기 안내로 끝낸다", async () => {
    download.mockImplementation(async () => new Response(null, { status: 503 }));
    const response = await request(PHOTO);
    expect(response.headers.get("Siljang-Outcome")).toBe("photo_download_failed");
    expect(download).toHaveBeenCalledTimes(2);
    expect(await rows()).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
  it("같은 메시지 반복 수신은 한 사진과 한 번의 내려받기만 남긴다", async () => {
    expect((await request(PHOTO)).headers.get("Siljang-Outcome")).toBe("photo_received");
    const repeated = await request(PHOTO);
    expect(repeated.headers.get("Siljang-Outcome")).toBe("duplicate");
    expect(await repeated.json()).toMatchObject({ template: { outputs: [] } });
    expect(await rows()).toHaveLength(1);
    expect(download).toHaveBeenCalledTimes(1);
  });
  it("콜백이 있으면 먼저 응답한 뒤 큐에서 사진을 붙이고 성공 안내만 보낸다", async () => {
    const jobs: KakaoCallbackJob[] = [];
    const queue: KakaoCallbackQueue = {
      send: async (job) => {
        jobs.push(job);
      },
    };
    const response = await request(PHOTO, queue, true);
    expect(response.headers.get("Siljang-Outcome")).toBe("callback_pending");
    expect(download).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
    const job = jobs[0];
    if (job === undefined) throw new Error("합성 사진 큐 없음");
    expect(Object.keys(job).sort()).toEqual(["messageId", "shopId"]);
    const posted: string[] = [];
    const network = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "POST") {
        posted.push(String(init.body));
        return Response.json({ status: "SUCCESS" });
      }
      return new Response(IMAGE, { headers: { "Content-Type": "image/png" } });
    });
    await consumeKakaoCallback(job, env, {
      now: () => new Date(NOW.getTime() + 1000),
      fetch: network,
      logSink: () => {},
      services: { storage: store, aiModel: { provider: "anthropic", model: "claude-haiku-5-5", call } },
    });
    expect(await rows()).toHaveLength(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("사진을 받았어요");
    expect(call).not.toHaveBeenCalled();
  });
  it("상담의 열한 번째 사진은 내려받기 전에 거절한다", async () => {
    for (let i = 0; i < 10; i++)
      expect((await request(`${PHOTO}?image=${i}`)).headers.get("Siljang-Outcome")).toBe("photo_received");
    const response = await request(`${PHOTO}?image=11`);
    expect(response.headers.get("Siljang-Outcome")).toBe("photo_rejected");
    expect(await rows()).toHaveLength(10);
    expect(download).toHaveBeenCalledTimes(10);
    expect(call).not.toHaveBeenCalled();
  });
});
