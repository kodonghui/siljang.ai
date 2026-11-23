import { BLOCK_KEYS, type BlockKey, type KakaoChannel } from "./kakao-channel-api";
import type { FieldError } from "./problems";
export const BLOCK_LABELS: Record<BlockKey, string> = {
  card: "확인 카드",
  ordererInfo: "주문자 정보",
  allergyAnswer: "알레르기 답",
  depositorName: "입금자 이름",
  review: "후기",
};
export interface ChannelForm {
  botId: string;
  channelPublicId: string;
  blockIds: Record<BlockKey, string>;
}
export function channelForm(value: KakaoChannel | null): ChannelForm {
  return {
    botId: value?.botId ?? "",
    channelPublicId: value?.channelPublicId ?? "",
    blockIds: {
      card: value?.blockIds.card ?? "",
      ordererInfo: value?.blockIds.ordererInfo ?? "",
      allergyAnswer: value?.blockIds.allergyAnswer ?? "",
      depositorName: value?.blockIds.depositorName ?? "",
      review: value?.blockIds.review ?? "",
    },
  };
}
export function channelPayload(base: KakaoChannel | null, form: ChannelForm) {
  const optional = (value: string) => (value.trim() === "" ? null : value);
  return {
    baseRevision: base?.revision ?? null,
    botId: form.botId,
    channelPublicId: optional(form.channelPublicId),
    blockIds: Object.fromEntries(BLOCK_KEYS.map((key) => [key, optional(form.blockIds[key])])),
  };
}
export function channelIssues(form: ChannelForm): FieldError[] {
  const issues: FieldError[] = [];
  function id(value: string, field: string, max: number, optional = false) {
    if (!value.trim()) {
      if (!optional) issues.push({ field, code: "required" });
    } else if (/[\s\0]/.test(value)) issues.push({ field, code: "bad_format" });
    else if ([...value].length > max) issues.push({ field, code: "too_long" });
  }
  id(form.botId, "/botId", 64);
  if (form.channelPublicId.trim()) {
    if (!/^_[A-Za-z0-9]+$/.test(form.channelPublicId)) issues.push({ field: "/channelPublicId", code: "bad_format" });
    else if (form.channelPublicId.length > 40) issues.push({ field: "/channelPublicId", code: "too_long" });
  }
  for (const key of BLOCK_KEYS) id(form.blockIds[key], `/blockIds/${key}`, 100, true);
  return issues;
}
export function rebaseChannel(base: KakaoChannel | null, mine: ChannelForm, latest: KakaoChannel): ChannelForm {
  const before = channelForm(base),
    result = channelForm(latest);
  for (const key of ["botId", "channelPublicId"] as const) if (mine[key] !== before[key]) result[key] = mine[key];
  for (const key of BLOCK_KEYS)
    if (mine.blockIds[key] !== before.blockIds[key]) result.blockIds[key] = mine.blockIds[key];
  return result;
}
