/** 사진은 수신에 묶인 암호문에서만 읽고 G10 정리 뒤 저장합니다. 이 경로에는 AI가 없습니다. */
import { FieldCryptoError } from "./field-crypto";
import { SKILL_CALLBACK_MS } from "./kakao-callback";
import type { KakaoCallbackClaim } from "./kakao-callback-store";
import {
  decodeKakaoPhotoContext,
  encodeKakaoPhotoContext,
  isKakaoPhotoTrace,
  KAKAO_PHOTO_PURPOSE,
  KAKAO_PHOTO_TEXT,
  type KakaoPhotoContext,
  type KakaoPhotoOutcome,
  kakaoPhotoTrace,
} from "./kakao-photo-context";
import { downloadKakaoPhoto } from "./kakao-photo-download";
import { saveKakaoReview } from "./kakao-review";
import { referencePhotoRoom } from "./photo-count";
import type { NormalizedPhoto } from "./photo-normalizer";
import type { Services } from "./services";
import type { ShopDb, ShopRequestDb } from "./shop-scope";

export interface KakaoPhotoReply {
  readonly id: string;
  readonly text: string;
  readonly outcome: KakaoPhotoOutcome;
  readonly delivered: boolean;
}
export type KakaoPhotoTurn =
  | { readonly kind: "not_photo" }
  | { readonly kind: "gone" }
  | { readonly kind: "reply"; readonly reply: KakaoPhotoReply; readonly callbackUrl?: string };

export async function storeKakaoPhotoContext(
  db: ShopDb,
  messageId: string,
  context: KakaoPhotoContext,
  services: Services,
  receivedAt: Date,
): Promise<string> {
  const envelope = await services.fieldCrypto().seal(encodeKakaoPhotoContext(context, receivedAt), {
    purpose: KAKAO_PHOTO_PURPOSE,
    shopId: db.scope.shopId,
    recordId: messageId,
  });
  const saved = await db.run(
    `UPDATE messages SET kakao_callback_enc=$3,kakao_callback_deadline_at=$4,trace_id=$5,body_masked='[사진 확인 중]'
      WHERE shop_id=$1 AND id=$2 AND direction='inbound' AND kind='text' AND kakao_callback_enc IS NULL`,
    [messageId, envelope, new Date(receivedAt.getTime() + SKILL_CALLBACK_MS), kakaoPhotoTrace(messageId, context.kind)],
  );
  if (saved.rowCount !== 1) throw new Error("photo source unavailable");
  return envelope;
}

async function ownedPhoto(tx: ShopDb, messageId: string, claim: KakaoCallbackClaim): Promise<boolean> {
  await tx.run("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [claim.customer_id]);
  const c = await tx.run<{ status: string }>(
    "SELECT status FROM consultations WHERE shop_id=$1 AND id=$2 AND customer_id=$3 FOR UPDATE",
    [claim.consultation_id, claim.customer_id],
  );
  const m = await tx.run(
    `SELECT id FROM messages WHERE shop_id=$1 AND id=$2 AND consultation_id=$3 AND trace_id IN ($4,$5)
      AND kakao_callback_enc=$6 AND kakao_callback_claim_until=$7 FOR UPDATE`,
    [
      messageId,
      claim.consultation_id,
      kakaoPhotoTrace(messageId),
      kakaoPhotoTrace(messageId, "review"),
      claim.kakao_callback_enc,
      claim.kakao_callback_claim_until,
    ],
  );
  return m.rowCount === 1 && c.rows[0] !== undefined && c.rows[0].status !== "deleted";
}

async function previousReply(
  tx: ShopDb,
  messageId: string,
  consultationId: string,
): Promise<KakaoPhotoReply | undefined> {
  const row = (
    await tx.run<{ id: string; body_masked: string; delivery: string }>(
      `SELECT id,body_masked,delivery FROM messages WHERE shop_id=$1 AND consultation_id=$2 AND trace_id=$3
      AND direction='outbound' AND author='system' AND kind='photo' ORDER BY created_at,id LIMIT 1`,
      [consultationId, messageId],
    )
  ).rows[0];
  if (row === undefined) return;
  const outcome = (Object.keys(KAKAO_PHOTO_TEXT) as KakaoPhotoOutcome[]).find(
    (key) => KAKAO_PHOTO_TEXT[key] === row.body_masked,
  );
  if (outcome === undefined) throw new Error("photo result unavailable");
  return { id: row.id, text: row.body_masked, outcome, delivered: row.delivery !== "deferred" };
}

async function saveOutcome(
  tx: ShopDb,
  messageId: string,
  claim: KakaoCallbackClaim,
  outcome: KakaoPhotoOutcome,
  now: Date,
): Promise<KakaoPhotoReply> {
  const prior = await previousReply(tx, messageId, claim.consultation_id);
  if (prior !== undefined) return prior;
  const text = KAKAO_PHOTO_TEXT[outcome];
  const row = await tx.found<{ id: string }>(
    `INSERT INTO messages(shop_id,consultation_id,direction,author,kind,body_masked,trace_id,delivery,created_at)
      VALUES($1,$2,'outbound','system','photo',$3,$4,'deferred',$5) RETURNING id`,
    [claim.consultation_id, text, messageId, now],
  );
  return { id: row.id, text, outcome, delivered: false };
}

export async function runKakaoPhotoTurn(
  db: ShopRequestDb,
  messageId: string,
  claim: KakaoCallbackClaim,
  services: Services,
  now: () => Date,
  options: { readonly fetch?: typeof fetch; readonly budgetMs?: number } = {},
): Promise<KakaoPhotoTurn> {
  const source = await db.run<{ trace_id: string | null }>("SELECT trace_id FROM messages WHERE shop_id=$1 AND id=$2", [
    messageId,
  ]);
  if (!isKakaoPhotoTrace(source.rows[0]?.trace_id, messageId)) return { kind: "not_photo" };
  const started = performance.now();
  const remaining = () =>
    Math.min(
      claim.kakao_callback_deadline_at.getTime() - now().getTime(),
      options.budgetMs === undefined ? Infinity : options.budgetMs - (performance.now() - started),
    );
  let context: KakaoPhotoContext | undefined;
  try {
    context = decodeKakaoPhotoContext(
      await services.fieldCrypto().open(claim.kakao_callback_enc, {
        purpose: KAKAO_PHOTO_PURPOSE,
        shopId: db.scope.shopId,
        recordId: messageId,
      }),
      claim.created_at,
    );
  } catch (error) {
    if (!(error instanceof FieldCryptoError)) throw error;
  }
  const ready = await db.transaction(async (tx) => {
    if (!(await ownedPhoto(tx, messageId, claim))) return { kind: "gone" } as const;
    const prior = await previousReply(tx, messageId, claim.consultation_id);
    if (prior !== undefined) return { kind: "reply", reply: prior } as const;
    if (context === undefined || remaining() < 100)
      return { kind: "failure", outcome: "photo_download_failed" } as const;
    if (context.kind === "review") {
      const order = await tx.run(
        "SELECT id FROM orders WHERE shop_id=$1 AND id=$2 AND customer_id=$3 AND consultation_id=$4 AND status='received' AND personal_data_purged_at IS NULL FOR UPDATE",
        [context.review.orderId, claim.customer_id, claim.consultation_id],
      );
      return order.rowCount === 1
        ? ({ kind: "ready" } as const)
        : ({ kind: "failure", outcome: "review_not_allowed" } as const);
    }
    const draft = await tx.run(
      "SELECT id FROM order_drafts WHERE shop_id=$1 AND id=$2 AND consultation_id=$3 AND status='active' AND EXISTS(SELECT 1 FROM consultations c WHERE c.shop_id=$1 AND c.id=$3 AND c.status IN ('open','awaiting_owner','ordered')) FOR UPDATE",
      [context.draftId, claim.consultation_id],
    );
    return draft.rowCount === 1 && (await referencePhotoRoom(tx, claim.consultation_id)) >= context.urls.length
      ? ({ kind: "ready" } as const)
      : ({ kind: "failure", outcome: "photo_rejected" } as const);
  });
  const callback = context?.callbackUrl === undefined ? {} : { callbackUrl: context.callbackUrl };
  if (ready.kind === "gone") return ready;
  if (ready.kind === "reply") return { ...ready, ...callback };
  let outcome: KakaoPhotoOutcome =
    ready.kind === "failure" ? ready.outcome : context?.kind === "review" ? "review_saved" : "photo_received";
  const photos: {
    readonly key: string;
    readonly contentType: NormalizedPhoto["contentType"];
    readonly byteSize: number;
    readonly position: number;
  }[] = [];
  if (ready.kind === "ready" && context !== undefined) {
    for (let i = 0; i < context.urls.length; i++) {
      const url = context.urls[i];
      if (url === undefined || remaining() < 100) {
        outcome = "photo_download_failed";
        break;
      }
      const downloaded = await downloadKakaoPhoto(url, services.photos(), {
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        timeoutMs: Math.max(1, Math.min(6000, Math.floor(remaining() / 3))),
        signal: AbortSignal.timeout(Math.max(1, Math.floor(remaining()))),
      });
      if (!downloaded.ok) {
        outcome =
          downloaded.reason === "rejected"
            ? context.kind === "review"
              ? "review_invalid"
              : "photo_rejected"
            : "photo_download_failed";
        break;
      }
      const key = `shops/${db.scope.shopId}/${context.kind}/${messageId}/${i + 1}`;
      const permitted = await db.transaction(async (tx) => {
        if (!(await ownedPhoto(tx, messageId, claim)) || remaining() < 100) return false;
        // 이 기한 전에는 지우기 실행기가 고르지 않는다. 중단된 올리기도 다음 지우기에서 회수한다.
        await tx.run(
          `INSERT INTO file_deletions(shop_id,storage_key,source,queued_at) VALUES($1,$2,$3,$4)
          ON CONFLICT(storage_key) DO NOTHING`,
          [
            key,
            context.kind === "review" ? "review_photo" : "reference_photo",
            new Date(claim.kakao_callback_deadline_at.getTime() + 30_000),
          ],
        );
        return true;
      });
      if (!permitted) {
        outcome = "photo_download_failed";
        break;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      try {
        const uploaded = await Promise.race([
          Promise.resolve()
            .then(() =>
              services
                .storage()
                .put(key, downloaded.photo.bytes, downloaded.photo.contentType, { signal: controller.signal }),
            )
            .then(
              () => true,
              () => false,
            ),
          new Promise<false>((resolve) => {
            timer = setTimeout(
              () => {
                controller.abort();
                resolve(false);
              },
              Math.max(1, Math.min(6000, remaining() - 100)),
            );
          }),
        ]);
        if (!uploaded || remaining() < 50) {
          outcome = "photo_download_failed";
          break;
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
      }
      photos.push({
        key,
        contentType: downloaded.photo.contentType,
        byteSize: downloaded.photo.bytes.byteLength,
        position: i + 1,
      });
    }
  }
  const result = await db.transaction(async (tx) => {
    if (!(await ownedPhoto(tx, messageId, claim))) return null;
    const prior = await previousReply(tx, messageId, claim.consultation_id);
    if (prior !== undefined) return prior;
    if (outcome === "photo_received" && context?.kind === "reference") {
      const draft = await tx.run(
        "SELECT id FROM order_drafts WHERE shop_id=$1 AND id=$2 AND consultation_id=$3 AND status='active' AND EXISTS(SELECT 1 FROM consultations c WHERE c.shop_id=$1 AND c.id=$3 AND c.status IN ('open','awaiting_owner','ordered')) FOR UPDATE",
        [context.draftId, claim.consultation_id],
      );
      if (
        remaining() < 1 ||
        draft.rowCount !== 1 ||
        (await referencePhotoRoom(tx, claim.consultation_id)) < photos.length
      )
        outcome = "photo_rejected";
      else {
        for (const item of photos) {
          await tx.run(
            `INSERT INTO reference_photos(shop_id,draft_id,message_id,position,storage_key,content_type,byte_size,created_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(message_id,position) DO NOTHING`,
            [context.draftId, messageId, item.position, item.key, item.contentType, item.byteSize, claim.created_at],
          );
          await tx.run("DELETE FROM file_deletions WHERE shop_id=$1 AND storage_key=$2 AND attempts=0", [item.key]);
        }
        await tx.run("UPDATE order_drafts SET revision=revision+1,updated_at=$3 WHERE shop_id=$1 AND id=$2", [
          context.draftId,
          now(),
        ]);
      }
    }
    if (outcome === "review_saved" && context?.kind === "review") {
      const order = await tx.run(
        "SELECT id FROM orders WHERE shop_id=$1 AND id=$2 AND customer_id=$3 AND consultation_id=$4 AND status='received' AND personal_data_purged_at IS NULL FOR UPDATE",
        [context.review.orderId, claim.customer_id, claim.consultation_id],
      );
      if (remaining() < 1) outcome = "photo_download_failed";
      else if (order.rowCount !== 1) outcome = "review_not_allowed";
      else {
        const reviewId = await saveKakaoReview(
          tx,
          context.review.orderId,
          context.review.text,
          claim.created_at,
          "photo",
        );
        for (const item of photos) {
          const photo = await tx.found<{ id: string }>(
            "INSERT INTO review_photos(shop_id,review_id,position,storage_key,content_type,byte_size,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [reviewId, item.position, item.key, item.contentType, item.byteSize, claim.created_at],
          );
          await tx.run(
            "INSERT INTO photo_consents(shop_id,order_id,scope,review_photo_id,consented,decided_at,publishable) VALUES($1,$2,'review_photo',$3,$4,$5,$4)",
            [context.review.orderId, photo.id, context.review.consent, claim.created_at],
          );
          await tx.run("DELETE FROM file_deletions WHERE shop_id=$1 AND storage_key=$2 AND attempts=0", [item.key]);
        }
      }
    }
    return saveOutcome(tx, messageId, claim, outcome, now());
  });
  return result === null ? { kind: "gone" } : { kind: "reply", reply: result, ...callback };
}
