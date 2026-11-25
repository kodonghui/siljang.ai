import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiModel } from "../src/ai-model";
import { type AppOptions, createApp } from "../src/app";
import { showConfirmCard } from "../src/confirm-card-store";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import { deferExpiredKakaoCallback, type KakaoCallbackJob, type KakaoCallbackQueue } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { deleteQueuedFile } from "../src/purge-files";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { StorageUnavailableError } from "../src/storage";
import { expectSchema } from "./support/contract";
import { describeDb, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { lockPhotoCustomer, photoFailureConnector, photoGate } from "./support/photo-faults";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";
import { MemoryStore } from "./support/storage";

const NOW = new Date("2026-11-25T00:00:00Z");
const PHOTO = "https://t1.daumcdn.net/synthetic/reference.png";
const CALLBACK = "https://bot-api.kakao.com/v1/callback/synthetic_photo_callback";
const IMAGE = new Uint8Array(readFileSync(new URL("./fixtures/photos/metadata.png", import.meta.url)));

describeDb("참고 사진의 실제 메시지 수신(TASK-065)", () => {
  const db = testDb();
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  let shop: ShopFixture, skillKey: string, userKey: string, store: MemoryStore, at: Date;
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
    at = NOW;
    store = new MemoryStore();
    call.mockClear();
    download.mockReset();
    download.mockImplementation(async () => new Response(IMAGE, { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", download);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => db.close());

  function request(
    url: string,
    queue?: KakaoCallbackQueue,
    callback = false,
    options: Pick<AppOptions, "connect" | "kakaoSkillTimeoutMs"> & {
      images?: NonNullable<AppOptions["services"]>["images"];
    } = {},
  ) {
    const app = createApp({
      ...(options.connect === undefined ? {} : { connect: options.connect }),
      ...(options.kakaoSkillTimeoutMs === undefined ? {} : { kakaoSkillTimeoutMs: options.kakaoSkillTimeoutMs }),
      services: {
        ...(options.images === undefined ? {} : { images: options.images }),
        now: () => at,
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
  it.each(["turn", "finish"] as const)(
    "즉시 참고 사진의 %s 예외는 자기 선점을 풀고 이미 저장한 결과를 보존한다",
    async (stage) => {
      const response = await request(PHOTO, undefined, false, { connect: photoFailureConnector(stage) });
      expect(response.headers.get("Siljang-Outcome")).toBe("server_error");
      expect(
        (
          await db.query(
            "SELECT kakao_callback_claim_until FROM messages WHERE shop_id=$1 AND direction='inbound' AND trace_id LIKE 'kakao%photo:%'",
            [shop.shopId],
          )
        ).rows,
      ).toEqual([{ kakao_callback_claim_until: null }]);
      expect(await rows()).toHaveLength(stage === "finish" ? 1 : 0);
      expect(
        (
          await db.query("SELECT id FROM messages WHERE shop_id=$1 AND direction='outbound' AND kind='photo'", [
            shop.shopId,
          ])
        ).rowCount,
      ).toBe(stage === "finish" ? 1 : 0);
    },
  );
  it("늦은 이미지 정리를 기다리지 않고 사진 실패로 답하며 뒤늦게 저장하지 않는다", async () => {
    const entered = photoGate(),
      finish = photoGate();
    const webp = new Uint8Array(readFileSync(new URL("./fixtures/photos/rotated.webp", import.meta.url)));
    const clean = new Uint8Array(readFileSync(new URL("./fixtures/photos/clean.webp", import.meta.url)));
    download.mockImplementation(async () => new Response(webp));
    const transformer = {
      transform: () => transformer,
      output: async () => {
        entered.release();
        await finish.promise;
        return { response: () => new Response(clean, { headers: { "Content-Type": "image/webp" } }) };
      },
    };
    const pending = request(PHOTO, undefined, false, {
      kakaoSkillTimeoutMs: 500,
      images: { input: () => transformer },
    });
    try {
      await entered.promise;
      const response = await pending;
      expect(response.headers.get("Siljang-Outcome")).toBe("photo_download_failed");
    } finally {
      finish.release();
      await pending;
    }
    expect(await rows()).toHaveLength(0);
    expect(store.objects.size).toBe(0);
    expect(call).not.toHaveBeenCalled();
  });
  it("사진 확정의 실제 행 잠금은 응답 기한을 넘기거나 55초 선점을 남기지 않는다", async () => {
    const lock = lockPhotoCustomer(store, testDb(), shop.shopId);
    const pending = request(PHOTO, undefined, false, { kakaoSkillTimeoutMs: 500 });
    try {
      await lock.entered;
      expect((await pending).headers.get("Siljang-Outcome")).toBe("server_error");
      const row = (
        await db.query<{ kakao_callback_claim_until: Date | null }>(
          "SELECT kakao_callback_claim_until FROM messages WHERE shop_id=$1 AND direction='inbound' AND trace_id LIKE 'kakao%photo:%'",
          [shop.shopId],
        )
      ).rows[0];
      expect(row?.kakao_callback_claim_until?.getTime() ?? NOW.getTime()).toBeLessThanOrEqual(NOW.getTime() + 500);
    } finally {
      await lock.release();
      await pending;
    }
    expect(await rows()).toHaveLength(0);
    expect((await db.query("SELECT id FROM file_deletions WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(1);
    expect(call).not.toHaveBeenCalled();
  });
  it("단독 디자인 링크의 글은 보존하고 사진을 내려받지 않는다", async () => {
    const link = "https://example.com/synthetic-design";
    const response = await request(link);
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    expect(
      (
        await db.query("SELECT id FROM messages WHERE shop_id=$1 AND direction='inbound' AND body_masked=$2", [
          shop.shopId,
          link,
        ])
      ).rowCount,
    ).toBe(1);
    expect(await rows()).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
  });
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
  it("사진 콜백이 앞선 확인 카드를 함께 전하면 card_shown도 기록한다", async () => {
    userKey = shop.userKey;
    await db.query("UPDATE consultations SET ai_disclosed_at=$2,ai_disclosed_policy_version=1 WHERE id=$1", [
      shop.consultationId,
      NOW,
    ]);
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), db);
    const card = await showConfirmCard(scoped, {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      orderId: shop.orderId,
      sourceMessageId: shop.messageId,
      kind: "cancel",
      now: NOW,
    });
    await db.query(
      "INSERT INTO messages(shop_id,consultation_id,direction,author,kind,body_masked,trace_id,delivery,created_at) VALUES($1,$2,'outbound','system','card',$3,$4,'deferred',$5)",
      [shop.shopId, shop.consultationId, card.title, shop.messageId, NOW],
    );
    const jobs: KakaoCallbackJob[] = [];
    await request(
      PHOTO,
      {
        send: async (job) => {
          jobs.push(job);
        },
      },
      true,
    );
    const job = jobs[0];
    if (!job) throw new Error("합성 사진 큐 없음");
    const logs: string[] = [],
      posted: string[] = [];
    const network = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "POST") {
        posted.push(String(init.body));
        return Response.json({ status: "SUCCESS" });
      }
      return new Response(IMAGE);
    });
    await consumeKakaoCallback(job, env, {
      now: () => new Date(NOW.getTime() + 1000),
      fetch: network,
      logSink: (line) => {
        logs.push(line);
      },
      services: { storage: store },
    });
    expect(posted[0]).toContain("textCard");
    expect(logs.map((line) => JSON.parse(line))).toContainEqual({
      level: "info",
      event: "kakao_callback_result",
      code: "card_shown",
    });
  });
  it("원격 저장 뒤 오류가 나면 연결 행 없이 회수 대기를 남기고 기한 뒤 파일을 지운다", async () => {
    const put = store.put.bind(store);
    store.put = async (...args) => {
      await put(...args);
      throw new StorageUnavailableError("put: synthetic interruption");
    };
    const response = await request(PHOTO);
    expect(response.headers.get("Siljang-Outcome")).toBe("photo_download_failed");
    expect(await rows()).toHaveLength(0);
    expect(store.objects.size).toBe(1);
    const intent = (
      await db.query<{ id: string; queued_at: Date }>("SELECT id,queued_at FROM file_deletions WHERE shop_id=$1", [
        shop.shopId,
      ])
    ).rows[0];
    if (intent === undefined) throw new Error("합성 파일 회수 대기 없음");
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), db);
    expect(await deleteQueuedFile(scoped, store, intent.id, NOW)).toBe("busy");
    expect(store.objects.size).toBe(1);
    expect(await deleteQueuedFile(scoped, store, intent.id, intent.queued_at)).toBe("deleted");
    expect(store.objects.size).toBe(0);
    expect(call).not.toHaveBeenCalled();
  });
  it("사진 콜백 실패와 같은 큐의 재실행 뒤 다음 대화에서 한 번만 안내한다", async () => {
    const jobs: KakaoCallbackJob[] = [];
    const queue: KakaoCallbackQueue = {
      send: async (job) => {
        jobs.push(job);
      },
    };
    await request(PHOTO, queue, true);
    const job = jobs[0];
    if (!job) throw new Error("합성 사진 큐 없음");
    const network = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === "POST" ? new Response(null, { status: 503 }) : new Response(IMAGE),
    );
    const options = {
      now: () => new Date(NOW.getTime() + 1000),
      fetch: network,
      logSink: () => {},
      services: { storage: store },
    };
    expect(await consumeKakaoCallback(job, env, options)).toBe("done");
    const requests = network.mock.calls.length;
    expect(await consumeKakaoCallback(job, env, options)).toBe("done");
    expect(network).toHaveBeenCalledTimes(requests);
    at = new Date(NOW.getTime() + 2000);
    expect(JSON.stringify(await (await request("계속 이야기할게요")).json())).toContain("사진을 받았어요");
    at = new Date(NOW.getTime() + 4000);
    expect(JSON.stringify(await (await request("다음 질문이 있어요")).json())).not.toContain("사진을 받았어요");
    expect(await rows()).toHaveLength(1);
    expect(call).not.toHaveBeenCalled();
  });
  it("처리 전에 기한이 지난 사진은 AI나 사장님 건 없이 다시 보내기 안내로 남긴다", async () => {
    const jobs: KakaoCallbackJob[] = [];
    const queue: KakaoCallbackQueue = {
      send: async (job) => {
        jobs.push(job);
      },
    };
    await request(PHOTO, queue, true);
    const job = jobs[0];
    if (!job) throw new Error("합성 사진 큐 없음");
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), db);
    at = new Date(NOW.getTime() + 56_000);
    expect(await deferExpiredKakaoCallback(scoped, job.messageId, at, "사장님 확인 뒤 답드릴게요")).toBe("deferred");
    expect(download).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
    expect((await db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(0);
    expect(JSON.stringify(await (await request("사진 처리됐나요")).json())).toContain("다시 보내 주세요");
    expect((await db.query("SELECT kakao_callback_enc,kind FROM messages WHERE id=$1", [job.messageId])).rows).toEqual([
      { kakao_callback_enc: null, kind: "photo" },
    ]);
    expect(call).not.toHaveBeenCalled();
  });
  it("아홉 장 뒤 두 큐가 겹쳐도 열 장만 붙이고 넘는 사진은 내려받지 않는다", async () => {
    for (let i = 0; i < 9; i++)
      expect((await request(`${PHOTO}?before=${i}`)).headers.get("Siljang-Outcome")).toBe("photo_received");
    const jobs: KakaoCallbackJob[] = [];
    const queue: KakaoCallbackQueue = {
      send: async (job) => {
        jobs.push(job);
      },
    };
    await request(`${PHOTO}?race=1`, queue, true);
    await request(`${PHOTO}?race=2`, queue, true);
    let gets = 0;
    const results: string[] = [];
    const network = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "POST") {
        results.push(String(init.body));
        return Response.json({ status: "SUCCESS" });
      }
      gets++;
      return new Response(IMAGE);
    });
    const options = {
      now: () => new Date(NOW.getTime() + 1000),
      fetch: network,
      logSink: () => {},
      services: { storage: store },
    };
    const statuses = await Promise.all(jobs.map((job) => consumeKakaoCallback(job, env, options)));
    for (const [i, status] of statuses.entries()) {
      const job = jobs[i];
      if (status === "retry" && job) expect(await consumeKakaoCallback(job, env, options)).toBe("done");
    }
    expect(await rows()).toHaveLength(10);
    expect(store.objects.size).toBe(10);
    expect(gets).toBe(1);
    expect(results.join(" ")).toContain("10장까지");
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
