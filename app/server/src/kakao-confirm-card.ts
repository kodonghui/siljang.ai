/** API-071. 카드 값과 업무 대상은 저장된 서버 자료에서만 읽습니다. */
import { type ConfirmCardAnswer, pressConfirmCardInTransaction } from "./confirm-card-store";
import { errorFields } from "./error-name";
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
  const outputs: unknown[] = [{ simpleText: { text: answer.text } }];
  if (answer.firstResult !== undefined) outputs.push({ simpleText: { text: answer.firstResult.text } });
  if (answer.card !== undefined) {
    const c = answer.card;
    outputs.push({
      textCard: {
        title: c.title,
        description: c.description,
        buttons: [
          {
            label: c.confirmLabel,
            action: "block",
            blockId: c.blockId,
            extra: { cardKey: c.cardKey, choice: "confirm" },
          },
          { label: "안 할래요", action: "block", blockId: c.blockId, extra: { cardKey: c.cardKey, choice: "decline" } },
        ],
      },
    });
  }
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
      const channel = await tx.run<{ card_block_id: string }>(
        "SELECT card_block_id FROM kakao_channels WHERE shop_id=$1 AND id=$2 AND status='linked' FOR SHARE",
        [request.channelId],
      );
      if (channel.rows[0] === undefined) return null;
      if (channel.rows[0].card_block_id !== request.payload.blockId)
        return { outcome: "card_not_yours", text: "받으신 카드에서 눌러 주세요" };
      const customer = await tx.run<{ id: string }>(
        "SELECT id FROM customers WHERE shop_id=$1 AND kakao_channel_id=$2 AND kakao_user_key=$3 FOR UPDATE",
        [request.channelId, request.payload.userId],
      );
      const customerId = customer.rows[0]?.id;
      if (customerId === undefined) return { outcome: "card_not_yours", text: "받으신 카드에서 눌러 주세요" };
      const consultation = await tx.run<{ id: string }>(
        "SELECT id FROM consultations WHERE shop_id=$1 AND customer_id=$2 AND status NOT IN ('ended','deleted','dropped') ORDER BY opened_at DESC,id DESC LIMIT 1",
        [customerId],
      );
      const consultationId = consultation.rows[0]?.id;
      if (consultationId === undefined) return { outcome: "card_not_yours", text: "받으신 카드에서 눌러 주세요" };
      return pressConfirmCardInTransaction(
        tx,
        { ...input, customerId, consultationId, now: r.services.now() },
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
