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
// 저장한 원문은 보존한다. 카드는 조문마다 한 줄이므로 줄바꿈/제어 문자만 공백으로 표시한다.
const singleLine = (value: string) =>
  Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029 ? " " : char;
  }).join("");

export function operatingRulesCardTexts(clauses: readonly ClauseInput[], version: number, lead?: string): string[] {
  const selected = clauses
    .map((c, index) => ({ ...c, index }))
    .filter((c) => CARD_KEYS.has(c.key))
    .sort((a, b) => a.position - b.position);
  const lines = selected.map(
    (c) => `· ${singleLine(c.title)}: ${singleLine(c.conditionText)} → ${singleLine(c.effectText)}\n`,
  );
  const header = `취소·환불 규정(운영규정 버전 ${version})\n`,
    footer = `${WITHDRAWAL_NOTICE}\n${MINOR_NOTICE}`;
  const prefix = lead === undefined ? "" : `${lead}\n`;
  const whole = prefix + header + lines.join("") + footer;
  if (length(whole) <= 1000) return [whole];
  for (let split = lines.length; split >= 0; split--) {
    const first = `${prefix}${header}(1/2)\n${lines.slice(0, split).join("")}`;
    const second = `${header}(2/2)\n${lines.slice(split).join("")}${footer}`;
    if (length(first) <= 1000 && length(second) <= 1000) return [first, second];
  }
  const oversized = selected.filter((_clause, i) => length(`${header}(1/2)\n${lines[i]}`) > 1000);
  let end = 0,
    used = length(`${header}(1/2)\n`);
  while (end < lines.length && used + length(lines[end] ?? "") <= 1000) used += length(lines[end++] ?? "");
  used = length(`${header}(2/2)\n${footer}`);
  while (end < lines.length && used + length(lines[end] ?? "") <= 1000) used += length(lines[end++] ?? "");
  const offenders = oversized.length ? oversized : selected.slice(end);
  throw new ApiError("validation_failed", {
    errors: [
      { field: "/clauses", code: "exceeds_card_limit" },
      ...offenders.slice(0, 49).map((c) => ({ field: `/clauses/${c.index}`, code: "exceeds_card_limit" as const })),
    ],
  });
}
