/**
 * 운영 기록 쓰기(05 TBL-051 ops_events). TASK-018.
 * 내용 없이 종류·건수와 종류별 숫자만 남긴다(손님 글·개인정보·시크릿 없음, 04 G6). 가게와 무관하면 shopId는 null.
 */
import type { Queryable } from "./db";

/** ops_events.kind의 CHECK 목록(05 schema.sql)과 같음. test/ops-events.test.ts가 데이터베이스의 CHECK와 견준다. */
export const OPS_EVENT_KINDS = [
  "purge_run",
  "order_request_dropped_full",
  "ai_failure_burst",
  "message_rate_limited",
  "channel_already_linked",
  "privacy_transfer_missing",
] as const;

export type OpsEventKind = (typeof OPS_EVENT_KINDS)[number];

export interface OpsEvent {
  readonly kind: OpsEventKind;
  readonly shopId?: string | null;
  /** 건수(0 이상 정수). 기본 1. */
  readonly count?: number;
  /** 종류별 숫자(이름은 소문자·숫자·_, 값은 유한한 숫자). 글은 받지 않는다. */
  readonly detail?: Readonly<Record<string, number>>;
  /** 남긴 시각. 없으면 데이터베이스의 지금. 서버 안의 일(TASK-023)은 그 실행의 기준 시각을 넘긴다. */
  readonly at?: Date;
}

const DETAIL_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/** 운영 기록 한 행을 넣고 ID를 돌려준다. 규칙에 맞지 않는 값은 TypeError(코드의 잘못, 값은 메시지에 싣지 않음). */
export async function recordOpsEvent(q: Queryable, event: OpsEvent): Promise<string> {
  if (!(OPS_EVENT_KINDS as readonly string[]).includes(event.kind)) throw new TypeError("unknown ops event kind");
  const count = event.count ?? 1;
  if (!Number.isInteger(count) || count < 0 || count > 2_147_483_647) throw new TypeError("count must be an integer");
  let detail: string | null = null;
  if (event.detail !== undefined) {
    const entries = Object.entries(event.detail);
    if (entries.length > 50) throw new TypeError("too many detail entries");
    for (const [name, value] of entries) {
      if (!DETAIL_NAME.test(name) || typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("detail must map short names to numbers");
      }
    }
    detail = JSON.stringify(Object.fromEntries(entries));
  }
  if (event.at !== undefined && Number.isNaN(event.at.getTime())) throw new TypeError("at must be a valid date");
  const r = await q.query<{ id: string }>(
    "INSERT INTO ops_events (shop_id, kind, count, detail, created_at) VALUES ($1, $2, $3, $4::jsonb, coalesce($5::timestamptz, now())) RETURNING id",
    [event.shopId ?? null, event.kind, count, detail, event.at ?? null],
  );
  const row = r.rows[0];
  if (row === undefined) throw new Error("ops event was not inserted");
  return row.id;
}
