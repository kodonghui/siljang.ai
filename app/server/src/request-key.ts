/**
 * 요청 키(04 G2, 06 DEC-04, 05 TBL-050 request_keys와 5절 E27). TASK-018.
 *
 * 사장님·운영자의 쓰기 명령은 Idempotency-Key 헤더(16~64자, 영문·숫자·_·-)를 꼭 갖는다.
 * 서버는 (누른 사람, 키)마다 요청 지문(명령·경로의 ID·본문을 정한 차례로 이어 REQUEST_HASH_KEY로 만든 HMAC-SHA256)과
 * 처리 상태를 남긴다.
 * - 처음 온 키: 처리 중(기한 = 받은 때 + 60초)으로 남기고 명령을 한 트랜잭션에서 처리한다. 명령의 쓰기와 '끝남' 표시는
 *   같은 트랜잭션이라 둘 다 남거나 둘 다 남지 않는다.
 * - 같은 키·다른 지문: 422 idempotency_key_reused. 같은 키·처리 중(기한 안): 409 request_in_progress.
 * - 같은 키·처리 중인데 기한이 지남(처리하던 서버가 멈춤): 같은 지문의 다음 요청이 이어받아 처음부터 처리한다.
 *   처리 중 표시는 기한 값(processing_expires_at)을 표처럼 쓴다. 이어받기가 기한 값을 바꾸므로, 늦게 끝난 앞 요청은
 *   '끝남' 표시가 0행이 되어 자기 트랜잭션을 되돌리고 409 request_in_progress를 받는다(두 번 처리되지 않음).
 * - 같은 키·끝남: 처음 결과와 같은 상태 코드·결과 종류로, 처음 결과가 가리킨 기록(response_ref)을 지금 다시 읽은 본문을
 *   돌려주고 Idempotency-Replayed: true를 붙인다. 처음 본문은 남기지 않는다(개인정보, E27).
 * - 입력 검사 실패(422)·서버 오류(5xx)는 남기지 않고 처리 중 행을 지워 같은 키로 다시 보낼 수 있게 한다(DEC-04).
 *   확인 요청(409 confirmation_required)도 아무것도 바꾸지 않고 confirm 목록을 남길 곳이 없어 같은 방식으로 지운다.
 *   401·429도 결과가 아니라 지운다(로그인·횟수 제한은 키를 받기 전에 보는 것이 원칙).
 * - 24시간 지난 키는 지난 기록 지우기(SPEC-065, TASK-158)가 지운다.
 */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import type { Queryable, RequestDb } from "./db";
import { ApiError, ERRORS, type ErrorCode, fieldError, problemResponse } from "./problem";
import type { Secret } from "./settings";

export const REQUEST_KEY_HEADER = "Idempotency-Key";
export const REPLAYED_HEADER = "Idempotency-Replayed";
/** 처리 중의 기한(초). 지나면 같은 키·같은 지문의 다음 요청이 이어받는다(DEC-04). */
export const PROCESSING_SECONDS = 60;

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEADER_FIELD = `header:${REQUEST_KEY_HEADER}`;

/** 누른 사람. 사장님·운영자 세션(TASK-020·021)에서 온다. */
export interface Actor {
  readonly kind: "owner" | "operator";
  readonly id: string;
}

/** 헤더의 요청 키를 읽는다. 없거나 틀리면 422 validation_failed와 header:Idempotency-Key의 사유. */
export function readRequestKey(headers: Headers): string {
  const raw = headers.get(REQUEST_KEY_HEADER);
  if (raw === null || raw === "") throw fieldError(HEADER_FIELD, "required");
  if (raw.length < 16) throw fieldError(HEADER_FIELD, "too_short");
  if (raw.length > 64) throw fieldError(HEADER_FIELD, "too_long");
  if (!KEY_PATTERN.test(raw)) throw fieldError(HEADER_FIELD, "bad_format");
  return raw;
}

/** 키 차례를 정렬한 JSON(같은 내용이면 키 차례가 달라도 같은 글). undefined인 속성은 뺀다(JSON.stringify와 같음). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** 요청 지문: HMAC-SHA256(REQUEST_HASH_KEY, [명령, 경로의 ID들, 본문]의 정렬한 JSON)의 소문자 16진수 64자. */
export async function requestHash(
  key: Secret,
  command: string,
  pathIds: readonly string[],
  body: unknown,
): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key.reveal()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = canonicalJson([command, [...pathIds], body ?? null]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface KeyId {
  readonly actor: Actor;
  readonly requestKey: string;
}

/** 남긴 처음 결과. */
export interface StoredResult {
  readonly status: number;
  readonly code: string;
  readonly ref: Readonly<Record<string, unknown>>;
}

export type Claim =
  | { readonly kind: "claimed"; readonly token: string; readonly takenOver: boolean }
  | { readonly kind: "replay"; readonly stored: StoredResult }
  | { readonly kind: "reused" }
  | { readonly kind: "in_progress" };

const PK = "actor_kind = $1 AND actor_id = $2 AND request_key = $3";

/**
 * 키를 받는다(트랜잭션 밖, 문장마다 바로 커밋). 처음이면 처리 중 행을 넣고, 있으면 지문·상태로 가린다.
 * token은 처리 중 기한 값(마이크로초까지 글로)이고, 끝남·지우기 때 내 처리인지 견주는 데 쓴다.
 */
export async function claimRequestKey(db: Queryable, id: KeyId, command: string, hash: string): Promise<Claim> {
  const key = [id.actor.kind, id.actor.id, id.requestKey];
  // 지운 행과 엇갈리면(앞 요청이 422·5xx로 지움) 처음부터 다시 본다. 세 번이면 충분하다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await db.query<{ token: string }>(
      `INSERT INTO request_keys (actor_kind, actor_id, request_key, command, request_hash, state, processing_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'processing', clock_timestamp() + make_interval(secs => $6))
       ON CONFLICT (actor_kind, actor_id, request_key) DO NOTHING
       RETURNING processing_expires_at::text AS token`,
      [...key, command, hash, PROCESSING_SECONDS],
    );
    const first = inserted.rows[0];
    if (first !== undefined) return { kind: "claimed", token: first.token, takenOver: false };

    const taken = await db.query<{ token: string }>(
      `UPDATE request_keys SET processing_expires_at = clock_timestamp() + make_interval(secs => $6)
       WHERE ${PK} AND state = 'processing' AND processing_expires_at <= clock_timestamp()
         AND command = $4 AND request_hash = $5
       RETURNING processing_expires_at::text AS token`,
      [...key, command, hash, PROCESSING_SECONDS],
    );
    const takeover = taken.rows[0];
    if (takeover !== undefined) return { kind: "claimed", token: takeover.token, takenOver: true };

    const current = await db.query<{
      command: string;
      request_hash: string;
      state: string;
      response_status: number | null;
      response_code: string | null;
      response_ref: Record<string, unknown>;
    }>(
      `SELECT command, request_hash, state, response_status, response_code, response_ref
       FROM request_keys WHERE ${PK}`,
      key,
    );
    const row = current.rows[0];
    if (row === undefined) continue;
    if (row.command !== command || row.request_hash !== hash) return { kind: "reused" };
    if (row.state !== "done" || row.response_status === null || row.response_code === null) {
      return { kind: "in_progress" };
    }
    return {
      kind: "replay",
      stored: { status: row.response_status, code: row.response_code, ref: row.response_ref },
    };
  }
  return { kind: "in_progress" };
}

/** 내 처리 중 행을 끝남으로. 이어받기로 기한 값이 바뀌었으면 0행이라 LostClaimError(트랜잭션을 되돌리게). */
export async function completeRequestKey(q: Queryable, id: KeyId, token: string, result: StoredResult): Promise<void> {
  const r = await q.query(
    `UPDATE request_keys
     SET state = 'done', processing_expires_at = NULL, done_at = clock_timestamp(),
         response_status = $5, response_code = $6, response_ref = $7::jsonb
     WHERE ${PK} AND state = 'processing' AND processing_expires_at = $4::timestamptz`,
    [id.actor.kind, id.actor.id, id.requestKey, token, result.status, result.code, JSON.stringify(result.ref)],
  );
  if (r.rowCount !== 1) throw new LostClaimError("request key was taken over");
}

/** 내 처리 중 행을 지운다(422·5xx 뒤, 같은 키로 다시 보낼 수 있게). 이어받긴 행은 건드리지 않는다. */
export async function releaseRequestKey(q: Queryable, id: KeyId, token: string): Promise<void> {
  await q.query(
    `DELETE FROM request_keys WHERE ${PK} AND state = 'processing' AND processing_expires_at = $4::timestamptz`,
    [id.actor.kind, id.actor.id, id.requestKey, token],
  );
}

/** 처리하던 키를 다른 요청이 이어받음. 내 트랜잭션은 되돌리고 409 request_in_progress. */
export class LostClaimError extends Error {
  override readonly name = "LostClaimError";
}

/** 명령의 성공 결과. ref는 다시 왔을 때 본문을 다시 읽을 기록의 ID만(개인정보·시크릿 없음). */
export interface CommandResult {
  readonly status: 200 | 201 | 202 | 204;
  /** 결과 종류(1~60자, 소문자·숫자·_). G7의 결과 이름. */
  readonly code: string;
  readonly ref: Readonly<Record<string, string | number | null>>;
  /** 처음 응답 본문. 204면 undefined. 남기지 않는다. */
  readonly body: unknown;
}

export interface CommandSpec {
  /** 명령 이름: 06의 API ID(예: API-010). 지문에 들어가므로 명령마다 하나로 고정. */
  readonly command: string;
  readonly actor: Actor;
  /** 경로의 ID들(계약의 경로 차례). */
  readonly pathIds: readonly string[];
  /** 읽은 본문(JSON). 지문에 들어간다. */
  readonly body: unknown;
  /** 명령의 일. 한 트랜잭션 안에서 돈다. 계약의 오류는 ApiError로 던진다. */
  prepare?(db: Queryable): Promise<void>;
  execute(tx: Queryable): Promise<CommandResult>;
  /**
   * 같은 키가 다시 왔을 때 처음 결과가 가리킨 기록(ref)을 지금 읽어 본문을 만든다(204면 undefined). 한 트랜잭션 안에서 돈다
   * (접속기록과 같은 트랜잭션, TASK-024).
   */
  render(db: Queryable, stored: StoredResult): Promise<unknown>;
}

const RESULT_CODE = /^[a-z][a-z0-9_]{0,59}$/;

/**
 * 처음 결과로 남기는 오류인지. 422·5xx·확인 요청·401·429는 남기지 않는다(파일 첫머리 주석).
 * 405도 남기지 않는다: 다시 돌려줄 때 Allow 목록이 없어 계약의 모양으로 다시 만들 수 없다(처리기가 던질 일도 없음).
 */
export function isStoredError(code: ErrorCode): boolean {
  const status: number = ERRORS[code].status;
  if (status >= 500 || status === 422 || status === 401 || status === 405 || status === 429) return false;
  return code !== "confirmation_required";
}

function pathOf(c: Context<HonoEnv>): string {
  return new URL(c.req.url).pathname;
}

function isErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(ERRORS, code);
}

function replayedResponse(c: Context<HonoEnv>, stored: StoredResult, body: unknown): Response {
  if (stored.status >= 400) {
    if (!isErrorCode(stored.code)) throw new TypeError("stored error code is not in the contract");
    return problemResponse(stored.code, c.get("traceId"), pathOf(c), {}, { [REPLAYED_HEADER]: "true" });
  }
  const headers = { [REPLAYED_HEADER]: "true", "cache-control": "no-store" };
  if (stored.status === 204 || body === undefined) return c.body(null, stored.status as 204, headers);
  return c.json(body as object, stored.status as 200, headers);
}

/**
 * 요청 키를 지키며 쓰기 명령 하나를 처리한다. 입력 검사(헤더) → 키 받기 → 한 트랜잭션에서 명령과 끝남 표시.
 * 오류는 ApiError로 던져 onError가 Problem으로 만든다.
 */
export async function runCommand(c: Context<HonoEnv>, spec: CommandSpec): Promise<Response> {
  const requestKey = readRequestKey(c.req.raw.headers);
  const hashKey = c.get("settings").secrets.REQUEST_HASH_KEY;
  if (hashKey === null) throw new MissingSettingError("REQUEST_HASH_KEY is not set");
  const db: RequestDb = c.get("db");
  const id: KeyId = { actor: spec.actor, requestKey };
  const hash = await requestHash(hashKey, spec.command, spec.pathIds, spec.body);

  const claim = await claimRequestKey(db, id, spec.command, hash);
  if (claim.kind === "reused") throw new ApiError("idempotency_key_reused");
  if (claim.kind === "in_progress") throw new ApiError("request_in_progress");
  if (claim.kind === "replay") {
    // 다시 읽기는 한 트랜잭션에서 한다: 접속기록을 남기는 경로는 같은 트랜잭션에 접속기록 한 행을 넣는다(TASK-024, 05 A24).
    // 남긴 오류의 다시 보냄은 아무것도 읽지 않는다(개인정보를 돌려주지 않으므로 접속기록도 없음).
    const stored = claim.stored;
    const body = stored.status >= 400 ? undefined : await db.transaction((tx) => spec.render(tx, stored));
    c.get("log")("info", {
      event: "request_replayed",
      traceId: c.get("traceId"),
      status: claim.stored.status,
      code: claim.stored.code,
    });
    return replayedResponse(c, claim.stored, body);
  }

  const { token } = claim;
  try {
    await spec.prepare?.(db);
    const result = await db.transaction(async (tx) => {
      const r = await spec.execute(tx);
      if (!RESULT_CODE.test(r.code)) throw new TypeError("result code must be a short name");
      await completeRequestKey(tx, id, token, { status: r.status, code: r.code, ref: r.ref });
      return r;
    });
    if (result.status === 204 || result.body === undefined) {
      return c.body(null, result.status as 204, { "cache-control": "no-store" });
    }
    return c.json(result.body as object, result.status, { "cache-control": "no-store" });
  } catch (err) {
    if (err instanceof LostClaimError) throw new ApiError("request_in_progress");
    if (err instanceof ApiError && isStoredError(err.code)) {
      // 명령은 아무것도 남기지 않았다(되돌림). 그 결과(상태 코드·오류 코드)만 처음 결과로 남긴다.
      try {
        await completeRequestKey(db, id, token, { status: ERRORS[err.code].status, code: err.code, ref: {} });
      } catch (e) {
        if (e instanceof LostClaimError) throw new ApiError("request_in_progress");
        throw e;
      }
      throw err;
    }
    try {
      await releaseRequestKey(db, id, token);
    } catch {
      // 지우지 못하면 60초 뒤 같은 키·같은 지문의 다음 요청이 이어받는다.
    }
    throw err;
  }
}

/** 꼭 있어야 하는 설정이 없음. 응답은 internal(500), 로그에는 이름만. */
export class MissingSettingError extends Error {
  override readonly name = "MissingSettingError";
}
