import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { sqlStateOf } from "./db";
import { authorizeKakaoSkill } from "./kakao-skill-auth";
import { receiveKakaoMessage } from "./kakao-skill-store";
import { openRoute } from "./routes";
import { shopRequestDb } from "./shop-scope";

type SkillKind = "message" | "card" | "review" | "event";

const SKILLS: readonly SkillKind[] = ["message", "card", "review", "event"];

const TEXT = {
  notice_gone: "지금은 전할 안내가 없어요",
  not_accepting: "아직 상담을 받지 않아요",
  rate_limited: "잠시 뒤 다시 말씀해 주세요",
  server_error: "잠시 뒤 다시 말씀해 주세요",
  unsupported_message: "글이나 사진으로 말씀해 주세요",
} as const;

type TextOutcome = keyof typeof TEXT;
type SkillOutcome = TextOutcome | "duplicate";

function reply(c: Context<HonoEnv>, outcome: SkillOutcome, silent = false): Response {
  const outputs = outcome === "duplicate" || silent ? [] : [{ simpleText: { text: TEXT[outcome] } }];
  return c.json({ version: "2.0", template: { outputs } }, 200, {
    "cache-control": "no-store",
    "Siljang-Outcome": outcome,
  });
}

async function handleSkill(c: Context<HonoEnv>, kind: SkillKind): Promise<Response> {
  const request = await authorizeKakaoSkill(c);
  if (kind === "event") return reply(c, "notice_gone");
  if (kind !== "message" || request.status !== "linked") return reply(c, "not_accepting");

  const messageKind = request.payload.utterance.trim() === "" ? "unsupported" : "text";
  try {
    const db = shopRequestDb(request.scope, c.get("db"));
    const receipt = await receiveKakaoMessage(db, request, messageKind);
    if (receipt.kind !== "received") return reply(c, receipt.kind);
    if (receipt.limit !== "ok") return reply(c, "rate_limited", receipt.limit === "silent");
    if (messageKind === "unsupported") return reply(c, "unsupported_message");
    return reply(c, "not_accepting");
  } catch (error) {
    const dbCode = sqlStateOf(error);
    c.get("log")("error", {
      event: "kakao_skill_failed",
      traceId: c.get("traceId"),
      code: "server_error",
      ...(dbCode === undefined ? {} : { dbCode }),
    });
    return reply(c, "server_error");
  }
}

export const kakaoSkillRoutes = SKILLS.map((kind) =>
  openRoute(
    "POST",
    `/kakao/skills/${kind}`,
    "카카오 스킬 키로 연결을 인증한 뒤 그 가게 범위만 사용함(06 DEC-08)",
    (c) => handleSkill(c, kind),
  ),
);
