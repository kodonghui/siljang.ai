/** 첫 AI 답의 맨 앞에 붙일 고지. 외부 전송 성공 전에는 고지 완료를 기록하지 않는다. */
import type { KakaoCallbackClaim } from "./kakao-callback-store";
import { type AuthorizedKakaoSkill, kakaoReceiptKey } from "./kakao-skill-auth";
import { KAKAO_MESSAGE_LIMIT } from "./kakao-skill-store";
import { currentPrivacyPolicy } from "./privacy-policy-current";
import type { Services } from "./services";
import type { ShopDb, ShopRequestDb } from "./shop-scope";

export interface KakaoAiDisclosure {
  readonly consultationId: string;
  readonly noticeId: string;
  readonly version: number;
  readonly text: string;
  readonly at: Date;
}

export type KakaoDisclosurePolicy = Pick<KakaoAiDisclosure, "version" | "text" | "at">;

const disclosureTrace = (consultationId: string) => `ai-disclosure:${consultationId}`;

/** 첫 준비 시각을 보존한다. 호출자는 먼저 손님과 상담을 잠근다. */
async function pendingDisclosure(
  tx: ShopDb,
  consultationId: string,
  policy: KakaoDisclosurePolicy,
): Promise<{ noticeId: string; at: Date }> {
  const trace = disclosureTrace(consultationId);
  const previous = await tx.run<{ id: string; created_at: Date }>(
    "SELECT id,created_at FROM messages WHERE shop_id=$1 AND consultation_id=$2 AND trace_id=$3 AND direction='outbound' AND author='system' FOR UPDATE",
    [consultationId, trace],
  );
  const old = previous.rows[0];
  if (old) {
    await tx.run("UPDATE messages SET body_masked=$3 WHERE shop_id=$1 AND id=$2", [old.id, policy.text]);
    return { noticeId: old.id, at: old.created_at };
  }
  const row = await tx.found<{ id: string }>(
    `INSERT INTO messages (shop_id,consultation_id,direction,author,kind,body_masked,trace_id,delivery,created_at)
      VALUES ($1,$2,'outbound','system','text',$3,$4,'deferred',$5) RETURNING id`,
    [consultationId, policy.text, trace, policy.at],
  );
  return { noticeId: row.id, at: policy.at };
}

/** 손님 잠금을 잡기 전에 현재 정책을 고른다. 게시 전/손상 상태에서는 AI 답을 열지 않는다. */
export async function readKakaoDisclosurePolicy(
  db: ShopRequestDb,
  services: Services,
): Promise<KakaoDisclosurePolicy | undefined> {
  if (!services.aiConfigured || services.privacyPolicy === null || services.publicAppOrigin === null) return undefined;
  try {
    return await db.transaction(async (tx) => {
      const policy = await currentPrivacyPolicy(tx, services);
      if (policy === null) return undefined;
      const shop = await tx.found<{ booking_slug: string | null }>("SELECT booking_slug FROM shops WHERE id=$1");
      if (shop.booking_slug === null) return undefined;
      return {
        version: policy.version,
        text: `AI가 상담합니다. 개인정보처리방침: ${services.publicAppOrigin}/s/${shop.booking_slug}/privacy`,
        at: services.now(),
      };
    });
  } catch {
    // 정책을 확인할 수 없으면 AI 답을 열지 않고 기존 수신/사장님 안내를 유지한다.
    return undefined;
  }
}

/** 가게 잠금 전의 빠른 읽기다. 이미 고지한 상담·중복 수신은 정책을 다시 만들지 않는다. */
export async function readKakaoInboundDisclosurePolicy(
  db: ShopRequestDb,
  request: AuthorizedKakaoSkill,
  services: Services,
): Promise<KakaoDisclosurePolicy | undefined> {
  if (!services.aiConfigured) return undefined;
  try {
    const receipt = await kakaoReceiptKey(request.requestKeySecret, request.payload, request.receivedAt, "message");
    const duplicate = await db.run("SELECT id FROM messages WHERE shop_id=$1 AND kakao_message_id=$2", [receipt]);
    if (duplicate.rowCount !== 0) return undefined;
    const known = await db.run<{ ai_disclosed_at: Date | null; status: string; customer_id: string }>(
      `SELECT c.ai_disclosed_at,c.status,c.customer_id FROM consultations c
       JOIN customers u ON u.shop_id=$1 AND u.id=c.customer_id
       WHERE c.shop_id=$1 AND u.kakao_channel_id=$2 AND u.kakao_user_key=$3
       AND c.status NOT IN ('ended','deleted') LIMIT 1`,
      [request.channelId, request.payload.userId],
    );
    const current = known.rows[0];
    if (current && (current.ai_disclosed_at !== null || current.status === "dropped")) return undefined;
    if (current) {
      const start = new Date(Math.floor(request.receivedAt.getTime() / 60000) * 60000);
      const recent = await db.found<{ n: number }>(
        `SELECT count(*)::int AS n FROM messages m JOIN consultations c ON c.shop_id=$1 AND c.id=m.consultation_id
         WHERE m.shop_id=$1 AND c.customer_id=$2 AND m.direction='inbound' AND m.created_at >= $3 AND m.created_at < $4`,
        [current.customer_id, start, new Date(start.getTime() + 60000)],
      );
      if (recent.n >= KAKAO_MESSAGE_LIMIT) return undefined;
    }
    return await readKakaoDisclosurePolicy(db, services);
  } catch {
    return undefined;
  }
}

/** 호출자는 손님 행을 잠근다. 같은 상담의 즉시 응답에서만 쓸 고지다. */
export async function inlineKakaoDisclosure(
  tx: ShopDb,
  consultationId: string,
  customerId: string,
  policy?: KakaoDisclosurePolicy,
): Promise<KakaoAiDisclosure | undefined> {
  if (policy === undefined) return undefined;
  const rows = await tx.run<{ ai_disclosed_at: Date | null; status: string }>(
    "SELECT ai_disclosed_at,status FROM consultations WHERE shop_id=$1 AND id=$2 AND customer_id=$3 FOR UPDATE",
    [consultationId, customerId],
  );
  const current = rows.rows[0];
  if (!current || current.ai_disclosed_at !== null || ["ended", "deleted", "dropped"].includes(current.status))
    return undefined;
  return { consultationId, ...policy, ...(await pendingDisclosure(tx, consultationId, policy)) };
}

/** 기존 이전 글 둘 뒤 현재 답의 자리보다 고지를 먼저 둔다. 넘친 현재 안내는 호출자가 미전달로 남긴다. */
export async function prependKakaoDisclosure(
  response: Response,
  disclosure?: KakaoAiDisclosure,
): Promise<{ response: Response; currentIncluded: boolean }> {
  if (disclosure === undefined) return { response, currentIncluded: true };
  const body = (await response.json()) as { version: string; template: { outputs: unknown[] } };
  const outputs = body.template.outputs;
  const next = {
    ...body,
    template: { ...body.template, outputs: [{ simpleText: { text: disclosure.text } }, ...outputs].slice(0, 3) },
  };
  return {
    response: new Response(JSON.stringify(next), { status: response.status, headers: response.headers }),
    currentIncluded: outputs.length < 3,
  };
}

/** null은 이미 고지함, undefined는 현재 고지를 준비할 수 없어 AI 답을 막아야 함을 뜻한다. */
export async function prepareKakaoAiDisclosure(
  db: ShopRequestDb,
  claim: KakaoCallbackClaim,
  services: Services,
): Promise<KakaoAiDisclosure | null | undefined> {
  const known = await db.run<{ ai_disclosed_at: Date | null; status: string }>(
    "SELECT ai_disclosed_at,status FROM consultations WHERE shop_id=$1 AND id=$2 AND customer_id=$3",
    [claim.consultation_id, claim.customer_id],
  );
  const state = known.rows[0];
  if (!state || ["ended", "deleted", "dropped"].includes(state.status)) return undefined;
  if (state.ai_disclosed_at !== null) return null;
  const policy = await readKakaoDisclosurePolicy(db, services);
  if (policy === undefined) return undefined;
  return db.transaction(async (tx) => {
    await tx.found("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [claim.customer_id]);
    const current = await tx.found<{ ai_disclosed_at: Date | null; status: string }>(
      "SELECT ai_disclosed_at,status FROM consultations WHERE shop_id=$1 AND id=$2 AND customer_id=$3 FOR UPDATE",
      [claim.consultation_id, claim.customer_id],
    );
    if (["ended", "deleted", "dropped"].includes(current.status)) return undefined;
    if (current.ai_disclosed_at !== null) return null;
    const owned = await tx.run(
      `SELECT id FROM messages WHERE shop_id=$1 AND consultation_id=$2 AND direction='inbound'
        AND kakao_callback_enc=$3 AND kakao_callback_claim_until=$4 LIMIT 1`,
      [claim.consultation_id, claim.kakao_callback_enc, claim.kakao_callback_claim_until],
    );
    if (owned.rowCount !== 1) return undefined;
    return {
      consultationId: claim.consultation_id,
      ...policy,
      ...(await pendingDisclosure(tx, claim.consultation_id, policy)),
    };
  });
}

/** 콜백 성공·선점 해제·답의 전달 표시와 같은 트랜잭션에서만 부른다. */
export async function markKakaoAiDisclosure(
  tx: ShopDb,
  claim: Pick<KakaoCallbackClaim, "consultation_id" | "customer_id">,
  disclosure: KakaoAiDisclosure,
  sentAt: Date,
  delivery: "callback" | "skill_response" = "callback",
): Promise<void> {
  if (disclosure.consultationId !== claim.consultation_id) throw new Error("AI disclosure scope mismatch");
  const marked = await tx.run(
    `UPDATE consultations SET ai_disclosed_at=$4,ai_disclosed_policy_version=$5
      WHERE shop_id=$1 AND id=$2 AND customer_id=$3 AND ai_disclosed_at IS NULL`,
    [claim.consultation_id, claim.customer_id, sentAt, disclosure.version],
  );
  if (marked.rowCount === 0) return;
  const saved = await tx.run(
    "UPDATE messages SET body_masked=$4,delivery=$5,sent_at=$6 WHERE shop_id=$1 AND id=$2 AND consultation_id=$3 AND trace_id=$7 AND direction='outbound' AND author='system'",
    [
      disclosure.noticeId,
      claim.consultation_id,
      disclosure.text,
      delivery,
      sentAt,
      disclosureTrace(claim.consultation_id),
    ],
  );
  if (saved.rowCount !== 1) throw new Error("AI disclosure record unavailable");
}
