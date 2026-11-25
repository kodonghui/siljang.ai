/** SCR009 표시 전용. 환불 계산·취소·자리 반환은 서버 업무 모듈이 담당한다. */
import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import { toShopLocal } from "./time";

export interface KakaoCancellationCard {
  readonly orderNo: string;
  readonly pickupAt: string;
  readonly timeZone: string;
  readonly refund:
    | { readonly kind: "unpaid" }
    | { readonly kind: "calculated"; readonly amount: number; readonly clauseNames: readonly string[] };
}
interface Card extends KakaoCancellationCard {
  readonly cardKey: string;
  readonly blockId: string;
}
export type KakaoCancellationView =
  | ({ readonly state: "normal" | "stale" | "expired" } & Card)
  | { readonly state: "stale"; readonly currentStatus: string }
  | { readonly state: "done"; readonly kind: "paid" | "unpaid" | "declined" }
  | { readonly state: "permission"; readonly reason: "card_not_yours" }
  | { readonly state: "permission"; readonly reason: "not_accepting"; readonly contactPhone: string }
  | { readonly state: "error"; readonly reason: "retry_needed" | "server_error" };
export const CANCELLATION_PAID_TEXT = "주문을 취소했어요. 환불은 사장님이 정한 뒤 알려 드려요";
export const CANCELLATION_UNPAID_TEXT = "주문을 취소했어요";
type Output =
  | { readonly simpleText: { readonly text: string } }
  | {
      readonly textCard: {
        readonly title: string;
        readonly description: string;
        readonly buttons: readonly {
          readonly label: string;
          readonly action: "block";
          readonly blockId: string;
          readonly extra: { readonly cardKey: string; readonly choice: "confirm" | "decline" };
        }[];
      };
    }
  | {
      readonly carousel: {
        readonly type: "textCard";
        readonly items: readonly { readonly title: string; readonly description?: string }[];
      };
    };
function text(value: string, max: number) {
  if (typeof value !== "string" || !value.trim() || [...value].length > max || /[\0\r]/.test(value))
    throw new RangeError("invalid cancellation text");
  return value;
}
function body(outputs: readonly Output[]) {
  if (outputs.length < 1 || outputs.length > 3) throw new RangeError("invalid cancellation outputs");
  return { version: "2.0" as const, template: { outputs } };
}
function simple(value: string): Output {
  return { simpleText: { text: text(value, 1000) } };
}
function details(value: string): readonly Output[] {
  const segments = [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text(value, 3360))].map(
    ({ segment }) => ({ text: segment, length: [...segment].length }),
  );
  let index = 0;
  const take = (maximum: number) => {
    let result = "",
      length = 0;
    while (index < segments.length) {
      const segment = segments[index];
      if (segment === undefined || length + segment.length > maximum) break;
      result += segment.text;
      length += segment.length;
      index++;
    }
    return result;
  };
  const parts: string[] = [];
  while (index < segments.length) {
    const part = take(1000);
    if (!part) throw new RangeError("cancellation grapheme exceeds text limit");
    parts.push(part);
  }
  if (parts.length <= 2) return parts.map(simple);
  index = 0;
  const items: { title: string; description?: string }[] = [];
  while (index < segments.length) {
    const start = index,
      title = `취소 내용 ${items.length + 1}\n${take(40)}`,
      description = take(128);
    if (index === start || items.length >= 20) throw new RangeError("cancellation graphemes exceed carousel limit");
    items.push({ title, ...(description ? { description } : {}) });
  }
  const outputs: Output[] = [];
  for (let at = 0; at < items.length; at += 10)
    outputs.push({ carousel: { type: "textCard", items: items.slice(at, at + 10) } });
  return outputs;
}
export function kakaoCancellationMessage(view: KakaoCancellationView) {
  if (view.state === "done") {
    if (!["paid", "unpaid", "declined"].includes(view.kind)) throw new RangeError("invalid cancellation result");
    return body([
      simple(
        view.kind === "paid"
          ? CANCELLATION_PAID_TEXT
          : view.kind === "unpaid"
            ? CANCELLATION_UNPAID_TEXT
            : "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요",
      ),
    ]);
  }
  if (view.state === "permission") {
    if (view.reason === "card_not_yours") return body([simple("이 버튼은 카드를 받은 분만 누를 수 있어요")]);
    if (view.reason !== "not_accepting" || !/^[0-9-]{8,14}$/.test(view.contactPhone))
      throw new RangeError("invalid cancellation permission");
    return body([simple(`아직 상담을 받지 않아요. 가게로 연락해 주세요: ${view.contactPhone}`)]);
  }
  if (view.state === "error") {
    if (!["retry_needed", "server_error"].includes(view.reason)) throw new RangeError("invalid cancellation error");
    return body([simple(view.reason === "retry_needed" ? "다시 눌러 주세요" : "잠시 뒤 다시 말씀해 주세요")]);
  }
  if ("currentStatus" in view) return body([simple(`지금은 할 수 없어요: ${text(view.currentStatus, 100)}`)]);
  if (
    !["normal", "stale", "expired"].includes(view.state) ||
    !/^[0-9A-Z]{6,12}$/.test(view.orderNo) ||
    !Number.isFinite(Date.parse(view.pickupAt)) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(view.cardKey) ||
    kakaoChannelIdentifierError(view.blockId, 200) !== null
  )
    throw new RangeError("invalid cancellation card");
  const pickup = toShopLocal(new Date(view.pickupAt), view.timeZone);
  const heading = `주문번호 ${view.orderNo}\n픽업 ${Number(pickup.date.slice(5, 7))}월 ${Number(pickup.date.slice(8))}일 ${pickup.time}`;
  let refund: string;
  if (view.refund.kind === "unpaid") refund = "결제 전이라 환불할 금액이 없어요";
  else {
    if (
      view.refund.kind !== "calculated" ||
      !Number.isSafeInteger(view.refund.amount) ||
      view.refund.amount < 0 ||
      view.refund.amount > 10000000 ||
      !Array.isArray(view.refund.clauseNames) ||
      view.refund.clauseNames.length < 1 ||
      view.refund.clauseNames.length > 50
    )
      throw new RangeError("invalid cancellation refund");
    refund = `지금 취소하면 환불 ${view.refund.amount.toLocaleString("ko-KR")}원(${view.refund.clauseNames.map((name) => text(name, 60)).join(", ")})`;
  }
  const notice =
    view.state === "stale"
      ? "내용이 바뀌었어요. 새 카드를 확인해 주세요"
      : view.state === "expired"
        ? "시간이 지나 새 카드를 보내 드려요"
        : undefined;
  const content = [...(notice ? [notice] : []), heading, refund].join("\n");
  text(content, 3360);
  const compact = [...content, ..."주문 취소"].length <= 400;
  const action: Output = {
    textCard: {
      title: "주문 취소",
      description: compact ? content : heading,
      buttons: (["confirm", "decline"] as const).map((choice) => ({
        label: choice === "confirm" ? "주문 취소하기" : "취소 안 함",
        action: "block",
        blockId: view.blockId,
        extra: { cardKey: view.cardKey, choice },
      })),
    },
  };
  return body([...(compact ? [] : details(content)), action]);
}
