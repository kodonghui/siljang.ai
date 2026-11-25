/** SCR008 표시 전용. 변경 값 검증·주문 쓰기·카드 갱신은 업무 처리기가 담당한다. */
import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import { normalizeLineBreaks } from "./line-breaks";
import { toShopLocal } from "./time";

export interface KakaoChangeRequestCard {
  readonly orderNo: string;
  readonly currentVersion: number;
  readonly changes: readonly { readonly label: string; readonly before: string; readonly after: string }[];
  readonly requiresOwnerApproval: boolean;
  readonly expiresAt: string;
  readonly timeZone: string;
}
interface Card extends KakaoChangeRequestCard {
  readonly cardKey: string;
  readonly blockId: string;
}
export type KakaoChangeRequestView =
  | ({ readonly state: "normal" | "stale" | "expired" } & Card)
  | { readonly state: "stale"; readonly currentStatus: string; readonly clause?: string }
  | { readonly state: "done"; readonly outcome: "change_requested" | "declined" }
  | { readonly state: "permission"; readonly reason: "card_not_yours" }
  | { readonly state: "permission"; readonly reason: "not_accepting"; readonly contactPhone: string }
  | { readonly state: "error"; readonly reason: "retry_needed" | "server_error" };
export const CHANGE_REQUESTED_TEXT = "변경을 요청했어요. 사장님이 보고 알려 드려요";
const DECLINED = "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요";
export function changeRequestResultText(outcome: string | undefined): string | undefined {
  switch (outcome) {
    case "change_requested":
      return CHANGE_REQUESTED_TEXT;
    case "declined":
      return DECLINED;
    case "card_stale":
      return "내용이 바뀌었어요. 새 카드를 확인해 주세요";
    case "card_expired":
      return "시간이 지나 새 카드를 보내 드려요";
    default:
      return undefined;
  }
}
const CHANGE_LABELS = [
  "크기",
  "맛",
  "디자인",
  "추가 사항",
  "더하는 옵션",
  "디자인 요청",
  "디자인 설명",
  "문구",
  "색",
  "픽업 날짜",
  "픽업 시간",
  "픽업 방법",
];
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
function text(value: string, max: number, empty = false) {
  if (typeof value !== "string") throw new RangeError("invalid change request text");
  const normalized = normalizeLineBreaks(value);
  if ((!empty && !normalized.trim()) || [...normalized].length > max || normalized.includes("\0"))
    throw new RangeError("invalid change request text");
  return normalized;
}
function body(outputs: readonly Output[]) {
  if (outputs.length < 1 || outputs.length > 3) throw new RangeError("invalid change request outputs");
  return { version: "2.0" as const, template: { outputs } };
}
function simple(value: string): Output {
  return { simpleText: { text: text(value, 1000) } };
}
/** 긴 변경 내용도 자르지 않고 행동 카드용 출력 하나를 남긴다. */
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
    if (!part) throw new RangeError("change grapheme exceeds text limit");
    parts.push(part);
  }
  if (parts.length <= 2) return parts.map(simple);
  index = 0;
  const items: { title: string; description?: string }[] = [];
  while (index < segments.length) {
    const start = index,
      title = `변경 내용 ${items.length + 1}\n${take(40)}`,
      description = take(128);
    if (index === start || items.length >= 20) throw new RangeError("change graphemes exceed carousel limit");
    items.push({ title, ...(description.length ? { description } : {}) });
  }
  const outputs: Output[] = [];
  for (let at = 0; at < items.length; at += 10)
    outputs.push({ carousel: { type: "textCard", items: items.slice(at, at + 10) } });
  return outputs;
}
export function kakaoChangeRequestMessage(view: KakaoChangeRequestView) {
  if (view.state === "done") {
    if (view.outcome !== "change_requested" && view.outcome !== "declined")
      throw new RangeError("invalid change result");
    return body([simple(view.outcome === "change_requested" ? CHANGE_REQUESTED_TEXT : DECLINED)]);
  }
  if (view.state === "permission") {
    if (view.reason !== "card_not_yours" && view.reason !== "not_accepting")
      throw new RangeError("invalid change request permission");
    return body([
      simple(
        view.reason === "card_not_yours"
          ? "이 버튼은 카드를 받은 분만 누를 수 있어요"
          : `아직 상담을 받지 않아요. 가게로 연락해 주세요: ${text(view.contactPhone, 40)}`,
      ),
    ]);
  }
  if (view.state === "error") {
    if (view.reason !== "retry_needed" && view.reason !== "server_error")
      throw new RangeError("invalid change request error");
    return body([simple(view.reason === "retry_needed" ? "다시 눌러 주세요" : "잠시 뒤 다시 말씀해 주세요")]);
  }
  if ("currentStatus" in view)
    return body(
      details(
        `지금은 할 수 없어요: ${text(view.currentStatus, 100)}${view.clause ? `\n${text(view.clause, 2100)}` : ""}`,
      ),
    );
  if (
    !["normal", "stale", "expired"].includes(view.state) ||
    !/^[0-9A-Z]{6,12}$/.test(view.orderNo) ||
    !Number.isSafeInteger(view.currentVersion) ||
    view.currentVersion < 1 ||
    !Array.isArray(view.changes) ||
    view.changes.length < 1 ||
    view.changes.length > 11 ||
    new Set(view.changes.map((change) => change.label)).size !== view.changes.length ||
    typeof view.requiresOwnerApproval !== "boolean" ||
    !Number.isFinite(Date.parse(view.expiresAt)) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(view.cardKey) ||
    kakaoChannelIdentifierError(view.blockId, 200) !== null
  )
    throw new RangeError("invalid change request card");
  const until = toShopLocal(new Date(view.expiresAt), view.timeZone).time;
  const heading = `주문번호 ${view.orderNo} · 지금 버전 ${view.currentVersion}`;
  const notice =
    view.state === "stale"
      ? "내용이 바뀌었어요. 새 카드를 확인해 주세요"
      : view.state === "expired"
        ? "시간이 지나 새 카드를 보내 드려요"
        : "";
  const changes = view.changes.map((change) => {
    if (!CHANGE_LABELS.includes(change.label)) throw new RangeError("invalid change request field");
    const before = text(change.before, 1000, true);
    const after = text(change.after, 1000, true);
    if (before === after) throw new RangeError("unchanged change request field");
    return `${text(change.label, 20)}: ${before || "없음"} → ${after || "없음"}`;
  });
  const content = [
    ...(notice ? [notice] : []),
    heading,
    ...changes,
    ...(view.requiresOwnerApproval ? ["받을지 사장님이 정해요"] : []),
    `${until}까지 눌러 주세요`,
  ].join("\n");
  text(content, 3360);
  const compact = [...content].length + [..."변경 요청"].length <= 400;
  const action: Output = {
    textCard: {
      title: "변경 요청",
      description: compact ? content : `${heading}\n${until}까지 눌러 주세요`,
      buttons: (["confirm", "decline"] as const).map((choice) => ({
        label: choice === "confirm" ? "변경 요청" : "안 할래요",
        action: "block",
        blockId: view.blockId,
        extra: { cardKey: view.cardKey, choice },
      })),
    },
  };
  return body([...(compact ? [] : details(content)), action]);
}
