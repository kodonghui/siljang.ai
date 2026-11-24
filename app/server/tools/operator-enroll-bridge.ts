/** 새 합성 운영자 등록의 비출력 전달. 실제 SQL 결과를 확인하기 전에는 성공 행을 반환하지 않는다. */
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Queryable } from "../src/db";
import { OPERATOR_ENROLLMENT_SQL } from "./operator-enroll";

export class EnrollmentBridgeError extends Error {
  override readonly name = "EnrollmentBridgeError";
  constructor() {
    super("운영자 등록 전달 자료나 실제 결과를 확인하지 못했어요");
  }
}
export interface EnrollmentRequest {
  readonly schemaVersion: 1;
  readonly nonce: string;
  readonly digest: string;
  readonly email: string;
  readonly sql: string;
  readonly params: readonly [string, string, string, string, string];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TEST_EMAIL = /^mvp-operator-[0-9]{8}(?:-[a-z0-9]{4,16})?@example\.com$/;
const NONCE = /^[0-9a-f]{32}$/;
const DIGEST = /^[0-9a-f]{64}$/;

/** RFC6238 SHA-1·30초·6자리. 우리가 새로 등록한 합성 계정의 비밀에만 쓴다. */
export function totpCode(secret: string, atMs = Date.now()): string {
  if (!/^[A-Z2-7]{16,128}={0,6}$/.test(secret) || !Number.isSafeInteger(atMs) || atMs < 0)
    throw new EnrollmentBridgeError();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0,
    bits = 0;
  const bytes: number[] = [];
  for (const char of secret.replace(/=+$/, "")) {
    value = (value << 5) | chars.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) throw new EnrollmentBridgeError();
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const last = digest.at(-1);
  if (last === undefined) throw new EnrollmentBridgeError();
  return String((digest.readUInt32BE(last & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}
function requestDigest(value: Omit<EnrollmentRequest, "digest">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function enrollmentRequest(
  sql: string,
  params: readonly unknown[],
  target: { email: string; authUserId: string },
  nonce = randomBytes(16).toString("hex"),
): EnrollmentRequest {
  if (
    sql !== OPERATOR_ENROLLMENT_SQL ||
    !TEST_EMAIL.test(target.email) ||
    !UUID.test(target.authUserId) ||
    !NONCE.test(nonce) ||
    params.length !== 5
  )
    throw new EnrollmentBridgeError();
  const [email, name, user, factor, at] = params;
  if (
    email !== target.email ||
    user !== target.authUserId ||
    typeof name !== "string" ||
    !name.startsWith("합성") ||
    [...name].length > 40 ||
    typeof factor !== "string" ||
    !UUID.test(factor)
  )
    throw new EnrollmentBridgeError();
  const timestamp = at instanceof Date ? at : new Date(typeof at === "string" ? at : NaN);
  if (Number.isNaN(timestamp.getTime())) throw new EnrollmentBridgeError();
  const values: EnrollmentRequest["params"] = [target.email, name, target.authUserId, factor, timestamp.toISOString()];
  const base = { schemaVersion: 1 as const, nonce, email: target.email, sql, params: values };
  return { ...base, digest: requestDigest(base) };
}
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
/** 정상 SQL Editor에서만 실행한다. 기존 다른 계정/인증수단은 잠금 아래 거절하고 실제 저장 결과를 돌려준다. */
export function renderEnrollmentSql(request: EnrollmentRequest): string {
  const canonical = enrollmentRequest(
    request.sql,
    request.params,
    { email: request.email, authUserId: request.params[2] },
    request.nonce,
  );
  if (request.schemaVersion !== 1 || !DIGEST.test(request.digest) || canonical.digest !== request.digest)
    throw new EnrollmentBridgeError();
  const [email, , user, factor] = request.params;
  const functionName = `siljang_enroll_${request.nonce}`;
  const sql = request.sql.replace("INSERT INTO operators (", "INSERT INTO public.operators (");
  // 자유 입력은 달러 인용 함수 본문에 넣지 않고 형식이 정해진 함수 인자로 전달한다.
  return `CREATE OR REPLACE FUNCTION pg_temp.${functionName}(p_email text,p_name text,p_user uuid,p_factor uuid,p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $siljang_enroll$
DECLARE saved_id uuid; saved_disabled boolean; proof jsonb;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  IF $1<>${literal(email)} OR $3<>${literal(user)}::uuid OR $4<>${literal(factor)}::uuid THEN
    RAISE EXCEPTION 'operator_enrollment_scope' USING ERRCODE='check_violation';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u JOIN auth.mfa_factors f ON f.user_id=u.id
    WHERE u.id=$3 AND lower(u.email)=$1 AND u.email_confirmed_at IS NOT NULL
      AND f.id=$4 AND f.status='verified' AND f.factor_type='totp') THEN
    RAISE EXCEPTION 'operator_enrollment_auth_unverified' USING ERRCODE='check_violation';
  END IF;
  LOCK TABLE public.operators IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.operators WHERE lower(email)=$1
    AND (auth_user_id IS DISTINCT FROM $3 OR mfa_factor_id IS DISTINCT FROM $4)) THEN
    RAISE EXCEPTION 'operator_enrollment_target_conflict' USING ERRCODE='check_violation';
  END IF;
  ${sql} INTO saved_id,saved_disabled;
  SELECT jsonb_build_object(
    'requestNonce',${literal(request.nonce)},'requestDigest',${literal(request.digest)},
    'operatorId',o.id,'disabled',o.disabled_at IS NOT NULL,
    'authUserMatches',o.auth_user_id=$3,'factorMatches',o.mfa_factor_id=$4,
    'factorVerified',f.status='verified' AND f.factor_type='totp',
    'userConfirmed',u.email_confirmed_at IS NOT NULL AND lower(u.email)=$1
  ) INTO proof
  FROM public.operators o
  LEFT JOIN auth.users u ON u.id=o.auth_user_id
  LEFT JOIN auth.mfa_factors f ON f.id=o.mfa_factor_id AND f.user_id=o.auth_user_id
  WHERE o.id=saved_id;
  RETURN proof;
END $siljang_enroll$;
SELECT pg_temp.${functionName}(${request.params.map(literal).join(",")}) AS result;
`;
}
export function enrollmentDb(options: {
  email: string;
  authUserId: string;
  exchange(request: EnrollmentRequest): Promise<unknown>;
}): Queryable {
  let used = false;
  return {
    query: async <R>(sql: string, params: readonly unknown[] = []) => {
      if (used) throw new EnrollmentBridgeError();
      used = true;
      const request = enrollmentRequest(sql, params, options);
      const response = await options.exchange(request);
      if (typeof response !== "object" || response === null || Array.isArray(response))
        throw new EnrollmentBridgeError();
      const proof = response as Record<string, unknown>;
      if (
        proof.requestNonce !== request.nonce ||
        proof.requestDigest !== request.digest ||
        typeof proof.operatorId !== "string" ||
        !UUID.test(proof.operatorId) ||
        typeof proof.disabled !== "boolean" ||
        ["authUserMatches", "factorMatches", "factorVerified", "userConfirmed"].some((key) => proof[key] !== true)
      )
        throw new EnrollmentBridgeError();
      const rows: unknown[] = [{ id: proof.operatorId, disabled: proof.disabled }];
      return { rows: rows as R[], rowCount: 1 };
    },
  };
}
