/** 합성 운영자·실제 로컬 세션 행. 실제 Supabase/TOTP 인증 성공으로 세지 않는다. */
import type { Queryable } from "../../src/db";
import { newSessionToken, tokenHash } from "../../src/operator-session";
import { newUuid } from "./db";

export async function seedOperatorSession(db: Queryable, now: Date) {
  const operatorId = newUuid(),
    token = newSessionToken();
  await db.query(
    "INSERT INTO operators (id,email,display_name,auth_user_id,mfa_factor_id,mfa_enrolled_at) VALUES ($1,$2,'합성 운영자',$3,$4,$5)",
    [operatorId, `${newUuid()}@operator.example`, newUuid(), newUuid(), now],
  );
  await db.query("INSERT INTO operator_sessions (operator_id,token_hash,created_at,expires_at) VALUES ($1,$2,$3,$4)", [
    operatorId,
    await tokenHash(token),
    now,
    new Date(now.getTime() + 12 * 3_600_000),
  ]);
  return { operatorId, token, cookie: `siljang_operator=${token}` };
}
