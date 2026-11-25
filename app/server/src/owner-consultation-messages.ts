/** API-043: 사장님에게만 전화·계좌를 복원하고 대화·손님 안내를 같은 페이지로 읽는다. */
import {
  type ConsultationCursor,
  ConsultationCursorError,
  type ConsultationReadDirection,
  openConsultationCursor,
  sealConsultationCursor,
} from "./consultation-cursor";
import { FieldCryptoError } from "./field-crypto";
import { maskedValuePlaceholderPattern, openStoredMaskedValue, type StoredMaskedValue } from "./masked-values";
import { ApiError, fieldError } from "./problem";
import type { AccessRequest } from "./routes";
import { isUuid } from "./shop-scope";
import { toShopIso } from "./time";

interface PageInput {
  limit: number;
  token: string | null;
  direction: ConsultationReadDirection;
}

interface Entry {
  id: string;
  at: Date;
  timeline_seq: string;
  cursor_at: string;
  direction: string;
  author: string;
  kind: string;
  body: string | null;
  delivery: string | null;
  source: string;
}
function input(query: Record<string, string>): PageInput {
  if (query.limit !== undefined && !/^-?[0-9]+$/.test(query.limit)) throw fieldError("query:limit", "bad_format");
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fieldError("query:limit", "out_of_range");
  if (query.cursor !== undefined && (query.cursor.length < 1 || query.cursor.length > 200))
    throw fieldError("query:cursor", "bad_format");
  const direction = query.direction ?? "forward";
  if (direction !== "forward" && direction !== "backward") throw fieldError("query:direction", "bad_format");
  return { limit, token: query.cursor ?? null, direction };
}

function displayText(body: string | null, replacements: ReadonlyMap<string, string>): string | null {
  if (body === null) return null;
  const text = body.replace(maskedValuePlaceholderPattern(), (key) => replacements.get(key) ?? key);
  return text.length <= 100000 ? text : Array.from(text).slice(0, 100000).join("");
}
const ENTRY_BASE = `WITH entries AS (
  SELECT m.id,m.created_at AS at,m.timeline_seq,m.direction,m.author,m.kind,m.body_masked AS body,m.delivery,'message'::text AS source
  FROM messages m WHERE m.shop_id=$1 AND m.consultation_id=$2 AND m.timeline_seq <= $7::bigint
  UNION ALL
  SELECT n.id,CASE WHEN txid_visible_in_snapshot(n.delivery_txid,$6::txid_snapshot) THEN coalesce(n.sent_at,n.created_at) ELSE n.created_at END AS at,n.timeline_seq,'outbound'::text,
    CASE WHEN n.kind='owner_reply' THEN 'owner' ELSE 'notice' END,'text'::text,n.body,
    CASE WHEN NOT txid_visible_in_snapshot(n.delivery_txid,$6::txid_snapshot) AND n.status='delivered_on_reply' THEN 'deferred'
      WHEN NOT txid_visible_in_snapshot(n.delivery_txid,$6::txid_snapshot) AND n.status='sent' THEN 'sending'
      ELSE CASE n.status WHEN 'sent' THEN 'event_api' WHEN 'deferred' THEN 'deferred'
      WHEN 'delivered_on_reply' THEN 'delivered_later' WHEN 'dropped' THEN 'failed' ELSE 'sending' END END,'notice'::text
  FROM notifications n WHERE n.shop_id=$1 AND n.consultation_id=$2 AND n.timeline_seq <= $7::bigint
    AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.shop_id=$1 AND o.id=n.order_id AND o.personal_data_purged_at IS NOT NULL)
), positioned AS (
  SELECT e.*,(extract(epoch FROM e.at)*1000000)::bigint AS at_us FROM entries e
)
SELECT p.id,p.at,p.timeline_seq,p.direction,p.author,p.kind,p.body,p.delivery,p.source,p.at_us::text AS cursor_at
FROM positioned p `;
const ENTRIES = {
  forward: `${ENTRY_BASE}WHERE ($3::bigint IS NULL OR (p.at_us,p.timeline_seq)>($3::bigint,$4::bigint)) ORDER BY p.at,p.timeline_seq LIMIT $5`,
  backward: `${ENTRY_BASE}WHERE ($3::bigint IS NULL OR (p.at_us,p.timeline_seq)<($3::bigint,$4::bigint)) ORDER BY p.at DESC,p.timeline_seq DESC LIMIT $5`,
};

export async function listConsultationMessages(r: AccessRequest): Promise<Response> {
  if (r.scope.via.kind !== "owner") throw new ApiError("not_found");
  const expectedShop = r.req.header("X-Expected-Shop-Id");
  if (expectedShop !== undefined && (!isUuid(expectedShop) || expectedShop.toLowerCase() !== r.scope.shopId))
    throw new ApiError("unauthenticated");
  const consultationId = r.pathId("consultationId"),
    filter = input(r.req.query());
  const ownerId = r.scope.via.ownerId,
    now = r.services.now();
  let after: ConsultationCursor | null = null;
  if (filter.token !== null) {
    const fields = r.services.fieldCrypto();
    try {
      after = await openConsultationCursor(fields, r.scope.shopId, consultationId, filter.token, filter.direction);
    } catch (error) {
      if (error instanceof ConsultationCursorError || error instanceof FieldCryptoError)
        throw fieldError("query:cursor", "bad_format");
      throw error;
    }
  }
  return r.read(async (db) => {
    const shop = await db.found<{ time_zone: string }>("SELECT time_zone FROM shops WHERE id=$1 AND owner_id=$2", [
      ownerId,
    ]);
    const consultation = await db.found<{ customer_id: string; status: string; channel_friend: boolean }>(
      "SELECT c.customer_id,c.status,u.channel_friend FROM consultations c JOIN customers u ON u.shop_id=$1 AND u.id=c.customer_id WHERE c.shop_id=$1 AND c.id=$2",
      [consultationId],
    );
    const base = { consultationId, status: consultation.status, customerChannelFriend: consultation.channel_friend };
    if (consultation.status === "deleted")
      return {
        body: {
          ...base,
          items: [],
          nextCursor: null,
          ...(filter.direction === "backward" ? { reloadCursor: null } : {}),
        },
        subjects: [consultation.customer_id],
      };
    // 페이지 중 전달된 안내의 정렬 키가 바뀌지 않도록 첫 가시성과 삽입 상한을 커서에 둔다.
    const snapshot =
      after?.snapshot ??
      (await db.found<{ transaction: string; ceiling: string }>(
        `SELECT txid_current_snapshot()::text AS transaction,
         coalesce(max(timeline_seq),0)::text AS ceiling FROM (
         SELECT m.timeline_seq FROM messages m WHERE m.shop_id=$1 AND m.consultation_id=$2
         UNION ALL SELECT n.timeline_seq FROM notifications n WHERE n.shop_id=$1 AND n.consultation_id=$2) initial_entries`,
        [consultationId],
      ));
    const found = (
      await db.run<Entry>(ENTRIES[filter.direction], [
        consultationId,
        after?.at ?? null,
        after?.sequence ?? null,
        filter.limit + 1,
        snapshot.transaction,
        snapshot.ceiling,
      ])
    ).rows;
    const window = found.slice(0, filter.limit);
    const rows = filter.direction === "backward" ? [...window].reverse() : window,
      tokens = [
        ...new Set(
          rows
            .filter((x) => x.source === "message")
            .flatMap((x) => x.body?.match(maskedValuePlaceholderPattern()) ?? []),
        ),
      ];
    const values = tokens.length
      ? (
          await db.run<StoredMaskedValue & { placeholder: string }>(
            "SELECT placeholder,kind,original_enc,last4 FROM masked_values WHERE shop_id=$1 AND consultation_id=$2 AND placeholder=ANY($3::text[])",
            [consultationId, tokens],
          )
        ).rows
      : [];
    const replacements = new Map<string, string>();
    for (const row of values) {
      const value = await openStoredMaskedValue(row, r.scope.shopId, () => r.services.fieldCrypto());
      replacements.set(
        row.placeholder,
        value.original ??
          (value.kind === "card" && value.last4 !== null
            ? `${row.placeholder} (끝 4자리 ${value.last4})`
            : row.placeholder),
      );
    }
    const messageIds = rows.filter((x) => x.source === "message").map((x) => x.id);
    const photos = messageIds.length
      ? (
          await db.run<{ message_id: string; storage_key: string }>(
            "SELECT p.message_id,p.storage_key FROM reference_photos p JOIN order_drafts d ON d.shop_id=$1 AND d.id=p.draft_id WHERE p.shop_id=$1 AND p.message_id=ANY($2::uuid[]) AND d.consultation_id=$3 ORDER BY p.message_id,p.position,p.id",
            [messageIds, consultationId],
          )
        ).rows
      : [];
    const photoUrls = new Map<string, { url: string }[]>();
    for (const photo of photos) {
      const urls = photoUrls.get(photo.message_id) ?? [];
      if (urls.length < 10)
        urls.push({ url: await r.services.fileUrls().sign(photo.storage_key, new URL(r.req.url).origin, now) });
      photoUrls.set(photo.message_id, urls);
    }
    const items = rows.map((row) => ({
      messageId: row.id,
      at: toShopIso(row.at, shop.time_zone),
      direction: row.direction,
      author: row.author,
      kind: row.kind,
      text: row.source === "message" ? displayText(row.body, replacements) : row.body,
      photos: row.source === "message" ? (photoUrls.get(row.id) ?? []) : [],
      delivery: row.delivery,
    }));
    const last = window.at(-1),
      newest = window[0];
    const reloadCursor =
      filter.direction === "backward"
        ? newest
          ? (filter.token ??
            (await sealConsultationCursor(
              r.services.fieldCrypto(),
              r.scope.shopId,
              consultationId,
              { at: (BigInt(newest.cursor_at) + 1n).toString(), sequence: "1" },
              snapshot,
              "backward",
            )))
          : null
        : undefined;
    return {
      body: {
        ...base,
        items,
        ...(reloadCursor === undefined ? {} : { reloadCursor }),
        nextCursor:
          found.length > filter.limit && last
            ? await sealConsultationCursor(
                r.services.fieldCrypto(),
                r.scope.shopId,
                consultationId,
                { at: last.cursor_at, sequence: last.timeline_seq },
                snapshot,
                filter.direction,
              )
            : null,
      },
      subjects: [consultation.customer_id],
    };
  });
}
