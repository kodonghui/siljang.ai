/** API-012~014/SPEC-003. 계좌 원문과 손님·주문 기록은 읽지도 응답하지도 않는다. */
import { requireJson } from "./body";
import { toHex } from "./encoding";
import { eventKeys, insertOnce } from "./event-keys";
import { readIdentityReview, renderIdentityReview } from "./identity-change-view";
import { parseLicenseReview, parseReviewList, reviewCursor } from "./license-review-input";
import { type ReviewSummaryRow, reviewRevision } from "./license-review-state";
import { readSessionCookie, tokenHash } from "./operator-session";
import { ApiError, type ErrorCode } from "./problem";
import type { OperatorRequest, ShopRequest } from "./routes";
import type { Services } from "./services";
import type { ShopDb } from "./shop-scope";
import { toShopIso } from "./time";

interface ShopRow extends ReviewSummaryRow {
  contact_phone: string;
  contact_email: string;
  business_address: string;
  mail_order_reg_no: string | null;
  mail_order_authority: string | null;
  mail_order_exemption: string | null;
  license_photo_key: string;
  license_hold_reason: string | null;
  license_reviewed_by: string | null;
  license_reviewed_at: Date | null;
}
interface AccountRow {
  bank_name: string;
  holder_name: string;
  account_last4: string;
  holder_mismatch_confirmed: boolean | null;
  holder_checked_by: string | null;
  holder_checked_at: Date | null;
  created_at: Date;
}
type Duplicates = readonly { shopId: string; name: string; licenseStatus: string }[];

async function current(db: ShopDb, lock: boolean): Promise<ShopRow> {
  // 잠금을 기다리는 동안 계좌/변경 요청이 바뀌었어도 뒤의 새 문장이 같은 시점의 버전을 읽는다.
  await db.found(
    lock
      ? "SELECT s.id FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE"
      : "SELECT s.id FROM shops s WHERE s.id=$1 FOR SHARE",
  );
  return db.found<ShopRow>(`SELECT s.*,
      concat(s.id,':',s.xmin::text,':',coalesce((SELECT concat(p.id,':',p.xmin::text) FROM payment_accounts p WHERE p.shop_id=$1 AND p.retired_at IS NULL),'-'),':',coalesce((SELECT concat(i.id,':',i.xmin::text) FROM shop_identity_changes i WHERE i.shop_id=$1 AND i.status='pending'),'-')) AS revision_state,
      concat(s.license_reviewed_by,':',extract(epoch FROM s.license_reviewed_at)) AS review_marker
      FROM shops s WHERE s.id=$1`);
}

async function operator(db: ShopDb, id: string | null) {
  if (id === null) return null;
  const row = await db.found<{ id: string; display_name: string }>(
    "SELECT id,display_name FROM operators WHERE id=$2 AND $1::uuid IS NOT NULL",
    [id],
  );
  return { operatorId: row.id, displayName: row.display_name };
}

async function render(db: ShopDb, services: Services, origin: string, row: ShopRow, duplicates: Duplicates) {
  const iso = (date: Date) => toShopIso(date, row.time_zone),
    now = services.now(),
    urls = services.fileUrls();
  const account = (
    await db.run<AccountRow>(
      "SELECT p.bank_name,p.holder_name,p.account_last4,p.holder_mismatch_confirmed,p.holder_checked_by,p.holder_checked_at,p.created_at FROM payment_accounts p WHERE p.shop_id=$1 AND p.retired_at IS NULL",
    )
  ).rows[0];
  const change = await readIdentityReview(db, null);
  return {
    shopId: row.id,
    name: row.name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    businessAddress: row.business_address,
    businessName: row.business_name,
    representativeName: row.representative_name,
    businessRegNo: row.business_reg_no,
    mailOrderRegNo: row.mail_order_reg_no,
    mailOrderAuthority: row.mail_order_authority,
    mailOrderExemption: row.mail_order_exemption,
    foodLicenseNo: row.food_license_no,
    foodBusinessType: row.food_business_type,
    licensePhotoUrl: await urls.sign(row.license_photo_key, origin, now),
    licenseStatus: row.license_status,
    licenseHoldReason: row.license_hold_reason,
    licenseReviewedAt: row.license_reviewed_at === null ? null : iso(row.license_reviewed_at),
    licenseReviewedBy: await operator(db, row.license_reviewed_by),
    duplicates,
    paymentAccount:
      account === undefined
        ? null
        : {
            bankName: account.bank_name,
            holderName: account.holder_name,
            accountLast4: account.account_last4,
            holderMatches: account.holder_name === row.business_name || account.holder_name === row.representative_name,
            holderMismatchConfirmed: account.holder_mismatch_confirmed,
            holderCheckedAt: account.holder_checked_at === null ? null : iso(account.holder_checked_at),
            holderCheckedBy: await operator(db, account.holder_checked_by),
            createdAt: iso(account.created_at),
          },
    pendingIdentityChange: change === undefined ? null : await renderIdentityReview(change, services, origin),
    createdAt: iso(row.created_at),
    revision: await reviewRevision(row),
  };
}

export async function listReviewShops(r: OperatorRequest): Promise<Response> {
  const input = parseReviewList(r.req.query()),
    rows = await r.shops.list(input),
    page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return r.json({
    items: await Promise.all(
      page.map(async (row) => ({
        shopId: row.id,
        name: row.name,
        businessName: row.business_name,
        representativeName: row.representative_name,
        businessRegNo: row.business_reg_no,
        foodLicenseNo: row.food_license_no,
        foodBusinessType: row.food_business_type,
        licenseStatus: row.license_status,
        duplicateBusinessRegNo: row.duplicate,
        createdAt: toShopIso(row.created_at, row.time_zone),
        revision: await reviewRevision(row),
      })),
    ),
    nextCursor: rows.length > input.limit && last ? reviewCursor(input.status, last.cursor_at, last.id) : null,
  });
}

export async function getReviewShop(r: ShopRequest): Promise<Response> {
  if (!r.operatorShops) throw new ApiError("unauthenticated");
  const duplicates = await r.operatorShops.duplicates();
  return r.json(
    await r.db.transaction(async (db) => render(db, r.services, r.req.url, await current(db, false), duplicates)),
  );
}

export async function reviewLicense(r: ShopRequest): Promise<Response> {
  if (r.scope.via.kind !== "operator" || !r.operatorShops) throw new ApiError("unauthenticated");
  requireJson(r.req.raw);
  const raw = await r.body(),
    input = parseLicenseReview(raw),
    now = r.services.now(),
    operatorId = r.scope.via.operatorId;
  const token = readSessionCookie(r.req.header("cookie"));
  if (token === null) throw new ApiError("unauthenticated");
  const hash = await tokenHash(token),
    duplicates = await r.operatorShops.duplicates();
  return r.command({
    command: "API-014",
    pathIds: [r.scope.shopId],
    body: raw,
    async execute(db) {
      const row = await current(db, true),
        revision = await reviewRevision(row);
      if (input.baseRevision !== revision) {
        const reviewChanged =
          /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{16}$/.test(input.baseRevision) &&
          input.baseRevision.split(".")[1] !== revision.split(".")[1];
        if (reviewChanged && row.license_reviewed_by !== null && row.license_reviewed_by !== operatorId)
          throw new ApiError("already_decided");
        throw new ApiError("version_conflict");
      }
      const result = (
        await db.found<{ result: string }>("SELECT review_shop_license($1,$2,$3,$4,$5,$6,$7) AS result", [
          operatorId,
          hash,
          now,
          row.revision_state,
          input.decision,
          input.holdReason ?? null,
        ])
      ).result;
      if (result !== "done" && result !== "unchanged") {
        if (
          [
            "unauthenticated",
            "not_found",
            "version_conflict",
            "invalid_state",
            "payment_account_missing",
            "identity_change_pending",
          ].includes(result)
        )
          throw new ApiError(result as ErrorCode);
        throw new Error("unexpected license review result");
      }
      if (result === "done" && input.decision === "on_hold") {
        // A33: 대상은 실제 가게 ID, 이벤트는 같은 판정 상태/운영자/시각/이유의 지문이다.
        const decision = JSON.stringify([
          r.scope.shopId,
          row.revision_state,
          operatorId,
          now.toISOString(),
          input.holdReason,
        ]);
        const event = toHex(
          new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(decision))),
        ).slice(0, 24);
        const task = await insertOnce(
          db,
          "owner_tasks",
          "INSERT INTO owner_tasks (shop_id, event_key, kind, detail, opened_at) VALUES ($1, $2, 'license_on_hold', $3, $4) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id",
          [eventKeys.task(`license_on_hold_${event}`, r.scope.shopId), { reason: input.holdReason }, now],
        );
        await insertOnce(
          db,
          "owner_alerts",
          "INSERT INTO owner_alerts (shop_id, event_key, owner_task_id, kind, next_attempt_at, created_at) VALUES ($1, $2, $3, 'license_on_hold', $4, $4) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id",
          [eventKeys.alert("license_on_hold", task.id), task.id, now],
        );
      }
      return {
        status: 200,
        code: result,
        ref: { shopId: r.scope.shopId },
        body: { outcome: result, shop: await render(db, r.services, r.req.url, await current(db, false), duplicates) },
      };
    },
    async render(db, stored) {
      return {
        outcome: stored.code,
        shop: await render(db, r.services, r.req.url, await current(db, false), duplicates),
      };
    },
  });
}
