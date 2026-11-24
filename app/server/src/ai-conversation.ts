/** AI 입력은 이 상담의 마스킹 글·허용한 초안·유효 견적만 읽는다. 원래 값/알레르기/주문자 정보는 조회하지 않는다. */
import type { AiMessage } from "./ai-model";
import { maskMessageText } from "./message-masking";
import type { Services } from "./services";
import type { ShopDb } from "./shop-scope";

const MAX_TURNS = 20;
const inputText = (text: string) => [...text].slice(0, 1000).join("");

/** 번호를 복원하지 않는다. 빈 답이 되면 호출자의 출력 검사에서 거절한다. */
export function stripAiPlaceholders(text: string): string {
  return text
    .replace(/\[(?:전화번호|계좌번호|카드번호|긴숫자)[0-9]{1,3}\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function readAiConversation(
  db: ShopDb,
  source: { readonly messageId: string; readonly consultationId: string; readonly customerId: string },
  services: Pick<Services, "fieldCrypto" | "now">,
): Promise<readonly AiMessage[]> {
  const anchor = await db.found<{ created_at: Date }>(
    `SELECT m.created_at FROM messages m JOIN consultations c ON c.shop_id=$1 AND c.id=m.consultation_id
      WHERE m.shop_id=$1 AND m.id=$2 AND m.consultation_id=$3 AND c.customer_id=$4 AND m.direction='inbound'`,
    [source.messageId, source.consultationId, source.customerId],
  );
  const requested = await db.found<{ at: Date | null }>(
    "SELECT max(requested_at) AS at FROM orders WHERE shop_id=$1 AND consultation_id=$2 AND requested_at<=$3",
    [source.consultationId, anchor.created_at],
  );
  const turns = await db.run<{ id: string; body_masked: string; created_at: Date }>(
    `SELECT id,body_masked,created_at FROM messages WHERE shop_id=$1 AND consultation_id=$2
      AND direction='inbound' AND kind='text' AND body_masked IS NOT NULL
      AND (id=$3 OR created_at<$4 OR (created_at=$4 AND id<$3))
      AND ($5::timestamptz IS NULL OR created_at>$5)
      ORDER BY (id=$3) DESC,created_at DESC,id DESC LIMIT $6`,
    [source.consultationId, source.messageId, anchor.created_at, requested.at, MAX_TURNS],
  );
  const mask = async (text: string) =>
    inputText(await maskMessageText(db, () => services.fieldCrypto(), source.consultationId, text));
  const messages: AiMessage[] = [];
  const draft = await db.run<{
    id: string;
    revision: number;
    lettering: string | null;
    design_notes: string | null;
    colors: string | null;
    excluded_ingredients: string | null;
    courier_pickup: boolean;
  }>(
    `SELECT id,revision,lettering,design_notes,colors,excluded_ingredients,courier_pickup FROM order_drafts
      WHERE shop_id=$1 AND consultation_id=$2 AND status='active' ORDER BY created_at DESC,id DESC LIMIT 1`,
    [source.consultationId],
  );
  if (draft.rows[0]) {
    const fields = draft.rows[0];
    const safe = {
      lettering: fields.lettering === null ? null : await mask(fields.lettering),
      designNotes: fields.design_notes === null ? null : await mask(fields.design_notes),
      colors: fields.colors === null ? null : await mask(fields.colors),
      excludedIngredients: fields.excluded_ingredients === null ? null : await mask(fields.excluded_ingredients),
      courierPickup: fields.courier_pickup,
    };
    messages.push({ role: "system", content: `서버가 고른 현재 초안: ${JSON.stringify(safe)}` });
    const quote = (
      await db.run<{
        amount: number;
        amount_max: number | null;
        display_kind: "fixed" | "from" | "range";
        order_kind: "standard" | "custom";
        valid_until: Date;
      }>(
        `SELECT q.amount,q.amount_max,q.display_kind,q.order_kind,q.valid_until FROM quotes q
       JOIN price_lists p ON p.shop_id=$1 AND p.id=q.price_list_id AND p.superseded_at IS NULL
         WHERE q.shop_id=$1 AND q.draft_id=$2 AND q.draft_revision=$3
         AND q.quoted_at<=$4 AND q.valid_until>$4 ORDER BY q.quoted_at DESC,q.id DESC LIMIT 1`,
        [fields.id, fields.revision, services.now()],
      )
    ).rows[0];
    if (quote)
      messages.push({
        role: "system",
        content: `서버가 계산한 현재 견적: ${JSON.stringify({
          amount: quote.amount,
          amountMax: quote.amount_max,
          displayKind: quote.display_kind,
          orderKind: quote.order_kind,
          validUntil: quote.valid_until.toISOString(),
        })}`,
      });
  }
  const replies = await db.run<{ trace_id: string; body_masked: string }>(
    `SELECT DISTINCT ON (trace_id) trace_id,body_masked FROM messages WHERE shop_id=$1 AND consultation_id=$2
      AND direction='outbound' AND author='ai' AND trace_id=ANY($3::text[]) AND body_masked IS NOT NULL
      AND delivery IN ('deferred','callback','delivered_later')
      ORDER BY trace_id,created_at,id`,
    [source.consultationId, turns.rows.filter((turn) => turn.id !== source.messageId).map((turn) => turn.id)],
  );
  const replyByTurn = new Map(replies.rows.map((row) => [row.trace_id, row.body_masked]));
  for (const turn of [...turns.rows].reverse()) {
    messages.push({ role: "user", content: await mask(turn.body_masked) });
    if (turn.id === source.messageId) continue;
    const reply = replyByTurn.get(turn.id);
    if (reply !== undefined) messages.push({ role: "assistant", content: await mask(reply) });
  }
  return messages;
}
