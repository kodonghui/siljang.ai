import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject as object, isApiTimestamp as timestamp, UUID_PATTERN } from "./api-response";
export const BLOCK_KEYS = ["card", "ordererInfo", "allergyAnswer", "depositorName", "review"] as const;
export type BlockKey = (typeof BLOCK_KEYS)[number];
export const VERIFIED_BLOCKS = ["card", "orderer_info", "allergy_answer", "depositor_name", "review"] as const;
export const FAILURE_HINTS = [
  "skill_url",
  "skill_key_header",
  "open_builder_deploy",
  "test_message_missing",
  "card_block",
  "orderer_block",
  "allergy_block",
  "depositor_block",
  "review_block",
] as const;
export const EVENT_FAILURES = [
  "app_not_linked",
  "wallet_missing",
  "event_block",
  "event_skill",
  "owner_not_friend",
  "not_delivered",
  "kakao_error",
] as const;
export const SKILL_HEADER = "Siljang-Skill-Key";
export interface SkillSetup {
  readonly messageSkillUrl: string;
  readonly cardSkillUrl: string;
  readonly reviewSkillUrl: string;
  readonly eventSkillUrl: string;
  readonly eventName: "siljang_notice";
  readonly headerName: typeof SKILL_HEADER;
  readonly keyVersion: number;
  readonly keyIssuedAt: string;
  readonly previousKeyValidUntil: string | null;
}
export interface SkillKey {
  readonly headerName: typeof SKILL_HEADER;
  readonly headerValue: string;
  readonly keyVersion: number;
}
export interface KakaoChannel {
  readonly connectionId: string;
  readonly botId: string;
  readonly channelPublicId: string | null;
  readonly status: "pending" | "linked" | "failed";
  readonly checkStartedAt: string | null;
  readonly checkExpiresAt: string | null;
  readonly linkedAt: string | null;
  readonly proofPhrase: string | null;
  readonly claimExpiresAt: string | null;
  readonly failureHints: readonly (typeof FAILURE_HINTS)[number][];
  readonly blockIds: Readonly<Record<BlockKey, string | null>>;
  readonly verifiedBlocks: readonly (typeof VERIFIED_BLOCKS)[number][];
  readonly eventStatus: "unchecked" | "checking" | "ready" | "unavailable";
  readonly eventCheckedAt: string | null;
  readonly eventFailReason: (typeof EVENT_FAILURES)[number] | null;
  readonly skill: SkillSetup;
  readonly revision: string;
}
export interface KakaoChannelResult {
  readonly outcome: "created" | "done" | "unchanged";
  readonly kakaoChannel: KakaoChannel;
  readonly skillKey: SkillKey | null;
}
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && [...v].length >= 1 && [...v].length <= max && !/[\s\0]/.test(v);
const nullableDate = (v: unknown) => v === null || timestamp(v);
const keyVersion = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 10000;
function choices<const T extends readonly string[]>(v: unknown, allowed: T): v is T[number][] {
  return (
    Array.isArray(v) &&
    v.length <= allowed.length &&
    new Set(v).size === v.length &&
    v.every((x) => typeof x === "string" && allowed.includes(x))
  );
}
function skillUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2048 || /[\s\0]/.test(v)) return false;
  try {
    return ["https:", "http:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}
function setup(v: unknown): v is SkillSetup {
  return (
    object(v) &&
    [v.messageSkillUrl, v.cardSkillUrl, v.reviewSkillUrl, v.eventSkillUrl].every(skillUrl) &&
    v.eventName === "siljang_notice" &&
    v.headerName === SKILL_HEADER &&
    keyVersion(v.keyVersion) &&
    timestamp(v.keyIssuedAt) &&
    nullableDate(v.previousKeyValidUntil)
  );
}
function channel(v: unknown): v is KakaoChannel {
  return (
    object(v) &&
    typeof v.connectionId === "string" &&
    UUID_PATTERN.test(v.connectionId) &&
    text(v.botId, 64) &&
    (v.channelPublicId === null ||
      (typeof v.channelPublicId === "string" && /^_[A-Za-z0-9]{1,39}$/.test(v.channelPublicId))) &&
    typeof v.status === "string" &&
    ["pending", "linked", "failed"].includes(v.status) &&
    [v.checkStartedAt, v.checkExpiresAt, v.linkedAt, v.claimExpiresAt, v.eventCheckedAt].every(nullableDate) &&
    (v.proofPhrase === null || (typeof v.proofPhrase === "string" && /^연결 [0-9]{6}$/.test(v.proofPhrase))) &&
    choices(v.failureHints, FAILURE_HINTS) &&
    object(v.blockIds) &&
    BLOCK_KEYS.every(
      (k) => v.blockIds !== null && object(v.blockIds) && (v.blockIds[k] === null || text(v.blockIds[k], 100)),
    ) &&
    choices(v.verifiedBlocks, VERIFIED_BLOCKS) &&
    typeof v.eventStatus === "string" &&
    ["unchecked", "checking", "ready", "unavailable"].includes(v.eventStatus) &&
    (v.eventFailReason === null ||
      (typeof v.eventFailReason === "string" &&
        EVENT_FAILURES.includes(v.eventFailReason as (typeof EVENT_FAILURES)[number]))) &&
    setup(v.skill) &&
    typeof v.revision === "string" &&
    /^[A-Za-z0-9._-]{1,64}$/.test(v.revision)
  );
}
function copy(v: KakaoChannel): KakaoChannel {
  const s = v.skill;
  return {
    connectionId: v.connectionId,
    botId: v.botId,
    channelPublicId: v.channelPublicId,
    status: v.status,
    checkStartedAt: v.checkStartedAt,
    checkExpiresAt: v.checkExpiresAt,
    linkedAt: v.linkedAt,
    proofPhrase: v.proofPhrase,
    claimExpiresAt: v.claimExpiresAt,
    failureHints: [...v.failureHints],
    blockIds: {
      card: v.blockIds.card,
      ordererInfo: v.blockIds.ordererInfo,
      allergyAnswer: v.blockIds.allergyAnswer,
      depositorName: v.blockIds.depositorName,
      review: v.blockIds.review,
    },
    verifiedBlocks: [...v.verifiedBlocks],
    eventStatus: v.eventStatus,
    eventCheckedAt: v.eventCheckedAt,
    eventFailReason: v.eventFailReason,
    skill: {
      messageSkillUrl: s.messageSkillUrl,
      cardSkillUrl: s.cardSkillUrl,
      reviewSkillUrl: s.reviewSkillUrl,
      eventSkillUrl: s.eventSkillUrl,
      eventName: s.eventName,
      headerName: s.headerName,
      keyVersion: s.keyVersion,
      keyIssuedAt: s.keyIssuedAt,
      previousKeyValidUntil: s.previousKeyValidUntil,
    },
    revision: v.revision,
  };
}
export async function fetchKakaoChannel(signal?: AbortSignal): Promise<ApiResult<KakaoChannel>> {
  const r = await request<unknown>("/owner/kakao-channel", { cache: "no-store", ...(signal ? { signal } : {}) });
  return !r.ok ? r : channel(r.data) ? { ...r, data: copy(r.data) } : INVALID_API_RESPONSE;
}
async function command(
  path: string,
  method: "POST" | "PUT",
  body: Record<string, unknown> | undefined,
  key: string,
  mode: "save" | "check" | "rotate",
): Promise<ApiResult<KakaoChannelResult>> {
  const r = await request<unknown>(path, { method, ...(body ? { body } : {}), key });
  if (!r.ok) return r;
  const v = r.data;
  if (
    !object(v) ||
    typeof v.outcome !== "string" ||
    !["created", "done", "unchanged"].includes(v.outcome) ||
    !channel(v.kakaoChannel)
  )
    return INVALID_API_RESPONSE;
  const k = v.skillKey;
  if (
    k !== null &&
    !(
      object(k) &&
      k.headerName === SKILL_HEADER &&
      typeof k.headerValue === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(k.headerValue) &&
      k.keyVersion === v.kakaoChannel.skill.keyVersion
    )
  )
    return INVALID_API_RESPONSE;
  if (
    (mode === "check" && (k !== null || v.outcome === "created")) ||
    (mode === "rotate" && (k === null || v.outcome !== "done"))
  )
    return INVALID_API_RESPONSE;
  return {
    ...r,
    data: {
      outcome: v.outcome as KakaoChannelResult["outcome"],
      kakaoChannel: copy(v.kakaoChannel),
      skillKey:
        k === null
          ? null
          : { headerName: SKILL_HEADER, headerValue: k.headerValue as string, keyVersion: Number(k.keyVersion) },
    },
  };
}
export const saveKakaoChannel = (body: Record<string, unknown>, key: string) =>
  command("/owner/kakao-channel", "PUT", body, key, "save");
export const startKakaoChannelCheck = (key: string) =>
  command("/owner/kakao-channel/check", "POST", undefined, key, "check");
export const rotateKakaoSkillKey = (
  body: { baseRevision: string; previousKey: "keep_24h" | "revoke_now" },
  key: string,
) => command("/owner/kakao-channel/skill-key", "POST", body, key, "rotate");
