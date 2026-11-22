import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createOwnerScope } from "../src/owner-scope";
import { createOwnerSession } from "../src/owner-session";
import { newUploadId, tempKey } from "../src/uploads";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, testDb, testEnv } from "./support/db";
import { MemoryStore } from "./support/storage";

const ORIGIN = "https://siljang.example";
const NOW = new Date("2026-11-22T05:00:00Z");
const env = testEnv({ FILE_URL_KEY: ["synthetic", "file", "key", "x".repeat(32)].join("-") });
const db = testDb();

interface Actor {
  readonly ownerId: string;
  readonly cookie: string;
}

async function actor(): Promise<Actor> {
  const session = await createOwnerSession(
    db,
    { accountId: String(crypto.getRandomValues(new Uint32Array(1))[0]), friend: false },
    NOW,
    false,
  );
  return { ownerId: session.ownerId, cookie: `siljang_owner=${session.token}` };
}

async function photo(store: MemoryStore, owner: Actor): Promise<string> {
  const id = newUploadId("license_photo", NOW);
  await store.put(tempKey(createOwnerScope(owner.ownerId), id), new Uint8Array([1, 2, 3]), "image/jpeg");
  return id;
}

function body(uploadId: string) {
  return {
    name: "합성 케이크",
    contactPhone: "010-1234-5678",
    businessAddress: "서울 합성로 12",
    contactEmail: "shop@example.com",
    businessName: "합성 제과",
    representativeName: "김합성",
    businessRegNo: "1234567891",
    mailOrderRegNo: "제2026-합성-001호",
    mailOrderAuthority: "합성구청",
    mailOrderExemption: null,
    foodLicenseNo: "2026-1234567",
    foodBusinessType: "bakery",
    licensePhotoUploadId: uploadId,
    entrustmentTermsVersion: "2026.11",
    entrustmentConsent: true,
  };
}

function harness() {
  const store = new MemoryStore();
  const app = createApp({ services: { storage: store, now: () => NOW }, logSink: () => {} });
  const post = (owner: Actor | null, input: unknown, key = newRequestKey()) =>
    app.request(
      `${ORIGIN}/api/owner/shop`,
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": key,
          ...(owner === null ? {} : { cookie: owner.cookie }),
        },
        body: JSON.stringify(input),
      },
      env,
    );
  const get = (owner: Actor | null) =>
    app.request(`${ORIGIN}/api/owner/shop`, { headers: owner === null ? {} : { cookie: owner.cookie } }, env);
  return { store, app, post, get };
}

async function shopCount(owner: Actor): Promise<number> {
  const result = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM shops WHERE owner_id = $1", [
    owner.ownerId,
  ]);
  return result.rows[0]?.count ?? 0;
}

describeDb("TASK-032 API-008/009와 SPEC-002 수락 기준", () => {
  let owner: Actor;
  beforeAll(async () => {
    owner = await actor();
  });
  afterAll(async () => db.close());

  it("정상 등록은 201·신고 확인 기다림·동의 버전/시각·예약 링크 없음이고 내 가게를 조회함", async () => {
    const h = harness();
    const who = await actor();
    const upload = await photo(h.store, who);
    const response = await h.post(who, body(upload));
    expect(response.status, await response.clone().text()).toBe(201);
    const result = (await response.json()) as Record<string, unknown>;
    expectSchema("Shop", result);
    expect(result).toMatchObject({
      licenseStatus: "pending",
      licenseHoldReason: null,
      entrustmentTermsVersion: "2026.11",
      entrustmentConsentedAt: "2026-11-22T14:00:00+09:00",
      bookingUrl: null,
      pickupAddress: null,
    });
    expect(await shopCount(who)).toBe(1);
    expect([...h.store.objects.keys()]).toHaveLength(1);
    expect([...h.store.objects.keys()][0]).toMatch(/^shops\//);
    expect(JSON.stringify(result)).not.toContain("license_photo/");
    const read = await h.get(who);
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expectSchema("Shop", readBody);
    expect(readBody).toMatchObject({ shopId: result.shopId, licenseStatus: "pending" });
  });

  it("동의하지 않으면 422이고 가게와 요청 키를 남기지 않음", async () => {
    const h = harness();
    const upload = await photo(h.store, owner);
    const key = newRequestKey();
    await expectProblem(await h.post(owner, { ...body(upload), entrustmentConsent: false }, key), "consent_required");
    expect(await shopCount(owner)).toBe(0);
    const keys = await db.query("SELECT 1 FROM request_keys WHERE actor_id = $1 AND request_key = $2", [
      owner.ownerId,
      key,
    ]);
    expect(keys.rowCount).toBe(0);
    expect(h.store.calls).toEqual(["put"]);
  });

  it("신고 번호가 있고 신고 기관이 없으면 해당 필드 오류이고 가게 0개", async () => {
    const h = harness();
    const upload = await photo(h.store, owner);
    const problem = await expectProblem(
      await h.post(owner, { ...body(upload), mailOrderAuthority: null }),
      "validation_failed",
    );
    expect(problem.errors).toContainEqual({ field: "/mailOrderAuthority", code: "required" });
    expect(await shopCount(owner)).toBe(0);
  });

  it("신고증 사진이 없으면 해당 필드의 필요 오류이고 가게 0개", async () => {
    const h = harness();
    const { licensePhotoUploadId: _upload, ...input } = body("unused");
    const problem = await expectProblem(await h.post(owner, input), "validation_failed");
    expect(problem.errors).toContainEqual({ field: "/licensePhotoUploadId", code: "required" });
    expect(await shopCount(owner)).toBe(0);
  });

  it("세션이 없으면 등록과 조회 모두 401", async () => {
    const h = harness();
    await expectProblem(await h.post(null, {}), "unauthenticated");
    await expectProblem(await h.get(null), "unauthenticated");
  });

  it("가게가 없으면 조회 404 shop_not_registered", async () => {
    await expectProblem(await harness().get(owner), "shop_not_registered");
  });
});
