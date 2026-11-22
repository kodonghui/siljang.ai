/** API-011: 보류 증빙을 다시 받고 판정 이력/할 일은 전용 함수로 함께 정리한다. */
import { requireJson } from "./body";
import { parseLicenseResubmission } from "./license-resubmission-input";
import { tokenHash } from "./operator-session";
import { OWNER_COOKIE, readCookie } from "./owner-oauth";
import { ownerOfShopScope } from "./owner-scope";
import { ApiError } from "./problem";
import type { ShopRequest } from "./routes";
import { ForgedScopeError } from "./shop-scope";
import { renderShop } from "./shops";
import { checkLicensePhoto, discardUpload, permanentKey, promoteUpload, type TakenUpload } from "./uploads";

export async function resubmitLicense(r: ShopRequest): Promise<Response> {
  if (r.scope.via.kind !== "owner") throw new ForgedScopeError("owner required");
  requireJson(r.req.raw);
  const raw = await r.body(),
    input = parseLicenseResubmission(raw),
    origin = new URL(r.req.url).origin;
  const ownerId = r.scope.via.ownerId,
    token = readCookie(r.req.header("cookie"), OWNER_COOKIE);
  if (token === null) throw new ApiError("unauthenticated");
  const hash = await tokenHash(token);
  let copied: string | undefined, consumed: TakenUpload | undefined;
  const response = await r.command({
    command: "API-011",
    pathIds: [],
    body: raw,
    async execute(db) {
      const current = await db.found<{ revision: string; license_status: string }>(
        "SELECT s.xmin::text AS revision,s.license_status FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE",
      );
      if (current.revision !== input.baseRevision) throw new ApiError("version_conflict");
      if (current.license_status !== "on_hold") throw new ApiError("invalid_state");
      const now = r.services.now(),
        store = r.services.storage();
      const upload = await checkLicensePhoto(
        store,
        ownerOfShopScope(r.scope),
        input.licensePhotoUploadId,
        "/licensePhotoUploadId",
        now,
      );
      const version = crypto.randomUUID(),
        key = permanentKey(r.scope.shopId, "license_photo", upload.uploadId, version);
      copied = key;
      await promoteUpload(store, upload, r.scope.shopId, version);
      const result = await db.found<{ outcome: string }>(
        "SELECT resubmit_shop_license($1,$2,$3,$4,$5,$6,$7,$8) AS outcome",
        [ownerId, hash, now, input.baseRevision, input.foodLicenseNo, input.foodBusinessType, key],
      );
      if (result.outcome !== "done") {
        if (result.outcome === "not_found") throw new ApiError("shop_not_registered");
        if (["unauthenticated", "version_conflict", "invalid_state"].includes(result.outcome))
          throw new ApiError(result.outcome as "unauthenticated" | "version_conflict" | "invalid_state");
        throw new Error("unexpected license resubmission result");
      }
      consumed = upload;
      return {
        status: 200,
        code: "done",
        ref: {},
        body: { outcome: "done", shop: await renderShop(db, r.services, origin) },
      };
    },
    async render(db, stored) {
      return { outcome: stored.code, shop: await renderShop(db, r.services, origin) };
    },
    async cleanup(db) {
      if (!copied) return;
      const current = await db.found<{ license_photo_key: string }>(
        "SELECT s.license_photo_key FROM shops s WHERE s.id=$1",
      );
      if (current.license_photo_key !== copied) await r.services.storage().delete(copied);
    },
  });
  if (consumed) await discardUpload(r.services.storage(), consumed);
  return response;
}
