/** 운영자에게 계좌 원문/손님 기록 없이 사업자 변경과 현재 계좌 끝4자리만 보여 준다. */
import { reviewRevision } from "./license-review-state";
import type { Services } from "./services";
import type { ShopDb } from "./shop-scope";
import { toShopIso } from "./time";

export interface IdentityReviewRow {
  id: string;
  shop_id: string;
  status: "pending" | "applied" | "on_hold";
  business_name: string;
  representative_name: string;
  business_reg_no: string;
  prev_business_name: string;
  prev_representative_name: string;
  prev_business_reg_no: string;
  evidence_photo_key: string;
  hold_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  requested_at: Date;
  identity_version: string;
  shop_name: string;
  license_status: string;
  time_zone: string;
  current_business_name: string;
  current_representative_name: string;
  current_business_reg_no: string;
  account_id: string | null;
  account_version: string | null;
  bank_name: string | null;
  holder_name: string | null;
  account_last4: string | null;
  reviewer_name: string | null;
  cursor_at?: string;
}
export function identityReviewRevision(row: IdentityReviewRow): Promise<string> {
  return reviewRevision({
    revision_state: JSON.stringify([
      row.id,
      row.identity_version,
      row.current_business_name,
      row.current_representative_name,
      row.current_business_reg_no,
      row.account_id,
      row.account_version,
    ]),
    review_marker: JSON.stringify([row.reviewed_by, row.reviewed_at?.toISOString() ?? null]),
  });
}
/** 호출자는 먼저 가게 행을 잠가 계좌/신원 변경의 요청 사이 순서를 고정한다. */
export async function readIdentityReview(db: ShopDb, id: string | null): Promise<IdentityReviewRow | undefined> {
  return (
    await db.run<IdentityReviewRow>(
      `SELECT i.*,i.xmin::text AS identity_version,s.name AS shop_name,s.license_status,s.time_zone,
    s.business_name AS current_business_name,s.representative_name AS current_representative_name,s.business_reg_no AS current_business_reg_no,
    p.id AS account_id,p.xmin::text AS account_version,p.bank_name,p.holder_name,p.account_last4,o.display_name AS reviewer_name
    FROM shop_identity_changes i JOIN shops s ON s.id=$1
    LEFT JOIN payment_accounts p ON p.shop_id=$1 AND p.retired_at IS NULL
    LEFT JOIN operators o ON o.id=i.reviewed_by
    WHERE i.shop_id=$1 AND (($2::uuid IS NOT NULL AND i.id=$2) OR ($2::uuid IS NULL AND i.status='pending'))`,
      [id],
    )
  ).rows[0];
}
export async function renderIdentityReview(row: IdentityReviewRow, services: Services, origin: string) {
  if (row.reviewed_by !== null && row.reviewer_name === null) throw new Error("reviewer missing");
  return {
    changeId: row.id,
    shop: { shopId: row.shop_id, name: row.shop_name, licenseStatus: row.license_status },
    status: row.status,
    businessName: row.business_name,
    representativeName: row.representative_name,
    businessRegNo: row.business_reg_no,
    previous: {
      businessName: row.prev_business_name,
      representativeName: row.prev_representative_name,
      businessRegNo: row.prev_business_reg_no,
    },
    evidencePhotoUrl: await services.fileUrls().sign(row.evidence_photo_key, origin, services.now()),
    paymentAccount:
      row.account_id === null
        ? null
        : {
            bankName: row.bank_name,
            holderName: row.holder_name,
            accountLast4: row.account_last4,
            holderMatchesNew: row.holder_name === row.business_name || row.holder_name === row.representative_name,
          },
    holdReason: row.hold_reason,
    requestedAt: toShopIso(row.requested_at, row.time_zone),
    reviewedAt: row.reviewed_at === null ? null : toShopIso(row.reviewed_at, row.time_zone),
    reviewedBy: row.reviewed_by === null ? null : { operatorId: row.reviewed_by, displayName: row.reviewer_name },
    revision: await identityReviewRevision(row),
  };
}
