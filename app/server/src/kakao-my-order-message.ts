/** SCR007 표시 전용. 본인 확인과 주문/환불 계산은 업무 모듈이 끝낸 서버 값을 받는다. */
import { toShopLocal } from "./time";
export interface KakaoMyOrderSummary {
  readonly orderNo: string;
  readonly status:
    | "requested"
    | "awaiting_payment"
    | "payment_overdue"
    | "confirmed"
    | "received"
    | "no_pickup"
    | "rejected"
    | "cancelled";
  readonly pickupAt: string;
  readonly contents: {
    readonly size: string;
    readonly flavor: string;
    readonly design?: string;
    readonly options?: readonly string[];
    readonly message?: string;
  };
  readonly amount: number;
  readonly paidAt: string | null;
  readonly refund?: { readonly amount: number; readonly sentAt: string | null };
  readonly changeDeadline: string;
  readonly refundNow: { readonly amount: number; readonly clause: string };
  readonly timeZone: string;
}
export type KakaoMyOrderView = { readonly state: "normal" | "stale"; readonly order: KakaoMyOrderSummary };
type MyOrderOutput =
  | { readonly simpleText: { readonly text: string } }
  | {
      readonly textCard: {
        readonly title: string;
        readonly description: string;
        readonly buttons: readonly {
          readonly label: string;
          readonly action: "message";
          readonly messageText: string;
        }[];
      };
    };
const STATUS: Record<KakaoMyOrderSummary["status"], string> = {
  requested: "주문 요청됨",
  awaiting_payment: "결제 기다림",
  payment_overdue: "결제 기한 지남",
  confirmed: "주문 확정",
  received: "받음",
  no_pickup: "미수령",
  rejected: "거절됨",
  cancelled: "취소됨",
};
function text(value: string) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new RangeError("invalid my order text");
  return value.replace(/\s+/gu, " ").trim();
}
function amount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000000) throw new RangeError("invalid my order amount");
  return `${value.toLocaleString("ko-KR")}원`;
}
function date(value: string, zone: string, includeTime = true) {
  if (!Number.isFinite(Date.parse(value))) throw new RangeError("invalid my order date");
  const local = toShopLocal(new Date(value), zone);
  return `${Number(local.date.slice(5, 7))}월 ${Number(local.date.slice(8))}일${includeTime ? ` ${local.time}` : ""}`;
}
export function kakaoMyOrderMessage(view: KakaoMyOrderView) {
  const o = view.order;
  if (!/^[0-9A-Z]{6,8}$/.test(o.orderNo) || STATUS[o.status] === undefined)
    throw new RangeError("invalid my order presentation");
  const title = `내 주문 · ${o.orderNo}`;
  const facts = [
    `${STATUS[o.status]} · ${date(o.pickupAt, o.timeZone)} 픽업`,
    `${amount(o.amount)} · ${o.paidAt === null ? "결제 전" : `결제 확인 ${date(o.paidAt, o.timeZone)}`}`,
    ...(o.refund === undefined
      ? []
      : [
          `환불 ${amount(o.refund.amount)} · ${o.refund.sentAt === null ? "보내기 전" : `${date(o.refund.sentAt, o.timeZone, false)} 보냄`}`,
        ]),
    `변경 마감: ${date(o.changeDeadline, o.timeZone)}까지`,
    `지금 취소하면 환불 ${amount(o.refundNow.amount)}(${text(o.refundNow.clause)})`,
  ];
  const summary = [
    o.contents.size,
    o.contents.flavor,
    ...(o.contents.design === undefined ? [] : [o.contents.design]),
    ...(o.contents.options ?? []),
  ]
    .map(text)
    .join(" · ");
  const base = [facts[0], summary, ...facts.slice(1)].join("\n");
  const message = o.contents.message === undefined || o.contents.message === "" ? "" : text(o.contents.message);
  const budget = 400 - [...title, ...base, ..." · 문구 ''"].length;
  const shownMessage =
    message && budget > 0
      ? [...message].length <= budget
        ? message
        : `${[...message].slice(0, Math.max(0, budget - 1)).join("")}…`
      : message;
  const description = [
    facts[0],
    `${summary}${shownMessage ? ` · 문구 '${shownMessage}'` : ""}`,
    ...facts.slice(1),
  ].join("\n");
  const buttons = (o.status === "received" ? ["문제가 있어요"] : ["바꾸고 싶어요", "취소할래요"]).map((label) => ({
    label,
    action: "message" as const,
    messageText: `${o.orderNo} ${label}`,
  }));
  const outputs: MyOrderOutput[] = [];
  if ([...title, ...description].length > 400) {
    const chars = [...description];
    if (chars.length > 2000) throw new RangeError("too many my order outputs");
    for (let at = 0; at < chars.length; at += 1000)
      outputs.push({ simpleText: { text: chars.slice(at, at + 1000).join("") } });
    outputs.push({ textCard: { title, description: facts.slice(0, 2).join("\n"), buttons } });
  } else outputs.push({ textCard: { title, description, buttons } });
  return { version: "2.0" as const, template: { outputs } };
}
