import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { readJsonBody } from "./body";
import { fromBase64Url, toBase64Url, toHex } from "./encoding";
import { ApiError, fieldError } from "./problem";
import { MissingSettingError } from "./request-key";
import type { Secret } from "./settings";
import { createShopScope, type ShopScope } from "./shop-scope";

const SKILL_KEY_FORMAT = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const BOT_ID_FORMAT = /^([0-9a-f]{24})!?$/i;
const utf8 = new TextEncoder();

type RecordValue = Readonly<Record<string, unknown>>;

export interface KakaoSkillPayload {
  readonly botId: string;
  readonly blockId: string;
  readonly userId: string;
  readonly utterance: string;
  readonly callbackUrl: string | undefined;
  readonly isFriend: boolean;
  readonly params: RecordValue;
  readonly action: { readonly params: RecordValue; readonly clientExtra: RecordValue };
}

interface ChannelRow {
  readonly id: string;
  readonly shop_id: string;
  readonly status: "linked" | "pending";
  readonly skill_key_version: number;
  readonly previous_key_until: Date | null;
}

export interface AuthorizedKakaoSkill {
  readonly scope: ShopScope;
  readonly channelId: string;
  readonly status: ChannelRow["status"];
  readonly payload: KakaoSkillPayload;
  readonly receivedAt: Date;
  readonly requestKeySecret: Secret;
}

function record(value: unknown, field: string): RecordValue {
  if (value === undefined) throw fieldError(field, "required");
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw fieldError(field, "bad_format");
  return value as RecordValue;
}

function optionalRecord(value: unknown, field: string): RecordValue {
  return value === undefined ? {} : record(value, field);
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (value === undefined) throw fieldError(field, "required");
  if (typeof value !== "string" || value.includes("\0")) throw fieldError(field, "bad_format");
  if (value.length < min) throw fieldError(field, "too_short");
  if (value.length > max && [...value].length > max) throw fieldError(field, "too_long");
  return value;
}

function parsePayload(body: unknown): KakaoSkillPayload {
  const root = record(body, "/");
  const request = record(root.userRequest, "/userRequest");
  const bot = record(root.bot, "/bot");
  const botValue = text(bot.id, "/bot/id", 1, 64);
  const botId = BOT_ID_FORMAT.exec(botValue)?.[1]?.toLowerCase();
  if (botId === undefined) throw fieldError("/bot/id", "bad_format");

  const user = record(request.user, "/userRequest/user");
  const properties = optionalRecord(user.properties, "/userRequest/user/properties");
  text(user.type, "/userRequest/user/type", 1, 32);
  if (properties.isFriend !== undefined && typeof properties.isFriend !== "boolean") {
    throw fieldError("/userRequest/user/properties/isFriend", "bad_format");
  }

  const action = record(root.action, "/action");
  text(action.id, "/action/id", 1, 200);
  const block = request.block === undefined ? undefined : record(request.block, "/userRequest/block");
  const callbackUrl =
    request.callbackUrl === undefined ? undefined : text(request.callbackUrl, "/userRequest/callbackUrl", 9, 2_048);
  return {
    botId,
    blockId: block?.id === undefined ? "" : text(block.id, "/userRequest/block/id", 1, 200),
    userId: text(user.id, "/userRequest/user/id", 1, 70),
    utterance: text(request.utterance, "/userRequest/utterance", 0, 100_000),
    callbackUrl,
    isFriend: properties.isFriend === true,
    params: optionalRecord(request.params, "/userRequest/params"),
    action: {
      params: optionalRecord(action.params, "/action/params"),
      clientExtra: optionalRecord(action.clientExtra, "/action/clientExtra"),
    },
  };
}

function signingKey(secret: Secret) {
  return crypto.subtle.importKey("raw", utf8.encode(secret.reveal()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function keyContext(channelId: string, version: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(utf8.encode(`siljang:kakao:skill:v1:${channelId}:${version}`));
}

/** API-031·079는 이 함수로 연결·버전별 키를 만들고 DB에는 버전만 둔다(DEC-08). */
export async function deriveKakaoSkillKey(secret: Secret, channelId: string, version: number): Promise<string> {
  const key = await signingKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, keyContext(channelId, version));
  return toBase64Url(new Uint8Array(signature));
}

export async function kakaoReceiptKey(
  secret: Secret,
  payload: Pick<KakaoSkillPayload, "botId" | "blockId" | "userId" | "utterance">,
  receivedAt: Date,
  kind: "message" | "review",
): Promise<string> {
  const interval = Math.floor(receivedAt.getTime() / 2_000);
  const input = JSON.stringify([
    "siljang:kakao:receipt:v1",
    kind,
    payload.botId,
    payload.userId,
    payload.blockId,
    payload.utterance,
    interval,
  ]);
  const key = await signingKey(secret);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(input))));
}

/** 연결 전에는 bot_id로 채널의 식별자와 키 버전만 찾는다. 그 뒤 읽기·쓰기는 가게 범위를 사용한다. */
async function authorizeKakaoSkill(c: Context<HonoEnv>): Promise<AuthorizedKakaoSkill> {
  const receivedAt = c.get("services").now();
  const supplied = c.req.header("Siljang-Skill-Key");
  if (supplied === undefined || !SKILL_KEY_FORMAT.test(supplied)) throw new ApiError("skill_key_invalid");
  const signature = fromBase64Url(supplied);
  if (signature === null) throw new ApiError("skill_key_invalid");

  const payload = parsePayload(await readJsonBody(c));
  const secret = c.get("settings").secrets.REQUEST_HASH_KEY;
  if (secret === null) throw new MissingSettingError("REQUEST_HASH_KEY is not set");
  const {
    rows: [channel],
  } = await c.get("db").query<ChannelRow>(
    `SELECT id, shop_id, status, skill_key_version, previous_key_until
       FROM kakao_channels WHERE bot_id = $1 AND status IN ('pending', 'linked')`,
    [payload.botId],
  );
  if (channel === undefined) throw new ApiError("skill_key_invalid");

  const key = await signingKey(secret);
  const valid = (version: number) =>
    crypto.subtle.verify("HMAC", key, new Uint8Array(signature), keyContext(channel.id, version));
  const previousAllowed =
    channel.skill_key_version > 1 && channel.previous_key_until !== null && receivedAt < channel.previous_key_until;
  if (!(await valid(channel.skill_key_version)) && !(previousAllowed && (await valid(channel.skill_key_version - 1)))) {
    throw new ApiError("skill_key_invalid");
  }
  return {
    scope: createShopScope(channel.shop_id, { kind: "customer", channelId: channel.id }),
    channelId: channel.id,
    status: channel.status,
    payload,
    receivedAt,
    requestKeySecret: secret,
  };
}

export async function resolveKakaoSkillScope(c: Context<HonoEnv>): Promise<ShopScope> {
  const authorized = await authorizeKakaoSkill(c);
  c.set("kakaoSkill", authorized);
  return authorized.scope;
}
