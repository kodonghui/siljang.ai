/** SPEC-028·REQ-184의 규정 글. 조문을 나누거나 자르지 않고 글 둘 안에 담는다. */
import type { ClauseInput } from "./operating-rules-input";
import { ApiError } from "./problem";

const CARD_KEYS = new Set([
  "pre_production_cancel",
  "staged_refund",
  "cancellation_fee",
  "date_change_refund_basis",
  "shop_cancel_compensation",
  "custom",
]);
export const WITHDRAWAL_NOTICE = "주문제작이라 청약철회가 제한될 수 있어요";
export const MINOR_NOTICE = "미성년자가 법정대리인의 동의 없이 한 주문은 본인이나 법정대리인이 취소할 수 있어요";
const length = (value: string) => [...value].length;

export function operatingRulesCardTexts(clauses: readonly ClauseInput[], version: number): string[] {
  const selected = clauses
    .map((c, index) => ({ ...c, index }))
    .filter((c) => CARD_KEYS.has(c.key))
    .sort((a, b) => a.position - b.position);
  const lines = selected.map((c) => `· ${c.title}: ${c.conditionText} → ${c.effectText}\n`);
  const header = `취소·환불 규정(운영규정 버전 ${version})\n`,
    footer = `${WITHDRAWAL_NOTICE}\n${MINOR_NOTICE}`;
  const whole = header + lines.join("") + footer;
  if (length(whole) <= 1000) return [whole];
  for (let split = lines.length; split >= 0; split--) {
    const first = `${header}(1/2)\n${lines.slice(0, split).join("")}`;
    const second = `${header}(2/2)\n${lines.slice(split).join("")}${footer}`;
    if (length(first) <= 1000 && length(second) <= 1000) return [first, second];
  }
  throw new ApiError("validation_failed", {
    errors: [
      { field: "/clauses", code: "exceeds_card_limit" },
      ...selected.slice(0, 49).map((c) => ({ field: `/clauses/${c.index}`, code: "exceeds_card_limit" as const })),
    ],
  });
}
