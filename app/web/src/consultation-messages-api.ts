/** API043의 사장님 전용 대화 읽기. 원래 값/사진 주소를 저장소나 로그에 쓰지 않는다. */
import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, isApiTimestamp, UUID_PATTERN } from "./api-response";

export const CONSULTATION_STATUSES = {
  open: "열림",
  awaiting_owner: "사장님 답 기다림",
  dropped: "끊김",
  ordered: "주문됨",
  ended: "끝남",
  deleted: "지워짐",
} as const;
export const MESSAGE_AUTHORS = {
  customer: "손님",
  ai: "AI",
  system: "서버 안내",
  owner: "사장님 답",
  notice: "안내",
} as const;
export const MESSAGE_DELIVERIES = {
  skill_response: "바로 답",
  callback: "콜백",
  deferred: "다음 대화 때 전함",
  delivered_later: "다음 대화 때 전함 완료",
  failed: "보내지 못함",
  sending: "보내는 중",
  event_api: "먼저 보냄",
} as const;
export interface ConsultationMessage {
  readonly messageId: string;
  readonly at: string;
  readonly direction: "inbound" | "outbound";
  readonly author: keyof typeof MESSAGE_AUTHORS;
  readonly kind: "text" | "photo" | "card" | "unsupported";
  readonly text: string | null;
  readonly photos: readonly { readonly url: string }[];
  readonly delivery: keyof typeof MESSAGE_DELIVERIES | null;
}
export interface ConsultationMessagesPage {
  readonly consultationId: string;
  readonly status: keyof typeof CONSULTATION_STATUSES;
  readonly customerChannelFriend: boolean;
  readonly items: readonly ConsultationMessage[];
  readonly nextCursor: string | null;
}
export interface ConsultationMessagesQuery {
  readonly limit: number;
  readonly cursor: string | null;
}
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
function validQuery(query: ConsultationMessagesQuery) {
  return (
    Number.isInteger(query.limit) &&
    query.limit >= 1 &&
    query.limit <= 100 &&
    (query.cursor === null || (typeof query.cursor === "string" && CURSOR.test(query.cursor)))
  );
}
export function parseConsultationMessagesSearch(search: string): ConsultationMessagesQuery | null {
  const p = new URLSearchParams(search);
  if (["limit", "cursor"].some((key) => p.getAll(key).length > 1)) return null;
  const raw = p.get("limit"),
    query = { limit: raw === null ? 20 : /^\d+$/.test(raw) ? Number(raw) : NaN, cursor: p.get("cursor") };
  return validQuery(query) ? query : null;
}
function photoUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    [...value].length > 2048 ||
    /\s/u.test(value) ||
    [...value].some((c) => c.charCodeAt(0) < 32)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.username === "" &&
      url.password === "" &&
      (url.protocol === "https:" || (url.protocol === "http:" && url.origin === window.location.origin))
    );
  } catch {
    return false;
  }
}
function message(v: unknown): v is ConsultationMessage {
  return (
    isApiObject(v) &&
    typeof v.messageId === "string" &&
    UUID_PATTERN.test(v.messageId) &&
    isApiTimestamp(v.at) &&
    (v.direction === "inbound" || v.direction === "outbound") &&
    typeof v.author === "string" &&
    Object.hasOwn(MESSAGE_AUTHORS, v.author) &&
    ["text", "photo", "card", "unsupported"].includes(v.kind as string) &&
    (v.text === null || (typeof v.text === "string" && [...v.text].length <= 100000 && !v.text.includes("\0"))) &&
    Array.isArray(v.photos) &&
    v.photos.length <= 10 &&
    v.photos.every((p) => isApiObject(p) && photoUrl(p.url)) &&
    (v.delivery === null || (typeof v.delivery === "string" && Object.hasOwn(MESSAGE_DELIVERIES, v.delivery)))
  );
}
export async function fetchConsultationMessages(
  consultationId: string,
  query: ConsultationMessagesQuery,
  expectedShopId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ConsultationMessagesPage>> {
  if (!UUID_PATTERN.test(consultationId)) return { ok: false, status: 404, problem: null, retryAfterSeconds: null };
  if (!validQuery(query)) return { ok: false, status: 422, problem: null, retryAfterSeconds: null };
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor !== null) params.set("cursor", query.cursor);
  const result = await request<unknown>(`/owner/consultations/${consultationId}/messages?${params}`, {
    cache: "no-store",
    expectedShopId,
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const v = result.data;
  if (
    !isApiObject(v) ||
    typeof v.consultationId !== "string" ||
    v.consultationId.toLowerCase() !== consultationId.toLowerCase() ||
    typeof v.status !== "string" ||
    !Object.hasOwn(CONSULTATION_STATUSES, v.status) ||
    typeof v.customerChannelFriend !== "boolean" ||
    !Array.isArray(v.items) ||
    v.items.length > query.limit ||
    !v.items.every(message) ||
    new Set(v.items.map((m) => m.messageId)).size !== v.items.length ||
    !(
      v.nextCursor === null ||
      (typeof v.nextCursor === "string" && CURSOR.test(v.nextCursor) && v.nextCursor !== query.cursor)
    ) ||
    (v.status === "deleted" && (v.items.length !== 0 || v.nextCursor !== null))
  )
    return INVALID_API_RESPONSE;
  return {
    ...result,
    data: {
      consultationId: v.consultationId,
      status: v.status as ConsultationMessagesPage["status"],
      customerChannelFriend: v.customerChannelFriend,
      items: v.items.map((m) => ({
        messageId: m.messageId,
        at: m.at,
        direction: m.direction,
        author: m.author,
        kind: m.kind,
        text: m.text,
        photos: m.photos.map((p) => ({ url: p.url })),
        delivery: m.delivery,
      })),
      nextCursor: v.nextCursor,
    },
  };
}
