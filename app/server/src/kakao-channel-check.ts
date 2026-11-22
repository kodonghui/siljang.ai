/** API-032/SPEC-008. 무료 MVP는 연결 문구/시험 버튼으로 연결하고 Event API를 부르지 않는다. */
import { currentKakaoChannel, currentKakaoChannelAfterExpiry, kakaoChannelResult } from "./kakao-channel";
import { kakaoReply } from "./kakao-reply";
import { kakaoContactPhone } from "./kakao-skill-store";
import { ApiError } from "./problem";
import type { ShopRequest } from "./routes";
import { ForgedScopeError, type ShopDb } from "./shop-scope";

/** 설정 저장과 같은 공통 잠금 뒤 가게 행을 잡는다. 가게의 봇을 다시 읽기 전에는 선점을 풀지 않는다. */
async function configurationLock(db: ShopDb) {
  await db.run(
    "SELECT pg_advisory_xact_lock(hashtextextended('siljang:kakao:channel-configuration:v1',0)) WHERE $1::uuid IS NOT NULL",
  );
  await db.found("SELECT s.id FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE");
}

const TRIAL_BLOCKS = [
  { name: "card", column: "card_block_id", label: "확인 카드" },
  { name: "orderer_info", column: "orderer_block_id", label: "주문자 정보" },
  { name: "allergy_answer", column: "allergy_block_id", label: "알레르기 답" },
  { name: "depositor_name", column: "depositor_block_id", label: "입금자 이름" },
  { name: "review", column: "review_block_id", label: "후기" },
] as const;
type Channel = NonNullable<Awaited<ReturnType<typeof currentKakaoChannel>>>;

function trialReply(
  r: ShopRequest,
  channel: Channel,
  outcome: "channel_test_card" | "block_verified" | "channel_linked",
): Response {
  const headers = { "Siljang-Outcome": outcome, "Cache-Control": "no-store" };
  if (outcome === "channel_linked")
    return r.json(
      {
        version: "2.0",
        template: {
          outputs: [
            { simpleText: { text: "시험 버튼 다섯이 모두 닿아 연결됐어요. 손님 안내는 다음 대화 때 전해요." } },
          ],
        },
      },
      200,
      headers,
    );
  const next = TRIAL_BLOCKS.find((block) => !channel.verified_blocks.includes(block.name)) ?? TRIAL_BLOCKS[0];
  const blockId = channel[next.column];
  if (blockId === null) throw new Error("configured trial block missing");
  const count = channel.verified_blocks.length;
  return r.json(
    {
      version: "2.0",
      template: {
        outputs: [
          {
            textCard: {
              title: "연결 확인",
              description:
                outcome === "channel_test_card"
                  ? `연결 문구를 받았어요. 시험 버튼을 하나씩 눌러 주세요(${count}/5 확인).`
                  : `시험 블록이 닿았어요(${count}/5). 다음 시험 버튼을 눌러 주세요.`,
              buttons: [{ label: `시험: ${next.label}`, action: "block", blockId, extra: { check: next.name } }],
            },
          },
        ],
      },
    },
    200,
    headers,
  );
}

/** 시험 표시는 일반 카드/후기 처리보다 먼저 받는다. 연결 뒤의 재전송도 주문/후기로 보내지 않는다. */
export async function receiveKakaoChannelCheck(
  r: ShopRequest,
  kind: "message" | "card" | "review" | "event",
): Promise<Response | null> {
  const request = r.kakaoSkill;
  if (!request || request.scope !== r.scope) throw new ForgedScopeError("missing authorized Kakao trial scope");
  if (kind === "event") return null;
  const check = request.payload.action.clientExtra.check;
  // 시험 표시/연결 문구 후보가 없는 요청은 기존 상담·미연결 읽기 경로로 보낸다.
  if (
    check === undefined &&
    (request.status === "linked" || kind !== "message" || !/^연결 [0-9]{6}$/.test(request.payload.utterance.trim()))
  )
    return null;
  return r.db.transaction(async (db) => {
    await configurationLock(db);
    let channel = (
      await db.run<Channel>(
        "SELECT c.*,c.xmin::text AS revision FROM kakao_channels c WHERE c.shop_id=$1 AND c.id=$2 FOR UPDATE",
        [request.channelId],
      )
    ).rows[0];
    const reject = async () => kakaoReply(r, "not_accepting", { contactPhone: await kakaoContactPhone(db) });
    if (!channel || !["pending", "linked"].includes(channel.status) || channel.check_started_at === null)
      return reject();
    if (channel.status === "pending") {
      const current = await currentKakaoChannel(db);
      if (current?.id !== channel.id) return reject();
      const expired = await db.run(
        "UPDATE kakao_channels SET status='failed',claim_expires_at=NULL WHERE shop_id=$1 AND id=$2 AND status='pending' AND check_started_at<=$3::timestamptz-interval '10 minutes' RETURNING id",
        [channel.id, request.receivedAt],
      );
      if (expired.rowCount > 0) return reject();
    }
    if (kind === "message") {
      if (check !== undefined || channel.status !== "pending") return reject();
      const phrase = await r.services.kakaoProofPhrase(channel.id, channel.check_started_at);
      if (
        request.payload.utterance.trim() !== phrase ||
        (channel.test_user_key !== null && channel.test_user_key !== request.payload.userId)
      )
        return reject();
      if (channel.test_user_key === null)
        channel = await db.found<Channel>(
          "UPDATE kakao_channels SET test_user_key=$3 WHERE shop_id=$1 AND id=$2 RETURNING *,xmin::text AS revision",
          [channel.id, request.payload.userId],
        );
      return trialReply(r, channel, "channel_test_card");
    }
    const block = TRIAL_BLOCKS.find((candidate) => candidate.name === check);
    if (
      !block ||
      channel.test_user_key !== request.payload.userId ||
      channel[block.column] !== request.payload.blockId ||
      (block.name === "review" ? kind !== "review" : kind !== "card")
    )
      return reject();
    if (channel.status === "linked") return trialReply(r, channel, "channel_linked");
    const verified = TRIAL_BLOCKS.filter(
      (candidate) => candidate.name === block.name || channel?.verified_blocks.includes(candidate.name),
    ).map((candidate) => candidate.name);
    if (verified.length === TRIAL_BLOCKS.length) {
      const now = r.services.now();
      await db.run(
        "UPDATE kakao_channels SET status='retired',retired_at=$3,claim_expires_at=NULL WHERE shop_id=$1 AND id<>$2 AND status='linked'",
        [channel.id, now],
      );
      channel = await db.found<Channel>(
        "UPDATE kakao_channels SET verified_blocks=$3,status='linked',linked_at=$4,claim_expires_at=NULL,event_status='unchecked',event_task_id=NULL,event_checked_at=NULL,event_fail_reason=NULL WHERE shop_id=$1 AND id=$2 RETURNING *,xmin::text AS revision",
        [channel.id, verified, now],
      );
      return trialReply(r, channel, "channel_linked");
    }
    if (!channel.verified_blocks.includes(block.name))
      channel = await db.found<Channel>(
        "UPDATE kakao_channels SET verified_blocks=$3 WHERE shop_id=$1 AND id=$2 RETURNING *,xmin::text AS revision",
        [channel.id, verified],
      );
    return trialReply(r, channel, "block_verified");
  });
}

export async function startKakaoChannelCheck(r: ShopRequest): Promise<Response> {
  const now = r.services.now();
  return r.command({
    command: "API-032",
    pathIds: [],
    body: null,
    async execute(db) {
      await configurationLock(db);
      const channel = await currentKakaoChannelAfterExpiry(db, now);
      if (!channel) throw new ApiError("not_set");
      if (
        [
          channel.card_block_id,
          channel.orderer_block_id,
          channel.allergy_block_id,
          channel.depositor_block_id,
          channel.review_block_id,
        ].some((id) => id === null)
      )
        throw new ApiError("channel_setup_incomplete");
      if (channel.status === "linked" || (channel.status === "pending" && channel.check_started_at !== null))
        return {
          status: 200,
          code: "unchanged",
          ref: { connectionId: channel.id },
          body: await kakaoChannelResult(db, r, channel, "unchanged", false),
        };
      const claimed = await db.found<{ available: boolean }>("SELECT claim_kakao_bot($1,$2,$3) AS available", [
        channel.bot_id,
        now,
      ]);
      // 다른 가게가 지난 선점을 가져갔으면 설정을 다시 저장해야 한다(API-031).
      if (!claimed.available) throw new ApiError("channel_setup_incomplete");
      const current = await db.found<NonNullable<Awaited<ReturnType<typeof currentKakaoChannelAfterExpiry>>>>(
        `UPDATE kakao_channels SET status='pending',check_started_at=$3,claim_expires_at=$3::timestamptz+interval '30 minutes',
         linked_at=NULL,verified_blocks='{}',test_user_key=NULL,event_status='unchecked',event_task_id=NULL,event_checked_at=NULL,event_fail_reason=NULL
         WHERE shop_id=$1 AND id=$2 RETURNING *,xmin::text AS revision`,
        [channel.id, now],
      );
      return {
        status: 200,
        code: "done",
        ref: { connectionId: current.id },
        body: await kakaoChannelResult(db, r, current, "done", false),
      };
    },
    async render(db, stored) {
      const channel = await currentKakaoChannelAfterExpiry(db, r.services.now());
      if (!channel) throw new ApiError("not_set");
      return kakaoChannelResult(db, r, channel, stored.code, false);
    },
  });
}
