import { afterAll, beforeAll, expect, it } from "vitest";
import { type AppOptions, createApp } from "../src/app";
import { pgConnector, type Queryable, type RequestDb } from "../src/db";
import { createOwnerScope } from "../src/owner-scope";
import { createOwnerSession } from "../src/owner-session";
import { newUploadId, tempKey } from "../src/uploads";
import { expectProblem, expectSchema } from "./support/contract";
import { collectLogs, describeDb, newRequestKey, testDb, testEnv } from "./support/db";
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

async function photo(
  store: MemoryStore,
  owner: Actor,
  at = NOW,
  purpose: "license_photo" | "design_image" = "license_photo",
): Promise<string> {
  const id = newUploadId(purpose, at);
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

function harness(options: Pick<AppOptions, "connect"> = {}) {
  const store = new MemoryStore();
  const clock = { now: NOW };
  const logs = collectLogs();
  const app = createApp({ ...options, services: { storage: store, now: () => clock.now }, logSink: logs.sink });
  const post = (owner: Actor | null, input: unknown, key: string | null = newRequestKey(), bindings = env) =>
    app.request(
      `${ORIGIN}/api/owner/shop`,
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          ...(key === null ? {} : { "Idempotency-Key": key }),
          ...(owner === null ? {} : { cookie: owner.cookie }),
        },
        body: JSON.stringify(input),
      },
      bindings,
    );
  const get = (owner: Actor | null) =>
    app.request(`${ORIGIN}/api/owner/shop`, { headers: owner === null ? {} : { cookie: owner.cookie } }, env);
  return { store, app, post, get, clock, logs };
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

  it.each([
    ["name", "", "too_short"],
    ["name", "가".repeat(41), "too_long"],
    ["contactPhone", "abc12345", "bad_format"],
    ["contactEmail", "invalid", "bad_format"],
    ["businessAddress", "가".repeat(201), "too_long"],
    ["businessName", "가".repeat(61), "too_long"],
    ["representativeName", "가".repeat(31), "too_long"],
    ["businessRegNo", "1234567890", "checksum_failed"],
    ["foodBusinessType", "unlicensed", "not_allowed"],
    ["foodLicenseNo", "", "too_short"],
    ["entrustmentTermsVersion", "2026/11", "bad_format"],
    ["ownerId", "client-chosen-owner", "unknown_field"],
    ["licenseStatus", "verified", "unknown_field"],
    ["bookingUrl", "https://shop.example/", "unknown_field"],
  ])("입력 %s의 잘못된 값은 필드 오류이며 저장하지 않음", async (field, value, code) => {
    const h = harness();
    const upload = await photo(h.store, owner);
    const problem = await expectProblem(await h.post(owner, { ...body(upload), [field]: value }), "validation_failed");
    expect(problem.errors).toContainEqual({ field: `/${field}`, code });
    expect(await shopCount(owner)).toBe(0);
    expect(h.store.calls).toEqual(["put"]);
  });

  it("신고 면제 사유는 신고번호/기관 대신 받고 동의 시각은 서버가 정함", async () => {
    const h = harness();
    const who = await actor();
    const upload = await photo(h.store, who);
    const response = await h.post(who, {
      ...body(upload),
      mailOrderRegNo: null,
      mailOrderAuthority: null,
      mailOrderExemption: "합성 면제 사유",
    });
    expect(response.status).toBe(201);
    const result = await response.json();
    expectSchema("Shop", result);
    expect(result).toMatchObject({
      mailOrderRegNo: null,
      mailOrderAuthority: null,
      mailOrderExemption: "합성 면제 사유",
    });
  });

  it.each(["other-owner", "expired", "wrong-purpose", "missing", "oversized", "wrong-format"])(
    "신고증 %s는 같은 필드 오류로 막음",
    async (kind) => {
      const h = harness();
      const source = kind === "other-owner" ? await actor() : owner;
      const at = kind === "expired" ? new Date(NOW.getTime() - 3_600_000) : NOW;
      const upload = await photo(h.store, source, at, kind === "wrong-purpose" ? "design_image" : "license_photo");
      const key = tempKey(createOwnerScope(source.ownerId), upload);
      if (kind === "missing") h.store.objects.delete(key);
      if (kind === "oversized")
        h.store.objects.set(key, { body: new Uint8Array(10 * 1024 * 1024 + 1), contentType: "image/jpeg" });
      if (kind === "wrong-format") h.store.objects.set(key, { body: new Uint8Array([1]), contentType: "image/webp" });
      const problem = await expectProblem(await h.post(owner, body(upload)), "validation_failed");
      expect(problem.errors).toContainEqual({
        field: "/licensePhotoUploadId",
        code: kind === "wrong-purpose" ? "upload_wrong_purpose" : "upload_not_found",
      });
      expect(await shopCount(owner)).toBe(0);
      expect(h.store.calls).not.toContain("copy");
    },
  );

  it("요청 키가 없으면 422이고 저장소를 읽지 않음", async () => {
    const h = harness();
    const upload = await photo(h.store, owner);
    const problem = await expectProblem(await h.post(owner, body(upload), null), "validation_failed");
    expect(problem.errors).toContainEqual({ field: "header:Idempotency-Key", code: "required" });
    expect(h.store.calls).toEqual(["put"]);
  });

  it.each([
    ["text/plain", JSON.stringify(body(`upl_${"x".repeat(20)}`)), "header:Content-Type", "not_allowed"],
    ["application/json", "{", "/", "bad_json"],
    ["application/json", "[]", "/", "bad_format"],
    ["application/json", " ".repeat(256 * 1024 + 1), "/", "too_long"],
  ])("본문 %s의 형식/크기 오류는 기록과 저장소 접근 없이 거절", async (contentType, raw, field, code) => {
    const h = harness();
    const response = await h.app.request(
      `${ORIGIN}/api/owner/shop`,
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie: owner.cookie,
          "content-type": contentType,
          "Idempotency-Key": newRequestKey(),
        },
        body: raw,
      },
      env,
    );
    const problem = await expectProblem(response, "validation_failed");
    expect(problem.errors).toContainEqual({ field, code });
    expect(await shopCount(owner)).toBe(0);
    expect(h.store.calls).toEqual([]);
  });

  it("같은 키는 사진이 만료된 뒤에도 첫 가게를 재조회하며 다른 내용은 422", async () => {
    const h = harness();
    const who = await actor();
    const upload = await photo(h.store, who);
    const input = body(upload),
      key = newRequestKey();
    const first = await h.post(who, input, key);
    const result = (await first.json()) as Record<string, unknown>;
    expect(first.status).toBe(201);
    h.clock.now = new Date(NOW.getTime() + 7_200_000);
    const replay = await h.post(who, input, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    const fresh = (await replay.json()) as Record<string, unknown>;
    expect(fresh.shopId).toBe(result.shopId);
    expect(Number(new URL(String(fresh.licensePhotoUrl)).searchParams.get("exp"))).toBe(
      Math.floor(h.clock.now.getTime() / 1000) + 900,
    );
    await expectProblem(await h.post(who, { ...input, name: "다른 이름" }, key), "idempotency_key_reused");
    expect(await shopCount(who)).toBe(1);
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
    const stored = await db.query<{ response_ref: Record<string, unknown> }>(
      "SELECT response_ref FROM request_keys WHERE actor_id=$1 AND request_key=$2",
      [who.ownerId, key],
    );
    expect(stored.rows[0]?.response_ref).toEqual({ shopId: result.shopId });
  });

  it("서로 다른 키의 동시 등록도 같은 계정의 가게 하나와 409로 끝남", async () => {
    const h = harness();
    const who = await actor();
    const upload = await photo(h.store, who);
    const responses = await Promise.all([h.post(who, body(upload)), h.post(who, body(upload))]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const conflict = responses.find((r) => r.status === 409);
    expect(conflict).toBeDefined();
    await expectProblem(conflict as Response, "already_registered");
    expect(await shopCount(who)).toBe(1);
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
  });

  it("같은 키를 처리 중이면 409이고 완료 뒤 재전송해도 복사는 한 번", async () => {
    const h = harness();
    const who = await actor();
    const upload = await photo(h.store, who),
      key = newRequestKey();
    const copy = h.store.copy.bind(h.store);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.store.copy = async (from, to) => {
      enter();
      await gate;
      return copy(from, to);
    };
    const first = h.post(who, body(upload), key);
    await entered;
    try {
      await expectProblem(await h.post(who, body(upload), key), "request_in_progress");
    } finally {
      release();
    }
    expect((await first).status).toBe(201);
    expect((await h.post(who, body(upload), key)).status).toBe(201);
    expect(await shopCount(who)).toBe(1);
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
  });

  it("다른 계정의 같은 사업자등록번호는 각각 등록됨", async () => {
    const h = harness();
    const owners = [await actor(), await actor()];
    for (const who of owners) expect((await h.post(who, body(await photo(h.store, who)))).status).toBe(201);
    const rows = await db.query("SELECT id FROM shops WHERE owner_id=ANY($1::uuid[]) AND business_reg_no=$2", [
      owners.map((x) => x.ownerId),
      "1234567891",
    ]);
    expect(rows.rowCount).toBe(2);
  });

  it.each(["head", "copy"] as const)("저장소 %s 실패는 503·등록/요청 키 없음이며 같은 키로 재시도 가능", async (op) => {
    const h = harness();
    const who = await actor();
    const upload = await photo(h.store, who),
      key = newRequestKey();
    h.store.failOn.add(op);
    await expectProblem(await h.post(who, body(upload), key), "storage_unavailable");
    expect(await shopCount(who)).toBe(0);
    expect([...h.store.objects.keys()]).toEqual([tempKey(createOwnerScope(who.ownerId), upload)]);
    expect(
      (await db.query("SELECT 1 FROM request_keys WHERE actor_id=$1 AND request_key=$2", [who.ownerId, key])).rowCount,
    ).toBe(0);
    h.store.failOn.delete(op);
    expect((await h.post(who, body(upload), key)).status).toBe(201);
  });

  it("복사 뒤 서버 설정 실패는 500·전체 되돌림·임시 사진 보존", async () => {
    const h = harness();
    const who = await actor();
    const upload = await photo(h.store, who),
      key = newRequestKey();
    const noFileKey = { ...env, FILE_URL_KEY: "" };
    await expectProblem(await h.post(who, body(upload), key, noFileKey), "internal");
    expect(await shopCount(who)).toBe(0);
    expect([...h.store.objects.keys()]).toEqual([tempKey(createOwnerScope(who.ownerId), upload)]);
    expect((await h.post(who, body(upload), key)).status).toBe(201);
    const read = await h.app.request(`${ORIGIN}/api/owner/shop`, { headers: { cookie: who.cookie } }, noFileKey);
    await expectProblem(read, "internal");
    const log = h.logs.lines.join("\n");
    for (const secret of [who.cookie, "shop@example.com", "김합성", "서울 합성로 12"])
      expect(log).not.toContain(secret);
  });

  it("커밋 응답 유실 뒤에는 등록된 신고증을 보존하고 같은 키가 첫 성공을 돌려줌", async () => {
    let loseCommitReply = true;
    const h = harness({
      connect: (url) => {
        const base = pgConnector(url);
        return {
          query: (sql, params) => base.query(sql, params),
          abort: () => base.abort(),
          close: () => base.close(),
          async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
            const result = await base.transaction(fn);
            if (loseCommitReply) {
              loseCommitReply = false;
              throw new Error("synthetic commit response lost");
            }
            return result;
          },
        } satisfies RequestDb;
      },
    });
    const who = await actor();
    const upload = await photo(h.store, who),
      key = newRequestKey();
    await expectProblem(await h.post(who, body(upload), key), "internal");
    expect(await shopCount(who)).toBe(1);
    expect([...h.store.objects.keys()].filter((x) => x.startsWith("shops/"))).toHaveLength(1);
    const replay = await h.post(who, body(upload), key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await shopCount(who)).toBe(1);
  });

  it("신고증은 15분 서명 주소이며 만료 뒤 새 조회로 다시 받을 수 있음", async () => {
    const h = harness();
    const who = await actor();
    const response = await h.post(who, body(await photo(h.store, who)));
    const result = (await response.json()) as { licensePhotoUrl: string };
    expect((await h.app.request(result.licensePhotoUrl, {}, env)).status).toBe(200);
    h.clock.now = new Date(NOW.getTime() + 901_000);
    await expectProblem(await h.app.request(result.licensePhotoUrl, {}, env), "not_found");
    const fresh = (await (await h.get(who)).json()) as { licensePhotoUrl: string };
    expect((await h.app.request(fresh.licensePhotoUrl, {}, env)).status).toBe(200);
  });

  it("조회는 현재 사업자 정보와 자기 가게의 최신 변경 요청을 구분해 보여 줌", async () => {
    const h = harness();
    const who = await actor();
    const first = await h.post(who, body(await photo(h.store, who)));
    const registered = (await first.json()) as { shopId: string; revision: string };
    const evidenceKey = `shops/${registered.shopId}/license_photo/synthetic-change.jpg`;
    await h.store.put(evidenceKey, new Uint8Array([1]), "image/jpeg");
    await db.query(
      `INSERT INTO shop_identity_changes (shop_id, business_name, representative_name, business_reg_no,
      prev_business_name, prev_representative_name, prev_business_reg_no, evidence_photo_key, requested_at)
      VALUES ($1, $2, $3, $4, $5, $3, $4, $6, $7)`,
      [registered.shopId, "새 합성 제과", "김합성", "1234567891", "합성 제과", evidenceKey, NOW],
    );
    const result = await (await h.get(who)).json();
    expectSchema("Shop", result);
    expect(result).toMatchObject({
      businessName: "합성 제과",
      identityChange: {
        status: "pending",
        businessName: "새 합성 제과",
        previous: { businessName: "합성 제과" },
        reviewedAt: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain(evidenceKey);
    await db.query("UPDATE shops SET name=$2 WHERE id=$1", [registered.shopId, "수정한 합성 이름"]);
    const changed = (await (await h.get(who)).json()) as { revision: string };
    expect(changed.revision).not.toBe(registered.revision);
  });
});
