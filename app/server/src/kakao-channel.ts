/** 채널 설정/API-030·031·079. 현재 설정과 실제로 수신 중인 옛 연결을 구분한다. */
import { requireJson } from "./body";
import { CHANNEL_BLOCKS, type ChannelInput, parseChannelInput, parseSkillKeyInput } from "./kakao-channel-input";
import { ApiError, fieldError } from "./problem";
import type { ShopRequest } from "./routes";
import type { ShopDb } from "./shop-scope";
import { toShopIso } from "./time";

interface Channel {
  id: string;
  bot_id: string;
  channel_public_id: string | null;
  status: "pending" | "linked" | "failed" | "retired";
  check_started_at: Date | null;
  linked_at: Date | null;
  claim_expires_at: Date | null;
  card_block_id: string | null;
  orderer_block_id: string | null;
  allergy_block_id: string | null;
  depositor_block_id: string | null;
  review_block_id: string | null;
  verified_blocks: string[];
  test_user_key: string | null;
  event_status: string;
  event_checked_at: Date | null;
  event_fail_reason: string | null;
  skill_key_version: number;
  skill_key_issued_at: Date;
  previous_key_until: Date | null;
  revision: string;
}
const BLOCK_NAMES = ["card", "orderer_info", "allergy_answer", "depositor_name", "review"];
const FAILURE_HINTS = ["card_block", "orderer_block", "allergy_block", "depositor_block", "review_block"];
const LEASE_MS = 30 * 60_000;
export async function currentKakaoChannel(db: ShopDb): Promise<Channel | undefined> {
  return (
    await db.run<Channel>(
      "SELECT c.*,c.xmin::text AS revision FROM kakao_channels c WHERE c.shop_id=$1 AND c.status<>'retired' ORDER BY c.configuration_order DESC LIMIT 1",
    )
  ).rows[0];
}
function blocks(c: Channel): ChannelInput["blockIds"] {
  return {
    card: c.card_block_id,
    ordererInfo: c.orderer_block_id,
    allergyAnswer: c.allergy_block_id,
    depositorName: c.depositor_block_id,
    review: c.review_block_id,
  };
}
function sameBlocks(a: Channel, b: ChannelInput) {
  const previous = blocks(a);
  return CHANNEL_BLOCKS.every((key) => previous[key] === b.blockIds[key]);
}
/** GET과 재전송의 시간 판정도 행 조건을 함께 검사해 더 새 저장을 보존한다. */
async function currentAfterExpiry(db: ShopDb, now: Date): Promise<Channel | undefined> {
  let row = await currentKakaoChannel(db);
  if (
    row?.status === "pending" &&
    row.check_started_at !== null &&
    now.getTime() >= row.check_started_at.getTime() + 10 * 60_000
  ) {
    await db.run(
      "UPDATE kakao_channels SET status='failed',claim_expires_at=NULL WHERE shop_id=$1 AND id=$2 AND status='pending' AND check_started_at=$3",
      [row.id, row.check_started_at],
    );
    row = await currentKakaoChannel(db);
  }
  return row;
}
async function render(db: ShopDb, r: ShopRequest, c: Channel) {
  const zone = (await db.found<{ time_zone: string }>("SELECT s.time_zone FROM shops s WHERE s.id=$1")).time_zone;
  const iso = (value: Date | null) => (value === null ? null : toShopIso(value, zone));
  const origin = new URL(r.req.url).origin;
  const checking = c.status === "pending" && c.check_started_at !== null;
  const failureHints =
    c.status !== "failed"
      ? []
      : [
          "skill_url",
          "skill_key_header",
          "open_builder_deploy",
          ...(c.test_user_key === null ? ["test_message_missing"] : []),
          ...BLOCK_NAMES.flatMap((name, i) => (c.verified_blocks.includes(name) ? [] : [FAILURE_HINTS[i]])),
        ];
  return {
    connectionId: c.id,
    botId: c.bot_id,
    channelPublicId: c.channel_public_id,
    status: c.status,
    checkStartedAt: iso(c.check_started_at),
    checkExpiresAt: c.check_started_at === null ? null : iso(new Date(c.check_started_at.getTime() + 10 * 60_000)),
    linkedAt: iso(c.linked_at),
    proofPhrase: checking ? await r.services.kakaoProofPhrase(c.id, c.check_started_at as Date) : null,
    claimExpiresAt: iso(c.claim_expires_at),
    failureHints,
    blockIds: blocks(c),
    verifiedBlocks: c.verified_blocks,
    eventStatus: c.event_status,
    eventCheckedAt: iso(c.event_checked_at),
    eventFailReason: c.event_fail_reason,
    skill: {
      messageSkillUrl: new URL("/api/kakao/skills/message", origin).href,
      cardSkillUrl: new URL("/api/kakao/skills/card", origin).href,
      reviewSkillUrl: new URL("/api/kakao/skills/review", origin).href,
      eventSkillUrl: new URL("/api/kakao/skills/event", origin).href,
      eventName: "siljang_notice",
      headerName: "Siljang-Skill-Key",
      keyVersion: c.skill_key_version,
      keyIssuedAt: iso(c.skill_key_issued_at),
      previousKeyValidUntil: iso(c.previous_key_until),
    },
    revision: c.revision,
  };
}
async function key(r: ShopRequest, c: Channel) {
  return {
    headerName: "Siljang-Skill-Key",
    headerValue: await r.services.kakaoSkillKey(c.id, c.skill_key_version),
    keyVersion: c.skill_key_version,
  };
}
async function result(db: ShopDb, r: ShopRequest, c: Channel, outcome: string, showKey: boolean) {
  return { outcome, kakaoChannel: await render(db, r, c), skillKey: showKey ? await key(r, c) : null };
}
export async function getKakaoChannel(r: ShopRequest): Promise<Response> {
  return r.json(
    await r.db.transaction(async (db) => {
      const c = await currentAfterExpiry(db, r.services.now());
      if (!c) throw new ApiError("not_set");
      return render(db, r, c);
    }),
  );
}
export async function setKakaoChannel(r: ShopRequest): Promise<Response> {
  requireJson(r.req.raw);
  const raw = await r.body(),
    input = parseChannelInput(raw),
    now = r.services.now();
  try {
    return await r.command({
      command: "API-031",
      pathIds: [],
      body: raw,
      async execute(db) {
        // 공통 잠금을 먼저 잡는다. 다른 가게의 지난 선점을 풀어도 저장 실패라면 되돌린다.
        const available = await db.found<{ available: boolean }>("SELECT claim_kakao_bot($1,$2,$3) AS available", [
          input.botId,
          now,
        ]);
        await db.found("SELECT s.id FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE");
        const previous = await currentKakaoChannel(db);
        if (input.baseRevision !== (previous?.revision ?? null)) throw new ApiError("version_conflict");
        if (!available.available) throw new ApiError("channel_linked_elsewhere");
        let c = (
          await db.run<Channel>(
            "SELECT c.*,c.xmin::text AS revision FROM kakao_channels c WHERE c.shop_id=$1 AND c.bot_id=$2 AND c.status<>'retired' ORDER BY CASE WHEN c.status IN ('pending','linked') THEN 0 ELSE 1 END,c.configuration_order DESC LIMIT 1",
            [input.botId],
          )
        ).rows[0];
        const same =
          c !== undefined &&
          previous?.id === c.id &&
          c.channel_public_id === input.channelPublicId &&
          sameBlocks(c, input) &&
          c.status !== "failed";
        let outcome = "done",
          showKey = false;
        if (same && c) {
          outcome = "unchanged";
          if (c.status === "pending")
            c = await db.found<Channel>(
              "UPDATE kakao_channels SET claim_expires_at=$3 WHERE shop_id=$1 AND id=$2 RETURNING *,xmin::text AS revision",
              [c.id, new Date(now.getTime() + LEASE_MS)],
            );
        } else if (!c) {
          c = await db.found<Channel>(
            `INSERT INTO kakao_channels (shop_id,bot_id,channel_public_id,card_block_id,orderer_block_id,allergy_block_id,depositor_block_id,review_block_id,claim_expires_at,skill_key_issued_at,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *,xmin::text AS revision`,
            [
              input.botId,
              input.channelPublicId,
              ...CHANNEL_BLOCKS.map((k) => input.blockIds[k]),
              new Date(now.getTime() + LEASE_MS),
              now,
            ],
          );
          outcome = "created";
          showKey = true;
        } else if (!sameBlocks(c, input) || c.status === "failed") {
          c = await db.found<Channel>(
            `UPDATE kakao_channels SET channel_public_id=$3,card_block_id=$4,orderer_block_id=$5,allergy_block_id=$6,depositor_block_id=$7,review_block_id=$8,
          status='pending',claim_expires_at=$9,check_started_at=NULL,linked_at=NULL,verified_blocks='{}',test_user_key=NULL,
          event_status='unchecked',event_task_id=NULL,event_checked_at=NULL,event_fail_reason=NULL,configuration_order=DEFAULT
          WHERE shop_id=$1 AND id=$2 RETURNING *,xmin::text AS revision`,
            [
              c.id,
              input.channelPublicId,
              ...CHANNEL_BLOCKS.map((k) => input.blockIds[k]),
              new Date(now.getTime() + LEASE_MS),
            ],
          );
        } else {
          c = await db.found<Channel>(
            `UPDATE kakao_channels SET channel_public_id=$3,configuration_order=DEFAULT,
          claim_expires_at=CASE WHEN status='pending' THEN $4 ELSE NULL END WHERE shop_id=$1 AND id=$2 RETURNING *,xmin::text AS revision`,
            [c.id, input.channelPublicId, new Date(now.getTime() + LEASE_MS)],
          );
        }
        if (!c) throw new Error("channel result missing");
        await db.run(
          "UPDATE kakao_channels SET status='retired',retired_at=$3,claim_expires_at=NULL WHERE shop_id=$1 AND id<>$2 AND status='pending'",
          [c.id, now],
        );
        return {
          status: 200,
          code: outcome,
          ref: { connectionId: c.id, keyVersion: c.skill_key_version },
          body: await result(db, r, c, outcome, showKey),
        };
      },
      async render(db, stored) {
        const c = await currentAfterExpiry(db, r.services.now());
        if (!c) throw new ApiError("not_set");
        return result(
          db,
          r,
          c,
          stored.code,
          stored.code === "created" &&
            stored.ref.connectionId === c.id &&
            stored.ref.keyVersion === c.skill_key_version,
        );
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "channel_linked_elsewhere") {
      try {
        await r.db.transaction((db) =>
          db.run("INSERT INTO ops_events (shop_id,kind,count,created_at) VALUES ($1,'channel_already_linked',1,$2)", [
            now,
          ]),
        );
      } catch {
        r.log("warn", { event: "channel_conflict_alert_failed", traceId: r.traceId });
      }
    }
    throw error;
  }
}
export async function regenerateKakaoSkillKey(r: ShopRequest): Promise<Response> {
  requireJson(r.req.raw);
  const raw = await r.body(),
    input = parseSkillKeyInput(raw),
    now = r.services.now();
  return r.command({
    command: "API-079",
    pathIds: [],
    body: raw,
    async execute(db) {
      await db.found("SELECT s.id FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE");
      const c = await currentKakaoChannel(db);
      if (!c) throw new ApiError("not_set");
      if (c.revision !== input.baseRevision) throw new ApiError("version_conflict");
      if (c.skill_key_version >= 10000) throw fieldError("/", "out_of_range");
      const updated = await db.found<Channel>(
        "UPDATE kakao_channels SET skill_key_version=skill_key_version+1,skill_key_issued_at=$3,previous_key_until=$4 WHERE shop_id=$1 AND id=$2 RETURNING *,xmin::text AS revision",
        [c.id, now, input.previousKey === "keep_24h" ? new Date(now.getTime() + 86_400_000) : null],
      );
      return {
        status: 200,
        code: "done",
        ref: { connectionId: updated.id, keyVersion: updated.skill_key_version },
        body: await result(db, r, updated, "done", true),
      };
    },
    async render(db, stored) {
      const c = await currentAfterExpiry(db, r.services.now());
      if (!c) throw new ApiError("not_set");
      return result(
        db,
        r,
        c,
        stored.code,
        stored.ref.connectionId === c.id && stored.ref.keyVersion === c.skill_key_version,
      );
    },
  });
}
