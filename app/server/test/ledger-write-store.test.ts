import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DUE_SOURCES } from "../src/due-sources";
import { runDueJobs } from "../src/job-runner";
import { LEDGER_STORAGE_HEADERS, signLedgerColumns } from "../src/ledger-sheet-columns";
import { ledgerWriteJob } from "../src/ledger-write-job";
import { createServices } from "../src/services";
import { readSettings, Secret } from "../src/settings";
import { TEST_DATABASE_URL, testDb } from "./support/db";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createTestRole, roleConnection } from "./support/purge-role";
import { createShop } from "./support/shops";

describe.skipIf(!TEST_DATABASE_URL)("장부 임대 DB", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  const role = `ledger157_${crypto.randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(
      "CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid PRIMARY KEY,name text,secret text); CREATE VIEW vault.decrypted_secrets AS SELECT id,name,secret AS decrypted_secret FROM vault.secrets",
    );
    await createTestRole(isolated.db, role, "app");
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });
  it("같은 가게 쓰기는 직렬화하고 늦은 임대 결과는 무시한다", async () => {
    const shop = await createShop(isolated.db, "합성 장부");
    const link = crypto.randomUUID(),
      row = crypto.randomUUID(),
      first = crypto.randomUUID(),
      second = crypto.randomUUID(),
      ref = crypto.randomUUID();
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
      [link, shop.shopId, "synthetic_sheet_1234567890", ref],
    );
    const envelope = `v1:${"A".repeat(50)}`;
    await isolated.db.query("INSERT INTO vault.secrets(id,name,secret) VALUES($1,$2,$3)", [
      ref,
      `siljang-ledger:${shop.shopId}:${link}`,
      envelope,
    ]);
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      shop.shopId,
      shop.orderId,
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$3,$4,$5,'changed',now()),($2,$3,$4,$6,'changed',now())",
      [first, second, shop.shopId, row, `ledger:${first}:changed`, `ledger:${second}:changed`],
    );
    await isolated.db.query("UPDATE ledger_writes SET created_at=created_at-interval '1 second' WHERE id=$1", [first]);
    await isolated.db.query(
      "UPDATE order_details SET lettering='최신 문구', allergy_consent='agreed', allergy_answer='장부에 없어야 함' WHERE shop_id=$1 AND order_id=$2",
      [shop.shopId, shop.orderId],
    );
    const remake = crypto.randomUUID();
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO orders(id,shop_id,order_no,customer_id,consultation_id,kind,status,version,price_list_id,operating_rules_id,pickup_at,pickup_day,amount,remake_of_order_id,cancelled_at,cancel_kind) SELECT $2,shop_id,'REMAKE1',customer_id,consultation_id,'standard','cancelled',1,price_list_id,operating_rules_id,pickup_at,pickup_day,0,id,now(),'customer' FROM orders WHERE id=$1",
        [shop.orderId, remake],
      );
      await tx.query(
        "INSERT INTO order_details(shop_id,order_id,version,source,price_list_id,pickup_at,allergy_consent,allergy_consent_at,amount) SELECT shop_id,$2,1,'remake',price_list_id,pickup_at,'not_required',now(),0 FROM order_details WHERE order_id=$1 AND version=1",
        [shop.orderId, remake],
      );
    });
    const lease = new Date(Date.now() + 120000);
    const claim = (id: string) =>
      isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [shop.shopId, id, lease]);
    const restricted = roleConnection(isolated.connect(), role);
    const firstClaim = await restricted.transaction(async (tx) => {
      expect((await tx.query(DUE_SOURCES.ledger_write.claim, [shop.shopId, first, new Date()])).rowCount).toBe(1);
      return tx.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [shop.shopId, first, lease]);
    });
    expect(firstClaim.rowCount).toBe(1);
    const values = (firstClaim.rows[0] as { row_values: unknown[] }).row_values;
    expect(values).toHaveLength(12);
    expect(values[5]).toBe("최신 문구");
    expect(values[8]).toBe("결제 기다림");
    expect(values[11]).toBe("취소됨");
    expect(JSON.stringify(values)).not.toContain("장부에 없어야 함");
    expect((await isolated.db.query("SELECT id FROM ledger_rows WHERE order_id=$1", [remake])).rowCount).toBe(0);
    const credential = (shopId: string, linkId: string, writeId: string, until: Date) =>
      isolated.db.query<{ envelope: string | null }>(
        "SELECT siljang_ledger_private.read_leased_ledger_credential($1,$2,$3,$4) AS envelope",
        [shopId, linkId, writeId, until],
      );
    expect((await credential(shop.shopId, link, first, lease)).rows[0]?.envelope).toBe(envelope);
    expect((await credential(shop.shopId, link, second, lease)).rows[0]?.envelope).toBeNull();
    expect((await credential(crypto.randomUUID(), link, first, lease)).rows[0]?.envelope).toBeNull();
    try {
      await expect(restricted.query("SELECT * FROM vault.decrypted_secrets")).rejects.toMatchObject({ code: "42501" });
      expect(
        (
          await restricted.query<{ envelope: string }>(
            "SELECT siljang_ledger_private.read_leased_ledger_credential($1,$2,$3,$4) AS envelope",
            [shop.shopId, link, first, lease],
          )
        ).rows[0]?.envelope,
      ).toBe(envelope);
    } finally {
      await restricted.close();
    }
    expect((await claim(second)).rowCount).toBe(0);
    const stale = new Date(lease.getTime() + 1000);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,NULL)", [
      shop.shopId,
      first,
      stale,
      "written",
      new Date(),
    ]);
    expect(
      (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [first])).rows[0]
        ?.status,
    ).toBe("pending");
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,$6::jsonb)", [
      shop.shopId,
      first,
      lease,
      "written",
      new Date(),
      JSON.stringify({ columns: [{ header: "주문번호", column: "AA" }], movedRight: true, ownershipToken: "proof" }),
    ]);
    expect(
      (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [first])).rows[0]
        ?.status,
    ).toBe("written");
    expect(
      (
        await isolated.db.query<{ our_columns: { movedRight: boolean } }>(
          "SELECT our_columns FROM ledger_links WHERE id=$1",
          [link],
        )
      ).rows[0]?.our_columns.movedRight,
    ).toBe(true);
    await isolated.db.query("UPDATE ledger_writes SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [second]);
    expect((await claim(second)).rowCount).toBe(1);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,NULL)", [
      shop.shopId,
      second,
      lease,
      "auth_lost",
      new Date(),
    ]);
    const failure = await isolated.db.query<{ status: string; next_attempt_at: Date }>(
      "SELECT status,next_attempt_at FROM ledger_writes WHERE id=$1",
      [second],
    );
    expect(failure.rows[0]?.status).toBe("alerted");
    expect(failure.rows[0]?.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600000);
    expect(
      (await isolated.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1 AND kind='ledger_relink'", [shop.shopId]))
        .rowCount,
    ).toBe(1);
    expect(
      (await isolated.db.query("SELECT id FROM owner_alerts WHERE shop_id=$1 AND kind='ledger_failing'", [shop.shopId]))
        .rowCount,
    ).toBe(1);
    await isolated.db.query("UPDATE ledger_writes SET next_attempt_at=now()-interval '1 minute' WHERE id=$1", [second]);
    expect((await claim(second)).rowCount).toBe(1);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,NULL)", [
      shop.shopId,
      second,
      lease,
      "written",
      new Date(),
    ]);
    expect(
      (
        await isolated.db.query<{ failure_alerted_at: Date | null }>(
          "SELECT failure_alerted_at FROM ledger_links WHERE id=$1",
          [link],
        )
      ).rows[0]?.failure_alerted_at,
    ).toBeNull();
    const third = crypto.randomUUID();
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now())",
      [third, shop.shopId, row, `ledger:${third}:changed`],
    );
    expect((await claim(third)).rowCount).toBe(1);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,NULL)", [
      shop.shopId,
      third,
      lease,
      "auth_lost",
      new Date(),
    ]);
    expect(
      (await isolated.db.query("SELECT id FROM owner_alerts WHERE shop_id=$1 AND kind='ledger_failing'", [shop.shopId]))
        .rowCount,
    ).toBe(2);
    expect(
      (
        await isolated.db.query(
          "SELECT id FROM owner_tasks WHERE shop_id=$1 AND kind='ledger_relink' AND closed_at IS NULL",
          [shop.shopId],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("24시간 경계보다 늦게 재시도하지 않아 지속 실패 알림을 놓치지 않는다", async () => {
    const shop = await createShop(isolated.db, "합성 장부 24시간"),
      link = crypto.randomUUID(),
      row = crypto.randomUUID(),
      write = crypto.randomUUID();
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
      [link, shop.shopId, "synthetic_sheet_1234567890", crypto.randomUUID()],
    );
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      shop.shopId,
      shop.orderId,
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,status,attempts,first_failed_at,next_attempt_at) VALUES($1,$2,$3,$4,'changed','retrying',5,now()-interval '23 hours 59 minutes',now())",
      [write, shop.shopId, row, `ledger:${write}:changed`],
    );
    const lease = new Date(Date.now() + 120000);
    await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
      shop.shopId,
      write,
      lease,
    ]);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,NULL)", [
      shop.shopId,
      write,
      lease,
      "retry",
      new Date(),
    ]);
    const result = (
      await isolated.db.query<{ status: string; next_attempt_at: Date; first_failed_at: Date }>(
        "SELECT status,next_attempt_at,first_failed_at FROM ledger_writes WHERE id=$1",
        [write],
      )
    ).rows[0];
    if (!result) throw new Error("ledger write missing");
    expect(result?.status).toBe("retrying");
    expect(result.next_attempt_at.getTime()).toBe(result.first_failed_at.getTime() + 24 * 3600000);
  });
  it("불확실한 외부 쓰기는 즉시 재전송하지 않고 5분 뒤 확인하도록 남긴다", async () => {
    const shop = await createShop(isolated.db, "불확실 합성 장부"),
      link = crypto.randomUUID(),
      row = crypto.randomUUID(),
      write = crypto.randomUUID();
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
      [link, shop.shopId, "synthetic_sheet_1234567890", crypto.randomUUID()],
    );
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      shop.shopId,
      shop.orderId,
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 minute')",
      [write, shop.shopId, row, `ledger:${write}:changed`],
    );
    const now = new Date(),
      lease = new Date(now.getTime() + 120000);
    await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
      shop.shopId,
      write,
      lease,
    ]);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,NULL)", [
      shop.shopId,
      write,
      lease,
      "uncertain",
      now,
    ]);
    const result = (
      await isolated.db.query<{ status: string; next_attempt_at: Date; write_uncertain: boolean }>(
        "SELECT status,next_attempt_at,write_uncertain FROM ledger_writes WHERE id=$1",
        [write],
      )
    ).rows[0];
    expect(result?.status).toBe("retrying");
    expect(result?.write_uncertain).toBe(true);
    expect(result?.next_attempt_at.getTime()).toBeGreaterThanOrEqual(now.getTime() + 299000);
  });
  it("제한 역할 예약 실행에서 Vault 암호문을 열고 구글 모의 시트에 현재 행을 쓴다", async () => {
    const shop = await createShop(isolated.db, "합성 실행기"),
      link = crypto.randomUUID(),
      row = crypto.randomUUID(),
      write = crypto.randomUUID(),
      ref = crypto.randomUUID();
    const file = "synthetic_sheet_1234567890",
      tab = "장부",
      secretText = `test-${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const settings = readSettings({
      APP_ENV: "development",
      REQUEST_HASH_KEY: secretText,
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
      GOOGLE_LEDGER_REDIRECT_URIS: "https://test.example/callback",
    });
    const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1),
      token = await fields.seal("fake-refresh", {
        purpose: "ledger_links.oauth_token",
        shopId: shop.shopId,
        recordId: link,
      });
    await isolated.db.query("INSERT INTO vault.secrets(id,name,secret) VALUES($1,$2,$3)", [
      ref,
      `siljang-ledger:${shop.shopId}:${link}`,
      token,
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,$4,'{}',$5)",
      [link, shop.shopId, file, tab, ref],
    );
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      shop.shopId,
      shop.orderId,
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
      [write, shop.shopId, row, `ledger:${write}:changed`],
    );
    const proof = await signLedgerColumns(
      new Secret(secretText),
      { shopId: shop.shopId, spreadsheetId: file, sheetId: 7 },
      0,
      false,
    );
    let written: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(raw));
        if (url.hostname === "oauth2.googleapis.com")
          return Response.json({ access_token: "fake-access", token_type: "Bearer", expires_in: 3600 });
        if (url.hostname === "www.googleapis.com")
          return Response.json({
            id: file,
            mimeType: "application/vnd.google-apps.spreadsheet",
            capabilities: { canEdit: true },
          });
        if (url.pathname.includes("/developerMetadata/")) return new Response(null, { status: 404 });
        if (init?.method === "POST") {
          written = JSON.parse(String(init.body));
          return Response.json({ spreadsheetId: file, replies: [{}] });
        }
        if (url.pathname.includes("/values/"))
          return Response.json({ values: url.pathname.includes("1%3A1") ? [LEDGER_STORAGE_HEADERS] : [["주문번호"]] });
        return Response.json({
          sheets: [
            {
              properties: { sheetId: 7, title: tab, sheetType: "GRID", gridProperties: { columnCount: 13 } },
              developerMetadata: [
                {
                  metadataKey: "siljang_columns_v1",
                  metadataValue: proof,
                  visibility: "PROJECT",
                  location: { dimensionRange: { sheetId: 7, dimension: "COLUMNS", startIndex: 0, endIndex: 1 } },
                },
              ],
            },
          ],
        });
      }),
    );
    const db = roleConnection(isolated.connect(), role);
    try {
      const services = createServices({}, settings, { fieldCrypto: fields });
      const result = await runDueJobs({
        db,
        now: new Date(),
        jobs: [
          {
            name: "ledger_write",
            every: "minute",
            sources: ["ledger_write"],
            handler: ledgerWriteJob(settings, services),
          },
        ],
        log: () => {},
      });
      expect(result.jobs.ledger_write?.done).toBe(1);
      expect(written).not.toBeNull();
      expect(
        (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [write])).rows[0]
          ?.status,
      ).toBe("written");
      expect(JSON.stringify(written)).not.toContain("fake-refresh");
    } finally {
      await db.close();
      vi.unstubAllGlobals();
    }
  });
});
