import { type AuthorizedKakaoSkill, kakaoReceiptKey } from "./kakao-skill-auth";
import type { ShopRequestDb } from "./shop-scope";

const MESSAGE_LIMIT = 20;
const MINUTE_MS = 60_000;

export type InboundReceipt =
  | { readonly kind: "duplicate" }
  | { readonly kind: "not_accepting" }
  | {
      readonly kind: "received";
      readonly messageId: string;
      readonly consultationId: string;
      readonly customerId: string;
      readonly limit: "ok" | "first" | "silent";
    };

type Id = { readonly id: string };

export async function receiveKakaoMessage(
  db: ShopRequestDb,
  request: AuthorizedKakaoSkill,
  kind: "text" | "unsupported",
): Promise<InboundReceipt> {
  const { channelId, payload, receivedAt, requestKeySecret } = request;
  const receipt = await kakaoReceiptKey(requestKeySecret, payload, receivedAt, "message");
  const windowStart = new Date(Math.floor(receivedAt.getTime() / MINUTE_MS) * MINUTE_MS);

  return db.transaction(async (tx) => {
    const channel = await tx.run<Id>(
      "SELECT id FROM kakao_channels WHERE shop_id = $1 AND id = $2 AND status = 'linked' FOR SHARE",
      [channelId],
    );
    if (channel.rowCount === 0) return { kind: "not_accepting" };

    await tx.run(
      `INSERT INTO customers (shop_id, kakao_channel_id, kakao_user_key)
       VALUES ($1, $2, $3) ON CONFLICT (kakao_channel_id, kakao_user_key) DO NOTHING`,
      [channelId, payload.userId],
    );
    const { id: customerId } = await tx.found<Id>(
      `SELECT id FROM customers
       WHERE shop_id = $1 AND kakao_channel_id = $2 AND kakao_user_key = $3 FOR UPDATE`,
      [channelId, payload.userId],
    );

    const previous = await tx.run<Id>("SELECT id FROM messages WHERE shop_id = $1 AND kakao_message_id = $2", [
      receipt,
    ]);
    if (previous.rowCount !== 0) return { kind: "duplicate" };

    const active = await tx.run<Id>(
      `SELECT id FROM consultations
       WHERE shop_id = $1 AND customer_id = $2 AND status NOT IN ('ended', 'deleted')`,
      [customerId],
    );
    const consultationId =
      active.rows[0]?.id ??
      (
        await tx.found<Id>(
          `INSERT INTO consultations (shop_id, customer_id, opened_at, last_customer_message_at)
           VALUES ($1, $2, $3, $3) RETURNING id`,
          [customerId, receivedAt],
        )
      ).id;
    const message = await tx.run<Id>(
      `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, kakao_message_id, created_at)
       VALUES ($1, $2, 'inbound', 'customer', $3, $4, $5)
       ON CONFLICT (shop_id, kakao_message_id) DO NOTHING RETURNING id`,
      [consultationId, kind, receipt, receivedAt],
    );
    const messageId = message.rows[0]?.id;
    if (messageId === undefined) return { kind: "duplicate" };

    const recent = await tx.run<Id>(
      `SELECT m.id FROM messages m
       JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
       WHERE m.shop_id = $1 AND c.customer_id = $2 AND m.direction = 'inbound' AND m.kind <> 'card'
         AND m.created_at >= $3 AND m.created_at < $4 LIMIT 22`,
      [customerId, windowStart, new Date(windowStart.getTime() + MINUTE_MS)],
    );
    const limit = recent.rowCount <= MESSAGE_LIMIT ? "ok" : recent.rowCount === MESSAGE_LIMIT + 1 ? "first" : "silent";
    return { kind: "received", messageId, consultationId, customerId, limit };
  });
}
