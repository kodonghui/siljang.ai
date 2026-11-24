/** API-043: 사장님에게만 전화·계좌를 복원하고 대화·손님 안내를 같은 페이지로 읽는다. */
import { fromBase64Url, toBase64Url } from "./encoding";
import { openStoredMaskedValue, type StoredMaskedValue } from "./masked-values";
import { ApiError, fieldError } from "./problem";
import type { AccessRequest } from "./routes";
import { toShopIso } from "./time";

const PLACEHOLDER = /\[(?:전화번호|계좌번호|카드번호|긴숫자)[0-9]{1,3}\]/g;
const MAX_I64 = 9223372036854775807n;
interface PageSnapshot {
  at: string;
  ceiling: string;
}
interface PageInput {
  limit: number;
  after: { at: string; sequence: string; snapshot: PageSnapshot } | null;
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
function input(query: Record<string, string>, consultationId: string): PageInput {
  if (query.limit !== undefined && !/^-?[0-9]+$/.test(query.limit)) throw fieldError("query:limit", "bad_format");
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fieldError("query:limit", "out_of_range");
  let after: PageInput["after"] = null;
  if (query.cursor !== undefined) {
    try {
      if (query.cursor.length < 1 || query.cursor.length > 200) throw new Error();
      const raw = fromBase64Url(query.cursor);
      if (raw === null || toBase64Url(raw) !== query.cursor) throw new Error();
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw));
      if (!Array.isArray(value) || value.length !== 6 || value[0] !== 2 || value[1] !== consultationId)
        throw new Error();
      const [, , at, sequence, snapshotAt, ceiling] = value;
      if (
        typeof at !== "string" ||
        typeof sequence !== "string" ||
        typeof snapshotAt !== "string" ||
        typeof ceiling !== "string" ||
        !/^-?[0-9]{1,19}$/.test(at) ||
        !/^-?[0-9]{1,19}$/.test(snapshotAt) ||
        !/^[1-9][0-9]{0,18}$/.test(sequence) ||
        !/^[1-9][0-9]{0,18}$/.test(ceiling)
      )
        throw new Error();
      if (
        BigInt(at) < -MAX_I64 - 1n ||
        BigInt(at) > MAX_I64 ||
        BigInt(snapshotAt) < -MAX_I64 - 1n ||
        BigInt(snapshotAt) > MAX_I64 ||
        BigInt(sequence) > MAX_I64 ||
        BigInt(ceiling) > MAX_I64 ||
        BigInt(sequence) > BigInt(ceiling)
      )
        throw new Error();
      after = { at, sequence, snapshot: { at: snapshotAt, ceiling } };
    } catch {
      throw fieldError("query:cursor", "bad_format");
    }
  }
  return { limit, after };
}
function cursor(consultationId: string, row: Entry, snapshot: PageSnapshot): string {
  return toBase64Url(
    new TextEncoder().encode(
      JSON.stringify([2, consultationId, row.cursor_at, row.timeline_seq, snapshot.at, snapshot.ceiling]),
    ),
  );
}

function displayText(body: string | null, replacements: ReadonlyMap<string, string>): string | null {
  if (body === null) return null;
  const text = body.replace(PLACEHOLDER, (key) => replacements.get(key) ?? key);
  return text.length <= 100000 ? text : Array.from(text).slice(0, 100000).join("");
}
const ENTRIES = `WITH entries AS (
  SELECT m.id,m.created_at AS at,m.timeline_seq,m.direction,m.author,m.kind,m.body_masked AS body,m.delivery,'message'::text AS source
  FROM messages m WHERE m.shop_id=$1 AND m.consultation_id=$2 AND m.timeline_seq <= $7::bigint
  UNION ALL
  SELECT n.id,CASE WHEN (extract(epoch FROM n.sent_at)*1000000)::bigint <= $6::bigint THEN n.sent_at ELSE n.created_at END AS at,n.timeline_seq,'outbound'::text,
    CASE WHEN n.kind='owner_reply' THEN 'owner' ELSE 'notice' END,'text'::text,n.body,
    CASE WHEN (extract(epoch FROM n.sent_at)*1000000)::bigint > $6::bigint AND n.status='delivered_on_reply' THEN 'deferred'
      WHEN (extract(epoch FROM n.sent_at)*1000000)::bigint > $6::bigint AND n.status='sent' THEN 'sending'
      ELSE CASE n.status WHEN 'sent' THEN 'event_api' WHEN 'deferred' THEN 'deferred'
      WHEN 'delivered_on_reply' THEN 'delivered_later' WHEN 'dropped' THEN 'failed' ELSE 'sending' END END,'notice'::text
  FROM notifications n WHERE n.shop_id=$1 AND n.consultation_id=$2 AND n.timeline_seq <= $7::bigint
    AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.shop_id=$1 AND o.id=n.order_id AND o.personal_data_purged_at IS NOT NULL)
), positioned AS (
  SELECT e.*,(extract(epoch FROM e.at)*1000000)::bigint AS at_us FROM entries e
)
SELECT p.id,p.at,p.timeline_seq,p.direction,p.author,p.kind,p.body,p.delivery,p.source,p.at_us::text AS cursor_at
FROM positioned p WHERE ($3::bigint IS NULL OR (p.at_us,p.timeline_seq)>($3::bigint,$4::bigint))
ORDER BY p.at,p.timeline_seq LIMIT $5`;

export async function listConsultationMessages(r: AccessRequest): Promise<Response> {
  if (r.scope.via.kind !== "owner") throw new ApiError("not_found");
  const consultationId = r.pathId("consultationId"),
    filter = input(r.req.query(), consultationId);
  const ownerId = r.scope.via.ownerId,
    now = r.services.now();
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
      return { body: { ...base, items: [], nextCursor: null }, subjects: [consultation.customer_id] };
    // 페이지 중 전달된 안내의 정렬 키가 바뀌지 않도록 첫 시각과 삽입 상한을 커서에 둔다.
    const snapshot =
      filter.after?.snapshot ??
      (await db.found<PageSnapshot>(
        `SELECT (extract(epoch FROM transaction_timestamp())*1000000)::bigint::text AS at,
         coalesce(max(timeline_seq),0)::text AS ceiling FROM (
         SELECT m.timeline_seq FROM messages m WHERE m.shop_id=$1 AND m.consultation_id=$2
         UNION ALL SELECT n.timeline_seq FROM notifications n WHERE n.shop_id=$1 AND n.consultation_id=$2) initial_entries`,
        [consultationId],
      ));
    const found = (
      await db.run<Entry>(ENTRIES, [
        consultationId,
        filter.after?.at ?? null,
        filter.after?.sequence ?? null,
        filter.limit + 1,
        snapshot.at,
        snapshot.ceiling,
      ])
    ).rows;
    const rows = found.slice(0, filter.limit),
      tokens = [
        ...new Set(rows.filter((x) => x.source === "message").flatMap((x) => x.body?.match(PLACEHOLDER) ?? [])),
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
    const last = rows.at(-1);
    return {
      body: {
        ...base,
        items,
        nextCursor: found.length > filter.limit && last ? cursor(consultationId, last, snapshot) : null,
      },
      subjects: [consultation.customer_id],
    };
  });
}
