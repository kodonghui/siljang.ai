/** 가게 등록/조회(API-008·009). 등록 전 쓰기는 사장님 전용 기능, 읽기는 가게 범위만 사용한다. */
import { ApiError, fieldError } from "./problem";
import type { OwnerRequest, ShopRequest } from "./routes";
import type { Services } from "./services";
import { parseShopRegistration } from "./shop-input";
import type { ShopDb } from "./shop-scope";
import { toShopIso } from "./time";
import { checkUploads, discardUpload, permanentKey, promoteUpload, type TakenUpload, UPLOAD_RULES } from "./uploads";

interface ShopRow {
  id: string;
  name: string;
  contact_phone: string;
  contact_email: string;
  business_address: string;
  pickup_address: string | null;
  business_name: string;
  representative_name: string;
  business_reg_no: string;
  mail_order_reg_no: string | null;
  mail_order_authority: string | null;
  mail_order_exemption: string | null;
  food_license_no: string;
  food_business_type: "instant_sale_manufacturing" | "bakery";
  license_photo_key: string;
  license_status: string;
  license_hold_reason: string | null;
  entrustment_terms_version: string;
  entrustment_consented_at: Date;
  time_zone: string;
  completion_photo_enabled: boolean;
  idle_close_hours: number;
  owner_wait_minutes: number;
  daily_ai_cost_limit_krw: number;
  awaiting_payment_limit: number;
  booking_slug: string | null;
  created_at: Date;
  updated_at: Date;
  revision: string;
}

interface IdentityRow {
  id: string;
  status: string;
  business_name: string;
  representative_name: string;
  business_reg_no: string;
  prev_business_name: string;
  prev_representative_name: string;
  prev_business_reg_no: string;
  evidence_photo_key: string;
  hold_reason: string | null;
  requested_at: Date;
  reviewed_at: Date | null;
}

export async function renderShop(db: ShopDb, services: Services, origin: string): Promise<Record<string, unknown>> {
  const row = await db.found<ShopRow>("SELECT s.*, s.xmin::text AS revision FROM shops s WHERE s.id = $1");
  const changes = await db.run<IdentityRow>(
    "SELECT c.* FROM shop_identity_changes c WHERE c.shop_id = $1 ORDER BY c.requested_at DESC, c.id DESC LIMIT 1",
  );
  const change = changes.rows[0];
  const now = services.now();
  const urls = services.fileUrls();
  const iso = (date: Date) => toShopIso(date, row.time_zone);
  return {
    shopId: row.id,
    name: row.name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    businessAddress: row.business_address,
    pickupAddress: row.pickup_address,
    businessName: row.business_name,
    representativeName: row.representative_name,
    businessRegNo: row.business_reg_no,
    mailOrderRegNo: row.mail_order_reg_no,
    mailOrderAuthority: row.mail_order_authority,
    mailOrderExemption: row.mail_order_exemption,
    foodLicenseNo: row.food_license_no,
    foodBusinessType: row.food_business_type,
    licenseStatus: row.license_status,
    licenseHoldReason: row.license_hold_reason,
    licensePhotoUrl: await urls.sign(row.license_photo_key, origin, now),
    entrustmentTermsVersion: row.entrustment_terms_version,
    entrustmentConsentedAt: iso(row.entrustment_consented_at),
    timeZone: row.time_zone,
    completionPhotoEnabled: row.completion_photo_enabled,
    idleCloseHours: row.idle_close_hours,
    ownerWaitMinutes: row.owner_wait_minutes,
    dailyAiCostLimitKrw: row.daily_ai_cost_limit_krw,
    awaitingPaymentLimit: row.awaiting_payment_limit,
    bookingUrl: row.booking_slug === null ? null : new URL(`/s/${row.booking_slug}`, origin).href,
    identityChange:
      change === undefined
        ? null
        : {
            changeId: change.id,
            status: change.status,
            businessName: change.business_name,
            representativeName: change.representative_name,
            businessRegNo: change.business_reg_no,
            previous: {
              businessName: change.prev_business_name,
              representativeName: change.prev_representative_name,
              businessRegNo: change.prev_business_reg_no,
            },
            evidencePhotoUrl: await urls.sign(change.evidence_photo_key, origin, now),
            holdReason: change.hold_reason,
            requestedAt: iso(change.requested_at),
            reviewedAt: change.reviewed_at === null ? null : iso(change.reviewed_at),
          },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    revision: row.revision,
  };
}

export async function registerShop(r: OwnerRequest): Promise<Response> {
  const raw = await r.body();
  const input = parseShopRegistration(raw);
  const origin = new URL(r.req.url).origin;
  const now = r.services.now();
  let copied: { key: string; upload: TakenUpload } | undefined;
  const response = await r.command({
    command: "API-008",
    body: raw,
    async execute(db) {
      await db.lock();
      if (await db.find()) throw new ApiError("already_registered");
      const store = r.services.storage();
      const uploads = await checkUploads(
        store,
        r.owner,
        [{ id: input.licensePhotoUploadId, field: "/licensePhotoUploadId", purpose: "license_photo" }],
        now,
      );
      const upload = uploads[0];
      if (
        !upload ||
        upload.byteSize > UPLOAD_RULES.license_photo.maxBytes ||
        !UPLOAD_RULES.license_photo.types.includes(upload.contentType)
      )
        throw fieldError("/licensePhotoUploadId", "upload_not_found");
      const id = crypto.randomUUID();
      const key = permanentKey(id, "license_photo", upload.uploadId);
      // 복사 응답을 잃어도 실제 객체가 생겼을 수 있어 정리 후보를 먼저 기록한다.
      copied = { key, upload };
      await promoteUpload(store, upload, id);
      const shop = await db.insert(id, input, key, now);
      const body = await renderShop(shop, r.services, origin);
      return { status: 201, code: "registered", ref: { shopId: id }, body };
    },
    async render(db, stored) {
      const shop = await db.find();
      if (!shop) throw new ApiError("not_found");
      const result = await renderShop(shop, r.services, origin);
      if (result.shopId !== stored.ref.shopId) throw new ApiError("not_found");
      return result;
    },
    async cleanup(db) {
      if (!copied) return;
      // COMMIT의 응답만 잃은 경우에는 등록된 신고증을 지우지 않는다. 조회도 안 되면 보존하고 경고만 남긴다.
      const shop = await db.find();
      if (shop) {
        const saved = await shop.found<{ license_photo_key: string }>(
          "SELECT s.license_photo_key FROM shops s WHERE s.id = $1",
        );
        if (saved.license_photo_key === copied.key) return;
      }
      await r.services.storage().delete(copied.key);
    },
  });
  if (copied) await discardUpload(r.services.storage(), copied.upload);
  return response;
}

export async function getShop(r: ShopRequest): Promise<Response> {
  const body = await r.db.transaction((tx) => renderShop(tx, r.services, new URL(r.req.url).origin));
  return r.json(body);
}
