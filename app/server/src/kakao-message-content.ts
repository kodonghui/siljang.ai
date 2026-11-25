/** 카카오 발신 내용. 확인 카드는 서버가 저장한 표시 값만 받습니다. */
import type { ConfirmCardView } from "./confirm-card-store";

export type KakaoMessageContent = string | ConfirmCardView;
export type KakaoMessageOutput =
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
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && [...value].length >= 1 && [...value].length <= max && !value.includes("\0");

export function kakaoMessageOutputs(contents: readonly KakaoMessageContent[]): KakaoMessageOutput[] {
  if (contents.length > 3) throw new RangeError("too many Kakao outputs");
  return contents.map((content) => {
    if (typeof content === "string") {
      if (!text(content, 1000)) throw new RangeError("invalid Kakao text");
      return { simpleText: { text: content } };
    }
    if (
      !content ||
      !text(content.title, 50) ||
      !text(content.description, 400) ||
      !text(content.confirmLabel, 14) ||
      !text(content.blockId, 200) ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(content.cardKey)
    )
      throw new RangeError("invalid server Kakao card");
    return {
      textCard: {
        title: content.title,
        description: content.description,
        buttons: [
          {
            label: content.confirmLabel,
            action: "block",
            blockId: content.blockId,
            extra: { cardKey: content.cardKey, choice: "confirm" },
          },
          {
            label: "안 할래요",
            action: "block",
            blockId: content.blockId,
            extra: { cardKey: content.cardKey, choice: "decline" },
          },
        ],
      },
    };
  });
}
