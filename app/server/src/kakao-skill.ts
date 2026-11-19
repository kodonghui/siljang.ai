import { sqlStateOf } from "./db";
import { KAKAO_CONSULTATION_UNAVAILABLE_TEXT, kakaoCallback, SKILL_ACK_MS } from "./kakao-callback";
import { scheduleKakaoCallback } from "./kakao-callback-store";
import { receiveKakaoMessage } from "./kakao-skill-store";
import { type ShopRequest, shopRoute } from "./routes";
import { ForgedScopeError } from "./shop-scope";

type SkillKind = "message" | "card" | "review" | "event";

const SKILLS: readonly SkillKind[] = ["message", "card", "review", "event"];

const TEXT = {
  notice_gone: "지금은 전할 안내가 없어요",
  not_accepting: KAKAO_CONSULTATION_UNAVAILABLE_TEXT,
  rate_limited: "잠시 뒤 다시 말씀해 주세요",
  server_error: "잠시 뒤 다시 말씀해 주세요",
  unsupported_message: "글이나 사진으로 말씀해 주세요",
} as const;

type TextOutcome = keyof typeof TEXT;
type SkillOutcome = TextOutcome | "duplicate";

function reply(r: ShopRequest, outcome: SkillOutcome, silent = false): Response {
  const outputs = outcome === "duplicate" || silent ? [] : [{ simpleText: { text: TEXT[outcome] } }];
  return r.json({ version: "2.0", template: { outputs } }, 200, {
    "Siljang-Outcome": outcome,
  });
}

async function handleSkill(r: ShopRequest, kind: SkillKind): Promise<Response> {
  const request = r.kakaoSkill;
  if (request === undefined || request.scope !== r.scope) {
    throw new ForgedScopeError("missing authorized Kakao skill scope");
  }
  if (kind === "event") return reply(r, "notice_gone");
  if (kind !== "message" || request.status !== "linked") return reply(r, "not_accepting");

  const messageKind = request.payload.utterance.trim() === "" ? "unsupported" : "text";
  try {
    const receipt = await receiveKakaoMessage(r.db, request, messageKind);
    if (receipt.kind !== "received") return reply(r, receipt.kind);
    if (receipt.limit !== "ok") return reply(r, "rate_limited", receipt.limit === "silent");
    if (messageKind === "unsupported") return reply(r, "unsupported_message");

    const queue = r.services.kakaoCallbackQueue;
    const callback = kakaoCallback(request.payload.callbackUrl, request.receivedAt);
    const ackUntil = request.receivedAt.getTime() + SKILL_ACK_MS;
    if (queue !== undefined && callback !== null && r.services.now().getTime() < ackUntil) {
      if (await scheduleKakaoCallback(
        r.db, r.services.fieldCrypto(), queue, receipt.messageId, callback,
        () => ackUntil - r.services.now().getTime(),
      )) {
        return r.json({ version: "2.0", useCallback: true, data: { text: "답을 준비하고 있어요" } }, 200, {
          "Siljang-Outcome": "callback_pending",
        });
      }
    }
    return reply(r, "not_accepting");
  } catch (error) {
    const dbCode = sqlStateOf(error);
    r.log("error", {
      event: "kakao_skill_failed",
      traceId: r.traceId,
      code: "server_error",
      ...(dbCode === undefined ? {} : { dbCode }),
    });
    return reply(r, "server_error");
  }
}

export const kakaoSkillRoutes = SKILLS.map((kind) =>
  shopRoute("POST", `/kakao/skills/${kind}`, "customer", (r) => handleSkill(r, kind)),
);
