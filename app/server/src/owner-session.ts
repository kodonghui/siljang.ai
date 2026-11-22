/** 사장님 서버 세션(DEC-26). 쿠키 값의 SHA-256만 저장하고 쓸 때마다 30일로 연장한다. */
import type { Queryable, RequestDb } from "./db";
import { newSessionToken, tokenHash } from "./operator-session";
import type { KakaoOwner, OwnerAuth } from "./owner-auth";
import { DEFAULT_TIME_ZONE, type OwnerProfile } from "./owner-scope";
import { toShopIso } from "./time";

export async function createOwnerSession(
  db: RequestDb,
  user: KakaoOwner,
  now: Date,
  trackChannelFriend: boolean,
): Promise<{ token: string; ownerId: string }> {
  const token = newSessionToken();
  const hash = await tokenHash(token);
  const ownerId = await db.transaction(async (tx) => {
    const result = await tx.query<{ id: string }>(
      trackChannelFriend
        ? `INSERT INTO owners (kakao_account_id, alert_channel_friend, alert_friend_checked_at, last_login_at, created_at)
       VALUES ($1, coalesce($2, false), CASE WHEN $2::boolean IS NULL THEN NULL ELSE $3::timestamptz END, $3, $3)
       ON CONFLICT (kakao_account_id) DO UPDATE SET
         last_login_at = EXCLUDED.last_login_at,
         alert_channel_friend = coalesce($2, owners.alert_channel_friend),
         alert_friend_checked_at = CASE WHEN $2::boolean IS NULL THEN owners.alert_friend_checked_at ELSE $3 END
       RETURNING id`
        : `INSERT INTO owners (kakao_account_id, last_login_at, created_at)
       VALUES ($1, $2, $2)
       ON CONFLICT (kakao_account_id) DO UPDATE SET last_login_at = EXCLUDED.last_login_at
       RETURNING id`,
      trackChannelFriend ? [user.accountId, user.friend, now] : [user.accountId, now],
    );
    const id = (result.rows[0] as { id: string }).id;
    await tx.query("DELETE FROM owner_sessions WHERE owner_id = $1 AND expires_at <= $2", [id, now]);
    await tx.query(
      `INSERT INTO owner_sessions (owner_id, token_hash, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $3, $3::timestamptz + interval '2592000 seconds')`,
      [id, hash, now],
    );
    return id;
  });
  return { token, ownerId };
}

export async function renewOwnerSession(db: Queryable, token: string, now: Date): Promise<string | null> {
  const result = await db.query<{ owner_id: string }>(
    `UPDATE owner_sessions SET last_seen_at = greatest(last_seen_at, $2),
       expires_at = greatest(last_seen_at, $2) + interval '2592000 seconds'
     WHERE token_hash = $1 AND ended_at IS NULL AND created_at <= $2 AND expires_at > $2 RETURNING owner_id`,
    [await tokenHash(token), now],
  );
  return result.rows[0]?.owner_id ?? null;
}

export async function endOwnerSession(db: Queryable, token: string, now: Date): Promise<void> {
  await db.query(
    "UPDATE owner_sessions SET ended_at = greatest(created_at, $2) WHERE token_hash = $1 AND ended_at IS NULL",
    [await tokenHash(token), now],
  );
}

/** 세션에서 찾은 사장님의 가게 요약만 읽는다. 정적 검사는 이 SQL만 허용한다. */
export const OWNER_SHOP_SQL = "SELECT id, name, license_status, time_zone FROM shops WHERE owner_id = $1";

export async function refreshOwnerFriend(db: Queryable, auth: OwnerAuth, ownerId: string, now: Date): Promise<void> {
  // 조회 권한을 먼저 선점해 동시에 온 화면 요청도 1분에 한 번만 조회한다. 실패 때도 기존 친구 여부는 유지한다.
  const claim = await db.query<{ kakao_account_id: string }>(
    `UPDATE owners SET alert_friend_checked_at = $2 WHERE id = $1 AND alert_channel_friend = false
      AND (alert_friend_checked_at IS NULL OR alert_friend_checked_at <= $2::timestamptz - interval '60 seconds')
      RETURNING kakao_account_id`,
    [ownerId, now],
  );
  const row = claim.rows[0];
  if (row === undefined) return;
  let friend: boolean | null;
  try {
    friend = await auth.channelFriend(row.kakao_account_id);
  } catch {
    return;
  }
  if (friend === null) return;
  await db.query("UPDATE owners SET alert_channel_friend = $3 WHERE id = $1 AND alert_friend_checked_at = $2", [
    ownerId,
    now,
    friend,
  ]);
}

export async function ownerProfile(
  db: Queryable,
  ownerId: string,
  showChannelBanner: boolean,
): Promise<{ profile: OwnerProfile; timeZone: string }> {
  const { rows } = await db.query<{ id: string; alert_channel_friend: boolean; created_at: Date }>(
    "SELECT id, alert_channel_friend, created_at FROM owners WHERE id = $1",
    [ownerId],
  );
  const owner = rows[0];
  if (owner === undefined) throw new Error("session owner missing");
  const shops = await db.query<{
    id: string;
    name: string;
    license_status: "pending" | "on_hold" | "verified";
    time_zone: string;
  }>(OWNER_SHOP_SQL, [ownerId]);
  const shop = shops.rows[0];
  const timeZone = shop?.time_zone ?? DEFAULT_TIME_ZONE;
  return {
    timeZone,
    profile: {
      owner: {
        ownerId,
        alertChannelFriend: owner.alert_channel_friend,
        createdAt: toShopIso(owner.created_at, timeZone),
      },
      shop: shop === undefined ? null : { shopId: shop.id, name: shop.name, licenseStatus: shop.license_status },
      banners: [
        ...(!showChannelBanner || owner.alert_channel_friend ? [] : ["add_alert_channel"]),
        ...(shop?.license_status === "pending"
          ? ["license_pending"]
          : shop?.license_status === "on_hold"
            ? ["license_on_hold"]
            : []),
      ],
    },
  };
}
