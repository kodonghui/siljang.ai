/**
 * 같은 일은 한 번만(05 A33, 04 G2, REQ-132·154). TASK-023.
 *
 * - 자동으로 하는 일이 남기는 행(결제 안내·환불·가예약·할 일·사장님 알림·손님 안내·장부 쓰기)은 05 A33 표의 형식으로
 *   키를 짓고, 가게마다 그 키로 한 번만 남는다(데이터베이스의 `(shop_id, 키)` UNIQUE). 이 모듈은 키를 짓는 함수
 *   (eventKeys)와 키로 한 번만 넣는 도구(insertOnce)를 둔다. 키 형식은 test/event-keys.test.ts가 05 README의 A33 표와
 *   견준다.
 * - 대상 ID는 그 행의 uuid를 소문자 36자로, 종류·사유는 그 테이블의 영문 값으로 넣는다(05 A33).
 * - insertOnce는 `INSERT … ON CONFLICT (shop_id, 키) DO NOTHING RETURNING id`를 보내고, 넣지 못했으면(같은 키가 이미 있음)
 *   다음 문장으로 그 행의 ID를 찾아 돌려준다(G2: 같은 키가 다시 오면 처음 결과). 한 문장 안의 하위 질의는 다른 트랜잭션이
 *   막 넣은 행을 보지 못하므로 두 문장으로 나눈다. 뒤따르는 일(알림 넣기 따위)은 created일 때만 한다.
 * - 가게 범위 연결(ShopDb)로만 쓴다. 다른 가게의 같은 키는 다른 이벤트다(가게마다 한 번).
 */
import { isUuid, type ShopDb } from "./shop-scope";

/** 05 A33의 키를 가진 테이블과 그 키 열. */
export const EVENT_KEY_TABLES = {
  payment_requests: { column: "event_key", prefix: "pay" },
  refunds: { column: "event_key", prefix: "refund" },
  slot_holds: { column: "hold_key", prefix: "hold" },
  owner_tasks: { column: "event_key", prefix: "task" },
  owner_alerts: { column: "event_key", prefix: "alert" },
  notifications: { column: "event_key", prefix: "notice" },
  ledger_writes: { column: "event_key", prefix: "ledger" },
} as const;

export type EventKeyTable = keyof typeof EVENT_KEY_TABLES;

/** 넣지 못했을 때 같은 키의 행을 찾는 SQL(테이블마다 글로 적어 정적 검사가 가게 조건을 본다). */
const EXISTING: { readonly [T in EventKeyTable]: string } = {
  payment_requests: "SELECT t.id FROM payment_requests t WHERE t.shop_id = $1 AND t.event_key = $2",
  refunds: "SELECT t.id FROM refunds t WHERE t.shop_id = $1 AND t.event_key = $2",
  slot_holds: "SELECT t.id FROM slot_holds t WHERE t.shop_id = $1 AND t.hold_key = $2",
  owner_tasks: "SELECT t.id FROM owner_tasks t WHERE t.shop_id = $1 AND t.event_key = $2",
  owner_alerts: "SELECT t.id FROM owner_alerts t WHERE t.shop_id = $1 AND t.event_key = $2",
  notifications: "SELECT t.id FROM notifications t WHERE t.shop_id = $1 AND t.event_key = $2",
  ledger_writes: "SELECT t.id FROM ledger_writes t WHERE t.shop_id = $1 AND t.event_key = $2",
};

/** 시험이 테이블마다 찾는 SQL을 데이터베이스에 보내 보려고 내보낸다. */
export const EXISTING_KEY_SQL = EXISTING;

/** 05 payment_requests.kind */
export const PAYMENT_KINDS = ["first", "reissue", "difference"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/** 05 refunds.cause. 뒤 둘(취소 뒤 들어온 입금·더 들어온 금액)은 키 끝에 셈한 들어온 금액이 붙는다. */
export const REFUND_CAUSES = [
  "customer_cancel",
  "shop_cancel",
  "change_reduced",
  "compensation",
  "paid_after_cancel",
  "over_received",
] as const;
export type RefundCause = (typeof REFUND_CAUSES)[number];
const ARRIVAL_CAUSES: readonly RefundCause[] = ["paid_after_cancel", "over_received"];

/** 05 ledger_writes.event_kind에서 재제작(remake)을 뺀 것. 재제작은 ledgerRemake로 짓는다. */
export const LEDGER_EVENT_KINDS = [
  "confirmed",
  "changed",
  "cancelled",
  "refund",
  "handed_over",
  "no_pickup",
  "refund_sent",
  "payment_voided",
] as const;
export type LedgerEventKind = (typeof LEDGER_EVENT_KINDS)[number];

/** 재제작 주문의 일(05 A33의 ledger 행, SPEC-064). */
export const REMAKE_LEDGER_EVENTS = ["created", "changed", "handed_over", "no_pickup", "cancelled"] as const;
export type RemakeLedgerEvent = (typeof REMAKE_LEDGER_EVENTS)[number];

const WORD = /^[a-z][a-z0-9_]{0,39}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 키의 대상 ID: uuid를 소문자 36자로. 틀리면 TypeError(코드의 잘못, 값은 메시지에 싣지 않음). */
function target(id: string): string {
  if (!isUuid(id)) throw new TypeError("event key target must be a uuid");
  return id.toLowerCase();
}

function word(value: string, what: string): string {
  if (!WORD.test(value)) throw new TypeError(`event key ${what} must be a lower-case word`);
  return value;
}

function oneOf<T extends string>(value: T, allowed: readonly T[], what: string): T {
  if (!allowed.includes(value)) throw new TypeError(`unknown event key ${what}`);
  return value;
}

function amount(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("event key amount must be a whole number of won");
  return String(value);
}

function shopDate(value: string): string {
  const m = DATE.exec(value);
  const d = m === null ? null : new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (m === null || d === null || d.toISOString().slice(0, 10) !== value) {
    throw new TypeError("event key date must be YYYY-MM-DD");
  }
  return value;
}

/** 05 A33 표의 키 짓기. 형식은 test/event-keys.test.ts가 05 README의 표와 견준다. */
export const eventKeys = {
  /** `pay:{대상 ID}:{결제 종류}`. 대상: 첫 결제는 주문, 다시 낸 결제는 기한이 지난 결제 안내, 차액 결제는 변경 요청. */
  pay(targetId: string, kind: PaymentKind): string {
    return `pay:${target(targetId)}:${oneOf(kind, PAYMENT_KINDS, "payment kind")}`;
  },
  /**
   * `refund:{대상 ID}:{사유}`. 취소 뒤 들어온 입금·더 들어온 금액은 `refund:{결제 안내 ID}:{사유}:{셈한 들어온 금액}`이라
   * 그 둘만 countedArrivedAmount(원)를 받는다.
   */
  refund(targetId: string, cause: RefundCause, countedArrivedAmount?: number): string {
    const c = oneOf(cause, REFUND_CAUSES, "refund cause");
    const arrival = ARRIVAL_CAUSES.includes(c);
    if (arrival !== (countedArrivedAmount !== undefined)) {
      throw new TypeError("only arrival refunds carry the counted arrived amount");
    }
    const base = `refund:${target(targetId)}:${c}`;
    return countedArrivedAmount === undefined ? base : `${base}:${amount(countedArrivedAmount)}`;
  },
  /** `hold:{주문 ID}:{결제 안내 ID}`, 날짜 변경은 `hold:{주문 ID}:{변경 요청 ID}`. */
  hold(orderId: string, paymentRequestOrChangeRequestId: string): string {
    return `hold:${target(orderId)}:${target(paymentRequestOrChangeRequestId)}`;
  },
  /** 재제작의 가예약 `hold:{주문 ID}:remake`. */
  holdRemake(orderId: string): string {
    return `hold:${target(orderId)}:remake`;
  },
  /** `task:{만든 이벤트}:{대상 ID}`, 같은 결제 안내에 다시 남긴 '들어옴'의 환불 정할 일은 뒤에 `:{들어온 금액 합}`. */
  task(event: string, targetId: string, arrivedSum?: number): string {
    const base = `task:${word(event, "event")}:${target(targetId)}`;
    return arrivedSum === undefined ? base : `${base}:${amount(arrivedSum)}`;
  },
  /** `alert:{알린 일}:{할 일 ID나 대상 ID}`, 하루 한 번까지인 다시 알림은 뒤에 `:{가게 날짜}`(가게 시간대의 YYYY-MM-DD). */
  alert(what: string, taskOrTargetId: string, shopLocalDate?: string): string {
    const base = `alert:${word(what, "alert")}:${target(taskOrTargetId)}`;
    return shopLocalDate === undefined ? base : `${base}:${shopDate(shopLocalDate)}`;
  },
  /** `notice:{대상 ID}:{안내 종류}`. 안내 종류는 notifications.kind. */
  notice(targetId: string, kind: string): string {
    return `notice:${target(targetId)}:${word(kind, "notice kind")}`;
  },
  /** `ledger:{대상 ID}:{이벤트 종류}`. 대상은 그 쓰기를 만든 일의 기록(05 A33). */
  ledger(targetId: string, kind: LedgerEventKind): string {
    return `ledger:${target(targetId)}:${oneOf(kind, LEDGER_EVENT_KINDS, "ledger event")}`;
  },
  /** 재제작 `ledger:{대상 ID}:remake:{재제작 주문의 일}`. 대상은 재제작 주문(그 변경은 변경 요청). */
  ledgerRemake(targetId: string, what: RemakeLedgerEvent): string {
    return `ledger:${target(targetId)}:remake:${oneOf(what, REMAKE_LEDGER_EVENTS, "remake event")}`;
  },
} as const;

/** 키로 한 번만 넣은 결과. created가 false면 같은 키의 행이 이미 있었고 id는 그 행이다(처음 결과, G2). */
export interface Once {
  readonly id: string;
  readonly created: boolean;
}

const INSERT_SHAPE =
  /^\s*INSERT INTO ([a-z_]+) \(shop_id, ([a-z_]+),[^;]*\)\s+VALUES \(\$1, \$2,[^;]*\)\s+ON CONFLICT \(shop_id, ([a-z_]+)\) DO NOTHING RETURNING id\s*$/;

/**
 * 키로 한 번만 넣는다. sql은 `INSERT INTO <table> (shop_id, <키 열>, …) VALUES ($1, $2, …) ON CONFLICT (shop_id, <키 열>)
 * DO NOTHING RETURNING id` 꼴이고 params의 첫 값이 키다($1은 ShopDb가 채우는 가게 ID). 꼴이 다르거나 키가 그 테이블의
 * 형식이 아니면 보내지 않고 TypeError(코드의 잘못). 다른 UNIQUE(환불의 대상마다 하나 따위)에 걸리면 데이터베이스 오류가
 * 그대로 나간다(같은 이벤트가 아니라 막아야 할 둘째 행).
 */
export async function insertOnce(
  db: ShopDb,
  table: EventKeyTable,
  sql: string,
  params: readonly [string, ...unknown[]],
): Promise<Once> {
  const spec = EVENT_KEY_TABLES[table];
  const m = INSERT_SHAPE.exec(sql);
  if (m === null || m[1] !== table || m[2] !== spec.column || m[3] !== spec.column) {
    throw new TypeError("insertOnce needs INSERT … (shop_id, <key>, …) VALUES ($1, $2, …) ON CONFLICT … DO NOTHING");
  }
  const key = params[0];
  if (typeof key !== "string" || !key.startsWith(`${spec.prefix}:`) || key.length > 300) {
    throw new TypeError(`event key for ${table} must start with ${spec.prefix}:`);
  }
  const inserted = await db.run<{ id: string }>(sql, params);
  const row = inserted.rows[0];
  if (row !== undefined) return { id: row.id, created: true };
  const existing = await db.run<{ id: string }>(EXISTING[table], [key]);
  const found = existing.rows[0];
  // ON CONFLICT DO NOTHING이 넣지 않았는데 같은 키가 없으면, 그 사이 다른 트랜잭션이 넣은 행이 되돌려짐(드묾).
  if (found === undefined) throw new EventKeyRaceError("the conflicting row is gone; retry the transaction");
  return { id: found.id, created: false };
}

/** 같은 키의 행이 있다가 없어짐(다른 트랜잭션이 되돌림). 이 트랜잭션을 처음부터 다시 하면 된다. */
export class EventKeyRaceError extends Error {
  override readonly name = "EventKeyRaceError";
}
