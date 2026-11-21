import type { FieldCrypto } from "./field-crypto";
import type { KakaoCallback } from "./kakao-callback";
import type { ShopRequestDb } from "./shop-scope";

export interface KakaoCallbackJob {
  readonly shopId: string;
  readonly messageId: string;
}

export interface KakaoCallbackQueue {
  send(job: KakaoCallbackJob, options: { readonly delaySeconds: number }): Promise<void>;
}

const PURPOSE = "messages.kakao_callback";
const CLAIM_MS = 15_000;
const RESPONSE_RESERVE_MS = 200;
const QUEUE_PUBLISH_MAX_MS = 500;

async function publishCallback(
  queue: KakaoCallbackQueue,
  job: KakaoCallbackJob,
  remainingMs: number,
): Promise<boolean> {
  const limitMs = Math.min(QUEUE_PUBLISH_MAX_MS, remainingMs - RESPONSE_RESERVE_MS);
  if (limitMs <= 0) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      queue.send(job, { delaySeconds: 1 }).then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), limitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function scheduleKakaoCallback(
  db: ShopRequestDb,
  crypto: FieldCrypto,
  queue: KakaoCallbackQueue,
  messageId: string,
  callback: KakaoCallback,
  timeLeft: () => number,
): Promise<boolean> {
  if (timeLeft() <= RESPONSE_RESERVE_MS) return false;
  const shopId = db.scope.shopId;
  const envelope = await crypto.seal(callback.url.toString(), { shopId, purpose: PURPOSE });
  const result = await db.run(
    `UPDATE messages SET kakao_callback_enc = $3, kakao_callback_deadline_at = $4
      WHERE shop_id = $1 AND id = $2 AND direction = 'inbound' AND kakao_callback_enc IS NULL`,
    [messageId, envelope, new Date(callback.deadline)],
  );
  if (result.rowCount === 0) return false;
  if (await publishCallback(queue, { shopId, messageId }, timeLeft())) return true;

  await db.run(
    `UPDATE messages SET kakao_callback_enc = NULL, kakao_callback_deadline_at = NULL, kakao_callback_claim_until = NULL
      WHERE shop_id = $1 AND id = $2 AND kakao_callback_enc = $3 AND kakao_callback_claim_until IS NULL`,
    [messageId, envelope],
  );
  return false;
}

interface Claim {
  readonly consultation_id: string;
  readonly kakao_callback_enc: string;
  readonly kakao_callback_deadline_at: Date;
  readonly kakao_callback_claim_until: Date;
  readonly created_at: Date;
}

export async function claimKakaoCallback(
  db: ShopRequestDb,
  messageId: string,
  now: Date,
): Promise<Claim | "busy" | null> {
  const result = await db.run<Claim>(
    `UPDATE messages
        SET kakao_callback_claim_until = LEAST(kakao_callback_deadline_at, $4)
      WHERE shop_id = $1 AND id = $2 AND direction = 'inbound'
        AND kakao_callback_enc IS NOT NULL AND kakao_callback_deadline_at > $3
        AND (kakao_callback_claim_until IS NULL OR kakao_callback_claim_until <= $3)
      RETURNING consultation_id, kakao_callback_enc, kakao_callback_deadline_at, kakao_callback_claim_until, created_at`,
    [messageId, now, new Date(now.getTime() + CLAIM_MS)],
  );
  const claim = result.rows[0];
  if (claim !== undefined) return claim;

  const pending = await db.run(
    `SELECT id FROM messages WHERE shop_id = $1 AND id = $2 AND kakao_callback_deadline_at > $3`,
    [messageId, now],
  );
  return pending.rowCount > 0 ? "busy" : null;
}

export async function openKakaoCallback(db: ShopRequestDb, crypto: FieldCrypto, claim: Claim): Promise<string> {
  return crypto.open(claim.kakao_callback_enc, { shopId: db.scope.shopId, purpose: PURPOSE });
}

export async function finishKakaoCallback(
  db: ShopRequestDb,
  messageId: string,
  claim: Claim,
  text: string,
  sentAt: Date | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const owned = await tx.run(
      `UPDATE messages SET kakao_callback_enc = NULL, kakao_callback_deadline_at = NULL, kakao_callback_claim_until = NULL
        WHERE shop_id = $1 AND id = $2 AND kakao_callback_enc = $3 AND kakao_callback_claim_until = $4`,
      [messageId, claim.kakao_callback_enc, claim.kakao_callback_claim_until],
    );
    if (owned.rowCount === 0) return;
    await tx.run(
      `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, body_masked, delivery, sent_at)
        VALUES ($1, $2, 'outbound', 'system', 'text', $3, $4, $5)`,
      [claim.consultation_id, text, sentAt === null ? "deferred" : "callback", sentAt],
    );
  });
}

export async function deferExpiredKakaoCallback(
  db: ShopRequestDb,
  messageId: string,
  now: Date,
  text: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const expired = await tx.run<{ consultation_id: string }>(
      `UPDATE messages SET kakao_callback_enc = NULL, kakao_callback_deadline_at = NULL, kakao_callback_claim_until = NULL
        WHERE shop_id = $1 AND id = $2 AND kakao_callback_deadline_at <= $3 RETURNING consultation_id`,
      [messageId, now],
    );
    const row = expired.rows[0];
    if (row === undefined) return;
    await tx.run(
      `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, body_masked, delivery)
        VALUES ($1, $2, 'outbound', 'system', 'text', $3, 'deferred')`,
      [row.consultation_id, text],
    );
  });
}
