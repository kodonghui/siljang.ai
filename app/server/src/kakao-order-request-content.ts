/** 실제 전달과 순수 표시가 함께 쓰는 규정/요약 묶음. DB·발신·AI를 호출하지 않는다. */
import type { ConfirmCardView } from "./confirm-card-store";
import { operatingRulesCardTexts } from "./operating-rules-card";
import type { ClauseInput } from "./operating-rules-input";

export interface KakaoOrderPolicy {
  readonly version: number;
  readonly clauses: readonly {
    readonly key?: ClauseInput["key"];
    readonly position?: number;
    readonly title: string;
    readonly condition: string;
    readonly effect: string;
  }[];
}
export interface KakaoOrderCardContext {
  readonly policy: KakaoOrderPolicy;
  readonly quoteId: string;
  readonly isFriend: boolean;
}
const ACK = "알겠어요. 알레르기는 묻지 않고 빼야 할 재료만으로 주문을 이어갈게요";
const RECOMMEND = "채널을 추가하면 결제 안내와 사장님 답을 바로 받아요";
export function kakaoOrderTerms(policy: KakaoOrderPolicy, afterAllergyDeclined = false): readonly string[] {
  if (
    !Number.isSafeInteger(policy.version) ||
    policy.version < 1 ||
    !Array.isArray(policy.clauses) ||
    policy.clauses.length < 1
  )
    throw new RangeError("invalid order policy");
  const clauses = policy.clauses.map((c, i) => {
    for (const value of [c.title, c.condition, c.effect])
      if (typeof value !== "string" || [...value].length < 1 || [...value].length > 1000 || value.includes("\0"))
        throw new RangeError("invalid order policy text");
    return {
      key: c.key ?? "custom",
      position: c.position ?? i,
      title: c.title,
      conditionText: c.condition,
      effectText: c.effect,
    };
  });
  return operatingRulesCardTexts(clauses, policy.version, afterAllergyDeclined ? ACK : undefined);
}
export function kakaoOrderRequestContents(input: {
  readonly card: ConfirmCardView;
  readonly policy: KakaoOrderPolicy;
  readonly isFriend: boolean;
  readonly state?: "normal" | "stale" | "expired";
  readonly afterAllergyDeclined?: boolean;
}): readonly (string | ConfirmCardView)[] {
  const notice =
    input.state === "stale"
      ? "내용이 바뀌었어요. 새 카드를 확인해 주세요"
      : input.state === "expired"
        ? "시간이 지나 새 카드를 보내 드려요"
        : "";
  let description = notice ? `${notice}\n${input.card.description}` : input.card.description;
  const title = "주문 요청 확인";
  if (!input.isFriend && [...title, ...description, ...RECOMMEND].length + 1 <= 400) description += `\n${RECOMMEND}`;
  // 내부 kind/견적 ID/규정 문맥은 다시 펼치거나 SDK에 노출하지 않는다.
  const card: ConfirmCardView = {
    title,
    description,
    confirmLabel: "규정에 동의하고 주문 요청",
    blockId: input.card.blockId,
    cardKey: input.card.cardKey,
  };
  return [...kakaoOrderTerms(input.policy, input.afterAllergyDeclined), card];
}
