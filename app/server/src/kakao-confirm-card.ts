/** API-071. 카드 값과 업무 대상은 저장된 서버 자료에서만 읽습니다. */
import { type ConfirmCardAnswer, pressKakaoConfirmCardInTransaction } from "./confirm-card-store";
import { errorFields } from "./error-name";
import { type KakaoMessageContent, kakaoMessageOutputs } from "./kakao-message-content";
import { kakaoReply } from "./kakao-reply";
import type { KakaoSkillPayload } from "./kakao-skill-auth";
import { kakaoContactPhone } from "./kakao-skill-store";
import { fieldError } from "./problem";
import type { ShopRequest } from "./routes";

export interface KakaoCardPress {
  readonly cardKey: string;
  readonly choice: "confirm" | "decline";
}
export function parseKakaoCardPress(payload: KakaoSkillPayload): KakaoCardPress {
  const { cardKey, choice } = payload.action.clientExtra;
  if (typeof cardKey !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(cardKey))
    throw fieldError("/action/clientExtra/cardKey", cardKey === undefined ? "required" : "bad_format");
  if (choice !== "confirm" && choice !== "decline")
    throw fieldError("/action/clientExtra/choice", choice === undefined ? "required" : "bad_format");
  return { cardKey, choice };
}
export function kakaoConfirmCardReply(r: Pick<ShopRequest, "json">, answer: ConfirmCardAnswer): Response {
  const contents: KakaoMessageContent[] = [answer.text];
  if (answer.firstResult !== undefined) contents.push(answer.firstResult.text);
  if (answer.card !== undefined) contents.push(answer.card);
  const outputs = kakaoMessageOutputs(contents);
  return r.json({ version: "2.0", template: { outputs } }, 200, {
    "Siljang-Outcome": answer.outcome,
    "Cache-Control": "no-store",
  });
}
export async function receiveKakaoConfirmCard(r: ShopRequest, input: KakaoCardPress): Promise<Response> {
  const request = r.kakaoSkill;
  if (request === undefined) throw new Error("authorized card request missing");
  try {
    const answer = await r.db.transaction(async (tx) => {
      const shop = await tx.run<{ booking_issued_at: Date | null }>(
        "SELECT booking_issued_at FROM shops WHERE id=$1 FOR SHARE",
      );
      if (shop.rows[0]?.booking_issued_at == null) return null;
      return pressKakaoConfirmCardInTransaction(
        tx,
        {
          ...input,
          channelId: request.channelId,
          userId: request.payload.userId,
          blockId: request.payload.blockId,
          now: r.services.now(),
        },
        r.services.confirmCardCommand,
      );
    });
    return answer === null
      ? kakaoReply(r, "not_accepting", { contactPhone: await kakaoContactPhone(r.db) })
      : kakaoConfirmCardReply(r, answer);
  } catch (error) {
    r.log("error", { event: "kakao_card_command_failed", traceId: r.traceId, ...errorFields(error) });
    return kakaoConfirmCardReply(r, { outcome: "retry_needed", text: "잠시 뒤 다시 눌러 주세요" });
  }
}
