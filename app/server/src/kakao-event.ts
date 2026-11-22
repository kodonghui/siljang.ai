/** TASK-028 G4/G5·DEC-20. 접수와 전달 확인은 별개이며 이 모듈은 DB/자동 재전송/로그를 갖지 않는다.
 * 공식 문서: https://kakaobusiness.gitbook.io/main/tool/chatbot/main_notions/event-api
 * 업무 실행기는 가게 범위에서 선점한 스냅샷을 넘기고 아래 계획을 같은 선점의 결과로만 기록한다.
 * 실제 발신/업무 렌더러 연결은 TASK-104·167에서 한다. 현재 서비스 생성만으로는 HTTP를 보내지 않는다.
 */
import { deliveryChecksDone, nextDeliveryCheckAt, nextKakaoAttemptAt } from "./retry";
import type { Secret } from "./settings";
import { isTimeZone, toShopLocal } from "./time";

const ORIGIN = "https://bot-api.kakao.com";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 16_384;
const INVALID = "invalid Kakao event input";

export interface NoticeEventInput {
  readonly botId: string;
  readonly development?: boolean;
  readonly userKey: string;
  readonly noticeKey: string;
  /** DB의 최신 친구/가게 발신 가능 상태. 손님 입력으로 정하지 않는다. */
  readonly isFriend: boolean;
  readonly eventAvailable: boolean;
  readonly status: "pending" | "retrying" | "confirming" | "sent" | "deferred" | "delivered_on_reply" | "dropped";
  /** 이번 시도 전의 횟수. 실제 선점에서 이번 횟수를 올린다. */
  readonly attemptsDone: number;
  readonly nextAttemptAt: Date | null;
  readonly scheduledFor: Date | null;
  readonly timeZone: string;
}
export interface KakaoEventRecipient {
  readonly type: "botUserKey" | "appUserId";
  readonly id: string;
}
export interface KakaoEventFailure {
  readonly kind: "failed";
  readonly code:
    | "not_friend"
    | "cannot_send"
    | "skill_error"
    | "event_setup"
    | "wallet"
    | "limit"
    | "kakao_error"
    | "unknown";
  readonly retryable: boolean;
  readonly disableChannel: boolean;
  readonly attention: "owner" | "operator" | null;
}
export type KakaoEventRequestResult =
  | { readonly kind: "accepted"; readonly taskId: string }
  | {
      readonly kind: "not_requested";
      readonly reason: "complete" | "not_friend" | "cannot_send" | "exhausted" | "retry_wait" | "scheduled";
    }
  | KakaoEventFailure;
export type KakaoDeliveryResult = { readonly kind: "delivered" } | { readonly kind: "pending" } | KakaoEventFailure;
export interface KakaoEvents {
  requestNotice(input: NoticeEventInput, now: Date): Promise<KakaoEventRequestResult>;
  checkDelivery(taskId: string, recipient: KakaoEventRecipient): Promise<KakaoDeliveryResult>;
}

function failed(
  code: KakaoEventFailure["code"],
  retryable: boolean,
  disableChannel = false,
  attention: KakaoEventFailure["attention"] = null,
): KakaoEventFailure {
  return { kind: "failed", code, retryable, disableChannel, attention };
}
function date(value: Date): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new RangeError(INVALID);
  return value.getTime();
}
function attempts(value: number, min: number) {
  if (!Number.isInteger(value) || value < min || value > 4) throw new RangeError(INVALID);
}
function user(recipient: KakaoEventRecipient) {
  if (
    !["botUserKey", "appUserId"].includes(recipient.type) ||
    typeof recipient.id !== "string" ||
    recipient.id.length < 1 ||
    recipient.id.length > 70 ||
    /[\p{Cc}\p{Cf}]/u.test(recipient.id)
  )
    throw new TypeError(INVALID);
  if (recipient.type === "appUserId" && !/^[1-9][0-9]{0,18}$/.test(recipient.id)) throw new TypeError(INVALID);
}
function notRequested(
  input: NoticeEventInput,
  now: Date,
): Extract<KakaoEventRequestResult, { kind: "not_requested" }> | null {
  if (
    !/^[0-9a-f]{24}$/i.test(input.botId) ||
    !UUID.test(input.noticeKey) ||
    typeof input.isFriend !== "boolean" ||
    typeof input.eventAvailable !== "boolean" ||
    (input.development !== undefined && typeof input.development !== "boolean") ||
    !isTimeZone(input.timeZone)
  )
    throw new TypeError(INVALID);
  user({ type: "botUserKey", id: input.userKey });
  attempts(input.attemptsDone, 0);
  const at = date(now);
  const next = input.nextAttemptAt === null ? null : date(input.nextAttemptAt);
  const scheduled = input.scheduledFor === null ? null : date(input.scheduledFor);
  if (
    !["pending", "retrying", "confirming", "sent", "deferred", "delivered_on_reply", "dropped"].includes(input.status)
  )
    throw new TypeError(INVALID);
  const skip = (reason: Extract<KakaoEventRequestResult, { kind: "not_requested" }>["reason"]) =>
    ({ kind: "not_requested", reason }) as const;
  if (input.status !== "pending" && input.status !== "retrying") return skip("complete");
  if (!input.isFriend) return skip("not_friend");
  if (!input.eventAvailable) return skip("cannot_send");
  if (input.attemptsDone === 4) return skip("exhausted");
  if (next !== null && next > at) return skip("retry_wait");
  if (scheduled !== null) {
    const time = toShopLocal(now, input.timeZone).time;
    if (scheduled > at || time < "08:00" || time > "20:50") return skip("scheduled");
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function message(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : "";
}
function requestFailure(text: unknown): KakaoEventFailure {
  const s = message(text);
  if (/^(?:invalid (?:bot id|channel profile id|event name)|the channel is not connected)/.test(s))
    return failed("event_setup", false, true, "owner");
  if (s.startsWith("wallet not found")) return failed("wallet", false, true, "owner");
  if (s.startsWith("non-sufficient funds")) return failed("wallet", false, false, "operator");
  if (s.startsWith("api request limit exceeded")) return failed("limit", false, false, "operator");
  return failed("kakao_error", true);
}
function deliveryFailure(row: Record<string, unknown>): KakaoEventFailure {
  const code = row.errorType;
  const text = message(row.errorMsg);
  if (code === 101 || text.startsWith("request user is not a friend of talk channel"))
    return failed("not_friend", false);
  if (code === 102 || code === 103 || /^(?:message cannot be sent to this user|invalid user key)/.test(text))
    return failed("cannot_send", false);
  if (
    (typeof code === "number" && code >= 201 && code <= 205) ||
    /^(?:bot skill server responded|connection to skill server timed out|invalid json response from bot-skill|invalid skill-json format)/.test(
      text,
    )
  )
    return failed("skill_error", true);
  if (code === 302 || code === 311 || /^(?:bot is not connected to an app|invalid bot event name)/.test(text))
    return failed("event_setup", false, true, "owner");
  if (
    (typeof code === "number" && code >= 401 && code <= 407) ||
    /^(?:there's kakao talk channel long term limits|long term limits on sending messages|message delivery limited|block turned off by operation policy)/.test(
      text,
    )
  )
    return failed("limit", false, false, "operator");
  if (code === 301 || code === 999 || /^(?:bot internal error|internal server error)/.test(text))
    return failed("kakao_error", true);
  return failed("unknown", false, false, "operator");
}

async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) return null;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted || Number(response.headers.get("Content-Length") ?? 0) > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    let text = "";
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (signal.aborted) return null;
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** HTTP 한 번과 본문 읽기에 같은 전체 기한을 적용한다. 재시도는 호출자의 G4 계획만 수행한다. */
export function kakaoEvents(
  apiKey: Secret,
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): KakaoEvents {
  const timeoutMs = options.timeoutMs ?? 6000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new RangeError(INVALID);
  const send = options.fetch ?? fetch;
  async function call(path: string, body?: unknown): Promise<{ status: number; body: unknown } | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      const response = await send(`${ORIGIN}${path}`, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: { Authorization: `KakaoAK ${apiKey.reveal()}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      return { status: response.status, body: await json(response, controller.signal) };
    };
    try {
      return await Promise.race([
        work(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, timeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async requestNotice(input, now) {
      const skipped = notRequested(input, now);
      if (skipped !== null) return skipped;
      const response = await call(`/v2/bots/${input.botId.toLowerCase()}${input.development ? "!" : ""}/talk`, {
        event: { name: "siljang_notice" },
        user: [{ type: "botUserKey", id: input.userKey }],
        params: { noticeKey: input.noticeKey },
      });
      if (response === null) return failed("kakao_error", true);
      if (response.status === 429) return failed("limit", false, false, "operator");
      if (response.status >= 500 || response.status === 408) return failed("kakao_error", true);
      const body = record(response.body);
      if (body?.status === "FAIL") return requestFailure(body.message);
      if (
        response.status >= 200 &&
        response.status < 300 &&
        body?.status === "SUCCESS" &&
        typeof body.taskId === "string" &&
        UUID.test(body.taskId)
      )
        return { kind: "accepted", taskId: body.taskId };
      return failed("kakao_error", true);
    },
    async checkDelivery(taskId, recipient) {
      if (!UUID.test(taskId)) throw new TypeError(INVALID);
      user(recipient);
      const response = await call(`/v1/tasks/${taskId}`);
      if (response === null || response.status < 200 || response.status >= 300) return { kind: "pending" };
      const body = record(response.body);
      if (
        body === null ||
        (body.taskID ?? body.taskId) !== taskId ||
        (body.taskID !== undefined && body.taskId !== undefined && body.taskID !== body.taskId) ||
        body.allRequestCount !== 1
      )
        return { kind: "pending" };
      const fail = record(body.fail);
      if (
        body.status === "ALL SUCCESS" &&
        body.successCount === 1 &&
        (body.fail === undefined || (fail?.count === 0 && Array.isArray(fail.list) && fail.list.length === 0))
      )
        return { kind: "delivered" };
      if (
        body.status !== "1 FAIL" ||
        body.successCount !== 0 ||
        fail?.count !== 1 ||
        !Array.isArray(fail.list) ||
        fail.list.length !== 1
      )
        return { kind: "pending" };
      const item = record(fail.list[0]);
      if (item === null || item.userID !== recipient.id || item.reqUserType !== recipient.type)
        return { kind: "pending" };
      return deliveryFailure(item);
    },
  };
}

export type KakaoEventPlan =
  | { readonly status: "confirming"; readonly taskId?: string; readonly requestedAt?: Date; readonly nextCheckAt: Date }
  | { readonly status: "sent"; readonly sentAt: Date }
  | { readonly status: "retrying"; readonly nextAttemptAt: Date; readonly failure: KakaoEventFailure }
  | { readonly status: "deferred"; readonly failure: KakaoEventFailure }
  | { readonly status: "unchanged" };

/** 요청 접수는 확인 중으로만 둔다. 재시도는 기존 G4의1/5/30분 규칙을 사용한다. */
export function planKakaoEventRequest(
  attemptsDone: number,
  now: Date,
  result: KakaoEventRequestResult,
): KakaoEventPlan {
  date(now);
  attempts(attemptsDone, result.kind === "not_requested" ? 0 : 1);
  if (result.kind === "accepted")
    return {
      status: "confirming",
      taskId: result.taskId,
      requestedAt: now,
      nextCheckAt: nextDeliveryCheckAt(now, null),
    };
  if (result.kind === "not_requested") {
    if (result.reason === "not_friend" || result.reason === "cannot_send")
      return { status: "deferred", failure: failed(result.reason, false) };
    if (result.reason === "exhausted") return { status: "deferred", failure: failed("unknown", false) };
    return { status: "unchanged" };
  }
  const next = result.retryable ? nextKakaoAttemptAt(attemptsDone, now) : null;
  return next === null
    ? { status: "deferred", failure: result }
    : { status: "retrying", nextAttemptAt: next, failure: result };
}

/** 전달 성공을 확인한 때만 보냄. 모르면 접수 시각 기준 1/5/30분에 조회하고 30분 뒤에는 다음 대화로 넘긴다. */
export function planKakaoDeliveryCheck(
  requestedAt: Date,
  checkedAt: Date,
  attemptsDone: number,
  result: KakaoDeliveryResult,
): KakaoEventPlan {
  if (date(checkedAt) < date(requestedAt)) throw new RangeError(INVALID);
  attempts(attemptsDone, 1);
  if (result.kind === "delivered") return { status: "sent", sentAt: checkedAt };
  if (result.kind === "pending")
    return deliveryChecksDone(requestedAt, checkedAt)
      ? { status: "deferred", failure: failed("unknown", false, false, "operator") }
      : { status: "confirming", nextCheckAt: nextDeliveryCheckAt(requestedAt, checkedAt) };
  return planKakaoEventRequest(attemptsDone, checkedAt, result);
}
