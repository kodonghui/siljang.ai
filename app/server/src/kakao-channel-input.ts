/** 채널 설정과 키 교체 입력(API-031/079). 키 값은 입력받거나 저장하지 않는다. */
import { ApiError, type FieldError, fieldError } from "./problem";

export const CHANNEL_BLOCKS = ["card", "ordererInfo", "allergyAnswer", "depositorName", "review"] as const;
export type ChannelBlock = (typeof CHANNEL_BLOCKS)[number];
export interface ChannelInput {
  baseRevision: string | null;
  botId: string;
  channelPublicId: string | null;
  blockIds: Record<ChannelBlock, string | null>;
}
function object(raw: unknown, field: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw fieldError(field, "bad_format");
  return raw as Record<string, unknown>;
}
function unknownKeys(input: Record<string, unknown>, keys: readonly string[], prefix: string, errors: FieldError[]) {
  for (const key of Object.keys(input))
    if (!keys.includes(key))
      errors.push({ field: /^[A-Za-z0-9_]{1,100}$/.test(key) ? `${prefix}/${key}` : "/", code: "unknown_field" });
}
function text(
  input: Record<string, unknown>,
  key: string,
  max: number,
  nullable: boolean,
  prefix: string,
  errors: FieldError[],
): string | null {
  const value = input[key],
    field = `${prefix}/${key}`;
  if (nullable && value === null) return null;
  if (value === undefined) errors.push({ field, code: "required" });
  else if (typeof value !== "string" || value.includes("\0") || /\s/.test(value))
    errors.push({ field, code: "bad_format" });
  else if (value.length === 0) errors.push({ field, code: "too_short" });
  else if ([...value].length > max) errors.push({ field, code: "too_long" });
  else return value;
  return null;
}
function revision(input: Record<string, unknown>, nullable: boolean, errors: FieldError[]): string | null {
  if (nullable && input.baseRevision === null) return null;
  const value = text(input, "baseRevision", 64, false, "", errors);
  if (value !== null && !/^[A-Za-z0-9._-]+$/.test(value)) errors.push({ field: "/baseRevision", code: "bad_format" });
  return value;
}
export function parseChannelInput(raw: unknown): ChannelInput {
  const input = object(raw, "/"),
    errors: FieldError[] = [];
  unknownKeys(input, ["baseRevision", "botId", "channelPublicId", "blockIds"], "", errors);
  const baseRevision = revision(input, true, errors);
  let botId = text(input, "botId", 64, false, "", errors) ?? "";
  if (/^[a-f0-9]{24}!?$/i.test(botId)) botId = botId.replace(/!$/, "").toLowerCase();
  const channelPublicId = text(input, "channelPublicId", 40, true, "", errors);
  if (channelPublicId !== null && !/^_[A-Za-z0-9]+$/.test(channelPublicId))
    errors.push({ field: "/channelPublicId", code: "bad_format" });
  const blocks = object(input.blockIds, "/blockIds");
  unknownKeys(blocks, CHANNEL_BLOCKS, "/blockIds", errors);
  const blockIds = Object.fromEntries(
    CHANNEL_BLOCKS.map((key) => [key, text(blocks, key, 100, true, "/blockIds", errors)]),
  ) as Record<ChannelBlock, string | null>;
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return { baseRevision, botId, channelPublicId, blockIds };
}
export function parseSkillKeyInput(raw: unknown): { baseRevision: string; previousKey: "keep_24h" | "revoke_now" } {
  const input = object(raw, "/"),
    errors: FieldError[] = [];
  unknownKeys(input, ["baseRevision", "previousKey"], "", errors);
  const baseRevision = revision(input, false, errors);
  if (input.previousKey === undefined) errors.push({ field: "/previousKey", code: "required" });
  else if (input.previousKey !== "keep_24h" && input.previousKey !== "revoke_now")
    errors.push({ field: "/previousKey", code: "not_allowed" });
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return { baseRevision: baseRevision as string, previousKey: input.previousKey as "keep_24h" | "revoke_now" };
}
