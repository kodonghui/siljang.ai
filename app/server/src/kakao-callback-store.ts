import type { FieldCrypto } from "./field-crypto";
import type { KakaoCallback } from "./kakao-callback";
import { type DeferredKakaoMessage, markDeferredKakaoMessages } from "./kakao-deferred";
import { recordKakaoHandoff } from "./kakao-handoff";
import type { ShopRequestDb } from "./shop-scope";

export interface KakaoCallbackJob {
  readonly shopId: string;
  readonly messageId: string;
}

export interface KakaoCallbackQueue {
  send(job: KakaoCallbackJob, options: { readonly delaySeconds: number }): Promise<void>;
}

const PURPOSE = "messages.kakao_callback";
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
  readonly customer_id: string;
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
  return db.transaction<Claim | "busy" | null>(async (tx) => {
    const target = await tx.run<{ customer_id: string }>(
      `SELECT c.customer_id FROM messages m
        JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
        WHERE m.shop_id = $1 AND m.id = $2 AND m.direction = 'inbound'
          AND m.kakao_callback_enc IS NOT NULL AND m.kakao_callback_deadline_at > $3`,
      [messageId, now],
    );
    const customerId = target.rows[0]?.customer_id;
    if (customerId === undefined) return null;
    await tx.run("SELECT id FROM customers WHERE shop_id = $1 AND id = $2 FOR UPDATE", [customerId]);
    const active = await tx.run(
      `SELECT m.id FROM messages m
        JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
        WHERE m.shop_id = $1 AND c.customer_id = $2 AND m.kakao_callback_claim_until > $3 LIMIT 1`,
      [customerId, now],
    );
    if (active.rowCount > 0) return "busy";
    // 바깥 호출 동안 DB 잠금은 잡지 않고 콜백 기한까지 그 손님의 전달을 선점한다.
    const result = await tx.run<Omit<Claim, "customer_id">>(
      `UPDATE messages SET kakao_callback_claim_until = kakao_callback_deadline_at
        WHERE shop_id = $1 AND id = $2 AND direction = 'inbound'
          AND kakao_callback_enc IS NOT NULL AND kakao_callback_deadline_at > $3
          AND (kakao_callback_claim_until IS NULL OR kakao_callback_claim_until <= $3)
        RETURNING consultation_id, kakao_callback_enc, kakao_callback_deadline_at, kakao_callback_claim_until, created_at`,
      [messageId, now],
    );
    const claim = result.rows[0];
    return claim === undefined ? null : { ...claim, customer_id: customerId };
  });
}

/** 예외 뒤에는 자기 선점만 풀어 다음 큐 시도가 남은 기한 안에 다시 처리하게 한다. */
export async function releaseKakaoCallback(db: ShopRequestDb, messageId: string, claim: Claim): Promise<void> {
  await db.run(
    `UPDATE messages SET kakao_callback_claim_until = NULL
      WHERE shop_id = $1 AND id = $2 AND kakao_callback_enc = $3 AND kakao_callback_claim_until = $4`,
    [messageId, claim.kakao_callback_enc, claim.kakao_callback_claim_until],
  );
}

export async function openKakaoCallback(db: ShopRequestDb, crypto: FieldCrypto, claim: Claim): Promise<string> {
  return crypto.open(claim.kakao_callback_enc, { shopId: db.scope.shopId, purpose: PURPOSE });
}

/** 외부 발신 전에 자기 선점과 열린 상담을 확인하고 사장님 기록을 확정한다. */
export async function prepareKakaoCallbackHandoff(
  db: ShopRequestDb,
  messageId: string,
  claim: Claim,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.found("SELECT id FROM customers WHERE shop_id = $1 AND id = $2 FOR UPDATE", [claim.customer_id]);
    const consultation = await tx.found<{ status: string }>(
      "SELECT status FROM consultations WHERE shop_id = $1 AND id = $2 AND customer_id = $3 FOR UPDATE",
      [claim.consultation_id, claim.customer_id],
    );
    const owned = await tx.run(
      `SELECT id FROM messages WHERE shop_id = $1 AND id = $2 AND consultation_id = $3
        AND direction = 'inbound' AND kakao_callback_enc = $4 AND kakao_callback_claim_until = $5 FOR UPDATE`,
      [messageId, claim.consultation_id, claim.kakao_callback_enc, claim.kakao_callback_claim_until],
    );
    if (owned.rowCount === 0) return false;
    if (["ended", "deleted", "dropped"].includes(consultation.status)) {
      await tx.run(
        `UPDATE messages SET kakao_callback_enc = NULL, kakao_callback_deadline_at = NULL, kakao_callback_claim_until = NULL
          WHERE shop_id = $1 AND id = $2`,
        [messageId],
      );
      return false;
    }
    await recordKakaoHandoff(tx, claim.consultation_id, messageId, "ai_failure", now);
    return true;
  });
}

export async function finishKakaoCallback(
  db: ShopRequestDb,
  messageId: string,
  claim: Claim,
  text: string,
  sentAt: Date | null,
  previous: readonly DeferredKakaoMessage[] = [],
): Promise<void> {
  await db.transaction(async (tx) => {
    const owned = await tx.run(
      `UPDATE messages SET kakao_callback_enc = NULL, kakao_callback_deadline_at = NULL, kakao_callback_claim_until = NULL
        WHERE shop_id = $1 AND id = $2 AND kakao_callback_enc = $3 AND kakao_callback_claim_until = $4`,
      [messageId, claim.kakao_callback_enc, claim.kakao_callback_claim_until],
    );
    if (owned.rowCount === 0) return;
    if (sentAt !== null) await markDeferredKakaoMessages(tx, claim.customer_id, previous, sentAt);
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
    const target = await tx.run<{ customer_id: string; consultation_id: string }>(
      `SELECT c.customer_id, c.id AS consultation_id FROM messages m
        JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
        WHERE m.shop_id = $1 AND m.id = $2 AND m.direction = 'inbound'
          AND m.kakao_callback_deadline_at <= $3`,
      [messageId, now],
    );
    const source = target.rows[0];
    if (source === undefined) return;
    await tx.run("SELECT id FROM customers WHERE shop_id = $1 AND id = $2 FOR UPDATE", [source.customer_id]);
    const consultation = await tx.found<{ status: string }>(
      "SELECT status FROM consultations WHERE shop_id = $1 AND id = $2 FOR UPDATE",
      [source.consultation_id],
    );
    const expired = await tx.run<{ consultation_id: string }>(
      `UPDATE messages SET kakao_callback_enc = NULL, kakao_callback_deadline_at = NULL, kakao_callback_claim_until = NULL
        WHERE shop_id = $1 AND id = $2 AND kakao_callback_deadline_at <= $3 RETURNING consultation_id`,
      [messageId, now],
    );
    const row = expired.rows[0];
    if (row === undefined) return;
    if (["ended", "deleted", "dropped"].includes(consultation.status)) return;
    await recordKakaoHandoff(tx, row.consultation_id, messageId, "callback_timeout", now);
    await tx.run(
      `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, body_masked, delivery)
        VALUES ($1, $2, 'outbound', 'system', 'text', $3, 'deferred')`,
      [row.consultation_id, text],
    );
  });
}
