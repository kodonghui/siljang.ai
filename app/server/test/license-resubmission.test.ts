import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Queryable, RequestDb } from "../src/db";
import { tokenHash } from "../src/operator-session";
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

const ORIGIN = "https://siljang.example",
  NOW = new Date("2026-11-22T06:00:00Z"),
  env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
let isolated: Awaited<ReturnType<typeof isolatedTestDb>> | undefined, db: RequestDb;
interface Shop {
  revision: string;
  licenseStatus: string;
  foodLicenseNo: string;
  foodBusinessType: string;
  licenseHoldReason: string | null;
  licensePhotoUrl: string;
}
async function fixture(status = "on_hold") {
  const f = await createShop(db, "영업 신고 다시 올리기");
  const op = await seedOperatorSession(db, NOW);
  await db.query(
    "UPDATE shops SET license_status=$2,license_hold_reason=CASE WHEN $2='on_hold' THEN '사진이 흐려요' ELSE NULL END,license_reviewed_by=CASE WHEN $2='pending' THEN NULL ELSE $3::uuid END,license_reviewed_at=CASE WHEN $2='pending' THEN NULL ELSE $4::timestamptz END WHERE id=$1",
    [f.shopId, status, op.operatorId, NOW],
  );
  const owner = (
    await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [f.ownerId])
  ).rows[0];
  if (!owner) throw new Error("사장님 없음");
  const session = await createOwnerSession(db, { accountId: owner.kakao_account_id, friend: false }, NOW, false),
    cookie = `${OWNER_COOKIE}=${session.token}`,
    store = new MemoryStore();
  const database = isolated;
  if (!database) throw new Error("시험 DB 없음");
  const app = createApp({
    connect: () => database.connect(),
    services: { storage: store, now: () => NOW },
    logSink: () => {},
  });
  const get = async () => {
    const response = await app.request(`${ORIGIN}/api/owner/shop`, { headers: { cookie } }, env);
    expect(response.status).toBe(200);
    return (await response.json()) as Shop;
  };
  const upload = async () => {
    const id = newUploadId("license_photo", NOW);
    await store.put(tempKey(createOwnerScope(f.ownerId), id), new Uint8Array([1, 2, 3]), "image/jpeg");
    return id;
  };
  const input = async () => ({
    baseRevision: (await get()).revision,
    foodLicenseNo: "2026-새신고-001",
    foodBusinessType: "instant_sale_manufacturing",
    licensePhotoUploadId: await upload(),
  });
  const put = (body: unknown, key = newRequestKey(), bindings = env) =>
    app.request(
      `${ORIGIN}/api/owner/shop/license`,
      {
        method: "PUT",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
      bindings,
    );
  return { f, op, cookie, store, app, get, input, put, upload };
}
describeDb("TASK-033 보류 영업 신고 재업로드", () => {
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
  }, 30_000);
  afterAll(async () => isolated?.close());
  it("보류된 영업 신고를 새 증빙/번호/종류로 다시 올리면 pending/이유 없음", async () => {
    const h = await fixture(),
      input = await h.input(),
      key = newRequestKey(),
      response = await h.put(input, key);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json();
    expectSchema("ShopResult", result);
    expect(result).toMatchObject({
      outcome: "done",
      shop: {
        licenseStatus: "pending",
        licenseHoldReason: null,
        foodLicenseNo: input.foodLicenseNo,
        foodBusinessType: input.foodBusinessType,
      },
    });
    const replay = await h.put(input, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
  });
  it.each(["pending", "verified"])("보류가 아닌 %s는409이고 증빙 복사0", async (status) => {
    const h = await fixture(status);
    await expectProblem(await h.put(await h.input()), "invalid_state");
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(0);
  });
  it("오래된 버전은409이며 신원/사진/이유는 보존", async () => {
    const h = await fixture(),
      input = await h.input(),
      before = await h.get();
    await expectProblem(await h.put({ ...input, baseRevision: "stale" }), "version_conflict");
    const { licensePhotoUrl: _beforeUrl, ...beforeFields } = before;
    const { licensePhotoUrl: _afterUrl, ...afterFields } = await h.get();
    expect(afterFields).toEqual(beforeFields);
  });
  it("재업로드는 판정자/시각을 비우고 자기 보류 할 일/pending 알림 예약만 정리함", async () => {
    const h = await fixture(),
      other = await fixture(),
      task = crypto.randomUUID(),
      otherTask = crypto.randomUUID(),
      ordinary = crypto.randomUUID();
    for (const [id, shop, kind] of [
      [task, h.f.shopId, "license_on_hold"],
      [otherTask, other.f.shopId, "license_on_hold"],
      [ordinary, h.f.shopId, "calendar_conflict"],
    ] as const)
      await db.query("INSERT INTO owner_tasks(id,shop_id,kind,event_key,detail,opened_at) VALUES ($1,$2,$3,$4,$5,$6)", [
        id,
        shop,
        kind,
        `task:${kind}:${id}`,
        { reason: "합성 이유" },
        NOW,
      ]);
    await db.query(
      "INSERT INTO owner_alerts(shop_id,owner_task_id,kind,event_key,next_attempt_at) VALUES ($1,$2,'license_on_hold',$3,$4),($5,$6,'license_on_hold',$7,$4)",
      [
        h.f.shopId,
        task,
        `alert:license_on_hold:${task}`,
        NOW,
        other.f.shopId,
        otherTask,
        `alert:license_on_hold:${otherTask}`,
      ],
    );
    const response = await h.put(await h.input());
    expect(response.status).toBe(200);
    expect(
      (await db.query("SELECT license_reviewed_by,license_reviewed_at FROM shops WHERE id=$1", [h.f.shopId])).rows,
    ).toEqual([{ license_reviewed_by: null, license_reviewed_at: null }]);
    expect((await db.query("SELECT closed_at FROM owner_tasks WHERE id=$1", [task])).rows).toEqual([
      { closed_at: NOW },
    ]);
    expect((await db.query("SELECT next_attempt_at FROM owner_alerts WHERE shop_id=$1", [h.f.shopId])).rows).toEqual([
      { next_attempt_at: null },
    ]);
    expect(
      (await db.query("SELECT closed_at FROM owner_tasks WHERE id=ANY($1::uuid[])", [[otherTask, ordinary]])).rows,
    ).toEqual([{ closed_at: null }, { closed_at: null }]);
    expect(
      (await db.query("SELECT next_attempt_at FROM owner_alerts WHERE shop_id=$1", [other.f.shopId])).rows,
    ).toEqual([{ next_attempt_at: NOW }]);
  });
  it.each(["missing", "other_owner", "wrong_purpose", "expired", "oversize", "wrong_type"])(
    "증빙 %s는422이고 판정/증빙 복사는 그대로",
    async (kind) => {
      const h = await fixture(),
        input = await h.input(),
        scope = createOwnerScope(h.f.ownerId),
        key = tempKey(scope, input.licensePhotoUploadId);
      let uploadId = input.licensePhotoUploadId;
      if (kind === "missing") h.store.objects.delete(key);
      if (kind === "other_owner") {
        const other = await fixture();
        uploadId = await other.upload();
      }
      if (kind === "wrong_purpose") {
        uploadId = newUploadId("design_image", NOW);
        await h.store.put(tempKey(scope, uploadId), new Uint8Array([1]), "image/jpeg");
      }
      if (kind === "expired") uploadId = newUploadId("license_photo", new Date(NOW.getTime() - 3_600_000));
      if (kind === "oversize")
        h.store.objects.set(key, { body: new Uint8Array(10 * 1024 * 1024 + 1), contentType: "image/jpeg" });
      if (kind === "wrong_type") h.store.objects.set(key, { body: new Uint8Array([1]), contentType: "image/webp" });
      const problem = await expectProblem(
        await h.put({ ...input, licensePhotoUploadId: uploadId }),
        "validation_failed",
      );
      expect(problem).toMatchObject({
        errors: [
          {
            field: "/licensePhotoUploadId",
            code: kind === "wrong_purpose" ? "upload_wrong_purpose" : "upload_not_found",
          },
        ],
      });
      expect((await h.get()).licenseStatus).toBe("on_hold");
      expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(0);
    },
  );
  it.each(["head", "copy"] as const)("저장소 %s 장애는503/판정 보존이고 같은 키로 복구함", async (operation) => {
    const h = await fixture(),
      input = await h.input(),
      key = newRequestKey();
    h.store.failOn.add(operation);
    await expectProblem(await h.put(input, key), "storage_unavailable");
    expect((await h.get()).licenseStatus).toBe("on_hold");
    h.store.failOn.delete(operation);
    expect((await h.put(input, key)).status).toBe(200);
  });
  it("반영 뒤 응답 서명500은 사진/판정/보류 할 일을 되돌리고 같은 키로 복구함", async () => {
    const h = await fixture(),
      input = await h.input(),
      key = newRequestKey(),
      oldKey = (
        await db.query<{ license_photo_key: string }>("SELECT license_photo_key FROM shops WHERE id=$1", [h.f.shopId])
      ).rows[0]?.license_photo_key;
    const task = crypto.randomUUID();
    await db.query(
      "INSERT INTO owner_tasks(id,shop_id,kind,event_key,detail,opened_at) VALUES ($1,$2,'license_on_hold',$3,'{}',$4)",
      [task, h.f.shopId, `task:license_on_hold:${task}`, NOW],
    );
    expect((await h.put(input, key, testEnv())).status).toBe(500);
    expect(
      (await db.query("SELECT license_photo_key,license_status FROM shops WHERE id=$1", [h.f.shopId])).rows,
    ).toEqual([{ license_photo_key: oldKey, license_status: "on_hold" }]);
    expect((await db.query("SELECT closed_at FROM owner_tasks WHERE id=$1", [task])).rows).toEqual([
      { closed_at: null },
    ]);
    expect([...h.store.objects.keys()]).toEqual([tempKey(createOwnerScope(h.f.ownerId), input.licensePhotoUploadId)]);
    expect((await h.put(input, key)).status).toBe(200);
  });
  it("동시 같은 버전의 재업로드는200/409와 복사1회", async () => {
    const h = await fixture(),
      input = await h.input();
    const responses = await Promise.all([h.put(input), h.put({ ...input, foodLicenseNo: "2026-다른-001" })]);
    expect(responses.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
  });
  it("같은 키를 다른 본문에 재사용하면422이며 복사/판정을 반복하지 않음", async () => {
    const h = await fixture(),
      input = await h.input(),
      key = newRequestKey();
    expect((await h.put(input, key)).status).toBe(200);
    await expectProblem(await h.put({ ...input, foodLicenseNo: "다른 번호" }, key), "idempotency_key_reused");
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
  });
  it("실제 세션이 있어도 가게 등록 전에는404", async () => {
    const h = await fixture(),
      session = await createOwnerSession(
        db,
        { accountId: BigInt(`0x${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`).toString(), friend: false },
        NOW,
        false,
      );
    const response = await h.app.request(
      `${ORIGIN}/api/owner/shop/license`,
      {
        method: "PUT",
        headers: {
          cookie: `${OWNER_COOKIE}=${session.token}`,
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": newRequestKey(),
        },
        body: JSON.stringify(await h.input()),
      },
      env,
    );
    await expectProblem(response, "shop_not_registered");
  });
  it("로컬 제한 역할은 전용 재업로드만 되고 판정/신고 직접 수정은 막힘", async () => {
    const h = await fixture(),
      input = await h.input(),
      role = `resubmit_test_${crypto.randomUUID().replaceAll("-", "")}`;
    await db.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT`);
    const roleDb = (): RequestDb => {
      if (!isolated) throw new Error("시험 DB 없음");
      const base = isolated.connect();
      const transaction = <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
        base.transaction(async (tx) => {
          await tx.query(`SET LOCAL ROLE "${role}"`);
          return fn(tx);
        });
      return {
        query: (sql, params) => transaction((tx) => tx.query(sql, params)),
        transaction,
        abort: () => base.abort(),
        close: () => base.close(),
      };
    };
    try {
      await db.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await db.query(
        readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8").replaceAll(
          ':"runtime_role"',
          `"${role}"`,
        ),
      );
      const app = createApp({
          connect: () => roleDb(),
          services: { storage: h.store, now: () => NOW },
          logSink: () => {},
        }),
        key = newRequestKey();
      const put = () =>
        app.request(
          `${ORIGIN}/api/owner/shop/license`,
          {
            method: "PUT",
            headers: { cookie: h.cookie, origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
            body: JSON.stringify(input),
          },
          env,
        );
      await db.query(
        `REVOKE EXECUTE ON FUNCTION resubmit_shop_license(uuid,uuid,text,timestamptz,text,text,text,text) FROM "${role}"`,
      );
      expect((await put()).status).toBe(500);
      expect((await h.get()).licenseStatus).toBe("on_hold");
      await db.query(
        `GRANT EXECUTE ON FUNCTION resubmit_shop_license(uuid,uuid,text,timestamptz,text,text,text,text) TO "${role}"`,
      );
      const response = await put();
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await put()).headers.get("Idempotency-Replayed")).toBe("true");
      const limited = roleDb();
      try {
        await expect(
          limited.query("UPDATE shops SET license_status='verified' WHERE id=$1", [h.f.shopId]),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          limited.query("UPDATE shops SET food_license_no='직접 변경' WHERE id=$1", [h.f.shopId]),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          limited.query("SELECT close_license_on_hold_tasks($1,$2)", [h.f.shopId, NOW]),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await limited.close();
      }
    } finally {
      await db.query(`DROP OWNED BY "${role}"`);
      await db.query(`DROP ROLE "${role}"`);
    }
  });
  it("전용 함수는 자기 세션이어도 다른 가게의 사진 경로를 받지 않음", async () => {
    const h = await fixture(),
      input = await h.input(),
      token = h.cookie.slice(OWNER_COOKIE.length + 1);
    await expect(
      db.query("SELECT resubmit_shop_license($1,$2,$3,$4,$5,$6,$7,$8)", [
        h.f.shopId,
        h.f.ownerId,
        await tokenHash(token),
        NOW,
        input.baseRevision,
        input.foodLicenseNo,
        input.foodBusinessType,
        `shops/${crypto.randomUUID()}/license_photo/${input.licensePhotoUploadId}`,
      ]),
    ).rejects.toMatchObject({ code: "22023" });
    expect((await h.get()).licenseStatus).toBe("on_hold");
  });
  it.each(["revoked", "commit_response_lost"] as const)(
    "세션/COMMIT 경계 %s에서 잘못된 저장/사진 지우기를 막음",
    async (mode) => {
      const h = await fixture(),
        input = await h.input(),
        key = newRequestKey();
      let once = true;
      const app = createApp({
        connect: () => {
          if (!isolated) throw new Error("시험 DB 없음");
          const base = isolated.connect();
          return {
            query: (sql, params) => base.query(sql, params),
            abort: () => base.abort(),
            close: () => base.close(),
            transaction: async (fn) => {
              let submitted = false;
              const result = await base.transaction((tx) =>
                fn({
                  async query(sql, params) {
                    if (sql.startsWith("SELECT resubmit_shop_license")) {
                      submitted = true;
                      if (mode === "revoked" && once) {
                        once = false;
                        await db.query("UPDATE owner_sessions SET ended_at=$2 WHERE owner_id=$1", [h.f.ownerId, NOW]);
                      }
                    }
                    return tx.query(sql, params);
                  },
                }),
              );
              if (mode === "commit_response_lost" && submitted && once) {
                once = false;
                throw new Error("synthetic_commit_response_lost");
              }
              return result;
            },
          };
        },
        services: { storage: h.store, now: () => NOW },
        logSink: () => {},
      });
      const put = () =>
        app.request(
          `${ORIGIN}/api/owner/shop/license`,
          {
            method: "PUT",
            headers: { cookie: h.cookie, origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
            body: JSON.stringify(input),
          },
          env,
        );
      if (mode === "revoked") {
        await expectProblem(await put(), "unauthenticated");
        expect((await db.query("SELECT license_status FROM shops WHERE id=$1", [h.f.shopId])).rows).toEqual([
          { license_status: "on_hold" },
        ]);
        expect([...h.store.objects.keys()]).toEqual([
          tempKey(createOwnerScope(h.f.ownerId), input.licensePhotoUploadId),
        ]);
      } else {
        expect((await put()).status).toBe(500);
        const stored = (
          await db.query<{ license_photo_key: string; license_status: string }>(
            "SELECT license_photo_key,license_status FROM shops WHERE id=$1",
            [h.f.shopId],
          )
        ).rows[0];
        if (!stored) throw new Error("가게 없음");
        expect(stored.license_status).toBe("pending");
        expect(h.store.objects.has(stored.license_photo_key)).toBe(true);
        const replay = await put();
        expect(replay.status).toBe(200);
        expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
        expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
      }
    },
  );
});
it("무인증 영업 신고 재업로드는401/데이터베이스0", async () => {
  let calls = 0;
  const fail = async (): Promise<never> => {
    calls++;
    throw new Error("데이터베이스 호출 금지");
  };
  const app = createApp({
    connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    logSink: () => {},
  });
  const response = await app.request(
    `${ORIGIN}/api/owner/shop/license`,
    {
      method: "PUT",
      headers: { origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": newRequestKey() },
      body: "{}",
    },
    testEnv(),
  );
  await expectProblem(response, "unauthenticated");
  expect(calls).toBe(0);
});
