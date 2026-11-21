import { sqlStateOf } from "./db";
import { kakaoCallback, SKILL_ACK_MS } from "./kakao-callback";
import { scheduleKakaoCallback } from "./kakao-callback-store";
import { kakaoReply } from "./kakao-reply";
import { kakaoContactPhone, receiveKakaoMessage } from "./kakao-skill-store";
import { type ShopRequest, shopRoute } from "./routes";
import { ForgedScopeError } from "./shop-scope";

type SkillKind = "message" | "card" | "review" | "event";

const SKILLS: readonly SkillKind[] = ["message", "card", "review", "event"];

async function handleSkill(r: ShopRequest, kind: SkillKind): Promise<Response> {
  const request = r.kakaoSkill;
  if (request === undefined || request.scope !== r.scope) {
    throw new ForgedScopeError("missing authorized Kakao skill scope");
  }
  if (kind === "event") return kakaoReply(r, "notice_gone");

  const messageKind = request.payload.utterance.trim() === "" ? "unsupported" : "text";
  try {
    if (kind !== "message" || request.status !== "linked") {
      return kakaoReply(r, "not_accepting", { contactPhone: await kakaoContactPhone(r.db) });
    }
    const receipt = await receiveKakaoMessage(r.db, request, messageKind);
    if (receipt.kind === "not_accepting") return kakaoReply(r, receipt.kind, { contactPhone: receipt.contactPhone });
    if (receipt.kind === "duplicate") return kakaoReply(r, receipt.kind);
    if (receipt.limit !== "ok") return kakaoReply(r, "rate_limited", { silent: receipt.limit === "silent" });
    if (messageKind === "unsupported") return kakaoReply(r, "unsupported_message");

    const queue = r.services.kakaoCallbackQueue;
    const callback = kakaoCallback(request.payload.callbackUrl, request.receivedAt);
    const ackUntil = request.receivedAt.getTime() + SKILL_ACK_MS;
    if (queue !== undefined && callback !== null && r.services.now().getTime() < ackUntil) {
      if (
        await scheduleKakaoCallback(
          r.db,
          r.services.fieldCrypto(),
          queue,
          receipt.messageId,
          callback,
          () => ackUntil - r.services.now().getTime(),
        )
      ) {
        return kakaoReply(r, "callback_pending");
      }
    }
    return kakaoReply(r, "not_accepting");
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
