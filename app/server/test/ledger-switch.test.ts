import { expect, it, vi } from "vitest";
import { runDueJobs } from "../src/job-runner";
import { ledgerWriteJob } from "../src/ledger-write-job";
import { createServices } from "../src/services";
import { readSettings } from "../src/settings";
import { TEST_DATABASE_URL } from "./support/db";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

it.skipIf(!TEST_DATABASE_URL)(
  "기본 꺼짐은 예약·재시도·불확실 재시도·사후 확인·복구와 주문별 확인을 막고 기록은 보존한다",
  async () => {
    const db = await isolatedTestDb();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Google 호출 금지"));
    try {
      await db.db.query(
        "CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid PRIMARY KEY,name text,secret text); CREATE VIEW vault.decrypted_secrets AS SELECT id,name,secret AS decrypted_secret FROM vault.secrets",
      );
      const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
      const writes: { shopId: string; ownerId: string; link: string; row: string; write: string; orderId: string }[] =
        [];
      for (const state of ["pending", "retrying", "uncertain", "audit", "repair"] as const) {
        const shop = await createShop(db.db, `스위치 ${state}`),
          link = crypto.randomUUID(),
          ref = crypto.randomUUID(),
          row = crypto.randomUUID(),
          write = crypto.randomUUID();
        await db.db.query(
          "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,'synthetic_sheet_1234567890','장부','{}',$3)",
          [link, shop.shopId, ref],
        );
        const envelope = await fields.seal("synthetic-refresh", {
          purpose: "ledger_links.oauth_token",
          shopId: shop.shopId,
          recordId: link,
        });
        await db.db.query("INSERT INTO vault.secrets(id,name,secret) VALUES($1,$2,$3)", [
          ref,
          `siljang-ledger:${shop.shopId}:${link}`,
          envelope,
        ]);
        await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
          row,
          shop.shopId,
          shop.orderId,
        ]);
        await db.db.query(
          "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,status,next_attempt_at,write_uncertain,audit_due_at,audit_deadline,written_at) VALUES($1,$2,$3,$4,'changed',$5,CASE WHEN $5='written' THEN NULL ELSE now()-interval '1 minute' END,$6,CASE WHEN $5='written' THEN now()-interval '1 minute' END,CASE WHEN $5='written' THEN now()+interval '1 day' END,CASE WHEN $5='written' THEN now()-interval '1 hour' END)",
          [
            write,
            shop.shopId,
            row,
            `switch:${write}`,
            state === "audit" ? "written" : state === "pending" || state === "repair" ? "pending" : "retrying",
            state === "uncertain" || state === "audit",
          ],
        );
        if (state === "repair")
          await db.db.query("UPDATE ledger_writes SET audit_repair_link_id=$2 WHERE id=$1", [write, link]);
        writes.push({ shopId: shop.shopId, ownerId: shop.ownerId, link, row, write, orderId: shop.orderId });
      }
      for (const item of writes) {
        const status = await db.db.query<{ status: string }>("SELECT status FROM read_owner_ledger($1,$2,$3)", [
          item.shopId,
          item.ownerId,
          item.link,
        ]);
        expect(status.rows[0]?.status).toBe("linked");
        const lease = new Date(Date.now() + 120000);
        expect(
          (
            await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
              item.shopId,
              item.write,
              lease,
            ])
          ).rowCount,
        ).toBe(0);
      }
      const initial = (
        await db.db.query(
          "SELECT id,status,next_attempt_at,audit_due_at,write_uncertain,audit_repair_link_id FROM ledger_writes WHERE id=ANY($1::uuid[]) ORDER BY id",
          [writes.map((x) => x.write)],
        )
      ).rows;
      const settings = readSettings({
        APP_ENV: "development",
        REQUEST_HASH_KEY: `test-${crypto.randomUUID()}`,
        GOOGLE_CLIENT_ID: "test-client",
        GOOGLE_CLIENT_SECRET: "test-secret",
        GOOGLE_LEDGER_REDIRECT_URIS: "https://test.example/callback",
      });
      const services = createServices({}, settings, { fieldCrypto: fields });
      const run = await runDueJobs({
        db: db.db,
        now: new Date(),
        jobs: [
          {
            name: "ledger_write",
            every: "minute",
            sources: ["ledger_write", "ledger_audit"],
            handler: ledgerWriteJob(settings, services, () => db.connect()),
          },
        ],
        log: () => {},
      });
      expect(run.jobs.ledger_write).toMatchObject({ found: 0, done: 0, failed: 0 });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        (
          await db.db.query(
            "SELECT id,status,next_attempt_at,audit_due_at,write_uncertain,audit_repair_link_id FROM ledger_writes WHERE id=ANY($1::uuid[]) ORDER BY id",
            [writes.map((x) => x.write)],
          )
        ).rows,
      ).toEqual(initial);

      for (const item of writes) {
        const lease = new Date(Date.now() + 120000);
        expect(
          (
            await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
              item.shopId,
              item.write,
              lease,
            ])
          ).rowCount,
        ).toBe(0);
        await db.db.query("UPDATE ledger_links SET write_lease_id=$2,write_lease_until=$3 WHERE id=$1", [
          item.link,
          item.write,
          lease,
        ]);
        await db.db.query(
          "UPDATE ledger_writes SET next_attempt_at=CASE WHEN status='written' THEN NULL ELSE $2::timestamptz END,audit_due_at=CASE WHEN status='written' THEN $2::timestamptz ELSE audit_due_at END WHERE id=$1",
          [item.write, lease],
        );
        expect(
          (
            await db.db.query<{ credential: string | null }>(
              "SELECT siljang_ledger_private.read_leased_ledger_credential($1,$2,$3,$4) AS credential",
              [item.shopId, item.link, item.write, lease],
            )
          ).rows[0]?.credential,
        ).toBeNull();
        const guard = await db.db.query<{ allowed: boolean }>(
          "SELECT siljang_ledger_private.guard_ledger_write($1,$2,$3,$4,$5,'장부') AS allowed",
          [item.shopId, item.link, item.write, lease, "synthetic_sheet_1234567890"],
        );
        expect(guard.rows[0]?.allowed).toBe(false);
        const task = crypto.randomUUID();
        await db.db.query(
          "INSERT INTO owner_tasks(id,shop_id,kind,event_key,order_id) VALUES($1,$2,'ledger_relink',$3,$4)",
          [task, item.shopId, `task:ledger_conflict:${item.orderId}`, item.orderId],
        );
        expect(
          (
            await db.db.query("SELECT * FROM siljang_ledger_private.prepare_ledger_confirmation($1,$2,$3)", [
              item.shopId,
              item.ownerId,
              task,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await db.db.query<{ ok: boolean }>(
              "SELECT siljang_ledger_private.confirm_ledger_order($1,$2,$3,$4,$5,NULL,NULL,$6) AS ok",
              [item.shopId, item.ownerId, task, item.link, "A".repeat(43), "B".repeat(43)],
            )
          ).rows[0]?.ok,
        ).toBe(false);
        expect((await db.db.query("SELECT id FROM ledger_writes WHERE id=$1", [item.write])).rowCount).toBe(1);
      }
    } finally {
      fetchSpy.mockRestore();
      await db.close();
    }
  },
  30000,
);

it.skipIf(!TEST_DATABASE_URL)(
  "기존·신규 가게 모두 기본 꺼짐이고 관리자만 켜며 삭제 보호는 유지한다",
  async () => {
    const { readFileSync } = await import("node:fs"),
      { createTestRole, roleConnection } = await import("./support/purge-role"),
      { testDb } = await import("./support/db");
    const db = await isolatedTestDb({ lastMigration: 57 }),
      role = `switch157_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      const old = await createShop(db.db, "기존 가게");
      const link = crypto.randomUUID(),
        oldRow = crypto.randomUUID(),
        oldWrite = crypto.randomUUID();
      await db.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,'synthetic_sheet_1234567890','장부','{}',$3)",
        [link, old.shopId, crypto.randomUUID()],
      );
      await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
        oldRow,
        old.shopId,
        old.orderId,
      ]);
      await db.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now())",
        [oldWrite, old.shopId, oldRow, `switch:${oldWrite}`],
      );
      const before = (
        await db.db.query(
          "SELECT to_jsonb(s) AS shop,to_jsonb(o) AS ordering,to_jsonb(l) AS link,to_jsonb(r) AS row,to_jsonb(w) AS write FROM shops s JOIN orders o ON o.shop_id=s.id JOIN ledger_links l ON l.shop_id=s.id JOIN ledger_rows r ON r.shop_id=s.id JOIN ledger_writes w ON w.ledger_row_id=r.id WHERE s.id=$1",
          [old.shopId],
        )
      ).rows[0];
      await db.db.query(
        readFileSync(new URL("../../../db/migrations/0058_ledger_write_lease.sql", import.meta.url), "utf8"),
      );
      const after = (
        await db.db.query(
          "SELECT to_jsonb(s)-'ledger_write_enabled' AS shop,to_jsonb(o) AS ordering,to_jsonb(l)-ARRAY['write_lease_id','write_lease_until'] AS link,to_jsonb(r)-ARRAY['sheet_hash','confirmed_target_key','sheet_key_version','sheet_hashes'] AS row,to_jsonb(w)-ARRAY['write_uncertain','write_in_flight','resume_needs_audit','audit_due_at','audit_deadline','audit_checks','audit_repair_link_id','checkpoint_hashes'] AS write FROM shops s JOIN orders o ON o.shop_id=s.id JOIN ledger_links l ON l.shop_id=s.id JOIN ledger_rows r ON r.shop_id=s.id JOIN ledger_writes w ON w.ledger_row_id=r.id WHERE s.id=$1",
          [old.shopId],
        )
      ).rows[0];
      expect(after).toEqual(before);
      const fresh = await createShop(db.db, "신규 가게");
      expect(
        (
          await db.db.query<{ ledger_write_enabled: boolean }>(
            "SELECT ledger_write_enabled FROM shops WHERE id=ANY($1::uuid[]) ORDER BY id",
            [[old.shopId, fresh.shopId]],
          )
        ).rows.map((x) => x.ledger_write_enabled),
      ).toEqual([false, false]);
      await createTestRole(db.db, role, "app");
      const limited = roleConnection(db.connect(), role);
      try {
        await expect(
          limited.query("UPDATE shops SET ledger_write_enabled=true WHERE id=$1", [old.shopId]),
        ).rejects.toThrow();
        await db.db.query(`GRANT UPDATE (ledger_write_enabled) ON shops TO "${role}"`);
        await expect(
          limited.query("UPDATE shops SET ledger_write_enabled=true WHERE id=$1", [old.shopId]),
        ).rejects.toThrow();
      } finally {
        await limited.close();
      }
      await db.db.query("UPDATE shops SET ledger_write_enabled=true WHERE id=$1", [old.shopId]);
      expect(
        (
          await db.db.query<{ ledger_write_enabled: boolean }>("SELECT ledger_write_enabled FROM shops WHERE id=$1", [
            old.shopId,
          ])
        ).rows[0]?.ledger_write_enabled,
      ).toBe(true);
      const row = crypto.randomUUID();
      await db.db.query(
        "INSERT INTO ledger_rows(id,shop_id,order_id,sheet_hash,sheet_hashes) VALUES($1,$2,$3,$4,$5::jsonb)",
        [row, fresh.shopId, fresh.orderId, "A".repeat(43), JSON.stringify({ dummy: { event: "A".repeat(43) } })],
      );
      await db.db.query(
        "UPDATE orders SET status='cancelled',cancel_kind='customer',cancelled_at=now()-interval '31 days',finished_at=now()-interval '31 days' WHERE id=$1",
        [fresh.orderId],
      );
      await db.db.query("UPDATE orders SET personal_data_purged_at=now() WHERE id=$1", [fresh.orderId]);
      expect(
        (
          await db.db.query<{ sheet_hash: string | null; sheet_hashes: unknown }>(
            "SELECT sheet_hash,sheet_hashes FROM ledger_rows WHERE id=$1",
            [row],
          )
        ).rows[0],
      ).toEqual({ sheet_hash: null, sheet_hashes: {} });
    } finally {
      await db.close();
      const admin = testDb();
      try {
        await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      } finally {
        await admin.close();
      }
    }
  },
  30000,
);

it.skipIf(!TEST_DATABASE_URL)(
  "꺼진 가게의 주문별 확인 API는 사장님이 눌러도 구글 조회와 충돌 해제를 하지 않는다",
  async () => {
    const { createApp } = await import("../src/app"),
      { createShopScope } = await import("../src/shop-scope"),
      { testEnv } = await import("./support/db");
    const db = await isolatedTestDb(),
      fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Google 호출 금지"));
    try {
      const shop = await createShop(db.db, "꺼진 확인"),
        task = crypto.randomUUID();
      await db.db.query(
        "INSERT INTO owner_tasks(id,shop_id,kind,event_key,order_id) VALUES($1,$2,'ledger_relink',$3,$4)",
        [task, shop.shopId, `task:ledger_conflict:${shop.orderId}`, shop.orderId],
      );
      let inspected = 0;
      const app = createApp({
        connect: () => db.connect(),
        scopes: { owner: async () => createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }) },
        services: {
          ledgerConfirmation: {
            inspect: async () => {
              inspected++;
              throw new Error("호출 금지");
            },
          },
        },
      });
      const response = await app.request(
        `https://siljang.example/api/owner/tasks/${task}/ledger-confirmation`,
        {
          method: "POST",
          headers: {
            origin: "http://localhost",
            "Idempotency-Key": "test-switch-1234567890",
            "X-Expected-Shop-Id": shop.shopId,
          },
        },
        testEnv(),
      );
      expect(response.status).toBe(404);
      expect(inspected).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await db.db.query("SELECT id FROM owner_tasks WHERE id=$1 AND closed_at IS NULL", [task])).rowCount).toBe(
        1,
      );
    } finally {
      fetchSpy.mockRestore();
      await db.close();
    }
  },
  30000,
);

it.skipIf(!TEST_DATABASE_URL)(
  "진행 중 전송 잠금이 끝난 뒤에만 관리자가 끌 수 있고 이후 전송을 막는다",
  async () => {
    const db = await isolatedTestDb(),
      guardDb = db.connect(),
      admin = db.connect();
    try {
      const shop = await createShop(db.db, "끄기 경합"),
        link = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID(),
        lease = new Date(Date.now() + 120000);
      await db.db.query("UPDATE shops SET ledger_write_enabled=true WHERE id=$1", [shop.shopId]);
      await db.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,'synthetic_sheet_1234567890','장부','{}',$3)",
        [link, shop.shopId, crypto.randomUUID()],
      );
      await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
        row,
        shop.shopId,
        shop.orderId,
      ]);
      await db.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
        [write, shop.shopId, row, `switch:${write}`],
      );
      expect(
        (
          await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
            shop.shopId,
            write,
            lease,
          ])
        ).rowCount,
      ).toBe(1);
      await guardDb.transaction(async (tx) => {
        expect(
          (
            await tx.query<{ allowed: boolean }>(
              "SELECT siljang_ledger_private.guard_ledger_write($1,$2,$3,$4,$5,'장부') AS allowed",
              [shop.shopId, link, write, lease, "synthetic_sheet_1234567890"],
            )
          ).rows[0]?.allowed,
        ).toBe(true);
        await expect(
          admin.transaction(async (atx) => {
            await atx.query("SET LOCAL lock_timeout='100ms'");
            await atx.query("UPDATE shops SET ledger_write_enabled=false WHERE id=$1", [shop.shopId]);
          }),
        ).rejects.toThrow();
      });
      await admin.query("UPDATE shops SET ledger_write_enabled=false WHERE id=$1", [shop.shopId]);
      expect(
        (
          await db.db.query<{ allowed: boolean }>(
            "SELECT siljang_ledger_private.guard_ledger_write($1,$2,$3,$4,$5,'장부') AS allowed",
            [shop.shopId, link, write, lease, "synthetic_sheet_1234567890"],
          )
        ).rows[0]?.allowed,
      ).toBe(false);
    } finally {
      await guardDb.close();
      await admin.close();
      await db.close();
    }
  },
  30000,
);
