import { type AuthorizedKakaoSkill, kakaoReceiptKey } from "./kakao-skill-auth";
import type { ShopDb, ShopRequestDb } from "./shop-scope";

export const KAKAO_MESSAGE_LIMIT = 20;
const MINUTE_MS = 60_000;

export type InboundReceipt =
  | { readonly kind: "duplicate" }
  | { readonly kind: "not_accepting"; readonly contactPhone?: string }
  | {
      readonly kind: "received";
      readonly messageId: string;
      readonly consultationId: string;
      readonly customerId: string;
      readonly limit: "ok" | "first" | "silent";
    };

type Id = { readonly id: string };

/** 후기 카드를 뺀 같은 손님의 1분 수신 수. 한도 초과 뒤 필요한 두 행까지만 읽는다. */
export async function recentKakaoInboundCount(db: ShopDb, customerId: string, receivedAt: Date): Promise<number> {
  const start = new Date(Math.floor(receivedAt.getTime() / MINUTE_MS) * MINUTE_MS);
  const recent = await db.run<Id>(
    `SELECT m.id FROM messages m JOIN consultations c ON c.shop_id=$1 AND c.id=m.consultation_id
     WHERE m.shop_id=$1 AND c.customer_id=$2 AND m.direction='inbound' AND m.kind<>'card'
     AND m.created_at >= $3 AND m.created_at < $4 LIMIT $5`,
    [customerId, start, new Date(start.getTime() + MINUTE_MS), KAKAO_MESSAGE_LIMIT + 2],
  );
  return recent.rowCount;
}

/** 인증한 가게의 연락처만 읽는다. 연결 확인 중에도 상담·손님·메시지는 만들지 않는다. */
export async function kakaoContactPhone(db: ShopDb): Promise<string | undefined> {
  const result = await db.run<{ contact_phone: string }>("SELECT contact_phone FROM shops WHERE id = $1");
  return result.rows[0]?.contact_phone;
}

export async function receiveKakaoMessage(
  db: ShopRequestDb,
  request: AuthorizedKakaoSkill,
  kind: "text" | "unsupported",
): Promise<InboundReceipt> {
  return receiveAndHandleKakaoMessage(db, request, kind, async (_tx, receipt) => receipt);
}

/** 외부 호출이 없는 즉시 처리는 수신과 같은 트랜잭션에 기록한다. */
export async function receiveAndHandleKakaoMessage<T>(
  db: ShopRequestDb,
  request: AuthorizedKakaoSkill,
  kind: "text" | "unsupported",
  handle: (tx: ShopDb, receipt: InboundReceipt) => Promise<T>,
): Promise<T> {
  const { channelId, payload, receivedAt, requestKeySecret } = request;
  const receipt = await kakaoReceiptKey(requestKeySecret, payload, receivedAt, "message");

  return db.transaction(async (tx) => {
    const result = await receiveInTransaction(tx, channelId, payload, receivedAt, kind, receipt);
    return handle(tx, result);
  });
}

async function receiveInTransaction(
  tx: ShopDb,
  channelId: string,
  payload: AuthorizedKakaoSkill["payload"],
  receivedAt: Date,
  kind: "text" | "unsupported",
  receipt: string,
): Promise<InboundReceipt> {
  // 연결만 끝나고 예약 링크를 내지 않은 가게에서는 손님 기록을 만들지 않는다(SPEC-017).
  // 가게와 채널의 공유 잠금을 수신 트랜잭션까지 유지해 설정을 바꾸는 요청과 차례를 정한다.
  const shop = await tx.run<{ contact_phone: string; booking_issued_at: Date | null }>(
    "SELECT contact_phone, booking_issued_at FROM shops WHERE id = $1 FOR SHARE",
  );
  const ready = shop.rows[0];
  if (ready === undefined) return { kind: "not_accepting" };
  if (ready.booking_issued_at === null) return { kind: "not_accepting", contactPhone: ready.contact_phone };
  const channel = await tx.run<Id>(
    "SELECT id FROM kakao_channels WHERE shop_id = $1 AND id = $2 AND status = 'linked' FOR SHARE",
    [channelId],
  );
  if (channel.rowCount === 0) return { kind: "not_accepting", contactPhone: ready.contact_phone };

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

  // 카카오가 값을 주지 않으면 false다. 늦게 끝난 옛 요청이 최신 친구 여부를 되돌리지 않는다(REQ-219, G5).
  await tx.run(
    `UPDATE customers SET channel_friend = $3, friend_checked_at = $4
        WHERE shop_id = $1 AND id = $2 AND (friend_checked_at IS NULL OR friend_checked_at <= $4)`,
    [customerId, payload.isFriend, receivedAt],
  );

  const previous = await tx.run<Id>("SELECT id FROM messages WHERE shop_id = $1 AND kakao_message_id = $2", [receipt]);
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

  const recent = await recentKakaoInboundCount(tx, customerId, receivedAt);
  const limit = recent <= KAKAO_MESSAGE_LIMIT ? "ok" : recent === KAKAO_MESSAGE_LIMIT + 1 ? "first" : "silent";
  return { kind: "received", messageId, consultationId, customerId, limit };
}
