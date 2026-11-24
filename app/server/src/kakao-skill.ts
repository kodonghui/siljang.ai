import { sqlStateOf } from "./db";
import { errorNameOf } from "./error-name";
import { kakaoAiCostLimit } from "./kakao-ai-cost";
import { readKakaoInboundDisclosurePolicy } from "./kakao-ai-disclosure";
import { kakaoCallback, SKILL_WORK_MS } from "./kakao-callback";
import { publishStoredKakaoCallback, storeKakaoCallback } from "./kakao-callback-store";
import { receiveKakaoChannelCheck } from "./kakao-channel-check";
import { replyWithDeferredKakaoMessages } from "./kakao-deferred";
import { replyKakaoHandoffInTransaction } from "./kakao-handoff";
import { kakaoAiFailureOutcome, kakaoReply } from "./kakao-reply";
import { receiveKakaoTextReview } from "./kakao-review";
import {
  type InboundReceipt,
  kakaoContactPhone,
  receiveAndHandleKakaoMessage,
  receiveKakaoMessage,
} from "./kakao-skill-store";
import { storeMaskedMessageText } from "./message-masking";
import { type ShopRequest, shopRoute } from "./routes";
import { ForgedScopeError, withShopSavepoint } from "./shop-scope";

type SkillKind = "message" | "card" | "review" | "event";

const SKILLS: readonly SkillKind[] = ["message", "card", "review", "event"];

interface PreparedCallback {
  readonly receipt: Extract<InboundReceipt, { kind: "received" }>;
  readonly envelope: string;
}

async function handleSkill(r: ShopRequest, kind: SkillKind): Promise<Response> {
  const request = r.kakaoSkill;
  if (request === undefined || request.scope !== r.scope) {
    throw new ForgedScopeError("missing authorized Kakao skill scope");
  }
  if (kind === "event") return kakaoReply(r, "notice_gone");

  const messageKind = request.payload.utterance.trim() === "" ? "unsupported" : "text";
  try {
    const trial = await receiveKakaoChannelCheck(r, kind);
    if (trial !== null) return trial;
    if (kind === "review" && request.status === "linked") {
      const outcome = await receiveKakaoTextReview(r.db, request);
      return kakaoReply(r, outcome, {
        repeatReview: true,
        ...(outcome === "not_accepting" ? { contactPhone: await kakaoContactPhone(r.db) } : {}),
      });
    }
    if (kind !== "message" || request.status !== "linked") {
      return kakaoReply(r, "not_accepting", { contactPhone: await kakaoContactPhone(r.db) });
    }
    const queue = r.services.kakaoCallbackQueue;
    const disclosurePolicy = await readKakaoInboundDisclosurePolicy(r.db, request, r.services, (error) => {
      const dbCode = sqlStateOf(error);
      r.log("warn", {
        event: "kakao_disclosure_policy_failed",
        traceId: r.traceId,
        code: "policy_unavailable",
        errorName: errorNameOf(error),
        ...(dbCode === undefined ? {} : { dbCode }),
      });
    });
    const callback = kakaoCallback(request.payload.callbackUrl, request.receivedAt);
    if (messageKind === "text") {
      const ackUntil = request.receivedAt.getTime() + SKILL_WORK_MS;
      const timeLeft = () => ackUntil - r.services.now().getTime();
      const prepared = await receiveAndHandleKakaoMessage<Response | PreparedCallback>(
        r.db,
        request,
        messageKind,
        async (tx, receipt) => {
          if (receipt.kind === "not_accepting")
            return kakaoReply(r, receipt.kind, { contactPhone: receipt.contactPhone });
          if (receipt.kind === "duplicate") return kakaoReply(r, receipt.kind);
          let maskingFailed = false;
          try {
            await withShopSavepoint(tx, (part) =>
              storeMaskedMessageText(part, () => r.services.fieldCrypto(), receipt, request.payload.utterance),
            );
          } catch (error) {
            maskingFailed = true;
            const dbCode = sqlStateOf(error);
            r.log("error", {
              event: "kakao_message_masking_failed",
              traceId: r.traceId,
              errorName: dbCode !== undefined ? "DatabaseError" : error instanceof Error ? error.name : "Error",
              ...(dbCode === undefined ? {} : { dbCode }),
            });
            const saved = await tx.run(
              `UPDATE messages SET body_masked = $3 WHERE shop_id = $1 AND id = $2 AND consultation_id = $4
                AND direction = 'inbound' AND kind = 'text' AND body_masked IS NULL`,
              [receipt.messageId, "[보관하지 못한 메시지]", receipt.consultationId],
            );
            if (saved.rowCount !== 1) throw new Error("inbound message unavailable after masking failure");
          }
          if (receipt.limit !== "ok") return kakaoReply(r, "rate_limited", { silent: receipt.limit === "silent" });
          if (maskingFailed) {
            return replyKakaoHandoffInTransaction(
              tx,
              receipt,
              r.services.now(),
              (previous) => kakaoReply(r, "masking_failed", { previous }),
              "masking_failed",
              disclosurePolicy,
            );
          }
          if ((await kakaoAiCostLimit(tx, receipt.consultationId, r.services.now())) !== "ok") {
            return replyKakaoHandoffInTransaction(
              tx,
              receipt,
              r.services.now(),
              (previous) => kakaoReply(r, "ai_cost_limit_reached", { previous }),
              "ai_cost_limit",
              disclosurePolicy,
            );
          }
          if (queue !== undefined && callback !== null && timeLeft() > 0) {
            const envelope = await storeKakaoCallback(
              tx,
              r.services.fieldCrypto(),
              receipt.messageId,
              callback,
              timeLeft,
            );
            if (envelope !== null) return { receipt, envelope };
          }
          const outcome = kakaoAiFailureOutcome(r.services.aiConfigured ? "unavailable" : "key_missing");
          return replyKakaoHandoffInTransaction(
            tx,
            receipt,
            r.services.now(),
            (previous) => kakaoReply(r, outcome, { previous }),
            "ai_failure",
            disclosurePolicy,
          );
        },
      );
      if (prepared instanceof Response) return prepared;
      if (queue === undefined) throw new Error("missing prepared callback queue");
      // 큐 발행 실패의 즉시 안내. 본문 마스킹/AI 업무 처리 전에는 모델을 호출하지 않는다.
      const outcome = kakaoAiFailureOutcome(r.services.aiConfigured ? "unavailable" : "key_missing");
      const publication = await publishStoredKakaoCallback(
        r.db,
        queue,
        prepared.receipt,
        prepared.envelope,
        timeLeft,
        (tx) =>
          replyKakaoHandoffInTransaction(
            tx,
            prepared.receipt,
            r.services.now(),
            (previous) => kakaoReply(r, outcome, { previous }),
            "ai_failure",
            disclosurePolicy,
          ),
      );
      return publication.kind === "callback" ? kakaoReply(r, "callback_pending") : publication.value;
    }
    const receipt = await receiveKakaoMessage(r.db, request, messageKind);
    if (receipt.kind === "not_accepting") return kakaoReply(r, receipt.kind, { contactPhone: receipt.contactPhone });
    if (receipt.kind === "duplicate") return kakaoReply(r, receipt.kind);
    if (receipt.limit !== "ok") return kakaoReply(r, "rate_limited", { silent: receipt.limit === "silent" });
    const reply = (outcome: "unsupported_message" | "not_accepting") =>
      replyWithDeferredKakaoMessages(
        r.db,
        receipt.customerId,
        r.services.now(),
        (previous) => kakaoReply(r, outcome, { previous }),
        receipt.consultationId,
        disclosurePolicy,
      );
    return reply("unsupported_message");
  } catch (error) {
    const dbCode = sqlStateOf(error);
    r.log("error", {
      event: "kakao_skill_failed",
      traceId: r.traceId,
      code: "server_error",
      ...(dbCode === undefined ? {} : { dbCode }),
    });
    return kakaoReply(r, "server_error");
  }
}

export const kakaoSkillRoutes = SKILLS.map((kind) =>
  shopRoute("POST", `/kakao/skills/${kind}`, "customer", (r) => handleSkill(r, kind)),
);
