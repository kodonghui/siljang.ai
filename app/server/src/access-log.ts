/**
 * 접속기록 남기기(TASK-024; 04 SPEC-074·G6, 05 앱 규칙 A24·결정 E21·TBL-053 access_logs, 06 README 5절 '접속기록',
 * REQ-196, 「개인정보의 안전성 확보조치 기준」 제8조①③).
 *
 * - 남기는 API: 06이 정한 사장님 API-040~066과 운영자의 가게 기록 API-074~077(ACCESS_LOG_APIS). 그 경로는 routes.ts의
 *   accessRoute로만 선언하고, 처리기는 접속기록을 남기는 읽기(read)와 쓰기 명령(command)으로만 데이터베이스를 쓴다.
 *   시험이 이 목록을 06과, 앱의 선언을 06의 (방법, 경로)와 견준다(test/access-log.test.ts). 목록 밖 경로는 이 도구를 받지 않아
 *   접속기록을 남기지 못한다(가게 설정·카카오 스킬·서버 안의 일, SPEC-074).
 * - 한 요청에 한 행, 응답과 같은 트랜잭션: 읽기는 읽기와 넣기를, 쓰기 명령은 명령과 넣기와 요청 키의 '끝남' 표시를, 같은 요청
 *   키로 다시 온 요청은 본문 다시 읽기와 넣기를 한 트랜잭션에서 한다. 넣지 못하면 되돌리고 500 internal(개인정보를 돌려주지
 *   않음). 오류 응답은 행을 남기지 않는다(트랜잭션이 되돌려짐).
 * - 누가: 가게 범위의 사장님·운영자(shop-scope.ts의 actorOf). 어디서: Cloudflare가 넣는 CF-Connecting-IP만(clientIp).
 *   없거나 IP 꼴이 아니면 닫힘(500). X-Forwarded-For처럼 부르는 쪽이 보낸 값을 덧붙이는 헤더는 보지 않는다.
 * - 무엇을: 행동(read·change·open_original·open_kept), API 번호, 쿼리 없는 경로, 손님 ID 목록(값 없이 ID만, 빈 목록도 한 행),
 *   연 경우의 대상·사유. 05의 CHECK 넷과 컬럼 CHECK를 넣기 전에 여기서 본다(어기면 코드의 잘못이라 500).
 * - 로그: 실패하면 access_log_failed 한 줄에 추적 ID·API 번호·사유 코드나 SQLSTATE만(G6). 경로·IP·손님 ID·사유 글은 싣지 않는다.
 * - 고치기·지우기·비우기는 데이터베이스 트리거(access_logs_guard)가 막고, 2년 지난 행 지우기는 지우기 작업(SPEC-065, TASK-158).
 */
import type { Logger } from "./app";
import { sqlStateOf } from "./db";
import type { Actor } from "./request-key";
import { isUuid, type ShopDb } from "./shop-scope";

/** 접속기록 API를 부르는 쪽. */
export type AccessVia = "owner" | "operator";

function apiRange(from: number, to: number, via: AccessVia): [string, AccessVia][] {
  const out: [string, AccessVia][] = [];
  for (let n = from; n <= to; n += 1) out.push([`API-${String(n).padStart(3, "0")}`, via]);
  return out;
}

/**
 * 06이 접속기록을 남기게 한 API와 그 API를 부르는 쪽: components.x-corthex.jobs의 SPEC-074 seen_in
 * 'API-040~066, API-074~077'과 06 README 5절 '접속기록'(사장님 API-040~066, 운영자의 가게 기록 API-074~077).
 */
export const ACCESS_LOG_APIS: ReadonlyMap<string, AccessVia> = new Map([
  ...apiRange(40, 66, "owner"),
  ...apiRange(74, 77, "operator"),
]);

/** 운영자가 원래 값 열기(open_original)로 여는 대상(05 target_kind, 보관 기록 kept_record는 open_kept만). */
export type OpenTarget = "masked_value" | "order_contact" | "refund_account" | "consultation_text";
const OPEN_TARGETS: ReadonlySet<string> = new Set<OpenTarget>([
  "masked_value",
  "order_contact",
  "refund_account",
  "consultation_text",
]);

/**
 * 처리기가 넘기는 접속기록 한 행의 '무엇을'. subjects는 응답이 담았거나 바꾼 손님 ID(customers.id)들이다(값 없이 ID만).
 * 열기는 운영자만 하고 대상과 사유(5~200자)가 꼭 있다(05 access_logs_open_chk·open_operator_chk·target_chk).
 */
export type AccessEntry =
  | { readonly action: "read" | "change"; readonly subjects: readonly string[] }
  | {
      readonly action: "open_original";
      readonly subjects: readonly string[];
      readonly target: { readonly kind: OpenTarget; readonly id: string };
      readonly reason: string;
    }
  | {
      readonly action: "open_kept";
      readonly subjects: readonly string[];
      readonly target: { readonly kind: "kept_record"; readonly id: string };
      readonly reason: string;
    };

/** 경로가 정하는 '누가·어디서·어느 API로'. */
export interface AccessContext {
  readonly actor: Actor;
  /** 06 API 번호(ACCESS_LOG_APIS 안). */
  readonly api: string;
  /** 요청 경로(쿼리 없음). */
  readonly path: string;
  /** clientIp가 읽은 접속지. */
  readonly clientIp: string;
}

/** 넣을 행(05 access_logs의 열, shop_id는 ShopDb가 $1로 채우고 accessed_at은 기본 now()). */
export interface AccessRow {
  readonly actorKind: AccessVia;
  readonly ownerId: string | null;
  readonly operatorId: string | null;
  readonly action: AccessEntry["action"];
  readonly apiId: string;
  readonly requestPath: string;
  readonly subjectIds: readonly string[];
  readonly targetKind: string | null;
  readonly targetId: string | null;
  readonly reason: string | null;
  readonly clientIp: string;
}

/** 접속기록을 남기지 못하는 까닭(로그의 code). 값은 싣지 않는다. */
export type AccessLogFailure =
  | "client_ip_missing"
  | "client_ip_invalid"
  | "path_invalid"
  | "api_invalid"
  | "actor_invalid"
  | "entry_invalid"
  | "subject_invalid"
  | "open_by_owner"
  | "target_invalid"
  | "reason_invalid"
  | "change_on_replay"
  | "logged_twice"
  | "not_logged";

/** 접속기록을 남길 수 없음(접속지 헤더가 없거나 코드의 잘못). 응답은 500 internal, 로그에는 이름과 사유 코드만. */
export class AccessLogError extends Error {
  override readonly name = "AccessLogError";
  readonly failure: AccessLogFailure;

  constructor(failure: AccessLogFailure) {
    super(failure);
    this.failure = failure;
  }
}

/** Cloudflare가 요청마다 넣는 접속지 헤더(Cloudflare 문서 'Cloudflare HTTP headers', 2026-11-16 확인, app/README.md 67). */
export const CLIENT_IP_HEADER = "CF-Connecting-IP";

/** 05 access_logs.client_ip의 CHECK. */
const CLIENT_IP_CHECK = /^[0-9A-Fa-f:.]{2,45}$/;
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/;

function isIpv6(s: string): boolean {
  const halves = s.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((h) => (h === "" ? [] : h.split(":")));
  let count = 0;
  for (const [i, g] of groups.entries()) {
    if (g.includes(".")) {
      // 끝의 IPv4(::ffff:198.51.100.7 꼴)만 받는다. 16비트 묶음 두 개로 센다.
      if (i !== groups.length - 1 || !s.endsWith(g) || !IPV4.test(g)) return false;
      count += 2;
    } else if (HEX_GROUP.test(g)) {
      count += 1;
    } else {
      return false;
    }
  }
  return halves.length === 2 ? count <= 7 : count === 8;
}

/** IPv4·IPv6 주소 하나인지(포트·대괄호·영역 ID·여러 값 없음)와 05 CHECK에 맞는지. */
export function isClientIp(value: string): boolean {
  return CLIENT_IP_CHECK.test(value) && (IPV4.test(value) || isIpv6(value));
}

/**
 * 접속지: CF-Connecting-IP만 읽는다. Cloudflare는 이 헤더에 Cloudflare에 접속한 쪽의 IP 하나를 넣고, X-Forwarded-For는
 * 부르는 쪽이 보낸 값에 덧붙인다(Cloudflare 문서). 없거나(Remove visitor IP headers를 켬, wrangler dev 밖의 시험) IP 꼴이
 * 아니면 AccessLogError(닫힘, 500).
 */
export function clientIp(headers: Headers): string {
  const raw = headers.get(CLIENT_IP_HEADER);
  if (raw === null || raw === "") throw new AccessLogError("client_ip_missing");
  if (!isClientIp(raw)) throw new AccessLogError("client_ip_invalid");
  return raw;
}

/** PostgreSQL char_length처럼 글자(코드 포인트) 수. */
function charLength(s: string): number {
  return [...s].length;
}

function subjectIds(subjects: unknown): string[] {
  if (!Array.isArray(subjects)) throw new AccessLogError("subject_invalid");
  const ids: string[] = [];
  for (const id of subjects) {
    if (!isUuid(id)) throw new AccessLogError("subject_invalid");
    const lower = id.toLowerCase();
    if (!ids.includes(lower)) ids.push(lower);
  }
  return ids;
}

/**
 * 넣을 행을 만든다. 05의 컬럼 CHECK와 CHECK 넷(actor·open·open_operator·target)을 넣기 전에 본다.
 * 어기면 AccessLogError(코드의 잘못이나 접속지 헤더 문제라 500, 행 없음).
 */
export function accessRow(ctx: AccessContext, entry: AccessEntry): AccessRow {
  const { actor } = ctx;
  if ((actor.kind !== "owner" && actor.kind !== "operator") || !isUuid(actor.id)) {
    throw new AccessLogError("actor_invalid");
  }
  if (!/^API-[0-9]{3}$/.test(ctx.api) || !ACCESS_LOG_APIS.has(ctx.api)) throw new AccessLogError("api_invalid");
  const path = ctx.path;
  if (path.length < 1 || charLength(path) > 300 || !path.startsWith("/") || /[?#]/.test(path)) {
    throw new AccessLogError("path_invalid");
  }
  if (!isClientIp(ctx.clientIp)) throw new AccessLogError("client_ip_invalid");
  const base = {
    actorKind: actor.kind,
    ownerId: actor.kind === "owner" ? actor.id.toLowerCase() : null,
    operatorId: actor.kind === "operator" ? actor.id.toLowerCase() : null,
    apiId: ctx.api,
    requestPath: path,
    clientIp: ctx.clientIp,
  };
  const loose = entry as { action?: unknown; subjects?: unknown; target?: unknown; reason?: unknown };
  if (loose.action === "read" || loose.action === "change") {
    if (loose.target !== undefined || loose.reason !== undefined) throw new AccessLogError("entry_invalid");
    return {
      ...base,
      action: loose.action,
      subjectIds: subjectIds(loose.subjects),
      targetKind: null,
      targetId: null,
      reason: null,
    };
  }
  if (loose.action !== "open_original" && loose.action !== "open_kept") throw new AccessLogError("entry_invalid");
  // 원래 값·보관 기록 열기는 운영자만(05 access_logs_open_operator_chk, REQ-195).
  if (actor.kind !== "operator") throw new AccessLogError("open_by_owner");
  const target = loose.target as { kind?: unknown; id?: unknown } | undefined;
  const kind = target?.kind;
  const targetId = target?.id;
  const kindOk =
    loose.action === "open_kept" ? kind === "kept_record" : typeof kind === "string" && OPEN_TARGETS.has(kind);
  if (!kindOk || !isUuid(targetId)) throw new AccessLogError("target_invalid");
  const reason = loose.reason;
  if (typeof reason !== "string" || reason.trim() === "" || charLength(reason) < 5 || charLength(reason) > 200) {
    throw new AccessLogError("reason_invalid");
  }
  return {
    ...base,
    action: loose.action,
    subjectIds: subjectIds(loose.subjects),
    targetKind: kind as string,
    targetId: targetId.toLowerCase(),
    reason,
  };
}

const INSERT_ACCESS_LOG = `INSERT INTO access_logs (shop_id, actor_kind, owner_id, operator_id, action, api_id, request_path,
                         subject_ids, target_kind, target_id, reason, client_ip)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`;

/** 접속기록 한 행을 tx(가게 범위 연결, 응답과 같은 트랜잭션)에 넣는다. 가게는 tx의 가게, 시각은 그 트랜잭션의 now(). */
async function insertAccessLog(tx: ShopDb, row: AccessRow): Promise<void> {
  await tx.run(INSERT_ACCESS_LOG, [
    row.actorKind,
    row.ownerId,
    row.operatorId,
    row.action,
    row.apiId,
    row.requestPath,
    JSON.stringify(row.subjectIds),
    row.targetKind,
    row.targetId,
    row.reason,
    row.clientIp,
  ]);
}

/**
 * 요청 하나의 접속기록. routes.ts의 accessRoute만 만들고, 처리기의 읽기·쓰기 명령이 그 트랜잭션 안에서 record를 한 번 부른다.
 * - record는 요청마다 한 번(두 번째는 logged_twice). 넣기에 실패하면 로그 한 줄을 남기고 다시 던진다(트랜잭션이 되돌려짐).
 * - committed: 넣은 트랜잭션이 커밋됨(감싼 쪽이 커밋 뒤 표시). 성공 응답인데 커밋된 행이 없으면 경로가 닫는다(not_logged).
 */
export class AccessRecorder {
  readonly #ctx: AccessContext;
  readonly #log: Logger;
  readonly #traceId: string;
  #attempted = false;
  #committed = false;

  private constructor(ctx: AccessContext, log: Logger, traceId: string) {
    this.#ctx = ctx;
    this.#log = log;
    this.#traceId = traceId;
  }

  /** 요청을 처리하기 전에 만든다. 접속지 헤더가 없거나 틀리면 여기서 닫힌다(아무것도 읽지 않음). */
  static start(
    input: { readonly actor: Actor; readonly api: string; readonly url: string; readonly headers: Headers },
    log: Logger,
    traceId: string,
  ): AccessRecorder {
    const fail = (err: unknown): never => {
      AccessRecorder.#report(log, traceId, input.api, err);
      throw err;
    };
    let ip = "";
    try {
      ip = clientIp(input.headers);
    } catch (err) {
      fail(err);
    }
    return new AccessRecorder(
      { actor: input.actor, api: input.api, path: new URL(input.url).pathname, clientIp: ip },
      log,
      traceId,
    );
  }

  static #report(log: Logger, traceId: string, api: string, err: unknown): void {
    const dbCode = sqlStateOf(err);
    log("error", {
      event: "access_log_failed",
      traceId,
      api,
      errorName: dbCode !== undefined ? "DatabaseError" : err instanceof Error ? err.name : "Error",
      ...(err instanceof AccessLogError ? { code: err.failure } : {}),
      ...(dbCode !== undefined ? { dbCode } : {}),
    });
  }

  get attempted(): boolean {
    return this.#attempted;
  }

  get committed(): boolean {
    return this.#committed;
  }

  /** 응답과 같은 트랜잭션(tx) 안에서 한 행을 넣는다. replay면 다시 온 요청(바꾸지 않으므로 change는 받지 않음). */
  async record(tx: ShopDb, entry: AccessEntry, options: { readonly replay?: boolean } = {}): Promise<void> {
    try {
      if (this.#attempted) throw new AccessLogError("logged_twice");
      this.#attempted = true;
      if (options.replay === true && (entry as { action?: unknown }).action === "change") {
        throw new AccessLogError("change_on_replay");
      }
      await insertAccessLog(tx, accessRow(this.#ctx, entry));
    } catch (err) {
      AccessRecorder.#report(this.#log, this.#traceId, this.#ctx.api, err);
      throw err;
    }
  }

  /** record를 부른 트랜잭션이 커밋됨. */
  markCommitted(): void {
    if (this.#attempted) this.#committed = true;
  }

  /** 성공 응답(2xx)인데 커밋된 행이 없으면 닫는다(처리기가 읽기·쓰기 명령을 거치지 않고 응답을 만듦). */
  assertLogged(status: number): void {
    if (status >= 200 && status < 300 && !this.#committed) {
      const err = new AccessLogError("not_logged");
      AccessRecorder.#report(this.#log, this.#traceId, this.#ctx.api, err);
      throw err;
    }
  }
}
