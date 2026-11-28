import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Queryable, RequestDb } from "../src/db";
import { GoogleLedgerUnavailableError } from "../src/ledger-google-auth";
import { LEDGER_COOKIE, verifyLedgerOAuth } from "../src/ledger-oauth";
import { OWNER_COOKIE, readCookie } from "../src/owner-oauth";
import { createOwnerSession } from "../src/owner-session";
import { requestHash } from "../src/request-key";
import type { ServiceOverrides } from "../src/services";
import { Secret } from "../src/settings";
import { toShopIso } from "../src/time";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { roleConnection } from "./support/purge-role";
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
    await isolated.db.query(
      "CREATE SCHEMA vault; CREATE TABLE vault.secrets (id uuid PRIMARY KEY, name text UNIQUE, secret text); CREATE FUNCTION vault.create_secret(value text, secret_name text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets (id, name, secret) VALUES (gen_random_uuid(), secret_name, value) RETURNING id $$",
    );
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
  function app(limited = false, fault = false, overrides: ServiceOverrides = {}) {
    return createApp({
      connect: (): RequestDb => {
        const raw = isolated.connect();
        const wrap = (q: Queryable): Queryable => ({
          query(sql, params) {
            if (
              fault &&
              (sql.includes("ledger_links") || sql.includes("read_owner_ledger") || sql.includes("unlink_owner_ledger"))
            )
              throw new Error("synthetic ledger query failure");
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
      services: { now: () => NOW, ...overrides },
      logSink: (line) => logs.push(line),
    });
  }
  const get = (options: { cookie?: string; limited?: boolean; fault?: boolean } = {}) =>
    app(options.limited, options.fault).request(PATH, { headers: { cookie: options.cookie ?? cookie } }, testEnv());
  async function link(
    status = "linked",
    overrides: { shopId?: string; sheet?: string; columns?: unknown; at?: Date; missing?: boolean } = {},
  ) {
    const id = newUuid(),
      at = overrides.at ?? NOW,
      credential = newUuid();
    if (!overrides.missing)
      await isolated.db.query("INSERT INTO vault.secrets(id,name) VALUES($1,$2)", [
        credential,
        `siljang-ledger:${overrides.shopId ?? shop.shopId}:${id}`,
      ]);
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref,status,linked_at,unlinked_at) VALUES($1,$2,$3,'주문 장부',$4::jsonb,$5,$6,$7,$8)",
      [
        id,
        overrides.shopId ?? shop.shopId,
        overrides.sheet ?? SHEET,
        JSON.stringify(overrides.columns ?? { columns: COLUMNS, movedRight: true }),
        credential,
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
  it.each([
    ["state", "google_authorization_failed"],
    ["denied", "google_authorization_failed"],
    ["sheet", "sheet_not_accessible"],
    ["offline", "google_unavailable"],
  ] as const)("구글 연결 실패 %s는 장부를 남기지 않는다", async (failure, code) => {
    const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const overrides = {
      fieldCrypto: fields,
      ledgerAuthorization: {
        start: async () => {
          throw new Error("unused");
        },
        verify: async () =>
          failure === "state" ? null : { redirect: "https://siljang.example/callback", verifier: "test-verifier" },
      },
      ledgerGoogle: {
        authorizeUrl: () => "",
        exchange: async () => {
          if (failure === "offline") throw new GoogleLedgerUnavailableError();
          return failure === "denied"
            ? null
            : { accessToken: new Secret("test-access"), refreshToken: new Secret("test-refresh"), expiresAt: NOW };
        },
      },
      ledgerSetup: { connect: async () => null },
    } as unknown as ServiceOverrides;
    const response = await app(true, false, overrides).request(
      PATH,
      {
        method: "PUT",
        headers: {
          cookie,
          Origin: "https://siljang.example",
          "content-type": "application/json",
          "Idempotency-Key": `ledger-${newUuid()}`,
        },
        body: JSON.stringify({
          baseRevision: null,
          code: "fixture-code",
          state: "fixture-state-123456789",
          spreadsheetId: SHEET,
          sheetName: "주문 장부",
        }),
      },
      testEnv(),
    );
    await expectProblem(response, code);
    expect((await isolated.db.query("SELECT id FROM ledger_links WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(0);
  });
  it("Vault가 없으면 구글 인가 코드를 쓰지 않는다", async () => {
    let exchanges = 0;
    const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const overrides = {
      fieldCrypto: fields,
      ledgerAuthorization: {
        start: async () => {
          throw new Error("unused");
        },
        verify: async () => ({ redirect: "https://siljang.example/callback", verifier: "test-verifier" }),
      },
      ledgerGoogle: {
        authorizeUrl: () => "",
        exchange: async () => {
          exchanges += 1;
          return null;
        },
      },
      ledgerSetup: { connect: async () => null },
    } as unknown as ServiceOverrides;
    await isolated.db.query("ALTER SCHEMA vault RENAME TO vault_unavailable");
    try {
      const response = await app(true, false, overrides).request(
        PATH,
        {
          method: "PUT",
          headers: {
            cookie,
            Origin: "https://siljang.example",
            "content-type": "application/json",
            "Idempotency-Key": `ledger-${newUuid()}`,
          },
          body: JSON.stringify({
            baseRevision: null,
            code: "fixture-code",
            state: "fixture-state-123456789",
            spreadsheetId: SHEET,
            sheetName: "주문 장부",
          }),
        },
        testEnv(),
      );
      expect(response.status).toBe(500);
      expect(exchanges).toBe(0);
    } finally {
      await isolated.db.query("ALTER SCHEMA vault_unavailable RENAME TO vault");
    }
  });
  it("암호화 키가 없으면 구글 인가 코드를 쓰지 않는다", async () => {
    let exchanges = 0;
    const overrides = {
      ledgerAuthorization: {
        start: async () => {
          throw new Error("unused");
        },
        verify: async () => ({ redirect: "https://siljang.example/callback", verifier: "test-verifier" }),
      },
      ledgerGoogle: {
        authorizeUrl: () => "",
        exchange: async () => {
          exchanges += 1;
          return null;
        },
      },
    } as unknown as ServiceOverrides;
    const response = await app(true, false, overrides).request(
      PATH,
      {
        method: "PUT",
        headers: {
          cookie,
          Origin: "https://siljang.example",
          "content-type": "application/json",
          "Idempotency-Key": `ledger-${newUuid()}`,
        },
        body: JSON.stringify({
          baseRevision: null,
          code: "fixture-code",
          state: "fixture-state-123456789",
          spreadsheetId: SHEET,
          sheetName: "주문 장부",
        }),
      },
      testEnv(),
    );
    expect(response.status).toBe(500);
    expect(exchanges).toBe(0);
  });
  it("연결 요청의 세션·가게·버전 오류는 계약대로 닫힌다", async () => {
    const body = JSON.stringify({
      baseRevision: null,
      code: "fixture-code",
      state: "fixture-state-123456789",
      spreadsheetId: SHEET,
      sheetName: "주문 장부",
    });
    const send = (ownerCookie: string) =>
      app(true).request(
        PATH,
        {
          method: "PUT",
          headers: {
            cookie: ownerCookie,
            Origin: "https://siljang.example",
            "content-type": "application/json",
            "Idempotency-Key": `ledger-${newUuid()}`,
          },
          body,
        },
        testEnv(),
      );
    await expectProblem(await send(""), "unauthenticated");
    const accountId = BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 14)}`).toString();
    const session = await createOwnerSession(isolated.db, { accountId, friend: false }, NOW, false);
    await expectProblem(await send(`${OWNER_COOKIE}=${session.token}`), "shop_not_registered");
    await link("linked");
    await expectProblem(await send(cookie), "version_conflict");
  });
  it("구글 연결은 토큰을 암호화해 저장하고 응답에서 숨긴다", async () => {
    const token = `fixture-token-${"x".repeat(300)}`;
    let exchanges = 0;
    const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const overrides = {
      fieldCrypto: fields,
      ledgerAuthorization: {
        start: async () => {
          throw new Error("unused");
        },
        verify: async () => ({ redirect: "https://siljang.example/callback", verifier: "test-verifier" }),
      },
      ledgerGoogle: {
        authorizeUrl: () => "",
        exchange: async () => {
          exchanges += 1;
          return { accessToken: new Secret("test-access"), refreshToken: new Secret(token), expiresAt: NOW };
        },
      },
      ledgerSetup: {
        connect: async () => ({
          sheetId: 1,
          start: 0,
          end: 1,
          movedRight: false,
          ownershipToken: "fixture-marker",
          columns: COLUMNS,
        }),
      },
    } as unknown as ServiceOverrides;
    const requestKey = `ledger-${newUuid()}`;
    const request: RequestInit = {
      method: "PUT",
      headers: {
        cookie,
        Origin: "https://siljang.example",
        "content-type": "application/json",
        "Idempotency-Key": requestKey,
      },
      body: JSON.stringify({
        baseRevision: null,
        code: "fixture-code",
        state: "fixture-state-123456789",
        spreadsheetId: SHEET,
        sheetName: "주문 장부",
      }),
    };
    const response = await app(true, false, overrides).request(PATH, request, testEnv());
    expect(response.status, await response.clone().text()).toBe(200);
    const replay = await app(true, false, overrides).request(PATH, request, testEnv());
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(exchanges).toBe(1);
    expect(logs.join("\n")).not.toContain(token);
    const text = await response.text();
    expect(text).not.toContain(token);
    const rows = await isolated.db.query<{ id: string; secret: string }>(
      "SELECT l.id,v.secret FROM ledger_links l JOIN vault.secrets v ON v.id::text=l.credential_ref WHERE l.shop_id=$1",
      [shop.shopId],
    );
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0];
    if (!row) throw new Error("저장된 장부 없음");
    expect(row.secret).not.toContain(token);
    expect(
      await fields.open(row.secret, {
        purpose: "ledger_links.oauth_token",
        shopId: shop.shopId,
        recordId: row.id,
      }),
    ).toBe(token);
  });
  it("장부 생성은 가게 소유를 검증하고 중복 연결을 막는다", async () => {
    const id = newUuid();
    const values = [shop.shopId, shop.ownerId, id, SHEET, "주문 장부", JSON.stringify({ columns: COLUMNS }), null, NOW];
    const first = await isolated.db.query<{ outcome: string }>(
      "SELECT * FROM siljang_ledger_private.create_owner_ledger($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
      values,
    );
    expect(first.rows[0]?.outcome).toBe("created");
    const duplicate = await isolated.db.query<{ outcome: string }>(
      "SELECT * FROM siljang_ledger_private.create_owner_ledger($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
      [shop.shopId, shop.ownerId, newUuid(), ...values.slice(3)],
    );
    expect(duplicate.rows[0]?.outcome).toBe("conflict");
    const other = await createShop(isolated.db, "다른 가게");
    const denied = await isolated.db.query(
      "SELECT * FROM siljang_ledger_private.create_owner_ledger($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
      [shop.shopId, other.ownerId, newUuid(), ...values.slice(3)],
    );
    expect(denied.rows).toHaveLength(0);
  });
  it("다시 연결은 이전 토큰을 지우고 연결 끊김 쓰기를 재시도한다", async () => {
    const oldId = await link("linked");
    const old = (
      await isolated.db.query<{ credential_ref: string; revision: string }>(
        "SELECT credential_ref,xmin::text AS revision FROM ledger_links WHERE id=$1",
        [oldId],
      )
    ).rows[0];
    if (!old) throw new Error("이전 연결 없음");
    const row = newUuid();
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      shop.shopId,
      shop.orderId,
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(shop_id,ledger_row_id,event_key,event_kind,status) VALUES($1,$2,$3,'changed','unlinked')",
      [shop.shopId, row, `ledger:${newUuid()}:changed`],
    );
    const newId = newUuid();
    const result = await isolated.db.query<{ outcome: string }>(
      "SELECT * FROM siljang_ledger_private.create_owner_ledger($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
      [shop.shopId, shop.ownerId, newId, SHEET, "주문 장부", JSON.stringify({ columns: COLUMNS }), old.revision, NOW],
    );
    expect(result.rows[0]?.outcome).toBe("relinked");
    expect(
      (await isolated.db.query("SELECT id FROM vault.secrets WHERE id::text=$1", [old.credential_ref])).rowCount,
    ).toBe(0);
    expect(
      (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE ledger_row_id=$1", [row]))
        .rows[0]?.status,
    ).toBe("pending");
    expect(
      (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_links WHERE id=$1", [oldId])).rows[0]
        ?.status,
    ).toBe("unlinked");
  });
  it("Vault 저장 함수는 해당 가게의 암호문만 저장한다", async () => {
    const id = await link("linked");
    const encrypted = `v1:${"A".repeat(64)}`;
    const runtime = roleConnection(isolated.connect(), role);
    const result = await runtime.query<{ ok: boolean }>(
      "SELECT siljang_ledger_private.store_ledger_credential($1,$2,$3,$4) AS ok",
      [shop.shopId, shop.ownerId, id, encrypted],
    );
    expect(result.rows[0]?.ok).toBe(true);
    const foreign = await createShop(isolated.db, "다른 가게");
    const denied = await isolated.db.query<{ ok: boolean }>(
      "SELECT siljang_ledger_private.store_ledger_credential($1,$2,$3,$4) AS ok",
      [shop.shopId, foreign.ownerId, id, encrypted],
    );
    expect(denied.rows[0]?.ok).toBe(false);
    await expect(runtime.query("SELECT * FROM vault.secrets")).rejects.toThrow();
    await runtime.close();
    const found = await isolated.db.query<{ secret: string }>(
      "SELECT v.secret FROM vault.secrets v JOIN ledger_links l ON v.id::text=l.credential_ref WHERE l.id=$1",
      [id],
    );
    expect(found.rows).toEqual([{ secret: encrypted }]);
    await expect(
      isolated.db.query("SELECT siljang_ledger_private.store_ledger_credential($1,$2,$3,$4)", [
        shop.shopId,
        shop.ownerId,
        id,
        "plaintext-token",
      ]),
    ).rejects.toThrow();
  });
  it("같은 장부 해제 요청이 진행 중이면 409를 반환한다", async () => {
    const key = `ledger-${newUuid()}`;
    const hash = await requestHash(new Secret(TEST_HASH_KEY), "API-036", [], null);
    await isolated.db.query(
      "INSERT INTO request_keys(actor_kind,actor_id,request_key,command,request_hash,state,processing_expires_at) VALUES('owner',$1,$2,'API-036',$3,'processing',clock_timestamp()+interval '1 minute')",
      [shop.ownerId, key, hash],
    );
    const response = await app(true).request(
      PATH,
      { method: "DELETE", headers: { cookie, Origin: "https://siljang.example", "Idempotency-Key": key } },
      testEnv(),
    );
    await expectProblem(response, "request_in_progress");
  });
  it("연결 해제의 세션·대상·요청 키·서버 오류는 계약대로 닫힌다", async () => {
    const send = (ownerCookie: string, key?: string, fault = false) =>
      app(true, fault).request(
        PATH,
        {
          method: "DELETE",
          headers: {
            cookie: ownerCookie,
            Origin: "https://siljang.example",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
        },
        testEnv(),
      );
    await expectProblem(await send("", `ledger-${newUuid()}`), "unauthenticated");
    await expectProblem(await send(cookie), "validation_failed");
    await expectProblem(await send(cookie, `ledger-${newUuid()}`), "not_set");
    await link("linked");
    await expectProblem(await send(cookie, `ledger-${newUuid()}`, true), "internal");
  });
  it("연결 해제는 토큰을 지우고 상태를 반환한다", async () => {
    const linkId = await link("linked");
    const ref = (
      await isolated.db.query<{ credential_ref: string }>("SELECT credential_ref FROM ledger_links WHERE id=$1", [
        linkId,
      ])
    ).rows[0]?.credential_ref;
    const response = await app(true).request(
      PATH,
      {
        method: "DELETE",
        headers: { cookie, Origin: "https://siljang.example", "Idempotency-Key": `ledger-${newUuid()}` },
      },
      testEnv(),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { outcome: string; ledger: { status: string } };
    expect(body.outcome).toBe("done");
    expect(body.ledger.status).toBe("unlinked");
    expect((await isolated.db.query("SELECT id FROM vault.secrets WHERE id::text=$1", [ref])).rowCount).toBe(0);
  });
  it("다른 연결의 Vault 행은 재연결 전 유효한 토큰으로 취급하거나 삭제하지 않는다", async () => {
    const id = await link("linked");
    const unrelated = newUuid();
    await isolated.db.query("INSERT INTO vault.secrets(id,secret) VALUES($1,'other-service')", [unrelated]);
    await isolated.db.query("UPDATE ledger_links SET credential_ref=$2 WHERE id=$1", [id, unrelated]);
    const response = await get();
    expect(((await response.json()) as { status: string }).status).toBe("auth_lost");
    const unlink = await app(true).request(
      PATH,
      {
        method: "DELETE",
        headers: { cookie, Origin: "https://siljang.example", "Idempotency-Key": `ledger-${newUuid()}` },
      },
      testEnv(),
    );
    expect(unlink.status).toBe(200);
    expect((await isolated.db.query("SELECT id FROM vault.secrets WHERE id=$1", [unrelated])).rowCount).toBe(1);
  });
  it("복구 뒤 토큰이 없으면 다시 연결할 수 있도록 auth_lost를 반환한다", async () => {
    await link("linked", { missing: true });
    const response = await get();
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("auth_lost");
  });
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
  it("장부 조회 역할에는 자격 증명 참조와 내부 발신 표시의 직접 조회를 열지 않는다", async () => {
    for (const column of ["credential_ref", "failure_alerted_at", "provider"]) {
      expect(
        (
          await isolated.db.query("SELECT has_column_privilege($1,'ledger_links',$2,'SELECT') AS allowed", [
            role,
            column,
          ])
        ).rows,
      ).toEqual([{ allowed: false }]);
    }
    const conn = isolated.connect();
    try {
      await expect(
        conn.transaction(async (tx) => {
          await tx.query(`SET LOCAL ROLE "${role}"`);
          await tx.query("SELECT credential_ref FROM ledger_links");
        }),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await conn.close();
    }
  });
  it("두 장부 함수는 PUBLIC 실행0/고정 search_path이고 실행 역할만 호출한다", async () => {
    for (const signature of ["read_owner_ledger(uuid,uuid,uuid)", "unlink_owner_ledger(uuid,uuid,timestamptz)"]) {
      const row = (
        await isolated.db.query(
          "SELECT p.prosecdef,p.proconfig,has_function_privilege($1,p.oid,'EXECUTE') AS callable,(SELECT count(*)::int FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid=$2::regprocedure",
          [role, signature],
        )
      ).rows[0];
      expect(row).toEqual({
        prosecdef: true,
        proconfig: ["search_path=pg_catalog"],
        callable: true,
        public_execute: 0,
      });
    }
  });
  it("함수도 다른 사장님의 가게를 읽거나 끊지 않고 열 정보의 숨은 필드를 제거한다", async () => {
    const hidden = "synthetic-hidden-credential",
      other = await createShop(isolated.db, "다른 장부 가게");
    await link("linked", { shopId: other.shopId });
    await link("linked", {
      columns: { columns: [{ ...COLUMNS[0], privateNote: hidden }], movedRight: true, privateCredential: hidden },
    });
    const before = await snapshotShop(isolated.db, other),
      conn = roleConnection(isolated.connect(), role);
    try {
      const own = await conn.query("SELECT * FROM public.read_owner_ledger($1,$2,NULL)", [shop.shopId, shop.ownerId]);
      expect(own.rowCount).toBe(1);
      expect(JSON.stringify(own.rows)).not.toContain(hidden);
      expect(own.rows[0]?.our_columns).toEqual({ columns: [COLUMNS[0]], movedRight: true });
      expect(
        (await conn.query("SELECT * FROM public.read_owner_ledger($1,$2,NULL)", [other.shopId, shop.ownerId])).rowCount,
      ).toBe(0);
      expect(
        (await conn.query("SELECT * FROM public.unlink_owner_ledger($1,$2,$3)", [other.shopId, shop.ownerId, NOW]))
          .rowCount,
      ).toBe(0);
    } finally {
      await conn.close();
    }
    expect(await snapshotShop(isolated.db, other)).toEqual(before);
  });
  const redirect = "https://siljang.example/owner/ledger/callback";
  const googleClient = `${crypto.randomUUID()}.apps.googleusercontent.com`,
    googleSecret = crypto.randomUUID() + crypto.randomUUID();
  const authorize = (
    body: unknown = { redirectUri: redirect },
    options: { cookie?: string; origin?: string; configured?: boolean; limited?: boolean } = {},
  ) =>
    app(options.limited).request(
      `${PATH}/authorization`,
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
    expect(response.headers.getSetCookie().some((value) => value.startsWith(`${OWNER_COOKIE}=`))).toBe(true);
    const nonce = readCookie(
        response.headers.getSetCookie().find((value) => value.startsWith(`${LEDGER_COOKIE}=`)),
        LEDGER_COOKIE,
      ),
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
    expect(((await first.json()) as { state: string }).state).not.toBe(
      ((await second.json()) as { state: string }).state,
    );
  });
  it.each([`${redirect}?altered=1`, "https://other.example/owner/ledger/callback"])(
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
    await expectProblem(await authorize(undefined, { origin: "https://other.example" }), "unauthenticated");
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
