/** 콜백 소비자의 모델 한 차례. 원문/연락처 대신 보관된 마스킹 글만 읽고, 결과를 발신 전에 확정한다. */
import { FIRST_ATTEMPT, markAiCallUnused, nextAttempt } from "./ai-calls";
import { AI_TOTAL_TIMEOUT_MS, type AiFailure } from "./ai-model";
import type { AiTurnOutput } from "./ai-turn-output";
import { kakaoAiCostLimit } from "./kakao-ai-cost";
import type { KakaoCallbackClaim } from "./kakao-callback-store";
import type { Services } from "./services";
import type { ShopDb, ShopRequestDb } from "./shop-scope";

export interface KakaoAiReply {
  readonly id: string;
  readonly text: string;
  readonly delivered: boolean;
}

export type KakaoAiTurnResult =
  | { readonly kind: "reply"; readonly reply: KakaoAiReply }
  | { readonly kind: "failure"; readonly failure: AiFailure }
  | { readonly kind: "cost_limit" }
  | { readonly kind: "busy" }
  | { readonly kind: "gone" };

const SEND_RESERVE_MS = 6500;
const FREE_FIELDS = {
  lettering: "lettering",
  design_notes: "design_notes",
  colors: "colors",
  excluded_ingredients: "excluded_ingredients",
  courier_pickup: "courier_pickup",
} as const;

async function currentReply(db: ShopDb, messageId: string, consultationId: string): Promise<KakaoAiReply | null> {
  const rows = await db.run<{ id: string; body_masked: string; delivery: string }>(
    `SELECT id, body_masked, delivery FROM messages WHERE shop_id = $1 AND consultation_id = $2
      AND trace_id = $3 AND direction = 'outbound' AND author = 'ai' AND body_masked IS NOT NULL
      AND delivery IN ('deferred', 'callback', 'delivered_later') ORDER BY created_at, id LIMIT 1`,
    [consultationId, messageId],
  );
  const row = rows.rows[0];
  return row === undefined ? null : { id: row.id, text: row.body_masked, delivered: row.delivery !== "deferred" };
}

/** 수신·선점과 같은 가게/상담을 다시 확인한다. 외부 호출 동안 행 잠금은 유지하지 않는다. */
export async function runKakaoAiTurn(
  db: ShopRequestDb,
  messageId: string,
  claim: KakaoCallbackClaim,
  services: Services,
  now: () => Date,
): Promise<KakaoAiTurnResult> {
  const left = () => claim.kakao_callback_deadline_at.getTime() - now().getTime();
  const prepared = await db.transaction(async (tx) => {
    await tx.found("SELECT id FROM customers WHERE shop_id = $1 AND id = $2 FOR UPDATE", [claim.customer_id]);
    const consultation = await tx.found<{
      status: string;
      ai_disclosed_at: Date | null;
      turn_trace_id: string | null;
    }>(
      `SELECT status, ai_disclosed_at, turn_trace_id FROM consultations
        WHERE shop_id = $1 AND id = $2 AND customer_id = $3 FOR UPDATE`,
      [claim.consultation_id, claim.customer_id],
    );
    const source = await tx.run<{ body_masked: string | null }>(
      `SELECT body_masked FROM messages WHERE shop_id = $1 AND id = $2 AND consultation_id = $3
        AND direction = 'inbound' AND kakao_callback_enc = $4 AND kakao_callback_claim_until = $5 FOR UPDATE`,
      [messageId, claim.consultation_id, claim.kakao_callback_enc, claim.kakao_callback_claim_until],
    );
    if (source.rowCount === 0) return { kind: "gone" } as const;
    if (["ended", "deleted", "dropped"].includes(consultation.status) || consultation.ai_disclosed_at === null)
      return { kind: "failure", failure: "unavailable" } as const;
    const reply = await currentReply(tx, messageId, claim.consultation_id);
    if (reply !== null) return { kind: "reply", reply } as const;
    const handedOff = await tx.run(
      `SELECT h.id FROM handoffs h WHERE h.shop_id = $1 AND h.consultation_id = $2
        AND (h.source_message_id = $3 OR h.id IN (
          SELECT q.handoff_id FROM handoff_questions q WHERE q.shop_id = $1 AND q.message_id = $3)) LIMIT 1`,
      [claim.consultation_id, messageId],
    );
    if (handedOff.rowCount > 0) return { kind: "failure", failure: "unavailable" } as const;
    if (consultation.turn_trace_id !== null)
      return consultation.turn_trace_id === messageId
        ? ({ kind: "failure", failure: "unavailable" } as const)
        : ({ kind: "busy" } as const);
    if ((await kakaoAiCostLimit(tx, claim.consultation_id, now())) !== "ok") return { kind: "cost_limit" } as const;
    const text = source.rows[0]?.body_masked;
    if (text === null || text === undefined || text.trim() === "" || left() <= SEND_RESERVE_MS)
      return { kind: "failure", failure: "timeout" } as const;
    // 발신 전 프로세스가 멈춰도 같은 차례를 다시 모델로 보내지 않는다. 답을 확정하지 못했으면 사장님께 넘긴다.
    await tx.run("UPDATE consultations SET turn_trace_id = $3, turn_started_at = $4 WHERE shop_id = $1 AND id = $2", [
      claim.consultation_id,
      messageId,
      now(),
    ]);
    return { kind: "input", text: [...text].slice(0, 1000).join("") } as const;
  });
  if (prepared.kind !== "input") return prepared;

  const model = services.aiModel({
    totalTimeoutMs: Math.min(AI_TOTAL_TIMEOUT_MS, Math.max(1, left() - SEND_RESERVE_MS)),
  });
  let attempt = FIRST_ATTEMPT;
  let result = await model.call({
    db,
    consultationId: claim.consultation_id,
    traceId: messageId,
    attempt,
    promptVersion: "kakao-callback-2026-11-22",
    messages: [
      {
        role: "system",
        content:
          "가게 상담의 마스킹된 글입니다. 가격·자리·법률 판단을 만들지 마세요. 일반 답과 명시된 문구·색·디자인 설명만 채우고, 그 밖의 요청은 사장님 확인으로 넘기세요.",
      },
      { role: "user", content: prepared.text },
    ],
  });
  if (!result.ok && result.retryable && left() > AI_TOTAL_TIMEOUT_MS + 1000 + SEND_RESERVE_MS) {
    await services.wait(1000);
    attempt = nextAttempt(attempt, "retry");
    result = await model.call({
      db,
      consultationId: claim.consultation_id,
      traceId: messageId,
      attempt,
      promptVersion: "kakao-callback-2026-11-22",
      messages: [
        {
          role: "system",
          content:
            "가게 상담의 마스킹된 글입니다. 가격·자리·법률 판단을 만들지 마세요. 일반 답과 명시된 문구·색·디자인 설명만 채우고, 그 밖의 요청은 사장님 확인으로 넘기세요.",
        },
        { role: "user", content: prepared.text },
      ],
    });
  }
  const failure = !result.ok
    ? result.failure
    : left() <= 0
      ? "timeout"
      : safeReply(result.output)
        ? null
        : "schema_invalid";
  if (failure !== null || !result.ok) {
    // 실패 안내의 확정과 함께 prepareKakaoCallbackHandoff가 선점을 푼다.
    if (result.ok)
      await markAiCallUnused(
        db,
        result.aiCallId,
        claim.consultation_id,
        failure === "timeout" ? "timeout" : "schema_invalid",
      );
    return { kind: "failure", failure: failure ?? "unavailable" };
  }

  const output = result.output;
  return db.transaction(async (tx) => {
    await tx.found("SELECT id FROM customers WHERE shop_id = $1 AND id = $2 FOR UPDATE", [claim.customer_id]);
    const c = await tx.found<{ status: string; turn_trace_id: string | null }>(
      "SELECT status, turn_trace_id FROM consultations WHERE shop_id = $1 AND id = $2 AND customer_id = $3 FOR UPDATE",
      [claim.consultation_id, claim.customer_id],
    );
    if (c.turn_trace_id !== messageId || ["ended", "deleted", "dropped"].includes(c.status))
      return { kind: "failure", failure: "unavailable" } as const;
    if (left() <= 0) return { kind: "failure", failure: "timeout" } as const;
    await saveDraft(tx, claim.consultation_id, output.draft_patch, now());
    const saved = await tx.run<{ id: string }>(
      `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, body_masked, trace_id, delivery, created_at)
        VALUES ($1, $2, 'outbound', 'ai', 'text', $3, $4, 'deferred', $5) RETURNING id`,
      [claim.consultation_id, output.reply, messageId, now()],
    );
    await tx.run(
      "UPDATE consultations SET turn_trace_id = NULL, turn_started_at = NULL WHERE shop_id = $1 AND id = $2 AND turn_trace_id = $3",
      [claim.consultation_id, messageId],
    );
    const id = saved.rows[0]?.id;
    if (id === undefined) throw new Error("AI reply was not stored");
    return { kind: "reply", reply: { id, text: output.reply, delivered: false } } as const;
  });
}

/** 견적/확인 카드/주문 업무는 뒤 업무 처리기가 검증한다. 아직 연결하지 않은 결과를 그대로 발신하지 않는다. */
function safeReply(output: AiTurnOutput): boolean {
  if (
    !output.reply.trim() ||
    output.quote_request ||
    output.card ||
    output.handoff ||
    output.issue_patch ||
    output.refund_account_patch
  )
    return false;
  if (/\d[\d,]*\s*원|\d\s*%|\d{7,}/.test(output.reply)) return false;
  return Object.keys(output.draft_patch ?? {}).every((key) => Object.hasOwn(FREE_FIELDS, key));
}

async function saveDraft(
  db: ShopDb,
  consultationId: string,
  patch: AiTurnOutput["draft_patch"],
  now: Date,
): Promise<void> {
  if (patch === undefined) return;
  const fields = Object.entries(patch).map(([key, value]) => ({
    column: FREE_FIELDS[key as keyof typeof FREE_FIELDS],
    value,
  }));
  if (fields.length === 0) return;
  const found = await db.run<{ id: string }>(
    "SELECT id FROM order_drafts WHERE shop_id = $1 AND consultation_id = $2 AND status = 'active' FOR UPDATE",
    [consultationId],
  );
  const draft = found.rows[0];
  if (draft === undefined) {
    await db.run(
      `INSERT INTO order_drafts (shop_id, consultation_id, ${fields.map((f) => f.column).join(", ")}, created_at, updated_at)
        VALUES ($1, $2, ${fields.map((_, i) => `$${i + 3}`).join(", ")}, $${fields.length + 3}, $${fields.length + 3})`,
      [consultationId, ...fields.map((f) => f.value), now],
    );
    return;
  }
  await db.run(
    `UPDATE order_drafts SET ${fields.map((f, i) => `${f.column} = $${i + 3}`).join(", ")}, revision = revision + 1, updated_at = $${fields.length + 3}
      WHERE shop_id = $1 AND id = $2 AND (${fields.map((f, i) => `${f.column} IS DISTINCT FROM $${i + 3}`).join(" OR ")})`,
    [draft.id, ...fields.map((f) => f.value), now],
  );
}
