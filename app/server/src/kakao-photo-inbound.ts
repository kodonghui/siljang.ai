import { kakaoCallback, SKILL_WORK_MS } from "./kakao-callback";
import {
  claimKakaoCallback,
  finishKakaoCallback,
  publishStoredKakaoCallback,
  releaseKakaoCallback,
} from "./kakao-callback-store";
import { deferredKakaoMessages, deferredKakaoTexts } from "./kakao-deferred";
import { kakaoPhotoUrl } from "./kakao-photo-download";
import { runKakaoPhotoTurn, storeKakaoPhotoContext } from "./kakao-photo-turn";
import { kakaoReply } from "./kakao-reply";
import { receiveAndHandleKakaoMessage } from "./kakao-skill-store";
import { referencePhotoRoom } from "./photo-count";
import type { ShopRequest } from "./routes";

/** DEC28에서 사진으로 오는 주소 하나. 글 안에 있는 일반 링크는 이 입력으로 해석하지 않습니다. */
export function isKakaoPhotoUtterance(text: string): boolean {
  const url = kakaoPhotoUrl(text.trim());
  return (
    url !== null &&
    ["kakaocdn.net", "daumcdn.net"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  );
}

export async function receiveKakaoReferencePhoto(r: ShopRequest): Promise<Response> {
  const request = r.kakaoSkill;
  if (request === undefined) throw new Error("photo request unavailable");
  const started = performance.now();
  const left = () =>
    Math.max(0, Math.min(SKILL_WORK_MS - (performance.now() - started), r.kakaoSkillTimeLeft?.() ?? Infinity));
  const url = kakaoPhotoUrl(request.payload.utterance.trim());
  const queue = r.services.kakaoCallbackQueue;
  const callback = queue === undefined ? null : kakaoCallback(request.payload.callbackUrl, request.receivedAt);
  const prepared = await receiveAndHandleKakaoMessage(r.db, request, "text", async (tx, receipt) => {
    if (receipt.kind === "not_accepting") return kakaoReply(r, receipt.kind, { contactPhone: receipt.contactPhone });
    if (receipt.kind === "duplicate") return kakaoReply(r, receipt.kind);
    await tx.run("UPDATE messages SET body_masked='[사진]' WHERE shop_id=$1 AND id=$2", [receipt.messageId]);
    if (receipt.limit !== "ok" || url === null || (await referencePhotoRoom(tx, receipt.consultationId)) < 1) {
      await tx.run("UPDATE messages SET kind='photo' WHERE shop_id=$1 AND id=$2", [receipt.messageId]);
      return receipt.limit !== "ok"
        ? kakaoReply(r, "rate_limited", { silent: receipt.limit === "silent" })
        : kakaoReply(r, "photo_rejected");
    }
    let draft = (
      await tx.run<{ id: string }>(
        "SELECT id FROM order_drafts WHERE shop_id=$1 AND consultation_id=$2 AND status='active' FOR UPDATE",
        [receipt.consultationId],
      )
    ).rows[0];
    if (draft === undefined)
      draft = await tx.found<{ id: string }>(
        "INSERT INTO order_drafts(shop_id,consultation_id,created_at,updated_at) VALUES($1,$2,$3,$3) RETURNING id",
        [receipt.consultationId, request.receivedAt],
      );
    const envelope = await storeKakaoPhotoContext(
      tx,
      receipt.messageId,
      {
        kind: "reference",
        draftId: draft.id,
        urls: [url.toString()],
        ...(callback === null ? {} : { callbackUrl: callback.url.toString() }),
      },
      r.services,
      request.receivedAt,
    );
    return { receipt, envelope };
  });
  if (prepared instanceof Response) return prepared;
  if (callback !== null && queue !== undefined) {
    const publication = await publishStoredKakaoCallback(
      r.db,
      queue,
      prepared.receipt,
      prepared.envelope,
      left,
      async (tx) => {
        await tx.run("UPDATE messages SET kind='photo',body_masked='[사진]' WHERE shop_id=$1 AND id=$2", [
          prepared.receipt.messageId,
        ]);
        return kakaoReply(r, "photo_download_failed");
      },
    );
    return publication.kind === "callback" ? kakaoReply(r, "callback_pending") : publication.value;
  }
  const claim = await claimKakaoCallback(r.db, prepared.receipt.messageId, r.services.now(), {
    maxLeaseMs: Math.max(1, Math.floor(left() - 100)),
  });
  if (claim === "busy" || claim === null) {
    await r.db.run(
      `UPDATE messages SET kakao_callback_enc=NULL,kakao_callback_deadline_at=NULL,kakao_callback_claim_until=NULL,kind='photo'
      WHERE shop_id=$1 AND id=$2 AND kakao_callback_enc=$3 AND kakao_callback_claim_until IS NULL`,
      [prepared.receipt.messageId, prepared.envelope],
    );
    return kakaoReply(r, "photo_download_failed");
  }
  try {
    const turn = await runKakaoPhotoTurn(r.db, prepared.receipt.messageId, claim, r.services, r.services.now, {
      budgetMs: Math.max(1, left() - 150),
    });
    if (turn.kind !== "reply") return kakaoReply(r, "photo_download_failed");
    const previous = await r.db.transaction((tx) =>
      deferredKakaoMessages(tx, claim.customer_id, {
        now: r.services.now(),
        excludeMessageId: turn.reply.id,
        fields: () => r.services.fieldCrypto(),
      }),
    );
    const response = kakaoReply(r, turn.reply.outcome, { previous: deferredKakaoTexts(previous) });
    await finishKakaoCallback(
      r.db,
      prepared.receipt.messageId,
      claim,
      turn.reply.text,
      r.services.now(),
      previous,
      turn.reply.id,
    );
    return response;
  } finally {
    await releaseKakaoCallback(r.db, prepared.receipt.messageId, claim).catch(() => {});
  }
}
