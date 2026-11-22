/** 가게가 생기기 전의 사장님 전용 등록 기능(API-008). 날 SQL은 이 파일 밖으로 전달하지 않는다. */
import type { Queryable } from "./db";
import { isOwnerScope, type OwnerScope } from "./owner-scope";
import { ApiError } from "./problem";
import type { ShopRegistration } from "./shop-input";
import { createShopScope, ForgedScopeError, type ShopDb, shopDb } from "./shop-scope";

export interface OwnerShopDb {
  /** 같은 사장님의 서로 다른 요청 키도 차례로 등록한다. */
  lock(): Promise<void>;
  /** 사장님 소유가 확인된 뒤 기존 가게 범위로만 읽는다. */
  find(): Promise<ShopDb | null>;
  insert(id: string, input: ShopRegistration, photoKey: string, now: Date): Promise<ShopDb>;
}

export function ownerShopDb(tx: Queryable, owner: OwnerScope): OwnerShopDb {
  if (!isOwnerScope(owner)) throw new ForgedScopeError("owner scope is not genuine");
  let locked = false;
  const scoped = (id: string) => shopDb(createShopScope(id, { kind: "owner", ownerId: owner.ownerId }), tx);
  return {
    async lock() {
      const result = await tx.query("SELECT id FROM owners WHERE id = $1 FOR UPDATE", [owner.ownerId]);
      if (result.rowCount !== 1) throw new ApiError("unauthenticated");
      locked = true;
    },
    async find() {
      const result = await tx.query<{ id: string }>("SELECT id FROM shops WHERE owner_id = $1", [owner.ownerId]);
      const row = result.rows[0];
      return row === undefined ? null : scoped(row.id);
    },
    async insert(id, input, photoKey, now) {
      if (!locked) throw new TypeError("owner must be locked before registration");
      await tx.query(
        `INSERT INTO shops (id, owner_id, name, contact_phone, business_address, contact_email, business_name,
          representative_name, business_reg_no, mail_order_reg_no, mail_order_authority, mail_order_exemption,
          food_license_no, food_business_type, license_photo_key, entrustment_terms_version, entrustment_consented_at,
          created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17, $17)`,
        [
          id,
          owner.ownerId,
          input.name,
          input.contactPhone,
          input.businessAddress,
          input.contactEmail,
          input.businessName,
          input.representativeName,
          input.businessRegNo,
          input.mailOrderRegNo,
          input.mailOrderAuthority,
          input.mailOrderExemption,
          input.foodLicenseNo,
          input.foodBusinessType,
          photoKey,
          input.entrustmentTermsVersion,
          now,
        ],
      );
      return scoped(id);
    },
  };
}
