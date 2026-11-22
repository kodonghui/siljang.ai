/** 결제 계좌(API-024/025). 같은 가게의 옛 계좌·기존 결제 안내는 보존한다. */
import { openAccountNumber, sealAccountNumber } from "./account-number";
import { requireJson } from "./body";
import { eventKeys, insertOnce } from "./event-keys";
import { parsePaymentDestination } from "./payment-destination-input";
import { ApiError } from "./problem";
import type { ShopRequest } from "./routes";
import type { Services } from "./services";
import type { ShopDb } from "./shop-scope";
import { toShopIso } from "./time";

interface AccountRow {
  id: string;
  bank_name: string;
  account_number_enc: string;
  holder_name: string;
  holder_mismatch_confirmed: boolean | null;
  holder_checked_by: string | null;
  holder_checked_at: Date | null;
  card_payment_url: string | null;
  created_at: Date;
  revision: string;
}

async function current(db: ShopDb): Promise<AccountRow | undefined> {
  return (
    await db.run<AccountRow>(
      "SELECT p.*,p.xmin::text AS revision FROM payment_accounts p WHERE p.shop_id=$1 AND p.retired_at IS NULL",
    )
  ).rows[0];
}

async function render(db: ShopDb, services: Services, row: AccountRow) {
  const zone = (await db.found<{ time_zone: string }>("SELECT s.time_zone FROM shops s WHERE s.id=$1")).time_zone;
  return {
    bankName: row.bank_name,
    accountNumber: await openAccountNumber(
      services.fieldCrypto(),
      row.account_number_enc,
      "payment_accounts.account_number",
      db.scope.shopId,
    ),
    holderName: row.holder_name,
    holderMismatchConfirmed: row.holder_mismatch_confirmed,
    cardPaymentUrl: row.card_payment_url,
    createdAt: toShopIso(row.created_at, zone),
    revision: row.revision,
  };
}

export async function getPaymentDestination(r: ShopRequest): Promise<Response> {
  const value = await r.db.transaction(async (db) => {
    const row = await current(db);
    if (!row) throw new ApiError("not_set");
    return render(db, r.services, row);
  });
  return r.json(value);
}

export async function setPaymentDestination(r: ShopRequest): Promise<Response> {
  requireJson(r.req.raw);
  const raw = await r.body();
  const input = parsePaymentDestination(raw);
  const now = r.services.now();
  return r.command({
    command: "API-025",
    pathIds: [],
    body: raw,
    async execute(db) {
      const shop = await db.found<{
        business_name: string;
        representative_name: string;
        license_status: string;
        license_reviewed_at: Date | null;
      }>(
        "SELECT s.business_name,s.representative_name,s.license_status,s.license_reviewed_at FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE",
      );
      const previous = await current(db);
      if (input.baseRevision !== (previous?.revision ?? null)) throw new ApiError("version_conflict");
      if (previous) {
        const old = await render(db, r.services, previous);
        if (
          old.bankName === input.bankName &&
          old.accountNumber === input.accountNumber &&
          old.holderName === input.holderName &&
          old.cardPaymentUrl === input.cardPaymentUrl
        )
          return {
            status: 200,
            code: "unchanged",
            ref: { paymentAccountId: previous.id },
            body: { outcome: "unchanged", paymentDestination: old },
          };
      }
      const matchesIdentity = input.holderName === shop.business_name || input.holderName === shop.representative_name;
      // 지금 영업 신고의 검토 이후 운영자가 확인한 이름도 허용한다. 서버 역할은 확인 이력을 새로 만들지 않는다.
      const checked =
        shop.license_status === "verified"
          ? (
              await db.run(
                "SELECT p.id FROM payment_accounts p WHERE p.shop_id=$1 AND p.holder_name=$2 AND p.holder_checked_at >= $3 LIMIT 1",
                [input.holderName, shop.license_reviewed_at],
              )
            ).rows[0]
          : undefined;
      const matchesChecked = checked !== undefined;
      if (shop.license_status === "verified" && !matchesIdentity && !matchesChecked)
        throw new ApiError("holder_not_verified");
      if (!matchesIdentity && !matchesChecked && !input.confirm.includes("holder_mismatch"))
        throw new ApiError("confirmation_required", { confirm: [{ kind: "holder_mismatch" }] });
      const account = await sealAccountNumber(
        r.services.fieldCrypto(),
        input.accountNumber,
        "payment_accounts.account_number",
        db.scope.shopId,
      );
      if (previous)
        await db.run("UPDATE payment_accounts SET retired_at=$3 WHERE shop_id=$1 AND id=$2", [previous.id, now]);
      const row = await db.found<AccountRow>(
        `INSERT INTO payment_accounts (shop_id,bank_name,account_number_enc,account_last4,holder_name,holder_mismatch_confirmed,card_payment_url,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *,xmin::text AS revision`,
        [
          input.bankName,
          account.enc,
          account.last4,
          input.holderName,
          matchesIdentity
            ? null
            : input.confirm.includes("holder_mismatch") ||
                (previous?.holder_name === input.holderName && previous.holder_mismatch_confirmed === true)
              ? true
              : null,
          input.cardPaymentUrl,
          now,
        ],
      );
      // 보류 해제는 새 계좌의 INSERT 트리거가 하며 서버 역할에 일반 승인 권한을 주지 않는다.
      if (previous)
        await insertOnce(
          db,
          "owner_alerts",
          `INSERT INTO owner_alerts (shop_id, event_key, kind, next_attempt_at, created_at)
         VALUES ($1, $2, 'payment_account_changed', $3, $3) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
          [eventKeys.alert("payment_account_changed", row.id), now],
        );
      return {
        status: 200,
        code: "created",
        ref: { paymentAccountId: row.id },
        body: { outcome: "created", paymentDestination: await render(db, r.services, row) },
      };
    },
    async render(db, stored) {
      const row = await db.found<AccountRow>(
        "SELECT p.*,p.xmin::text AS revision FROM payment_accounts p WHERE p.shop_id=$1 AND p.id=$2",
        [stored.ref.paymentAccountId],
      );
      return { outcome: stored.code, paymentDestination: await render(db, r.services, row) };
    },
  });
}
