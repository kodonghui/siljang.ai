/**
 * 운영자 세션과 로그인 실패 세기(TASK-021; 06 DEC-26·DEC-16·DEC-27, 05 TBL-002·TBL-059·TBL-060).
 *
 * 세션(05 operator_sessions)
 * - 쿠키 siljang_operator의 값은 무작위 32바이트(base64url 43자)이고, 데이터베이스에는 그 SHA-256(소문자 16진수)만 둔다.
 *   데이터베이스를 읽은 사람도 살아 있는 쿠키를 만들 수 없다. 서버가 세션을 끝낼 수 있다(로그아웃 API-006).
 * - 로그인한 때부터 12시간이 지나면 끝나고 쓴다고 늘지 않는다(DEC-26). 05의 CHECK가 expires_at = created_at + 12시간을 지킨다.
 * - 운영자를 막거나(disabled_at) 2단계 인증을 끄거나 다시 등록하거나(mfa_enrolled_at·mfa_factor_id) Supabase 사용자가 바뀌면
 *   (auth_user_id) 05 트리거 operators_end_sessions가 그 운영자의 열린 세션을 같은 트랜잭션에서 끝낸다(DEC-27). 앱 밖(대시보드·SQL)에서
 *   바꿔도 듣고, 풀거나 되돌려도 옛 쿠키는 살아나지 않는다.
 * - 그래도 요청마다 세션과 운영자 행을 함께 본다: 끝났거나 지났거나, 운영자가 막혔거나 2단계 인증을 켜지 않았으면(05 R2) 세션이
 *   없는 것과 같다.
 * - 세션은 로그인 확인 때 읽은 운영자 행이 그대로일 때만 만든다(그 행을 잠그고 다시 봄). 그 사이에 막거나 다시 등록했으면 만들지 않는다.
 * - 지난 세션 행은 로그인 때 지운다(따로 도는 일 없음).
 *
 * 로그인 실패(05 operator_login_failures)
 * - 이메일(앞뒤 공백을 빼고 소문자)마다 15분에 5번을 넘으면 429와 Retry-After(DEC-16). 이메일 글은 남기지 않고
 *   REQUEST_HASH_KEY로 만든 HMAC만 둔다(용도를 가르는 앞글자를 붙임).
 * - 시도를 시작할 때 한 행을 먼저 넣고(그 이메일의 트랜잭션 잠금 안에서 세고 넣음) 인증 서비스를 부른다. 동시에 여러 번
 *   보내도 15분에 5번까지만 인증 서비스에 닿는다. 성공하면 그 이메일의 행을 모두 지우고, 인증 서비스가 답하지 않으면
 *   그 행만 지운다. 남은 행이 실패다.
 * - 15분 지난 행은 시도 때 지운다.
 */
import type { Queryable, RequestDb } from "./db";
import type { Secret } from "./settings";

export const OPERATOR_COOKIE = "siljang_operator";
/** 운영자 세션 길이(초): 로그인한 때부터 12시간(06 DEC-26, 쿠키 Max-Age). */
export const OPERATOR_SESSION_SECONDS = 43200;
/** 로그인 실패 한도: 15분(900초)에 5번(06 DEC-16). */
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_SECONDS = 900;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 새 세션 쿠키 값: 무작위 32바이트의 base64url(43자). */
export function newSessionToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** 쿠키 값의 SHA-256(소문자 16진수 64자). 데이터베이스에는 이것만 둔다. */
export async function tokenHash(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

/** 로그인 이메일을 셀 때의 꼴: 앞뒤 공백을 빼고 소문자. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 실패를 세는 열쇠: HMAC-SHA256(REQUEST_HASH_KEY, "operator-login\0" + 이메일)의 소문자 16진수. */
export async function emailHash(key: Secret, email: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key.reveal()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(`operator-login\0${normalizeEmail(email)}`);
  return toHex(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

const COOKIE_ATTRS = "Path=/; HttpOnly; Secure; SameSite=Lax";

/** 로그인 응답의 Set-Cookie(06 API-004: HttpOnly·Secure·SameSite=Lax, Max-Age 43200). */
export function sessionCookie(token: string): string {
  return `${OPERATOR_COOKIE}=${token}; ${COOKIE_ATTRS}; Max-Age=${OPERATOR_SESSION_SECONDS}`;
}

/** 로그아웃 응답의 Set-Cookie(06 API-006: Max-Age=0). */
export function clearedCookie(): string {
  return `${OPERATOR_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;
}

/**
 * Cookie 헤더에서 운영자 세션 쿠키 값. 없거나 꼴이 틀리거나 같은 이름이 둘 이상이면 null(어느 것을 믿을지 정하지 않고 닫음).
 */
export function readSessionCookie(header: string | undefined | null): string | null {
  if (header === undefined || header === null) return null;
  const values: string[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === OPERATOR_COOKIE) values.push(part.slice(eq + 1).trim());
  }
  if (values.length !== 1) return null;
  const value = values[0] as string;
  return TOKEN.test(value) ? value : null;
}

/** 로그인한 운영자(세션에서 찾음). */
export interface SessionOperator {
  readonly sessionId: string;
  readonly operatorId: string;
  readonly displayName: string;
}

/** 로그인 확인 때 읽은 운영자 행의 묶음(세션을 만들 때 그대로인지 다시 봄). */
export interface SessionBinding {
  readonly id: string;
  readonly mfaFactorId: string;
  readonly authUserId: string;
}

/**
 * 세션을 만들고 쿠키 값을 돌려준다. 지난 세션 행은 이때 지운다. 운영자 행이 막히지 않고 2단계 인증을 켰고 확인 때의 인증 수단·
 * Supabase 사용자 그대로일 때만 만든다(그 행을 FOR SHARE로 잠가 막기·다시 등록과 차례를 정함). 아니면 null.
 */
export async function createSession(db: RequestDb, operator: SessionBinding, now: Date): Promise<string | null> {
  const token = newSessionToken();
  const hash = await tokenHash(token);
  const created = await db.transaction(async (tx) => {
    const still = await tx.query(
      `SELECT 1 FROM operators
        WHERE id = $1 AND disabled_at IS NULL AND mfa_enrolled_at IS NOT NULL AND mfa_factor_id = $2 AND auth_user_id = $3
        FOR SHARE`,
      [operator.id, operator.mfaFactorId, operator.authUserId],
    );
    if (still.rows.length === 0) return false;
    await tx.query("DELETE FROM operator_sessions WHERE expires_at <= $1", [now]);
    await tx.query(
      `INSERT INTO operator_sessions (operator_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $3::timestamptz + interval '12 hours')`,
      [operator.id, hash, now],
    );
    return true;
  });
  return created ? token : null;
}

/** 쿠키 값의 살아 있는 세션과 그 운영자. 끝났거나 지났거나, 운영자가 막혔거나 2단계 인증이 꺼졌으면 null. */
export async function findSession(db: Queryable, token: string, now: Date): Promise<SessionOperator | null> {
  const hash = await tokenHash(token);
  const r = await db.query<{ session_id: string; operator_id: string; display_name: string }>(
    `SELECT s.id AS session_id, o.id AS operator_id, o.display_name
       FROM operator_sessions s JOIN operators o ON o.id = s.operator_id
      WHERE s.token_hash = $1 AND s.ended_at IS NULL AND s.created_at <= $2 AND s.expires_at > $2
        AND o.disabled_at IS NULL AND o.mfa_enrolled_at IS NOT NULL`,
    [hash, now],
  );
  const row = r.rows[0];
  if (row === undefined) return null;
  return { sessionId: row.session_id, operatorId: row.operator_id, displayName: row.display_name };
}

/** 그 쿠키 값의 세션을 끝낸다(로그아웃). 없거나 이미 끝났으면 아무것도 바꾸지 않는다. */
export async function endSession(db: Queryable, token: string, now: Date): Promise<boolean> {
  const hash = await tokenHash(token);
  const r = await db.query(
    `UPDATE operator_sessions SET ended_at = $2
      WHERE token_hash = $1 AND ended_at IS NULL AND created_at <= $2 AND expires_at > $2`,
    [hash, now],
  );
  return r.rowCount > 0;
}

/** 로그인할 운영자 행(이메일 소문자로 찾음). */
export interface LoginOperator {
  readonly id: string;
  readonly displayName: string;
  readonly disabled: boolean;
  readonly mfaEnrolled: boolean;
  /** 등록 도구가 묶은 Supabase 사용자 ID(05 operators.auth_user_id). 없으면 null. */
  readonly authUserId: string | null;
  /** 등록 도구가 확인한 TOTP 인증 수단 ID(05 operators.mfa_factor_id). 2단계 인증을 켜지 않았으면 null. */
  readonly mfaFactorId: string | null;
}

export async function findOperatorByEmail(db: Queryable, email: string): Promise<LoginOperator | null> {
  const r = await db.query<{
    id: string;
    display_name: string;
    disabled: boolean;
    mfa_enrolled: boolean;
    auth_user_id: string | null;
    mfa_factor_id: string | null;
  }>(
    `SELECT id, display_name, disabled_at IS NOT NULL AS disabled, mfa_enrolled_at IS NOT NULL AS mfa_enrolled,
            auth_user_id, mfa_factor_id
       FROM operators WHERE lower(email) = $1`,
    [normalizeEmail(email)],
  );
  const row = r.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    disabled: row.disabled,
    mfaEnrolled: row.mfa_enrolled,
    authUserId: row.auth_user_id,
    mfaFactorId: row.mfa_factor_id,
  };
}

export type Reservation =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly retryAfterSeconds: number };

/**
 * 로그인 시도 하나를 센다(실패로 먼저 넣음). 이 이메일이 15분 안에 이미 5번 실패했으면 넣지 않고 다시 할 수 있을 때까지의 초.
 * 이메일마다 트랜잭션 잠금(pg_advisory_xact_lock) 안에서 세고 넣어, 동시에 온 시도도 한도를 넘지 않는다.
 */
export async function reserveAttempt(db: RequestDb, hash: string, now: Date): Promise<Reservation> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 21))", [hash]);
    await tx.query(
      "DELETE FROM operator_login_failures WHERE attempted_at <= $1::timestamptz - make_interval(secs => $2)",
      [now, LOGIN_FAILURE_WINDOW_SECONDS],
    );
    const recent = await tx.query<{ attempted_at: Date }>(
      `SELECT attempted_at FROM operator_login_failures
        WHERE email_hash = $1 AND attempted_at > $2::timestamptz - make_interval(secs => $3)
        ORDER BY attempted_at DESC LIMIT $4`,
      [hash, now, LOGIN_FAILURE_WINDOW_SECONDS, LOGIN_FAILURE_LIMIT],
    );
    if (recent.rows.length >= LOGIN_FAILURE_LIMIT) {
      // 5번째로 최근인 실패가 15분 창을 벗어나면 다시 할 수 있다.
      const oldest = recent.rows[LOGIN_FAILURE_LIMIT - 1] as { attempted_at: Date };
      const waitMs = oldest.attempted_at.getTime() + LOGIN_FAILURE_WINDOW_SECONDS * 1000 - now.getTime();
      const retryAfterSeconds = Math.min(LOGIN_FAILURE_WINDOW_SECONDS, Math.max(1, Math.ceil(waitMs / 1000)));
      return { ok: false, retryAfterSeconds } as const;
    }
    const inserted = await tx.query<{ id: string }>(
      "INSERT INTO operator_login_failures (email_hash, attempted_at) VALUES ($1, $2) RETURNING id",
      [hash, now],
    );
    return { ok: true, id: (inserted.rows[0] as { id: string }).id } as const;
  });
}

/** 인증 서비스가 답하지 않은 시도는 세지 않는다. */
export async function forgetAttempt(db: Queryable, id: string): Promise<void> {
  await db.query("DELETE FROM operator_login_failures WHERE id = $1", [id]);
}

/** 성공하면 그 이메일의 실패를 모두 지운다. */
export async function clearFailures(db: Queryable, hash: string): Promise<void> {
  await db.query("DELETE FROM operator_login_failures WHERE email_hash = $1", [hash]);
}
