/** 인증된 운영자의 등록 목록·중복 표시만 읽는다. 날 연결/임의 SQL은 처리기에 주지 않는다(TASK-034). */
import type { Queryable } from "./db";
import type { IdentityChangeListInput } from "./identity-change-input";
import type { IdentityReviewRow } from "./identity-change-view";
import type { ReviewListInput } from "./license-review-input";
import type { ReviewSummaryRow } from "./license-review-state";
import { isOperatorScope, type OperatorScope } from "./operator-scope";
import { ForgedScopeError, isShopScope, type ShopScope } from "./shop-scope";

export interface OperatorShopDirectory {
  list(input: ReviewListInput): Promise<readonly ReviewSummaryRow[]>;
  duplicates(): Promise<readonly { shopId: string; name: string; licenseStatus: string }[]>;
  listIdentityChanges(input: IdentityChangeListInput): Promise<readonly IdentityReviewRow[]>;
}

export function operatorShopDirectory(db: Queryable, scope: OperatorScope | ShopScope): OperatorShopDirectory {
  const operator = isOperatorScope(scope);
  const shop = isShopScope(scope) && scope.via.kind === "operator" ? scope : null;
  if (!operator && shop === null) throw new ForgedScopeError("operator directory requires genuine operator scope");
  return {
    async listIdentityChanges(input) {
      if (!operator) throw new ForgedScopeError("shop scope cannot enumerate identity changes");
      return (
        await db.query<IdentityReviewRow>(
          `SELECT i.*,i.xmin::text AS identity_version,s.name AS shop_name,s.license_status,s.time_zone,
        s.business_name AS current_business_name,s.representative_name AS current_representative_name,s.business_reg_no AS current_business_reg_no,
        p.id AS account_id,p.xmin::text AS account_version,p.bank_name,p.holder_name,p.account_last4,o.display_name AS reviewer_name,
        to_char(i.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
        FROM shop_identity_changes i JOIN shops s ON s.id=i.shop_id
        LEFT JOIN payment_accounts p ON p.shop_id=i.shop_id AND p.retired_at IS NULL
        LEFT JOIN operators o ON o.id=i.reviewed_by
        WHERE i.status=$1 AND ($2::timestamptz IS NULL OR (i.requested_at,i.id)>($2::timestamptz,$3::uuid))
        ORDER BY i.requested_at,i.id LIMIT $4`,
          [input.status, input.after?.at ?? null, input.after?.id ?? null, input.limit + 1],
        )
      ).rows;
    },
    async list(input) {
      if (!operator) throw new ForgedScopeError("shop scope cannot enumerate shops");
      return (
        await db.query<ReviewSummaryRow>(
          `SELECT s.id,s.name,s.business_name,s.representative_name,s.business_reg_no,s.food_license_no,s.food_business_type,s.license_status,s.created_at,s.time_zone,
          to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
          EXISTS(SELECT 1 FROM shops d WHERE d.business_reg_no=s.business_reg_no AND d.id<>s.id) AS duplicate,
          concat(s.id,':',s.xmin::text,':',coalesce((SELECT concat(p.id,':',p.xmin::text) FROM payment_accounts p WHERE p.shop_id=s.id AND p.retired_at IS NULL),'-'),':',coalesce((SELECT concat(i.id,':',i.xmin::text) FROM shop_identity_changes i WHERE i.shop_id=s.id AND i.status='pending'),'-')) AS revision_state,
          concat(s.license_reviewed_by,':',extract(epoch FROM s.license_reviewed_at)) AS review_marker
         FROM shops s WHERE s.license_status=$1 AND ($2::timestamptz IS NULL OR (s.created_at,s.id)>($2::timestamptz,$3::uuid))
         ORDER BY s.created_at,s.id LIMIT $4`,
          [input.status, input.after?.at ?? null, input.after?.id ?? null, input.limit + 1],
        )
      ).rows;
    },
    async duplicates() {
      if (shop === null) throw new ForgedScopeError("duplicate lookup requires one operator shop scope");
      return (
        await db.query<{ shopId: string; name: string; licenseStatus: string }>(
          `SELECT d.id AS "shopId",d.name,d.license_status AS "licenseStatus" FROM shops d
         JOIN shops s ON s.business_reg_no=d.business_reg_no WHERE s.id=$1 AND d.id<>s.id ORDER BY d.created_at,d.id LIMIT 20`,
          [shop.shopId],
        )
      ).rows;
    },
  };
}
