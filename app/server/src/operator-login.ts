/**
 * 운영자 로그인·로그인한 운영자·로그아웃(TASK-021; 06 API-004·005·006, 04 SPEC-001, 06 DEC-11·DEC-16·DEC-26·DEC-27)과
 * 운영자 세션 해석기(resolveOperatorSession).
 *
 * 로그인(API-004) 한 번의 요청 안에서 서버가 Supabase Auth에 비밀번호 로그인 → TOTP challenge·verify를 하고, 모두 맞고
 * 우리 운영자 표(05 operators)에 막히지 않고 2단계 인증을 켠 운영자로 있을 때만 우리 세션(operator-session.ts)을 만든다.
 * Supabase가 준 토큰은 우리 세션에 쓰지 않고 확인이 끝나면 끝낸다(signOut): 세션 길이(12시간 고정)와 로그아웃·계정 막기를
 * 우리 데이터베이스가 정하고, 화면에는 우리 쿠키 하나만 간다.
 *
 * 순서와 응답
 * 1. Origin 헤더가 이 요청의 주소(우리 화면과 같은 Worker)가 아니면 인증 서비스에 묻지 않고 401 operator_login_failed
 *    (다른 사이트가 운영자 브라우저로 로그인을 보내는 것을 막음, 06 DEC-10의 M18과 같은 이유). 세지 않는다.
 * 2. Content-Type이 JSON이 아니거나 본문이 06 OperatorSessionInput에 맞지 않으면 422 validation_failed(06 DEC-01). 세지 않는다.
 * 3. 이 이메일의 실패가 15분에 5번이면 429 too_many_attempts와 Retry-After(06 DEC-16). 아니면 시도 하나를 실패로 먼저 넣는다.
 * 4. 이메일·비밀번호·2단계 인증 번호 가운데 맞지 않는 것이 있거나, 운영자 표에 없거나 막혔거나 2단계 인증을 켜지 않았으면
 *    모두 같은 401 operator_login_failed(어느 것인지 알리지 않음). 실패 응답은 시작한 때부터 FAILURE_FLOOR_MS가 지나기 전에는
 *    보내지 않아, 어디서 틀렸는지가 응답 시간으로 드러나는 것을 줄인다.
 * 5. 인증 서비스가 답하지 않으면 503 auth_unavailable. 비밀번호 로그인부터 답이 없었으면 그 시도는 세지 않는다(맞는지 알게 된
 *    것이 없음). 비밀번호에 답한 뒤 끊겼으면 센다.
 * 6. 성공하면 그 이메일의 실패를 지우고 세션 쿠키(Max-Age 43200)와 운영자(06 Operator)를 200으로 준다.
 *
 * 남기지 않는 것: 비밀번호·번호·Supabase 토큰·이메일은 로그·데이터베이스·응답에 싣지 않는다(REQ-135). 로그에는 결과와
 * 운영자 ID(성공 때)만.
 */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { readJsonBody } from "./body";
import { AuthUnavailableError, type OperatorAuth } from "./operator-auth";
import { createOperatorScope, type OperatorScope } from "./operator-scope";
import {
  clearedCookie,
  clearFailures,
  createSession,
  emailHash,
  endSession,
  findOperatorByEmail,
  findSession,
  forgetAttempt,
  type LoginOperator,
  normalizeEmail,
  readSessionCookie,
  reserveAttempt,
  sessionCookie,
} from "./operator-session";
import { ApiError, type FieldError, fieldError } from "./problem";
import { MissingSettingError } from "./request-key";
import type { OperatorRequest } from "./routes";

/** 로그인 실패 응답의 최소 시간(밀리초). 인증 서비스를 부르는 수가 어디서 틀렸는지에 따라 1~5번이라 그 차이를 덮는다. */
export const FAILURE_FLOOR_MS = 2000;

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const OTP = /^[0-9]{6}$/;
const FIELD_NAME = /^[A-Za-z0-9_]{1,100}$/;
const JSON_TYPE = /^application\/json\s*(;\s*charset\s*=\s*"?utf-8"?\s*)?$/i;

interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly otp: string;
}

/** 글자 수(JSON Schema의 minLength·maxLength처럼 코드 포인트로 셈). */
function chars(s: string): number {
  return [...s].length;
}

/** 06 OperatorSessionInput 검사. 맞지 않는 필드마다 사유 코드(넣은 값은 싣지 않음). */
export function parseLoginInput(body: unknown): LoginInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw fieldError("/", "bad_format");
  const record = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  const text = (name: "email" | "password" | "otp", min: number, max: number, pattern: RegExp | null) => {
    const v = record[name];
    if (v === undefined) {
      errors.push({ field: `/${name}`, code: "required" });
      return;
    }
    if (typeof v !== "string" || v.includes("\u0000")) {
      errors.push({ field: `/${name}`, code: "bad_format" });
      return;
    }
    const n = chars(v);
    if (n < min) errors.push({ field: `/${name}`, code: "too_short" });
    else if (n > max) errors.push({ field: `/${name}`, code: "too_long" });
    else if (pattern !== null && !pattern.test(v)) errors.push({ field: `/${name}`, code: "bad_format" });
  };
  text("email", 3, 254, EMAIL);
  text("password", 1, 256, null);
  text("otp", 6, 6, OTP);
  for (const key of Object.keys(record)) {
    if (key === "email" || key === "password" || key === "otp") continue;
    // 계약 밖 필드. 이름이 위치 형식에 맞지 않으면 본문 전체(/)로.
    errors.push({ field: FIELD_NAME.test(key) ? `/${key}` : "/", code: "unknown_field" });
  }
  if (errors.length > 0) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return record as unknown as LoginInput;
}

/** Origin 헤더가 이 요청의 주소와 같은지(화면과 API는 같은 Worker, 같은 주소). 없으면 false. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin !== null && origin === new URL(req.url).origin;
}

/** 06 DEC-01: 받지 않는 Content-Type은 header:Content-Type·not_allowed. */
function requireJson(req: Request): void {
  const type = req.headers.get("content-type");
  if (type === null || !JSON_TYPE.test(type.trim())) throw fieldError("header:Content-Type", "not_allowed");
}

/**
 * 이메일·비밀번호·번호를 인증 서비스로 확인하고 우리 운영자 행을 찾는다. 맞지 않으면 null(어디서인지 가르지 않음).
 * answered()는 인증 서비스가 비밀번호에 답했을 때 부른다(그 뒤의 503은 시도로 셈).
 */
async function checkOperator(
  auth: OperatorAuth,
  db: HonoEnv["Variables"]["db"],
  input: LoginInput,
  answered: () => void,
): Promise<LoginOperator | null> {
  const signedIn = await auth.signInWithPassword(input.email, input.password);
  answered();
  if (signedIn === null) return null;
  let token = signedIn.accessToken;
  try {
    if (normalizeEmail(signedIn.user.email) !== normalizeEmail(input.email)) return null;
    let factors = signedIn.user.factors;
    if (factors === null) {
      const user = await auth.getUser(token);
      if (user === null) return null;
      factors = user.factors ?? [];
    }
    const totp = factors.filter((f) => f.type === "totp" && f.status === "verified");
    // 확인된 TOTP가 꼭 하나(없으면 2단계 인증을 켜지 않은 것, 둘 이상은 등록 도구가 만들지 않음: 닫힘).
    if (totp.length !== 1) return null;
    const upgraded = await auth.verifyTotp(token, (totp[0] as { id: string }).id, input.otp);
    if (upgraded === null) return null;
    token = upgraded;
    const operator = await findOperatorByEmail(db, signedIn.user.email);
    if (operator === null || operator.disabled || !operator.mfaEnrolled) return null;
    return operator;
  } finally {
    // Supabase 세션은 우리 세션에 쓰지 않는다. 끝내지 못해도 던지지 않는다(operator-auth.ts).
    await auth.signOut(token);
  }
}

/** API-004 운영자 로그인(openRoute: 세션이 생기기 전). */
export async function createOperatorSession(c: Context<HonoEnv>): Promise<Response> {
  const started = Date.now();
  if (!sameOrigin(c.req.raw)) throw new ApiError("operator_login_failed");
  requireJson(c.req.raw);
  const input = parseLoginInput(await readJsonBody(c));

  const services = c.get("services");
  const log = c.get("log");
  const traceId = c.get("traceId");
  const db = c.get("db");
  // 설정이 없으면 세기 전에 닫힌다(500, 로그에는 이름만).
  const auth = services.operatorAuth();
  const hashKey = c.get("settings").secrets.REQUEST_HASH_KEY;
  if (hashKey === null) throw new MissingSettingError("REQUEST_HASH_KEY is not set");

  const now = services.now();
  const key = await emailHash(hashKey, input.email);
  const reserved = await reserveAttempt(db, key, now);
  if (!reserved.ok) {
    log("info", { event: "operator_login", traceId, code: "too_many_attempts" });
    throw new ApiError("too_many_attempts", { retryAfterSeconds: reserved.retryAfterSeconds });
  }

  let answered = false;
  let operator: LoginOperator | null;
  try {
    operator = await checkOperator(auth, db, input, () => {
      answered = true;
    });
  } catch (e) {
    if (e instanceof AuthUnavailableError) {
      if (!answered) await forgetAttempt(db, reserved.id);
      // 이유(network·timeout·status·shape)와 셌는지만. 상태 코드는 인증 서비스가 준 것.
      log("error", {
        event: "operator_login",
        traceId,
        code: "auth_unavailable",
        errorName: e.name,
        names: [e.reason, answered ? "counted" : "not_counted"],
        ...(e.status !== null ? { status: e.status } : {}),
      });
      throw new ApiError("auth_unavailable");
    }
    // 예상하지 못한 오류(데이터베이스 등)는 사용자의 실패가 아니므로 세지 않는다.
    await forgetAttempt(db, reserved.id).catch(() => {});
    throw e;
  }

  if (operator === null) {
    log("info", { event: "operator_login", traceId, code: "operator_login_failed" });
    const left = FAILURE_FLOOR_MS - (Date.now() - started);
    if (left > 0) await services.wait(left);
    throw new ApiError("operator_login_failed");
  }

  await clearFailures(db, key);
  const token = await createSession(db, operator.id, now);
  log("info", { event: "operator_login", traceId, code: "signed_in", itemId: operator.id });
  return c.json({ operatorId: operator.id, displayName: operator.displayName }, 200, {
    "set-cookie": sessionCookie(token),
    "cache-control": "no-store",
  });
}

/** API-005 로그인한 운영자(operatorRoute). */
export async function getOperatorMe(r: OperatorRequest): Promise<Response> {
  return r.json({ operatorId: r.operator.operatorId, displayName: r.operator.displayName });
}

/**
 * API-006 운영자 로그아웃(openRoute: 세션이 없어도 204). 쿠키가 살아 있는 세션이고 Origin이 맞을 때만 그 세션을 끝내고,
 * 늘 쿠키를 지운다(Max-Age=0). Origin이 틀린 요청은 세션이 없는 것과 같다(06 DEC-10 M18): 다른 사이트가 운영자를
 * 로그아웃시키지 못한다.
 */
export async function deleteOperatorSession(c: Context<HonoEnv>): Promise<Response> {
  const token = readSessionCookie(c.req.header("cookie"));
  if (token !== null && sameOrigin(c.req.raw)) {
    const ended = await endSession(c.get("db"), token, c.get("services").now());
    if (ended) c.get("log")("info", { event: "operator_logout", traceId: c.get("traceId") });
  }
  return c.body(null, 204, { "set-cookie": clearedCookie(), "cache-control": "no-store" });
}

/**
 * 운영자 세션 해석기. 쿠키 siljang_operator가 살아 있는 세션이고 그 운영자가 막히지 않고 2단계 인증을 켰을 때만 운영자
 * 범위를 만든다. 아니면 401 unauthenticated(운영자 기록은 하나도 읽지 않음). 사장님 세션 쿠키는 보지 않는다(SPEC-001 #5).
 * 읽기(GET·HEAD)가 아닌 요청은 Origin도 맞아야 한다(06 DEC-10 M18).
 */
export async function resolveOperatorSession(c: Context<HonoEnv>): Promise<OperatorScope> {
  const token = readSessionCookie(c.req.header("cookie"));
  if (token === null) throw new ApiError("unauthenticated");
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !sameOrigin(c.req.raw)) throw new ApiError("unauthenticated");
  const found = await findSession(c.get("db"), token, c.get("services").now());
  if (found === null) throw new ApiError("unauthenticated");
  return createOperatorScope(found.operatorId, found.displayName);
}
