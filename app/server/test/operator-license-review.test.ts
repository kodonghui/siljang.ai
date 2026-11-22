import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { DbConnector, RequestDb } from "../src/db";
import { parseLicenseReview, parseReviewList, reviewCursor } from "../src/license-review-input";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerSession } from "../src/owner-session";
import { expectProblem, expectSchema } from "./support/contract";
import { collectLogs, describeDb, newRequestKey, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop, type ShopFixture } from "./support/shops";

interface ReviewDetail {
  shopId: string;
  revision: string;
  licenseStatus: string;
  licenseHoldReason: string | null;
  paymentAccount: {
    accountLast4: string;
    holderMatches: boolean;
    holderMismatchConfirmed: boolean | null;
    holderCheckedBy: { operatorId: string } | null;
  } | null;
  pendingIdentityChange: { changeId: string } | null;
}
interface ReviewResult {
  outcome: string;
  shop: ReviewDetail;
}
interface ReviewList {
  items: { shopId: string; revision: string }[];
  nextCursor: string | null;
}

const ORIGIN = "https://siljang.example";
const NOW = new Date("2026-11-22T05:00:00Z");
const db = testDb();

it.each([
  [null, "/", "bad_format"],
  [{}, "/baseRevision", "required"],
  [{ baseRevision: "x", decision: "on_hold" }, "/holdReason", "required"],
  [{ baseRevision: "x", decision: "on_hold", holdReason: "" }, "/holdReason", "too_short"],
  [{ baseRevision: "x", decision: "on_hold", holdReason: "가".repeat(201) }, "/holdReason", "too_long"],
  [{ baseRevision: "x", decision: "on_hold", holdReason: "\u0000" }, "/holdReason", "bad_format"],
  [{ baseRevision: null, decision: "verified" }, "/baseRevision", "bad_format"],
  [{ baseRevision: "가", decision: "verified" }, "/baseRevision", "bad_format"],
  [{ baseRevision: "x".repeat(65), decision: "verified" }, "/baseRevision", "too_long"],
  [{ baseRevision: "x", decision: "pending" }, "/decision", "bad_format"],
  [{ baseRevision: "x", decision: "verified", shopId: newUuid() }, "/shopId", "unknown_field"],
])("영업 신고 입력의 잘못된 필드를 값 없이 거절함 %#", (body, field, code) => {
  expect(() => parseLicenseReview(body)).toThrowError(
    expect.objectContaining({
      code: "validation_failed",
      extras: { errors: expect.arrayContaining([{ field, code }]) },
    }),
  );
});
it("보류 이유200개 이모지와64자 버전을 받고 여러 오류를 함께 돌려줌", () => {
  expect(
    parseLicenseReview({ baseRevision: "x".repeat(64), decision: "on_hold", holdReason: "🎂".repeat(200) }).holdReason,
  ).toHaveLength(400);
  expect(() => parseLicenseReview({ baseRevision: "", decision: "on_hold", holdReason: "", other: true })).toThrowError(
    expect.objectContaining({
      extras: {
        errors: expect.arrayContaining([
          { field: "/baseRevision", code: "too_short" },
          { field: "/holdReason", code: "too_short" },
          { field: "/other", code: "unknown_field" },
        ]),
      },
    }),
  );
});
it.each(["0", "101", "-1", "1.2", "NaN", "", "1e2"])("목록 limit %s는422임", (limit) => {
  expect(() => parseReviewList({ limit })).toThrowError(expect.objectContaining({ code: "validation_failed" }));
});
it.each([
  "bad=cursor",
  "A",
  "x".repeat(201),
  reviewCursor("verified", "2020-01-01T00:00:00.000123Z", newUuid()),
  reviewCursor("pending", "2020-02-30T00:00:00.000000Z", newUuid()),
  reviewCursor("pending", "0000-01-01T00:00:00.000000Z", newUuid()),
])("틀리거나 다른 상태의 커서는422임 %#", (cursor) => {
  expect(() => parseReviewList({ cursor })).toThrowError(expect.objectContaining({ code: "validation_failed" }));
});

async function fixture(options: { database?: RequestDb; connect?: DbConnector; shop?: ShopFixture } = {}) {
  const fixtureDb = options.database ?? db;
  const shop = options.shop ?? (await createShop(fixtureDb, "신고 확인 합성 가게"));
  const { operatorId, token } = await seedOperatorSession(fixtureDb, NOW);
  const logs = collectLogs();
  const app = createApp({
    ...(options.connect ? { connect: options.connect } : {}),
    services: { now: () => NOW },
    logSink: logs.sink,
  });
  const call = (method: string, path: string, body?: unknown, authenticated = true, key = newRequestKey()) =>
    app.request(
      `${ORIGIN}/api${path}`,
      {
        method,
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": key,
          ...(authenticated ? { cookie: `siljang_operator=${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
    );
  const path = `/operator/shops/${shop.shopId}`;
  const current = async () => {
    const response = await call("GET", path);
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json() as Promise<ReviewDetail>;
  };
  const review = async (decision = "verified", holdReason?: string, revision?: string, key?: string) =>
    call(
      "POST",
      `${path}/license-review`,
      {
        baseRevision: revision ?? (await current()).revision,
        decision,
        ...(holdReason === undefined ? {} : { holdReason }),
      },
      true,
      key,
    );
  return { shop, operatorId, token, call, current, review, path, app, logs };
}

describeDb("TASK-034 운영자의 영업 신고 확인 API-012/013/014", () => {
  afterAll(async () => db.close());
  it("운영자 세션으로 확인 기다림 목록을 읽음", async () => {
    const h = await fixture(),
      response = await h.call("GET", "/operator/shops");
    expect(response.status, await response.clone().text()).toBe(200);
    expectSchema("ReviewShopList", await response.json());
  });
  it("가게 상세는 은행/예금주/끝4자리와 신고증 주소만 보임", async () => {
    const h = await fixture(),
      response = await h.call("GET", `/operator/shops/${h.shop.shopId}`);
    expect(response.status, await response.clone().text()).toBe(200);
    const value = await response.json();
    expectSchema("ReviewShopDetail", value);
    expect(value).toMatchObject({
      shopId: h.shop.shopId,
      paymentAccount: { bankName: "시험은행", holderName: "시험사장", accountLast4: "9012" },
    });
    expect(JSON.stringify(value)).not.toContain(h.shop.customerId);
    expect(JSON.stringify(value)).not.toContain("accountNumber");
  });
  it("확인됨은 가게와 지금 계좌에 같은 운영자/시각을 함께 남김", async () => {
    const h = await fixture(),
      path = `/operator/shops/${h.shop.shopId}`;
    const response = await h.call("GET", path);
    expect(response.status).toBe(200);
    const current = (await response.json()) as { revision: string };
    const saved = await h.call("POST", `${path}/license-review`, {
      baseRevision: current.revision,
      decision: "verified",
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expectSchema("LicenseReviewResult", await saved.json());
    expect(
      (
        await db.query("SELECT license_status,license_reviewed_by,license_reviewed_at FROM shops WHERE id=$1", [
          h.shop.shopId,
        ])
      ).rows,
    ).toEqual([{ license_status: "verified", license_reviewed_by: h.operatorId, license_reviewed_at: NOW }]);
    expect(
      (
        await db.query(
          "SELECT holder_checked_by,holder_checked_at FROM payment_accounts WHERE shop_id=$1 AND retired_at IS NULL",
          [h.shop.shopId],
        )
      ).rows,
    ).toEqual([{ holder_checked_by: h.operatorId, holder_checked_at: NOW }]);
  });
  it.each(["list", "detail", "review"])("인증 없는 %s는401임", async (kind) => {
    const h = await fixture();
    const path =
      kind === "list"
        ? "/operator/shops"
        : `/operator/shops/${h.shop.shopId}${kind === "review" ? "/license-review" : ""}`;
    await expectProblem(
      await h.call(
        kind === "review" ? "POST" : "GET",
        path,
        kind === "review" ? { baseRevision: "revision", decision: "verified" } : undefined,
        false,
      ),
      "unauthenticated",
    );
  });
  it("실제로 내 정보를 읽는 사장님 세션도 운영자 목록/상세/검토를 열지 못함", async () => {
    const h = await fixture(),
      row = (
        await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [
          h.shop.ownerId,
        ])
      ).rows[0];
    if (!row) throw new Error("합성 사장님 없음");
    const session = await createOwnerSession(db, { accountId: row.kakao_account_id, friend: false }, NOW, false),
      headers = {
        cookie: `${OWNER_COOKIE}=${session.token}`,
        origin: ORIGIN,
        "content-type": "application/json",
        "Idempotency-Key": newRequestKey(),
      },
      env = testEnv();
    expect((await h.app.request(`${ORIGIN}/api/owner/me`, { headers }, env)).status).toBe(200);
    for (const [method, path] of [
      ["GET", "/operator/shops"],
      ["GET", h.path],
      ["POST", `${h.path}/license-review`],
    ] as const)
      await expectProblem(
        await h.app.request(
          `${ORIGIN}/api${path}`,
          {
            method,
            headers,
            ...(method === "POST" ? { body: JSON.stringify({ baseRevision: "stale", decision: "verified" }) } : {}),
          },
          env,
        ),
        "unauthenticated",
      );
  });
  it.each(["list", "detail", "review"])("DB가 끊긴 %s는 내부 값을 숨긴500임", async (kind) => {
    const fail = async (): Promise<never> => {
      throw new Error("private-database-failure-marker");
    };
    const h = await fixture({
      connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    });
    const path = kind === "list" ? "/operator/shops" : `${h.path}${kind === "review" ? "/license-review" : ""}`;
    const response = await h.call(
      kind === "review" ? "POST" : "GET",
      path,
      kind === "review" ? { baseRevision: "stale", decision: "verified" } : undefined,
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expectSchema("Problem", JSON.parse(body));
    expect(body).not.toContain("private-database-failure-marker");
    expect(h.logs.lines.join("")).not.toContain("private-database-failure-marker");
  });
  it.each(["?status=wrong", "?limit=0", "?cursor=bad=cursor"])("목록 쿼리 %s는422임", async (query) => {
    const h = await fixture();
    await expectProblem(await h.call("GET", `/operator/shops${query}`), "validation_failed");
  });
  it.each(["not_json", "wrong_type", "missing_key", "wrong_body"])(
    "검토 본문/요청 키 %s는422이고 가게를 바꾸지 않음",
    async (kind) => {
      const h = await fixture(),
        before = await h.current(),
        headers: Record<string, string> = {
          origin: ORIGIN,
          cookie: `siljang_operator=${h.token}`,
          "content-type": kind === "wrong_type" ? "text/plain" : "application/json",
        };
      if (kind !== "missing_key") headers["Idempotency-Key"] = newRequestKey();
      const response = await h.app.request(
        `${ORIGIN}/api${h.path}/license-review`,
        {
          method: "POST",
          headers,
          body:
            kind === "not_json"
              ? "{"
              : JSON.stringify(kind === "wrong_body" ? {} : { baseRevision: before.revision, decision: "verified" }),
        },
        testEnv(),
      );
      await expectProblem(response, "validation_failed");
      expect((await h.current()).revision).toBe(before.revision);
    },
  );

  it("마이크로초가 다른 등록 시각과 같은 시각의ID를 빠뜨리거나 되풀이하지 않고 다음 쪽으로 읽음", async () => {
    const isolated = await isolatedTestDb();
    try {
      const h = await fixture({ database: isolated.db, connect: () => isolated.connect() });
      const b = await createShop(isolated.db, "합성 둘"),
        c = await createShop(isolated.db, "합성 셋");
      await isolated.db.query("UPDATE shops SET created_at='2020-01-01T00:00:00.000123Z' WHERE id=$1", [h.shop.shopId]);
      await isolated.db.query("UPDATE shops SET created_at='2020-01-01T00:00:00.000124Z' WHERE id=ANY($1::uuid[])", [
        [b.shopId, c.shopId],
      ]);
      const expected = [h.shop.shopId, ...[b.shopId, c.shopId].sort()],
        found: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 4; i++) {
        const response = await h.call("GET", `/operator/shops?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
        expect(response.status).toBe(200);
        const page = (await response.json()) as ReviewList;
        expectSchema("ReviewShopList", page);
        found.push(...page.items.map((s: { shopId: string }) => s.shopId));
        cursor = page.nextCursor;
        if (cursor === null) break;
      }
      expect(found).toEqual(expected);
      expect(cursor).toBeNull();
      const empty = await h.call("GET", "/operator/shops?status=on_hold");
      expect(await empty.json()).toEqual({ items: [], nextCursor: null });
    } finally {
      await isolated.close();
    }
  });
  it("보류 이유·할 일·알림을 같은 요청 키의 재전송에도 한 번만 남김", async () => {
    const h = await fixture(),
      revision = (await h.current()).revision,
      key = newRequestKey();
    for (let i = 0; i < 2; i++) {
      const response = await h.review("on_hold", "신고증 글자가 안 보여요", revision, key);
      expect(response.status, await response.clone().text()).toBe(200);
      expectSchema("LicenseReviewResult", await response.json());
    }
    expect((await h.current()).licenseHoldReason).toBe("신고증 글자가 안 보여요");
    expect(
      (await db.query("SELECT detail FROM owner_tasks WHERE shop_id=$1 AND kind='license_on_hold'", [h.shop.shopId]))
        .rows,
    ).toEqual([{ detail: { reason: "신고증 글자가 안 보여요" } }]);
    expect(
      (
        await db.query("SELECT count(*)::int AS n FROM owner_alerts WHERE shop_id=$1 AND kind='license_on_hold'", [
          h.shop.shopId,
        ])
      ).rows,
    ).toEqual([{ n: 1 }]);
    await db.query("UPDATE owner_alerts SET status='failed',fail_code='cannot_send' WHERE shop_id=$1", [h.shop.shopId]);
    expect(
      (await db.query("SELECT detail FROM owner_tasks WHERE shop_id=$1", [h.shop.shopId])).rows[0]?.detail,
    ).toEqual({ reason: "신고증 글자가 안 보여요" });
  });
  it("중복 사업자 번호는 목록에 표시하고 상세는 오래된20가게까지만 보임", async () => {
    const isolated = await isolatedTestDb();
    try {
      const h = await fixture({ database: isolated.db, connect: () => isolated.connect() });
      const duplicates: string[] = [];
      for (let i = 0; i < 21; i++) {
        const other = await createShop(isolated.db, `중복 합성 가게${i}`);
        duplicates.push(other.shopId);
        await isolated.db.query(
          "UPDATE shops SET business_reg_no=(SELECT business_reg_no FROM shops WHERE id=$1),created_at=$3 WHERE id=$2",
          [h.shop.shopId, other.shopId, new Date(NOW.getTime() + i * 1000)],
        );
      }
      const detail = await h.call("GET", h.path),
        value = (await detail.json()) as { duplicates: { shopId: string }[] };
      expectSchema("ReviewShopDetail", value);
      expect(value.duplicates.map((s) => s.shopId)).toEqual(duplicates.slice(0, 20));
      const list = await h.call("GET", "/operator/shops?limit=100"),
        page = (await list.json()) as {
          items: { shopId: string; duplicateBusinessRegNo: boolean; revision: string }[];
        };
      expect(page.items).toHaveLength(22);
      expect(page.items.every((s) => s.duplicateBusinessRegNo)).toBe(true);
      expect(page.items.find((s) => s.shopId === h.shop.shopId)?.revision).toBe((await h.current()).revision);
    } finally {
      await isolated.close();
    }
  });
  it("이미 확인된 가게를 새 버전으로 다시 확인하면 그대로이고 보류는409임", async () => {
    const h = await fixture();
    expect((await h.review()).status).toBe(200);
    const before = await h.current();
    const again = await h.review();
    expect(again.status).toBe(200);
    expect(((await again.json()) as ReviewResult).outcome).toBe("unchanged");
    expect((await h.current()).revision).toBe(before.revision);
    await expectProblem(await h.review("on_hold", "보류"), "invalid_state");
  });
  it("두 운영자가 같은 버전으로 동시에 정하면 한 번 남고 뒤는already_decided임", async () => {
    const a = await fixture(),
      b = await fixture({ shop: a.shop }),
      revision = (await a.current()).revision;
    const responses = await Promise.all([
      a.review("on_hold", "A 판정", revision),
      b.review("on_hold", "B 판정", revision),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    await expectProblem(responses.find((r) => r.status === 409) as Response, "already_decided");
    expect(
      (await db.query("SELECT count(*)::int AS n FROM owner_tasks WHERE shop_id=$1", [a.shop.shopId])).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("검토 중 계좌만 바뀌어도 이전 화면으로 승인하지 않음", async () => {
    const h = await fixture(),
      revision = (await h.current()).revision;
    await db.query("UPDATE payment_accounts SET holder_name='새 예금주' WHERE shop_id=$1 AND retired_at IS NULL", [
      h.shop.shopId,
    ]);
    await expectProblem(await h.review("verified", undefined, revision), "version_conflict");
    expect((await h.current()).licenseStatus).toBe("pending");
    expect((await h.review()).status).toBe(200);
  });
  it("다른 가게 수정은 내 버전을 바꾸지 않고 내 가게 변경은version_conflict임", async () => {
    const h = await fixture(),
      b = await fixture(),
      revision = (await h.current()).revision;
    await db.query("UPDATE shops SET name='다른 합성 이름' WHERE id=$1", [b.shop.shopId]);
    expect((await h.current()).revision).toBe(revision);
    await db.query("UPDATE shops SET name='내 합성 이름' WHERE id=$1", [h.shop.shopId]);
    await expectProblem(await h.review("verified", undefined, revision), "version_conflict");
  });
  it("대기 중인 사업자 변경은 상세에 보이고 먼저 판정하기 전 승인만 막음", async () => {
    const h = await fixture(),
      old = (await h.current()).revision;
    const change = (
      await db.query<{ id: string }>(
        `INSERT INTO shop_identity_changes (shop_id,business_name,representative_name,business_reg_no,prev_business_name,prev_representative_name,prev_business_reg_no,evidence_photo_key,requested_at)
      SELECT id,'합성 새 상호',representative_name,business_reg_no,business_name,representative_name,business_reg_no,license_photo_key,$2 FROM shops WHERE id=$1 RETURNING id`,
        [h.shop.shopId, NOW],
      )
    ).rows[0];
    const detail = await h.current();
    expectSchema("ReviewShopDetail", detail);
    expect(detail.pendingIdentityChange?.changeId).toBe(change?.id);
    await expectProblem(await h.review("verified", undefined, old), "version_conflict");
    await expectProblem(await h.review(), "identity_change_pending");
    expect((await h.review("on_hold", "사업자 변경부터 확인해 주세요")).status).toBe(200);
    expect((await h.current()).pendingIdentityChange?.changeId).toBe(change?.id);
  });
  it("같은 요청 키의 다른 판정은422이고 같은 운영자의 옛 버전은version_conflict임", async () => {
    const h = await fixture(),
      revision = (await h.current()).revision,
      key = newRequestKey();
    expect((await h.review("on_hold", "보류", revision, key)).status).toBe(200);
    await expectProblem(await h.review("verified", undefined, revision, key), "idempotency_key_reused");
    await expectProblem(await h.review("verified", undefined, revision), "version_conflict");
    expect((await h.review()).status).toBe(200);
  });
  it("대표자/상호와 다른 예금주도 운영자가 판정하고 원문 없이 확인자를 남김", async () => {
    const h = await fixture();
    await db.query(
      "UPDATE payment_accounts SET holder_name='다른 합성 예금주',holder_mismatch_confirmed=true WHERE shop_id=$1",
      [h.shop.shopId],
    );
    const before = await h.current();
    expect(before.paymentAccount?.holderMatches).toBe(false);
    expect(before.paymentAccount?.holderMismatchConfirmed).toBe(true);
    const response = await h.review();
    expect(response.status).toBe(200);
    const result = (await response.json()) as ReviewResult;
    expectSchema("LicenseReviewResult", result);
    expect(result.shop.paymentAccount?.holderCheckedBy?.operatorId).toBe(h.operatorId);
    expect(JSON.stringify(result)).not.toContain("accountNumber");
  });
  it("현재 계좌가 없으면 확인됨은 막고 보류는 허용함", async () => {
    const h = await fixture();
    await db.query("UPDATE payment_accounts SET retired_at=$2 WHERE shop_id=$1", [h.shop.shopId, NOW]);
    expect((await h.current()).paymentAccount).toBeNull();
    await expectProblem(await h.review(), "payment_account_missing");
    expect((await h.review("on_hold", "계좌 등록을 기다려요")).status).toBe(200);
  });
  it.each(["disabled", "ended", "mfa"])("세션의 %s 변경 뒤 목록/상세/승인 모두401임", async (kind) => {
    const h = await fixture();
    if (kind === "disabled") await db.query("UPDATE operators SET disabled_at=$2 WHERE id=$1", [h.operatorId, NOW]);
    if (kind === "mfa") await db.query("UPDATE operators SET mfa_factor_id=$2 WHERE id=$1", [h.operatorId, newUuid()]);
    if (kind === "ended")
      await db.query("UPDATE operator_sessions SET ended_at=$2 WHERE operator_id=$1", [h.operatorId, NOW]);
    for (const [method, path, body] of [
      ["GET", "/operator/shops", undefined],
      ["GET", h.path, undefined],
      ["POST", `${h.path}/license-review`, { baseRevision: "stale", decision: "verified" }],
    ] as const)
      await expectProblem(await h.call(method, path, body), "unauthenticated");
  });
  it.each(["not-a-uuid", newUuid(), "x".repeat(101)])("인증 뒤 없는/틀린 가게 %s는조회/검토404임", async (id) => {
    const h = await fixture();
    await expectProblem(await h.call("GET", `/operator/shops/${id}`), "not_found");
    await expectProblem(
      await h.call("POST", `/operator/shops/${id}/license-review`, { baseRevision: "stale", decision: "verified" }),
      "not_found",
    );
  });
});
