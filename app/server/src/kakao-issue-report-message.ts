/** SCR010 표시 전용. 신고 내용 저장·손님 확인·명령은 업무 처리기가 맡는다. */
import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import { normalizeLineBreaks } from "./line-breaks";
import { toShopLocal } from "./time";

export interface KakaoIssueReportCard {
  readonly orderNo: string;
  readonly receivedAt: string;
  readonly description: string;
  readonly photoCount: number;
  readonly showMedicalNotice: boolean;
  readonly expiresAt: string;
  readonly timeZone: string;
  readonly cardKey: string;
  readonly blockId: string;
}
export type KakaoIssueReportView =
  | ({ readonly state: "normal" | "stale" | "expired" } & KakaoIssueReportCard)
  | { readonly state: "stale"; readonly reason: "not_received" }
  | { readonly state: "done"; readonly outcome: "issue_reported" | "declined" }
  | { readonly state: "permission"; readonly reason: "card_not_yours" }
  | { readonly state: "permission"; readonly reason: "not_accepting"; readonly contactPhone: string }
  | { readonly state: "error"; readonly reason: "retry_needed" | "server_error" };
export type KakaoIssueReportOutput =
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
    };
export interface KakaoIssueReportBody {
  readonly version: "2.0";
  readonly template: { readonly outputs: readonly KakaoIssueReportOutput[] };
}
export const ISSUE_REPORTED_TEXT = "신고를 받았어요. 사장님이 보시고 정하실 거예요";
const DECLINED = "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요";
const MEDICAL_NOTICE = "몸이 불편하시면 병원 진료를 먼저 받으세요";
function text(value: string, maximum: number): string {
  if (typeof value !== "string") throw new RangeError("invalid issue report text");
  const normalized = normalizeLineBreaks(value);
  if (!normalized.trim() || [...normalized].length > maximum || normalized.includes("\0"))
    throw new RangeError("invalid issue report text");
  return normalized;
}
function simple(value: string): KakaoIssueReportOutput {
  return { simpleText: { text: text(value, 1000) } };
}
function body(outputs: readonly KakaoIssueReportOutput[]): KakaoIssueReportBody {
  if (outputs.length < 1 || outputs.length > 3) throw new RangeError("invalid issue report outputs");
  return { version: "2.0", template: { outputs } };
}
/** 신고의 경과 시간으로 권리를 판단하지 않고, 서버가 준비한 현재 카드 값만 표시한다. */
export function kakaoIssueReportMessage(view: KakaoIssueReportView): KakaoIssueReportBody {
  if (typeof view !== "object" || view === null) throw new RangeError("invalid issue report view");
  if (view.state === "done") {
    if (view.outcome !== "issue_reported" && view.outcome !== "declined")
      throw new RangeError("invalid issue report result");
    return body([simple(view.outcome === "issue_reported" ? ISSUE_REPORTED_TEXT : DECLINED)]);
  }
  if (view.state === "permission") {
    if (view.reason !== "card_not_yours" && view.reason !== "not_accepting")
      throw new RangeError("invalid issue report permission");
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
      throw new RangeError("invalid issue report error");
    return body([simple(view.reason === "retry_needed" ? "다시 눌러 주세요" : "잠시 뒤 다시 말씀해 주세요")]);
  }
  if ("reason" in view) {
    if (view.state !== "stale" || view.reason !== "not_received")
      throw new RangeError("invalid issue report unavailable state");
    return body([simple("지금은 할 수 없어요: 아직 받지 않은 주문이에요")]);
  }
  if (
    !["normal", "stale", "expired"].includes(view.state) ||
    typeof view.orderNo !== "string" ||
    !/^[0-9A-Z]{6,12}$/.test(view.orderNo) ||
    !Number.isSafeInteger(view.photoCount) ||
    view.photoCount < 0 ||
    view.photoCount > 5 ||
    typeof view.showMedicalNotice !== "boolean" ||
    typeof view.receivedAt !== "string" ||
    !Number.isFinite(Date.parse(view.receivedAt)) ||
    typeof view.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(view.expiresAt)) ||
    typeof view.timeZone !== "string" ||
    typeof view.cardKey !== "string" ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(view.cardKey) ||
    kakaoChannelIdentifierError(view.blockId, 200) !== null
  )
    throw new RangeError("invalid issue report card");
  const description = text(view.description, 1000);
  const segments = [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(description)].map(
    ({ segment }) => segment,
  );
  const excerpt = segments.slice(0, 40).join("") + (segments.length > 40 ? "…" : "");
  const received = toShopLocal(new Date(view.receivedAt), view.timeZone).date;
  const until = toShopLocal(new Date(view.expiresAt), view.timeZone).time;
  const notice =
    view.state === "stale"
      ? "내용이 바뀌었어요. 새 카드를 확인해 주세요"
      : view.state === "expired"
        ? "시간이 지나 새 카드를 보내 드려요"
        : "";
  const medical = view.showMedicalNotice ? MEDICAL_NOTICE : "";
  const heading = `주문번호 ${view.orderNo}`;
  const receivedText = `받은 날 ${received}`;
  const photos = `사진 ${view.photoCount}장`;
  const deadline = `${until}까지 눌러 주세요`;
  const detail = [notice, heading, receivedText, photos, `신고 내용: ${excerpt}`, medical, deadline]
    .filter(Boolean)
    .join("\n");
  const title = "문제 신고";
  const compact = [...title, ...detail].length <= 400;
  const action: KakaoIssueReportOutput = {
    textCard: {
      title,
      description: compact ? detail : [heading, receivedText, photos, deadline].join("\n"),
      buttons: (["confirm", "decline"] as const).map((choice) => ({
        label: choice === "confirm" ? "문제 신고" : "안 할래요",
        action: "block" as const,
        blockId: view.blockId,
        extra: { cardKey: view.cardKey, choice },
      })),
    },
  };
  // 설명이 한 그래핌 1000자여도 앞말과 합쳐 한도를 넘기거나 중간을 자르지 않는다.
  return body(
    compact ? [action] : [simple([notice, medical, "신고 내용"].filter(Boolean).join("\n")), simple(excerpt), action],
  );
}
