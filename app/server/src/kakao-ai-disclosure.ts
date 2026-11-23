/** 첫 AI 답의 맨 앞에 붙일 고지. 외부 전송 성공 전에는 고지 완료를 기록하지 않는다. */
import type { KakaoCallbackClaim } from "./kakao-callback-store";
import { currentPrivacyPolicy } from "./privacy-policy-current";
import type { Services } from "./services";
import type { ShopDb, ShopRequestDb } from "./shop-scope";

export interface KakaoAiDisclosure {
  readonly consultationId: string;
  readonly version: number;
  readonly text: string;
  readonly at: Date;
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
  if (services.privacyPolicy === null || services.publicAppOrigin === null) return undefined;
  return db.transaction(async (tx) => {
    // 수신과 같은 가게→손님→상담 순서다. 정책의 가게 잠금을 손님 잠금보다 먼저 잡는다.
    const policy = await currentPrivacyPolicy(tx, services);
    if (policy === null) return undefined;
    const shop = await tx.found<{ booking_slug: string | null }>("SELECT booking_slug FROM shops WHERE id=$1");
    if (shop.booking_slug === null) return undefined;
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
      version: policy.version,
      text: `AI가 상담합니다. 개인정보처리방침: ${services.publicAppOrigin}/s/${shop.booking_slug}/privacy`,
      at: services.now(),
    };
  });
}

/** 콜백 성공·선점 해제·답의 전달 표시와 같은 트랜잭션에서만 부른다. */
export async function markKakaoAiDisclosure(
  tx: ShopDb,
  claim: KakaoCallbackClaim,
  disclosure: KakaoAiDisclosure,
  sentAt: Date,
): Promise<void> {
  if (disclosure.consultationId !== claim.consultation_id) throw new Error("AI disclosure scope mismatch");
  const marked = await tx.run(
    `UPDATE consultations SET ai_disclosed_at=$4,ai_disclosed_policy_version=$5
      WHERE shop_id=$1 AND id=$2 AND customer_id=$3 AND ai_disclosed_at IS NULL`,
    [claim.consultation_id, claim.customer_id, disclosure.at, disclosure.version],
  );
  if (marked.rowCount === 0) return;
  await tx.run(
    `INSERT INTO messages (shop_id,consultation_id,direction,author,kind,body_masked,delivery,sent_at,created_at)
      VALUES ($1,$2,'outbound','system','text',$3,'callback',$4,$5)`,
    [claim.consultation_id, disclosure.text, sentAt, disclosure.at],
  );
}
