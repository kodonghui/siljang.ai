import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { DbConnector, RequestDb } from "../src/db";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerScope } from "../src/owner-scope";
import { createOwnerSession } from "../src/owner-session";
import { newUploadId, tempKey } from "../src/uploads";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, TEST_HASH_KEY, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop } from "./support/shops";
import { MemoryStore } from "./support/storage";

let db: RequestDb;
let isolated: Awaited<ReturnType<typeof isolatedTestDb>> | undefined;
const NOW = new Date("2026-11-22T05:00:00Z"),
  ORIGIN = "https://siljang.example",
  env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
interface Shop {
  revision: string;
  businessName: string;
  representativeName: string;
  businessRegNo: string;
  identityChange: { changeId: string; businessName: string; status: string; previous: { businessName: string } } | null;
}
async function fixture(options: { connect?: DbConnector } = {}) {
  const shop = await createShop(db, "사업자 변경 합성 가게");
  await db.query("UPDATE shops SET business_reg_no='1234567891' WHERE id=$1", [shop.shopId]);
  const owner = (
    await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [shop.ownerId])
  ).rows[0];
  if (!owner) throw new Error("합성 사장님 없음");
  const session = await createOwnerSession(db, { accountId: owner.kakao_account_id, friend: false }, NOW, false),
    cookie = `${OWNER_COOKIE}=${session.token}`,
    store = new MemoryStore();
  const database = isolated;
  if (!database) throw new Error("시험 DB 없음");
  const logs: string[] = [];
  const app = createApp({
    connect: options.connect ?? (() => database.connect()),
    services: { storage: store, now: () => NOW },
    logSink: (line) => logs.push(line),
  });
  const get = async () => {
    const response = await app.request(`${ORIGIN}/api/owner/shop`, { headers: { cookie } }, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Shop;
    expectSchema("Shop", body);
    return body;
  };
  const upload = async () => {
    const id = newUploadId("license_photo", NOW);
    await store.put(tempKey(createOwnerScope(shop.ownerId), id), new Uint8Array([1, 2, 3]), "image/jpeg");
    return id;
  };
  const post = (body: unknown, key = newRequestKey(), bindings = env) =>
    app.request(
      `${ORIGIN}/api/owner/shop/identity-changes`,
      {
        method: "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
      bindings,
    );
  const input = async () => {
    const current = await get();
    return {
      baseRevision: current.revision,
      businessName: "새 합성 상호",
      representativeName: current.representativeName,
      businessRegNo: current.businessRegNo,
      evidencePhotoUploadId: await upload(),
    };
  };
  return { shop, cookie, store, app, get, upload, post, input, logs };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function operatorFor(h: Fixture) {
  const session = await seedOperatorSession(db, NOW);
  const list = (query = "", bindings = env) =>
    h.app.request(`${ORIGIN}/api/operator/identity-changes${query}`, { headers: { cookie: session.cookie } }, bindings);
  const detail = async () => {
    const response = await h.app.request(
      `${ORIGIN}/api/operator/shops/${h.shop.shopId}`,
      { headers: { cookie: session.cookie } },
      env,
    );
    expect(response.status, JSON.stringify(h.logs)).toBe(200);
    return (await response.json()) as {
      pendingIdentityChange: {
        changeId: string;
        revision: string;
        paymentAccount: { holderMatchesNew: boolean } | null;
      } | null;
    };
  };
  const review = (id: string, body: unknown, key = newRequestKey(), bindings = env) =>
    h.app.request(
      `${ORIGIN}/api/operator/identity-changes/${id}/review`,
      {
        method: "POST",
        headers: { cookie: session.cookie, origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
      bindings,
    );
  return { ...session, list, detail, review };
}

describeDb("TASK-036 사장님 사업자 변경 요청", () => {
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
  }, 30_000);
  afterAll(async () => isolated?.close());
  it("사장님 변경 요청201은 지금 값을 보존하고 새 값/증빙/요청 때 값을 남김", async () => {
    const h = await fixture(),
      before = await h.get(),
      body = await h.input(),
      key = newRequestKey(),
      response = await h.post(body, key);
    expect(response.status, await response.clone().text()).toBe(201);
    const result = (await response.json()) as { outcome: string; shop: Shop };
    expectSchema("ShopResult", result);
    expect(result).toMatchObject({
      outcome: "done",
      shop: {
        businessName: before.businessName,
        identityChange: {
          status: "pending",
          businessName: body.businessName,
          previous: { businessName: before.businessName },
        },
      },
    });
    expect((await h.get()).businessName).toBe(before.businessName);
    const copies = h.store.calls.filter((x) => x === "copy").length;
    expect(copies).toBe(1);
    const replay = await h.post(body, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(copies);
    await expectProblem(await h.post(body), "identity_change_pending");
    expect(
      (await db.query("SELECT count(*)::int AS n FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("같은 값의 사업자 변경 요청은200 unchanged이며 사진을 복사하지 않음", async () => {
    const h = await fixture(),
      current = await h.get(),
      response = await h.post({
        baseRevision: current.revision,
        businessName: current.businessName,
        representativeName: current.representativeName,
        businessRegNo: current.businessRegNo,
        evidencePhotoUploadId: await h.upload(),
      });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "unchanged", shop: { identityChange: null } });
    expect(h.store.calls).not.toContain("copy");
    expect(
      (await db.query("SELECT count(*)::int AS n FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });
  it("운영자 변경 목록은 이전 값/새 값/서명 증빙과 계좌 끝4자리만 보임", async () => {
    const h = await fixture(),
      input = await h.input();
    const created = await h.post(input);
    expect(created.status).toBe(201);
    const detail = (await created.json()) as { shop: Shop };
    const session = await seedOperatorSession(db, NOW);
    const response = await h.app.request(
      `${ORIGIN}/api/operator/identity-changes?limit=100`,
      { headers: { cookie: session.cookie } },
      env,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const list = (await response.json()) as { items: Record<string, unknown>[] };
    expectSchema("IdentityChangeList", list);
    const item = list.items.find((x) => x.changeId === detail.shop.identityChange?.changeId);
    expect(item).toMatchObject({
      businessName: input.businessName,
      status: "pending",
      paymentAccount: { holderMatchesNew: true },
    });
    expect(JSON.stringify(item)).not.toContain("accountNumber");
    expect(JSON.stringify(item)).not.toContain("account_number_enc");
  });
  it("같은 시각에 보류 뒤 다시 요청해도 새 요청을 내 가게에 보여 줌", async () => {
    const h = await fixture(),
      input = await h.input();
    expect((await h.post(input)).status).toBe(201);
    const session = await seedOperatorSession(db, NOW);
    await db.query(
      "UPDATE shop_identity_changes SET id='ffffffff-ffff-4fff-8fff-ffffffffffff',status='on_hold',hold_reason='다시 확인',reviewed_by=$2,reviewed_at=$3 WHERE shop_id=$1",
      [h.shop.shopId, session.operatorId, NOW],
    );
    const nextInput = { ...(await h.input()), businessName: "다시 신청한 상호" };
    const response = await h.post(nextInput);
    expect(response.status).toBe(201);
    const result = (await response.json()) as { shop: Shop };
    expect(result.shop.identityChange).toMatchObject({ status: "pending", businessName: nextInput.businessName });
    expect((await h.get()).identityChange?.businessName).toBe(nextInput.businessName);
  });
  it("운영자 반영은 새 신원/운영자/시각과 할 일 없는 알림1건을 같은 처리로 남김", async () => {
    const h = await fixture(),
      input = await h.input(),
      created = await h.post(input);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { shop: Shop },
      id = body.shop.identityChange?.changeId;
    const session = await seedOperatorSession(db, NOW),
      headers = {
        cookie: session.cookie,
        origin: ORIGIN,
        "content-type": "application/json",
        "Idempotency-Key": newRequestKey(),
      };
    const listResponse = await h.app.request(`${ORIGIN}/api/operator/identity-changes?limit=100`, { headers }, env);
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { items: { changeId: string; revision: string }[] },
      item = list.items.find((x) => x.changeId === id);
    if (!item) throw new Error("합성 변경 요청 없음");
    const review = await h.app.request(
      `${ORIGIN}/api/operator/identity-changes/${id}/review`,
      { method: "POST", headers, body: JSON.stringify({ baseRevision: item.revision, decision: "applied" }) },
      env,
    );
    expect(review.status, JSON.stringify(h.logs)).toBe(200);
    const result = await review.json();
    expectSchema("IdentityChangeReviewResult", result);
    expect(result).toMatchObject({
      outcome: "done",
      change: { status: "applied", reviewedBy: { operatorId: session.operatorId } },
    });
    expect((await h.get()).businessName).toBe(input.businessName);
    expect(
      (await db.query("SELECT kind,owner_task_id FROM owner_alerts WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ kind: "identity_change_applied", owner_task_id: null }]);
  });
  it.each(["pending", "on_hold", "verified"])("영업 신고 %s여도 요청은 현재 신원을 바꾸지 않음", async (status) => {
    const h = await fixture();
    const op = await seedOperatorSession(db, NOW);
    await db.query(
      "UPDATE shops SET license_status=$2,license_hold_reason=CASE WHEN $2='on_hold' THEN '확인할 내용' ELSE NULL END,license_reviewed_by=CASE WHEN $2='pending' THEN NULL ELSE $3::uuid END,license_reviewed_at=CASE WHEN $2='pending' THEN NULL ELSE $4::timestamptz END WHERE id=$1",
      [h.shop.shopId, status, op.operatorId, NOW],
    );
    const before = await h.get(),
      response = await h.post(await h.input());
    expect(response.status, JSON.stringify(h.logs)).toBe(201);
    expect(((await response.json()) as { shop: Shop }).shop.businessName).toBe(before.businessName);
  });
  it.each(["missing", "other_owner", "wrong_purpose", "expired", "oversize", "wrong_type"])(
    "증빙 %s는 같은 필드 오류이고 요청/영구 복사0",
    async (kind) => {
      const h = await fixture(),
        input = await h.input(),
        scope = createOwnerScope(h.shop.ownerId);
      let uploadId = input.evidencePhotoUploadId;
      const key = tempKey(scope, uploadId);
      if (kind === "missing") h.store.objects.delete(key);
      if (kind === "other_owner") {
        const other = await fixture();
        uploadId = await other.upload();
      }
      if (kind === "wrong_purpose") uploadId = newUploadId("design_image", NOW);
      if (kind === "expired") uploadId = newUploadId("license_photo", new Date(NOW.getTime() - 3_600_001));
      if (kind === "oversize")
        h.store.objects.set(key, { body: new Uint8Array(10 * 1024 * 1024 + 1), contentType: "image/jpeg" });
      if (kind === "wrong_type") h.store.objects.set(key, { body: new Uint8Array([1]), contentType: "image/webp" });
      const response = await h.post({ ...input, evidencePhotoUploadId: uploadId });
      const problem = await expectProblem(response, "validation_failed");
      expect(problem).toMatchObject({ errors: [{ field: "/evidencePhotoUploadId", code: "upload_not_found" }] });
      expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(0);
      expect(
        (await db.query("SELECT id FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows,
      ).toHaveLength(0);
    },
  );
  it.each(["head", "copy"] as const)("증빙 저장소 %s 장애503은 행0/임시 보존이고 같은 키로 복구됨", async (op) => {
    const h = await fixture(),
      input = await h.input(),
      key = newRequestKey();
    h.store.failOn.add(op);
    await expectProblem(await h.post(input, key), "storage_unavailable");
    expect(
      (await db.query("SELECT id FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toHaveLength(0);
    expect(h.store.objects.size).toBe(1);
    h.store.failOn.delete(op);
    expect((await h.post(input, key)).status).toBe(201);
  });
  it("증빙 복사 뒤 응답 서명500은 요청/영구 복사를 되돌리고 같은 키 재시도201", async () => {
    const h = await fixture(),
      input = await h.input(),
      key = newRequestKey();
    expect((await h.post(input, key, testEnv())).status).toBe(500);
    expect(
      (await db.query("SELECT id FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toHaveLength(0);
    expect([...h.store.objects.keys()]).toEqual([
      tempKey(createOwnerScope(h.shop.ownerId), input.evidencePhotoUploadId),
    ]);
    expect((await h.post(input, key)).status).toBe(201);
  });
  it("보류는 현재 신원을 보존하고 이유/판정자/알림1건, 같은 운영자의 새 키는 unchanged", async () => {
    const h = await fixture(),
      before = await h.get();
    expect((await h.post(await h.input())).status).toBe(201);
    const op = await operatorFor(h),
      item = (await op.detail()).pendingIdentityChange;
    if (!item) throw new Error("변경 요청 없음");
    const body = { baseRevision: item.revision, decision: "on_hold", holdReason: "증빙을 다시 확인해 주세요" },
      key = newRequestKey();
    const first = await op.review(item.changeId, body, key);
    expect(first.status, JSON.stringify(h.logs)).toBe(200);
    const saved = await first.json();
    expectSchema("IdentityChangeReviewResult", saved);
    expect(saved).toMatchObject({
      outcome: "done",
      change: { status: "on_hold", holdReason: body.holdReason, reviewedBy: { operatorId: op.operatorId } },
    });
    const replay = await op.review(item.changeId, body, key);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(((await replay.json()) as { outcome: string }).outcome).toBe("done");
    const unchanged = await op.review(item.changeId, body);
    expect(((await unchanged.json()) as { outcome: string }).outcome).toBe("unchanged");
    expect((await h.get()).businessName).toBe(before.businessName);
    expect(
      (await db.query("SELECT kind,owner_task_id FROM owner_alerts WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ kind: "identity_change_on_hold", owner_task_id: null }]);
    expect((await db.query("SELECT id FROM owner_tasks WHERE shop_id=$1", [h.shop.shopId])).rows).toHaveLength(0);
    const other = await operatorFor(h);
    await expectProblem(await other.review(item.changeId, body), "already_decided");
    await expectProblem(await op.review(item.changeId, { ...body, holdReason: "바뀐 이유" }), "version_conflict");
  });
  it.each(["mismatch", "none"])("계좌 %s는 새 예금주 표시만 바뀌고 반영을 막지 않음", async (account) => {
    const h = await fixture();
    if (account === "none")
      await db.query("UPDATE payment_accounts SET retired_at=$2 WHERE shop_id=$1", [h.shop.shopId, NOW]);
    else await db.query("UPDATE payment_accounts SET holder_name='다른 합성 예금주' WHERE shop_id=$1", [h.shop.shopId]);
    expect((await h.post(await h.input())).status).toBe(201);
    const op = await operatorFor(h),
      item = (await op.detail()).pendingIdentityChange;
    if (!item) throw new Error("변경 요청 없음");
    expect(item.paymentAccount).toEqual(
      account === "none" ? null : expect.objectContaining({ holderMatchesNew: false }),
    );
    const response = await op.review(item.changeId, { baseRevision: item.revision, decision: "applied" });
    expect(response.status, JSON.stringify(h.logs)).toBe(200);
    expect(
      (
        await db.query("SELECT holder_checked_by,holder_checked_at FROM payment_accounts WHERE shop_id=$1", [
          h.shop.shopId,
        ])
      ).rows,
    ).toEqual([{ holder_checked_by: null, holder_checked_at: null }]);
  });
  it.each(["identity", "shop", "account"])("목록 뒤 %s 버전이 바뀌면409이고 반영/알림0", async (changed) => {
    const h = await fixture();
    expect((await h.post(await h.input())).status).toBe(201);
    const op = await operatorFor(h),
      item = (await op.detail()).pendingIdentityChange;
    if (!item) throw new Error("변경 요청 없음");
    if (changed === "identity")
      await db.query("UPDATE shop_identity_changes SET business_name='다른 새 상호' WHERE shop_id=$1", [h.shop.shopId]);
    if (changed === "shop")
      await db.query("UPDATE shops SET business_name='바뀐 현재 상호' WHERE id=$1", [h.shop.shopId]);
    if (changed === "account")
      await db.query("UPDATE payment_accounts SET holder_name='바뀐 예금주' WHERE shop_id=$1", [h.shop.shopId]);
    await expectProblem(
      await op.review(item.changeId, { baseRevision: item.revision, decision: "applied" }),
      "version_conflict",
    );
    expect((await db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [h.shop.shopId])).rows).toHaveLength(0);
    expect((await db.query("SELECT status FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual(
      [{ status: "pending" }],
    );
  });
  it("같은 현재 버전의 두 운영자는200/409이고 판정/알림이 하나", async () => {
    const h = await fixture();
    expect((await h.post(await h.input())).status).toBe(201);
    const a = await operatorFor(h),
      b = await operatorFor(h),
      item = (await a.detail()).pendingIdentityChange;
    if (!item) throw new Error("변경 요청 없음");
    const responses = await Promise.all([
      a.review(item.changeId, { baseRevision: item.revision, decision: "applied" }),
      b.review(item.changeId, { baseRevision: item.revision, decision: "on_hold", holdReason: "합성 보류" }),
    ]);
    expect(responses.map((x) => x.status).sort()).toEqual([200, 409]);
    expect((await db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [h.shop.shopId])).rows).toHaveLength(1);
  });
  it("동시에 온 두 사장님 요청은201/409이고 복사/요청이 하나", async () => {
    const h = await fixture(),
      input = await h.input();
    const responses = await Promise.all([h.post(input), h.post({ ...input, businessName: "다른 새 이름" })]);
    expect(responses.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
    expect(
      (await db.query("SELECT id FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toHaveLength(1);
  });
  it("API-013과081의 같은 요청 버전으로 바로 판정하고 알림 실패는 전부 되돌림", async () => {
    const h = await fixture(),
      input = await h.input(),
      before = await h.get();
    expect((await h.post(input)).status).toBe(201);
    const op = await operatorFor(h),
      item = (await op.detail()).pendingIdentityChange;
    if (!item) throw new Error("변경 요청 없음");
    const list = (await (await op.list("?limit=100")).json()) as { items: { changeId: string; revision: string }[] };
    expect(list.items.find((x) => x.changeId === item.changeId)?.revision).toBe(item.revision);
    await db.query(
      `CREATE FUNCTION identity_alert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.shop_id='${h.shop.shopId}'::uuid THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      "CREATE TRIGGER identity_alert_failure BEFORE INSERT ON owner_alerts FOR EACH ROW EXECUTE FUNCTION identity_alert_failure()",
    );
    const key = newRequestKey(),
      body = { baseRevision: item.revision, decision: "applied" };
    try {
      expect((await op.review(item.changeId, body, key)).status).toBe(500);
      expect((await h.get()).businessName).toBe(before.businessName);
      expect(
        (await db.query("SELECT status FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows,
      ).toEqual([{ status: "pending" }]);
    } finally {
      await db.query("DROP TRIGGER identity_alert_failure ON owner_alerts");
      await db.query("DROP FUNCTION identity_alert_failure()");
    }
    expect((await op.review(item.changeId, body, key)).status).toBe(200);
  });
  it("다른/없는/형식이 틀린 변경 ID는 사장님 접근401, 운영자는 없는 값에 같은404", async () => {
    const h = await fixture(),
      op = await operatorFor(h);
    for (const id of [crypto.randomUUID(), "not-a-uuid", "x".repeat(101)]) {
      await expectProblem(await op.review(id, { baseRevision: "revision", decision: "applied" }), "not_found");
      const response = await h.app.request(
        `${ORIGIN}/api/operator/identity-changes/${id}/review`,
        {
          method: "POST",
          headers: {
            cookie: h.cookie,
            origin: ORIGIN,
            "content-type": "application/json",
            "Idempotency-Key": newRequestKey(),
          },
          body: "{}",
        },
        env,
      );
      await expectProblem(response, "unauthenticated");
    }
  });
  it("목록의 시각/ID 커서는 같은 마이크로초 요청을 빠짐/중복 없이 읽음", async () => {
    const fixtures: Fixture[] = [],
      ids: string[] = [];
    for (let i = 0; i < 3; i++) fixtures.push(await fixture());
    for (let i = 0; i < fixtures.length; i++) {
      const h = fixtures[i];
      if (!h) throw new Error("가게 없음");
      const response = await h.post(await h.input());
      expect(response.status).toBe(201);
      const id = ((await response.json()) as { shop: Shop }).shop.identityChange?.changeId;
      if (!id) throw new Error("요청 없음");
      ids.push(id);
      await db.query("UPDATE shop_identity_changes SET requested_at=$2::timestamptz WHERE id=$1", [
        id,
        `2000-01-01T00:00:00.00000${i < 2 ? 1 : 2}Z`,
      ]);
    }
    const op = await operatorFor(fixtures[0] as Fixture),
      seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const response = await op.list(`?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: { changeId: string }[]; nextCursor: string | null };
      expectSchema("IdentityChangeList", body);
      seen.push(...body.items.map((x) => x.changeId));
      cursor = body.nextCursor;
    }
    expect(seen).toEqual([...ids.slice(0, 2).sort(), ids[2]]);
  });
  it.each(["applied", "on_hold"] as const)("끝난 %s 요청도 판정자/시각과 함께 목록에서 읽음", async (decision) => {
    const h = await fixture();
    expect((await h.post(await h.input())).status).toBe(201);
    const op = await operatorFor(h),
      item = (await op.detail()).pendingIdentityChange;
    if (!item) throw new Error("요청 없음");
    expect(
      (
        await op.review(item.changeId, {
          baseRevision: item.revision,
          decision,
          ...(decision === "on_hold" ? { holdReason: "합성 이유" } : {}),
        })
      ).status,
    ).toBe(200);
    const response = await op.list(`?status=${decision}&limit=100`),
      body = (await response.json()) as { items: { changeId: string }[] };
    expectSchema("IdentityChangeList", body);
    expect(body.items.find((x) => x.changeId === item.changeId)).toMatchObject({
      status: decision,
      reviewedAt: expect.any(String),
      reviewedBy: { operatorId: op.operatorId, displayName: "합성 운영자" },
    });
  });
  it.each(["?status=verified", "?limit=0", "?limit=101", "?limit=1e2", "?cursor=broken"])(
    "목록%s는422 필드 오류",
    async (query) => {
      const h = await fixture(),
        op = await operatorFor(h);
      await expectProblem(await op.list(query), "validation_failed");
    },
  );
  it("COMMIT 응답만 잃어도 사용 중인 증빙은 지우지 않고 같은 키로201을 읽음", async () => {
    let failOnce = true;
    const h = await fixture({
      connect: () => {
        if (!isolated) throw new Error("시험 DB 없음");
        const base = isolated.connect();
        return {
          query: (sql, params) => base.query(sql, params),
          abort: () => base.abort(),
          close: () => base.close(),
          transaction: async (fn) => {
            let inserted = false;
            const result = await base.transaction((tx) =>
              fn({
                query(sql, params) {
                  if (sql.startsWith("INSERT INTO shop_identity_changes")) inserted = true;
                  return tx.query(sql, params);
                },
              }),
            );
            if (inserted && failOnce) {
              failOnce = false;
              throw new Error("synthetic_commit_response_lost");
            }
            return result;
          },
        };
      },
    });
    const input = await h.input(),
      key = newRequestKey();
    expect((await h.post(input, key)).status).toBe(500);
    const row = (
      await db.query<{ evidence_photo_key: string }>(
        "SELECT evidence_photo_key FROM shop_identity_changes WHERE shop_id=$1",
        [h.shop.shopId],
      )
    ).rows[0];
    if (!row) throw new Error("저장된 요청 없음");
    expect(h.store.objects.has(row.evidence_photo_key)).toBe(true);
    const replay = await h.post(input, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
  });
  it("반영 뒤 응답 서명 실패500도 신원/판정/알림을 모두 되돌림", async () => {
    const h = await fixture(),
      before = await h.get();
    expect((await h.post(await h.input())).status).toBe(201);
    const op = await operatorFor(h),
      item = (await op.detail()).pendingIdentityChange;
    if (!item) throw new Error("요청 없음");
    const body = { baseRevision: item.revision, decision: "applied" },
      key = newRequestKey();
    expect((await op.review(item.changeId, body, key, testEnv())).status).toBe(500);
    expect((await h.get()).businessName).toBe(before.businessName);
    expect((await db.query("SELECT status FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual(
      [{ status: "pending" }],
    );
    expect((await db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [h.shop.shopId])).rows).toHaveLength(0);
    expect((await op.review(item.changeId, body, key)).status).toBe(200);
  });
  it("운영자 목록의 증빙 서명 설정이 없으면 값 없는500이고 복구하면200", async () => {
    const h = await fixture();
    expect((await h.post(await h.input())).status).toBe(201);
    const op = await operatorFor(h),
      failed = await op.list("", testEnv());
    await expectProblem(failed, "internal");
    expect((await op.list()).status).toBe(200);
  });
  it("오래된 사장님 버전은409/복사0이고 가게 없는 실제 세션은404", async () => {
    const h = await fixture(),
      input = await h.input();
    await expectProblem(await h.post({ ...input, baseRevision: "stale" }), "version_conflict");
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(0);
    const unregistered = await createOwnerSession(
      db,
      { accountId: BigInt(`0x${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`).toString(), friend: false },
      NOW,
      false,
    );
    const response = await h.app.request(
      `${ORIGIN}/api/owner/shop/identity-changes`,
      {
        method: "POST",
        headers: {
          cookie: `${OWNER_COOKIE}=${unregistered.token}`,
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": newRequestKey(),
        },
        body: JSON.stringify(input),
      },
      env,
    );
    await expectProblem(response, "shop_not_registered");
  });
  it("사업자 요청/판정의 필수 요청 키와 내용 형식/판정 입력은422", async () => {
    const h = await fixture(),
      input = await h.input();
    const badOwner = await h.app.request(
      `${ORIGIN}/api/owner/shop/identity-changes`,
      {
        method: "POST",
        headers: { cookie: h.cookie, origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      env,
    );
    expect(await expectProblem(badOwner, "validation_failed")).toMatchObject({
      errors: [{ field: "header:Idempotency-Key", code: "required" }],
    });
    expect((await h.post(input)).status).toBe(201);
    const op = await operatorFor(h),
      item = (await op.detail()).pendingIdentityChange;
    if (!item) throw new Error("요청 없음");
    for (const body of [
      { baseRevision: item.revision, decision: "on_hold" },
      { baseRevision: item.revision, decision: "applied", shopId: crypto.randomUUID() },
    ])
      await expectProblem(await op.review(item.changeId, body), "validation_failed");
    const wrongType = await h.app.request(
      `${ORIGIN}/api/operator/identity-changes/${item.changeId}/review`,
      {
        method: "POST",
        headers: {
          cookie: op.cookie,
          origin: ORIGIN,
          "content-type": "text/plain",
          "Idempotency-Key": newRequestKey(),
        },
        body: "{}",
      },
      env,
    );
    await expectProblem(wrongType, "validation_failed");
  });
  it("앱 인증 뒤 세션이 끝나면 전용 함수가 다시 거절하고 신원/판정/알림은 그대로", async () => {
    let revoke: (() => Promise<void>) | undefined;
    const h = await fixture({
        connect: () => {
          if (!isolated) throw new Error("시험 DB 없음");
          const base = isolated.connect();
          return {
            query: (sql, params) => base.query(sql, params),
            abort: () => base.abort(),
            close: () => base.close(),
            transaction: (fn) =>
              base.transaction((tx) =>
                fn({
                  async query(sql, params) {
                    if (sql.startsWith("SELECT review_shop_identity") && revoke) {
                      const run = revoke;
                      revoke = undefined;
                      await run();
                    }
                    return tx.query(sql, params);
                  },
                }),
              ),
          };
        },
      }),
      before = await h.get();
    expect((await h.post(await h.input())).status).toBe(201);
    const op = await operatorFor(h),
      item = (await op.detail()).pendingIdentityChange;
    if (!item) throw new Error("요청 없음");
    revoke = async () => {
      await db.query("UPDATE operator_sessions SET ended_at=$2 WHERE operator_id=$1", [op.operatorId, NOW]);
    };
    await expectProblem(
      await op.review(item.changeId, { baseRevision: item.revision, decision: "applied" }),
      "unauthenticated",
    );
    expect((await h.get()).businessName).toBe(before.businessName);
    expect((await db.query("SELECT status FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual(
      [{ status: "pending" }],
    );
    expect((await db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [h.shop.shopId])).rows).toHaveLength(0);
  });
});

it.each([
  ["POST", "/owner/shop/identity-changes"],
  ["GET", "/operator/identity-changes"],
  ["POST", "/operator/identity-changes/00000000-0000-4000-8000-000000000036/review"],
])("인증 없는 사업자 변경 %s %s는401이고 DB0", async (method, path) => {
  let calls = 0;
  const fail = async (): Promise<never> => {
    calls++;
    throw new Error("DB를 부르면 안 됨");
  };
  const app = createApp({
    connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    logSink: () => {},
  });
  const response = await app.request(
    `https://siljang.example/api${path}`,
    {
      method,
      headers: {
        origin: "https://siljang.example",
        "Idempotency-Key": newRequestKey(),
        "content-type": "application/json",
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    },
    testEnv(),
  );
  await expectProblem(response, "unauthenticated");
  expect(calls).toBe(0);
});
