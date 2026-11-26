/** SCR013 표시 전용. 사진 내리기와 동의 철회는 서버 업무 명령이 담당한다. */
import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import { normalizeLineBreaks } from "./line-breaks";
import { toShopLocal } from "./time";

export interface KakaoConsentWithdrawalCard {
  readonly orderNo: string;
  readonly completionPhotoCount: number;
  readonly reviewPhotoCount: number;
  readonly publishedCount: number;
  readonly expiresAt: string;
  readonly timeZone: string;
  readonly cardKey: string;
  readonly blockId: string;
}
export type KakaoConsentWithdrawalView =
  | ({ readonly state: "normal" | "stale" | "expired" } & KakaoConsentWithdrawalCard)
  | { readonly state: "stale"; readonly reason: "no_consented_photos" }
  | { readonly state: "done"; readonly outcome: "consent_withdrawn" | "declined"; readonly firstResultText?: string }
  | { readonly state: "permission"; readonly reason: "card_not_yours" }
  | { readonly state: "permission"; readonly reason: "not_accepting"; readonly contactPhone: string }
  | { readonly state: "error"; readonly reason: "retry_needed" | "server_error" };
export interface KakaoConsentWithdrawalBody {
  readonly version: "2.0";
  readonly template: {
    readonly outputs: readonly (
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
    )[];
  };
}
export const CONSENT_WITHDRAWN_TEXT = "사진 게시 동의를 철회했어요. 5분 안에 사진이 내려가요";
export const NO_CONSENTED_PHOTOS_TEXT = "지금은 할 수 없어요: 게시에 동의한 사진이 없어요";
function text(value: string, maximum = 1000): string {
  if (typeof value !== "string") throw new RangeError("invalid consent withdrawal text");
  const normalized = normalizeLineBreaks(value);
  if (!normalized.trim() || normalized.includes("\0") || [...normalized].length > maximum)
    throw new RangeError("invalid consent withdrawal text");
  return normalized;
}
function simple(value: string): KakaoConsentWithdrawalBody {
  return { version: "2.0", template: { outputs: [{ simpleText: { text: text(value) } }] } };
}
export function kakaoConsentWithdrawalMessage(view: KakaoConsentWithdrawalView): KakaoConsentWithdrawalBody {
  if (typeof view !== "object" || view === null) throw new RangeError("invalid consent withdrawal view");
  if (view.state === "done") {
    if (view.outcome !== "consent_withdrawn" && view.outcome !== "declined")
      throw new RangeError("invalid consent withdrawal result");
    return simple(
      view.firstResultText ??
        (view.outcome === "consent_withdrawn"
          ? CONSENT_WITHDRAWN_TEXT
          : "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"),
    );
  }
  if (view.state === "permission") {
    if (view.reason === "card_not_yours") return simple("이 버튼은 카드를 받은 분만 누를 수 있어요");
    if (view.reason === "not_accepting")
      return simple(`아직 상담을 받지 않아요. 가게로 연락해 주세요: ${text(view.contactPhone, 40)}`);
    throw new RangeError("invalid consent withdrawal permission");
  }
  if (view.state === "error") {
    if (view.reason === "retry_needed") return simple("다시 눌러 주세요");
    if (view.reason === "server_error") return simple("잠시 뒤 다시 말씀해 주세요");
    throw new RangeError("invalid consent withdrawal error");
  }
  if ("reason" in view) {
    if (view.state !== "stale" || view.reason !== "no_consented_photos")
      throw new RangeError("invalid consent withdrawal unavailable state");
    return simple(NO_CONSENTED_PHOTOS_TEXT);
  }
  const counts = [view.completionPhotoCount, view.reviewPhotoCount, view.publishedCount];
  const total = view.completionPhotoCount + view.reviewPhotoCount;
  if (
    !["normal", "stale", "expired"].includes(view.state) ||
    typeof view.orderNo !== "string" ||
    !/^[0-9A-Z]{6,12}$/.test(view.orderNo) ||
    counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    view.publishedCount > total ||
    typeof view.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(view.expiresAt)) ||
    typeof view.timeZone !== "string" ||
    typeof view.cardKey !== "string" ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(view.cardKey) ||
    kakaoChannelIdentifierError(view.blockId, 200) !== null
  )
    throw new RangeError("invalid consent withdrawal card");
  const until = toShopLocal(new Date(view.expiresAt), view.timeZone).time;
  const notice =
    view.state === "stale"
      ? "내용이 바뀌었어요. 새 카드를 확인해 주세요"
      : view.state === "expired"
        ? "시간이 지나 새 카드를 보내 드려요"
        : "";
  const title = "사진 게시 동의 철회";
  const description = [
    notice,
    `주문번호 ${view.orderNo}`,
    `철회할 사진 ${total.toLocaleString("ko-KR")}장`,
    `완성 사진 ${view.completionPhotoCount.toLocaleString("ko-KR")}장 · 후기 사진 ${view.reviewPhotoCount.toLocaleString("ko-KR")}장`,
    view.publishedCount > 0 ? "포트폴리오에 올라 있음" : "포트폴리오에 올라 있지 않음",
    `${until}까지 눌러 주세요`,
  ]
    .filter(Boolean)
    .join("\n");
  if ([...title, ...description].length > 400) throw new RangeError("consent withdrawal card too long");
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          textCard: {
            title,
            description,
            buttons: (["confirm", "decline"] as const).map((choice) => ({
              label: choice === "confirm" ? "동의 철회" : "안 할래요",
              action: "block" as const,
              blockId: view.blockId,
              extra: { cardKey: view.cardKey, choice },
            })),
          },
        },
      ],
    },
  };
}
