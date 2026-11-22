/** API-080/SPEC-078. 운영자가 정하기 전 가게의 사업자 정보는 바꾸지 않는다. */
import { requireJson } from "./body";
import { parseIdentityChange } from "./identity-change-input";
import { ownerOfShopScope } from "./owner-scope";
import { ApiError, fieldError } from "./problem";
import type { ShopRequest } from "./routes";
import { renderShop } from "./shops";
import { checkUploads, discardUpload, permanentKey, promoteUpload, type TakenUpload, UPLOAD_RULES } from "./uploads";

export async function requestIdentityChange(r: ShopRequest): Promise<Response> {
  requireJson(r.req.raw);
  const raw = await r.body(),
    input = parseIdentityChange(raw),
    now = r.services.now(),
    origin = new URL(r.req.url).origin;
  let copied: string | undefined, consumed: TakenUpload | undefined, response: Response;
  try {
    response = await r.command({
      command: "API-080",
      pathIds: [],
      body: raw,
      async execute(db) {
        const row = await db.found<{
          business_name: string;
          representative_name: string;
          business_reg_no: string;
          revision: string;
        }>(
          "SELECT s.business_name,s.representative_name,s.business_reg_no,s.xmin::text AS revision FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE",
        );
        if (row.revision !== input.baseRevision) throw new ApiError("version_conflict");
        const pending = await db.run("SELECT id FROM shop_identity_changes WHERE shop_id=$1 AND status='pending'");
        if (pending.rowCount > 0) throw new ApiError("identity_change_pending");
        if (
          row.business_name === input.businessName &&
          row.representative_name === input.representativeName &&
          row.business_reg_no === input.businessRegNo
        )
          return {
            status: 200,
            code: "unchanged",
            ref: {},
            body: { outcome: "unchanged", shop: await renderShop(db, r.services, origin) },
          };
        const upload = (
          await checkUploads(
            r.services.storage(),
            ownerOfShopScope(r.scope),
            [{ id: input.evidencePhotoUploadId, field: "/evidencePhotoUploadId", purpose: "license_photo" }],
            now,
          )
        )[0];
        if (
          !upload ||
          upload.byteSize > UPLOAD_RULES.license_photo.maxBytes ||
          !UPLOAD_RULES.license_photo.types.includes(upload.contentType)
        )
          throw fieldError("/evidencePhotoUploadId", "upload_not_found");
        const id = crypto.randomUUID(),
          key = permanentKey(r.scope.shopId, "license_photo", upload.uploadId, id);
        copied = key;
        await promoteUpload(r.services.storage(), upload, r.scope.shopId, id);
        await db.run(
          "INSERT INTO shop_identity_changes (shop_id,id,business_name,representative_name,business_reg_no,prev_business_name,prev_representative_name,prev_business_reg_no,evidence_photo_key,requested_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            id,
            input.businessName,
            input.representativeName,
            input.businessRegNo,
            row.business_name,
            row.representative_name,
            row.business_reg_no,
            key,
            now,
          ],
        );
        consumed = upload;
        return {
          status: 201,
          code: "done",
          ref: { changeId: id },
          body: { outcome: "done", shop: await renderShop(db, r.services, origin) },
        };
      },
      async render(db, stored) {
        return { outcome: stored.code, shop: await renderShop(db, r.services, origin) };
      },
    });
  } catch (error) {
    if (copied)
      try {
        const used = await r.db.found<{ used: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM shop_identity_changes WHERE shop_id=$1 AND evidence_photo_key=$2) AS used",
          [copied],
        );
        if (!used.used) await r.services.storage().delete(copied);
      } catch {
        r.log("warn", { event: "identity_evidence_cleanup_failed", traceId: r.traceId });
      }
    throw error;
  }
  if (consumed) await discardUpload(r.services.storage(), consumed);
  return response;
}
