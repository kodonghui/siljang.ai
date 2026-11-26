import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Queryable, RequestDb } from "../src/db";
import { LEDGER_COOKIE, verifyLedgerOAuth } from "../src/ledger-oauth";
import { OWNER_COOKIE, readCookie } from "../src/owner-oauth";
import { createOwnerSession } from "../src/owner-session";
import { Secret } from "../src/settings";
import { toShopIso } from "../src/time";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop, type ShopFixture, snapshotShop } from "./support/shops";

const NOW = new Date("2026-11-26T00:00:00Z"),
  PATH = "https://siljang.example/api/owner/ledger";
const SHEET = "sheet_fixture_current_000000000001";
const COLUMNS = [
  { header: "주문번호", column: "A" },
  { header: "상태", column: "B" },
];
describeDb("API033 실제 세션/장부 상태·쓰기 수·토큰 비노출", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, cookie: string;
  const role = `ledger156_${newUuid().replaceAll("-", "")}`,
    logs: string[] = [];
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await isolated.db.query(
      readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8").replaceAll(
        ':"runtime_role"',
        `"${role}"`,
      ),
    );
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
    const db = testDb();
    try {
      await db.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await db.close();
    }
  });
  async function ownerCookie(ownerId: string) {
    const row = (
      await isolated.db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [
        ownerId,
      ])
    ).rows[0];
    if (!row) throw new Error("합성 사장님 없음");
    const session = await createOwnerSession(
      isolated.db,
      { accountId: row.kakao_account_id, friend: false },
      NOW,
      false,
    );
    return `${OWNER_COOKIE}=${session.token}`;
  }
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 장부 가게");
    cookie = await ownerCookie(shop.ownerId);
    logs.length = 0;
  });
  function app(limited = false, fault = false) {
    return createApp({
      connect: (): RequestDb => {
        const raw = isolated.connect();
        const wrap = (q: Queryable): Queryable => ({
          query(sql, params) {
            if (fault && sql.includes("ledger_links")) throw new Error("synthetic ledger query failure");
            return q.query(sql, params);
          },
        });
        const transaction = <T>(fn: (tx: Queryable) => Promise<T>) =>
          raw.transaction(async (tx) => {
            if (limited) await tx.query(`SET LOCAL ROLE "${role}"`);
            return fn(wrap(tx));
          });
        return {
          query: (sql, params) => transaction((tx) => tx.query(sql, params)),
          transaction,
          abort: () => raw.abort(),
          close: () => raw.close(),
        };
      },
      services: { now: () => NOW },
      logSink: (line) => logs.push(line),
    });
  }
  const get = (options: { cookie?: string; limited?: boolean; fault?: boolean } = {}) =>
    app(options.limited, options.fault).request(PATH, { headers: { cookie: options.cookie ?? cookie } }, testEnv());
  async function link(
    status = "linked",
    overrides: { shopId?: string; sheet?: string; columns?: unknown; at?: Date } = {},
  ) {
    const id = newUuid(),
      at = overrides.at ?? NOW;
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref,status,linked_at,unlinked_at) VALUES($1,$2,$3,'주문 장부',$4::jsonb,$5,$6,$7,$8)",
      [
        id,
        overrides.shopId ?? shop.shopId,
        overrides.sheet ?? SHEET,
        JSON.stringify(overrides.columns ?? { columns: COLUMNS, movedRight: true }),
        `fixture:${newUuid()}`,
        status,
        at,
        status === "unlinked" ? NOW : null,
      ],
    );
    return id;
  }
  it.each(["linked", "auth_lost", "unlinked"])(
    "%s의 모든 응답 필드·가게 시간·버전을 계약대로 반환한다",
    async (status) => {
      await link(status);
      const response = await get();
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expectSchema("LedgerLink", body);
      expect(body).toEqual({
        status,
        spreadsheetId: SHEET,
        sheetName: "주문 장부",
        columns: COLUMNS,
        movedRight: true,
        failingSince: null,
        unwrittenCount: 0,
        linkedAt: toShopIso(NOW, "Asia/Seoul"),
        unlinkedAt: status === "unlinked" ? toShopIso(NOW, "Asia/Seoul") : null,
        revision: expect.any(String),
      });
    },
  );
  it("옛 배열 형식도 읽으며 숨은 필드나 자격 증명 참조는 내보내지 않는다", async () => {
    await link("linked", { columns: COLUMNS });
    let response = await get();
    expect(response.status).toBe(200);
    let body = (await response.json()) as Record<string, unknown>;
    expectSchema("LedgerLink", body);
    expect(body.movedRight).toBe(false);
    const hidden = crypto.randomUUID();
    await isolated.db.query("UPDATE ledger_links SET our_columns=$2::jsonb WHERE shop_id=$1", [
      shop.shopId,
      JSON.stringify({ columns: COLUMNS, movedRight: false, notForResponse: hidden }),
    ]);
    response = await get();
    expect(response.status).toBe(200);
    body = (await response.json()) as Record<string, unknown>;
    expectSchema("LedgerLink", body);
    expect(JSON.stringify(body)).not.toContain(hidden);
    expect(body).not.toHaveProperty("credential_ref");
    expect(body).not.toHaveProperty("credentialRef");
  });
  it("나중에 끊은 옛 기록보다 현재 연결을 고른다", async () => {
    await link("linked", { at: new Date(NOW.getTime() - 86400000) });
    await link("unlinked", { sheet: `${SHEET}2` });
    const response = await get();
    expect(response.status).toBe(200);
    expect(((await response.json()) as { spreadsheetId: string }).spreadsheetId).toBe(SHEET);
  });
  it("적지 못한 모든 상태의 수와 가장 이른 실패만 센다", async () => {
    await link("auth_lost");
    const row = newUuid(),
      old = new Date(NOW.getTime() - 86400000);
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      shop.shopId,
      shop.orderId,
    ]);
    for (const status of ["pending", "retrying", "alerted", "unlinked", "written"])
      await isolated.db.query(
        "INSERT INTO ledger_writes(shop_id,ledger_row_id,event_key,event_kind,status,first_failed_at,written_at) VALUES($1,$2,$3,'changed',$4,$5,$6)",
        [
          shop.shopId,
          row,
          `ledger:${newUuid()}:changed`,
          status,
          status === "retrying" ? old : status === "written" ? new Date(old.getTime() - 86400000) : null,
          status === "written" ? NOW : null,
        ],
      );
    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expectSchema("LedgerLink", body);
    expect(body.unwrittenCount).toBe(4);
    expect(body.failingSince).toBe(toShopIso(old, "Asia/Seoul"));
  });
  it("연결하지 않은 가게는404 not_set이며 다른 가게의 연결은 보이지 않는다", async () => {
    const other = await createShop(isolated.db, "다른 장부 가게");
    await link("linked", { shopId: other.shopId });
    await expectProblem(await get(), "not_set");
  });
  it("사장님 쿠키 없음/운영자 쿠키는401이다", async () => {
    await link();
    await expectProblem(await get({ cookie: "" }), "unauthenticated");
    const session = await seedOperatorSession(isolated.db, NOW);
    await expectProblem(await get({ cookie: session.cookie }), "unauthenticated");
  });
  it("가게가 없는 실제 사장님 세션은404 shop_not_registered다", async () => {
    const accountId = BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 14)}`).toString();
    const session = await createOwnerSession(isolated.db, { accountId, friend: false }, NOW, false);
    await expectProblem(await get({ cookie: `${OWNER_COOKIE}=${session.token}` }), "shop_not_registered");
  });
  it("조회는 장부·업무 기록을 바꾸지 않는다", async () => {
    await link();
    const before = await snapshotShop(isolated.db, shop);
    expect((await get()).status).toBe(200);
    expect(await snapshotShop(isolated.db, shop)).toEqual(before);
  });
  it("배포용 최소 역할로도 조회하고 DB 오류는 기본500으로 닫는다", async () => {
    await link();
    const response = await get({ limited: true });
    expect(response.status, await response.clone().text()).toBe(200);
    expectSchema("LedgerLink", await response.json());
    await expectProblem(await get({ fault: true }), "internal");
    expect(logs.join("\n")).not.toContain(SHEET);
  });
  const redirect = "https://siljang.example/owner/ledger/callback";
  const googleClient = crypto.randomUUID() + ".apps.googleusercontent.com",
    googleSecret = crypto.randomUUID() + crypto.randomUUID();
  const authorize = (
    body: unknown = { redirectUri: redirect },
    options: { cookie?: string; origin?: string; configured?: boolean; limited?: boolean } = {},
  ) =>
    app(options.limited).request(
      PATH + "/authorization",
      {
        method: "POST",
        headers: {
          cookie: options.cookie ?? cookie,
          origin: options.origin ?? "https://siljang.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      testEnv(
        options.configured === false
          ? {}
          : {
              GOOGLE_CLIENT_ID: googleClient,
              GOOGLE_CLIENT_SECRET: googleSecret,
              GOOGLE_LEDGER_REDIRECT_URIS: redirect,
            },
      ),
    );
  it("API034는 요청 키 없이 실제 세션의 가게/사장님/브라우저에 묶은600초 state를 만든다", async () => {
    const before = await snapshotShop(isolated.db, shop),
      response = await authorize(undefined, { limited: true });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { authorizationUrl: string; state: string; expiresAt: string };
    expectSchema("LedgerAuthorization", body);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(`${LEDGER_COOKIE}=`);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"]) expect(setCookie).toContain(flag);
    const nonce = readCookie(setCookie, LEDGER_COOKIE),
      url = new URL(body.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("state")).toBe(body.state);
    expect(url.searchParams.get("redirect_uri")).toBe(redirect);
    expect(url.searchParams.get("client_id")).toBe(googleClient);
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/spreadsheets");
    expect(new Date(body.expiresAt).getTime()).toBe(NOW.getTime() + 600000);
    expect(
      await verifyLedgerOAuth(
        new Secret(TEST_HASH_KEY),
        { shopId: shop.shopId, ownerId: shop.ownerId },
        body.state,
        nonce,
        redirect,
        NOW,
      ),
    ).not.toBeNull();
    for (const scope of [
      { shopId: newUuid(), ownerId: shop.ownerId },
      { shopId: shop.shopId, ownerId: newUuid() },
    ])
      expect(await verifyLedgerOAuth(new Secret(TEST_HASH_KEY), scope, body.state, nonce, redirect, NOW)).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(body)).not.toContain(nonce);
    expect(JSON.stringify(body)).not.toContain(googleSecret);
    expect(logs.join("\n")).not.toContain(googleSecret);
    expect(await snapshotShop(isolated.db, shop)).toEqual(before);
  });
  it("API034를 다시 시작하면 브라우저 nonce/state를 새로 만든다", async () => {
    const first = await authorize(),
      second = await authorize();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("set-cookie")).not.toBe(second.headers.get("set-cookie"));
    expect((await first.json()).state).not.toBe((await second.json()).state);
  });
  it.each([redirect + "?altered=1", "https://other.example/owner/ledger/callback"])(
    "API034의 설정 밖 주소 %s는422다",
    async (value) => {
      const body = await expectProblem(await authorize({ redirectUri: value }), "validation_failed");
      expect(body.errors).toEqual([{ field: "/redirectUri", code: "not_allowed" }]);
    },
  );
  it("API034는 잘못된/추가 입력과 다른 Origin을 거절한다", async () => {
    for (const body of [
      { redirectUri: "http://siljang.example/callback" },
      { redirectUri: redirect, shopId: newUuid() },
      { redirectUri: redirect, code: "never-echo-this-code" },
    ])
      await expectProblem(await authorize(body), "validation_failed");
    await expectProblem(await authorize(undefined, { origin: "https://other.example" }), "validation_failed");
  });
  it("API034 사장님 세션 없음/운영자 세션은401이다", async () => {
    await expectProblem(await authorize(undefined, { cookie: "" }), "unauthenticated");
    const operator = await seedOperatorSession(isolated.db, NOW);
    await expectProblem(await authorize(undefined, { cookie: operator.cookie }), "unauthenticated");
  });
  it("API034 가게 없는 사장님 세션은404다", async () => {
    const accountId = BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 14)}`).toString(),
      session = await createOwnerSession(isolated.db, { accountId, friend: false }, NOW, false);
    await expectProblem(
      await authorize(undefined, { cookie: `${OWNER_COOKIE}=${session.token}` }),
      "shop_not_registered",
    );
  });
  it("API034 구글 설정이 없으면 값 없는500이고 기존 조회/상태 확인은 유지한다", async () => {
    await expectProblem(await authorize(undefined, { configured: false }), "internal");
    expect((await app().request("https://siljang.example/api/healthz", {}, testEnv())).status).toBe(200);
    expect(logs.join("\n")).not.toContain(googleSecret);
  });
});
