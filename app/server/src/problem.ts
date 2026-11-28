/**
 * 오류 응답(06 계약의 Problem: RFC 9457에 code·traceId를 더함, application/problem+json). TASK-018.
 * - 오류 코드 38개(ERRORS)와 필드 오류 사유 24개(FIELD_REASONS)는 api/openapi.yaml의
 *   components.x-corthex.errors·fieldErrors를 옮긴 것이다. test/contract.test.ts가 계약과 같은지
 *   (빠짐·더함 없이 코드·상태·말이 같은지) 보고, 코드마다 응답 본문을 계약의 Problem 스키마로 검사한다.
 * - 업무 코드는 ApiError를 던지고, app.ts의 onError가 이 모듈로 응답을 만든다.
 * - 응답에는 넣은 값·내부 오류 내용·시크릿·다른 가게의 존재를 싣지 않는다(04 G6). detail은 코드에 적은 고정 문장만 쓴다.
 */

/** components.x-corthex.errors의 status와 message(06 README 6절)를 그대로 옮김. */
export const ERRORS = {
  validation_failed: { status: 422, title: "입력한 내용을 확인해 주세요" },
  idempotency_key_reused: { status: 422, title: "다시 시도해 주세요" },
  consent_required: { status: 422, title: "개인정보 처리 위탁 조건에 동의해야 가게를 등록할 수 있어요" },
  google_authorization_failed: { status: 422, title: "구글 연결을 다시 해 주세요" },
  sheet_not_accessible: {
    status: 422,
    title: "그 시트를 열 수 없어요. 주소와 탭을 확인하고 구글 연결을 다시 해 주세요",
  },
  unauthenticated: { status: 401, title: "다시 로그인해 주세요" },
  kakao_login_failed: { status: 401, title: "카카오 로그인을 다시 해 주세요" },
  operator_login_failed: { status: 401, title: "로그인 정보가 맞지 않아요" },
  skill_key_invalid: { status: 401, title: "(손님에게 보이지 않음)" },
  not_found: { status: 404, title: "찾을 수 없어요" },
  shop_not_registered: { status: 404, title: "가게를 먼저 등록해 주세요" },
  not_set: { status: 404, title: "아직 정하지 않았어요" },
  method_not_allowed: { status: 405, title: "지원하지 않는 요청이에요" },
  version_conflict: { status: 409, title: "그 사이 바뀌었어요. 지금 상태를 확인해 주세요" },
  invalid_state: { status: 409, title: "지금 상태에서는 할 수 없어요" },
  already_decided: { status: 409, title: "이미 처리됐어요" },
  order_cancelled: { status: 409, title: "그 사이 주문이 취소됐어요" },
  confirmation_required: { status: 409, title: "저장하기 전에 확인해 주세요" },
  already_registered: { status: 409, title: "이미 등록한 가게가 있어요" },
  channel_setup_incomplete: { status: 409, title: "버튼 블록 ID 5개를 모두 넣어 주세요" },
  channel_linked_elsewhere: { status: 409, title: "이미 다른 가게에 연결된 채널이에요" },
  slot_released: { status: 409, title: "자리가 풀린 주문이에요. 먼저 '결제 기한 연장'으로 자리를 다시 잡아 주세요" },
  undo_window_passed: { status: 409, title: "5분이 지나 되돌릴 수 없어요" },
  photo_consent_missing: { status: 409, title: "손님이 게시에 동의한 사진만 올릴 수 있어요" },
  payment_account_missing: {
    status: 409,
    title: "결제 계좌 등록을 기다리고 있어요. 사장님이 계좌를 등록하면 확인할 수 있어요",
  },
  holder_not_verified: {
    status: 409,
    title: "확인된 예금주와 다른 계좌로는 바꿀 수 없어요. 우리 서비스 채널로 문의해 주세요",
  },
  identity_change_pending: { status: 409, title: "확인을 기다리는 변경 요청이 있어요" },
  original_not_kept: { status: 409, title: "원래 값을 두지 않아요" },
  original_erased: { status: 409, title: "지워진 값이에요" },
  request_in_progress: { status: 409, title: "처리하고 있어요. 잠시 뒤 다시 확인해 주세요" },
  file_too_large: { status: 413, title: "사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요" },
  rate_limited: { status: 429, title: "잠시 뒤 다시 시도해 주세요" },
  too_many_attempts: { status: 429, title: "잠시 뒤 다시 로그인해 주세요" },
  internal: { status: 500, title: "문제가 생겼어요. 다시 시도해 주세요" },
  kakao_unavailable: { status: 503, title: "카카오에 연결하지 못했어요. 잠시 뒤 다시 해 주세요" },
  google_unavailable: { status: 503, title: "현재 연결 상태를 확인하고 구글 권한부터 다시 연결해 주세요" },
  storage_unavailable: { status: 503, title: "사진을 저장하지 못했어요. 다시 올려 주세요" },
  auth_unavailable: { status: 503, title: "로그인 서비스에 연결하지 못했어요. 잠시 뒤 다시 해 주세요" },
} as const satisfies Record<string, { readonly status: number; readonly title: string }>;

export type ErrorCode = keyof typeof ERRORS;

export const ERROR_CODES = Object.keys(ERRORS) as ErrorCode[];

/** components.x-corthex.fieldErrors의 사유 코드(FieldError.code). */
export const FIELD_REASONS = [
  "required",
  "too_short",
  "too_long",
  "bad_format",
  "not_allowed",
  "out_of_range",
  "too_many",
  "duplicate",
  "checksum_failed",
  "upload_not_found",
  "upload_wrong_purpose",
  "reference_not_found",
  "conflict",
  "overlaps",
  "gap",
  "exceeds_received",
  "below_calculated",
  "below_quote_min",
  "exceeds_card_limit",
  "in_past",
  "outside_window",
  "not_after_start",
  "unknown_field",
  "bad_json",
] as const;

export type FieldReason = (typeof FIELD_REASONS)[number];

/** ConfirmationNeeded.kind(components.x-corthex.confirmations). */
export const CONFIRMATION_KINDS = [
  "lowered_refund",
  "closed_day_with_orders",
  "capacity_below_held",
  "overbooking",
  "not_pickup_day",
  "closed_day",
  "past_cutoff",
  "holder_mismatch",
  "no_compensation_standard",
] as const;

export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];

/** 필드 오류 하나. 넣은 값은 싣지 않는다(06 FieldError). */
export interface FieldError {
  /** JSON Pointer(/a/b), header:이름·query:이름·path:이름, file, 또는 본문 전체 / */
  readonly field: string;
  readonly code: FieldReason;
}

export interface ConfirmationNeeded {
  readonly kind: ConfirmationKind;
  readonly count?: number;
  readonly day?: string;
}

/** 코드에 따라 붙는 것. 어느 코드에 무엇이 꼭 있어야 하는지는 checkExtras가 본다. */
export interface ProblemExtras {
  /** 이번 일의 설명. 코드에 적은 고정 문장만(넣은 값·내부 내용·시크릿 없음, G6). */
  readonly detail?: string;
  /** validation_failed에만, 꼭 있음. */
  readonly errors?: readonly FieldError[];
  /** confirmation_required에만, 꼭 있음. */
  readonly confirm?: readonly ConfirmationNeeded[];
  /** 영업 캘린더 저장 전에 확인할 자기 가게의 주문(REQ-261). */
  readonly conflicts?: readonly CalendarConflict[];
  /** 429(rate_limited·too_many_attempts)에만, 꼭 있음. Retry-After 헤더와 같은 값. */
  readonly retryAfterSeconds?: number;
  /** method_not_allowed에만, 꼭 있음. Allow 헤더. */
  readonly allow?: readonly string[];
}

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ErrorCode;
  readonly traceId: string;
  readonly instance?: string;
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
  readonly confirm?: readonly ConfirmationNeeded[];
  readonly conflicts?: readonly CalendarConflict[];
  readonly retryAfterSeconds?: number;
}

export interface CalendarConflict {
  readonly day: string;
  readonly capacity: number;
  readonly held: number;
  readonly orders: readonly {
    readonly orderId: string;
    readonly orderNo: string;
    readonly status: string;
    readonly pickupAt: string;
  }[];
}

/**
 * 업무 코드가 계약의 오류를 낼 때 던진다. message에는 코드만 싣는다(넣은 값·내부 내용 없음, G6).
 * onError가 Problem 응답으로 바꾼다. 붙는 것이 계약에 맞지 않으면 응답을 만들 때 ProblemShapeError(500)가 된다.
 */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly code: ErrorCode;
  readonly extras: ProblemExtras;

  constructor(code: ErrorCode, extras: ProblemExtras = {}) {
    super(code);
    this.code = code;
    this.extras = extras;
  }
}

/** 오류 응답을 계약에 맞지 않게 만들려 함(코드의 잘못). 응답은 internal(500)이 된다. */
export class ProblemShapeError extends Error {
  override readonly name = "ProblemShapeError";
}

/** 필드 오류 하나로 된 validation_failed. */
export function fieldError(field: string, code: FieldReason): ApiError {
  return new ApiError("validation_failed", { errors: [{ field, code }] });
}

const FIELD_PATTERN = /^((\/[A-Za-z0-9_]+)+|(header|query|path):[A-Za-z0-9_-]+|file|\/)$/;
const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function isInt(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** 코드마다 붙어야 하는 것과 붙으면 안 되는 것(06 Problem의 errors·confirm·retryAfterSeconds·Allow). 메시지에는 코드와 이름만. */
function checkExtras(code: ErrorCode, extras: ProblemExtras): void {
  const status = ERRORS[code].status;
  const fail = (what: string) => {
    throw new ProblemShapeError(`${code}: ${what}`);
  };
  if (extras.detail !== undefined && (extras.detail.length < 1 || extras.detail.length > 1000)) {
    fail("detail length");
  }
  if ((code === "validation_failed") !== (extras.errors !== undefined))
    fail("errors only and always with validation_failed");
  if (extras.errors !== undefined) {
    if (extras.errors.length < 1 || extras.errors.length > 50) fail("errors count");
    for (const e of extras.errors) {
      if (!FIELD_PATTERN.test(e.field) || e.field.length > 200) fail("errors field");
      if (!(FIELD_REASONS as readonly string[]).includes(e.code)) fail("errors code");
    }
  }
  if ((code === "confirmation_required") !== (extras.confirm !== undefined)) {
    fail("confirm only and always with confirmation_required");
  }
  if (extras.confirm !== undefined) {
    if (extras.confirm.length < 1 || extras.confirm.length > 10) fail("confirm count");
    for (const c of extras.confirm) {
      if (!(CONFIRMATION_KINDS as readonly string[]).includes(c.kind)) fail("confirm kind");
      if (c.count !== undefined && !isInt(c.count, 0, 10000)) fail("confirm count value");
      if (c.day !== undefined && !DAY_PATTERN.test(c.day)) fail("confirm day");
    }
  }
  if (extras.conflicts !== undefined) {
    if (code !== "confirmation_required" || extras.conflicts.length < 1 || extras.conflicts.length > 400)
      fail("conflicts count/code");
    for (const item of extras.conflicts) {
      if (!DAY_PATTERN.test(item.day) || !isInt(item.capacity, 0, 100) || !isInt(item.held, 0, 10000))
        fail("conflicts day/count");
      if (item.orders.length < 1 || item.orders.length > 100) fail("conflicts orders count");
      for (const order of item.orders)
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order.orderId) ||
          !/^[0-9A-Z]{6,8}$/.test(order.orderNo) ||
          ![
            "requested",
            "awaiting_payment",
            "payment_overdue",
            "confirmed",
            "received",
            "no_pickup",
            "rejected",
            "cancelled",
          ].includes(order.status) ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(order.pickupAt) ||
          !Number.isFinite(Date.parse(order.pickupAt))
        )
          fail("conflicts order");
    }
  }
  if ((status === 429) !== (extras.retryAfterSeconds !== undefined)) fail("retryAfterSeconds only and always with 429");
  if (extras.retryAfterSeconds !== undefined && !isInt(extras.retryAfterSeconds, 1, 3600))
    fail("retryAfterSeconds range");
  if ((code === "method_not_allowed") !== (extras.allow !== undefined)) fail("allow only and always with 405");
  if (extras.allow !== undefined && (extras.allow.length < 1 || extras.allow.some((m) => !METHODS.has(m)))) {
    fail("allow methods");
  }
}

export function problemBody(code: ErrorCode, traceId: string, instance?: string, extras: ProblemExtras = {}): Problem {
  checkExtras(code, extras);
  const { status, title } = ERRORS[code];
  return {
    type: `/problems/${code}`,
    title,
    status,
    code,
    traceId,
    ...(instance !== undefined && instance.length > 0 ? { instance: instance.slice(0, 2048) } : {}),
    ...(extras.detail !== undefined ? { detail: extras.detail } : {}),
    ...(extras.errors !== undefined ? { errors: extras.errors.map((e) => ({ field: e.field, code: e.code })) } : {}),
    ...(extras.confirm !== undefined
      ? {
          confirm: extras.confirm.map((c) => ({
            kind: c.kind,
            ...(c.count !== undefined ? { count: c.count } : {}),
            ...(c.day !== undefined ? { day: c.day } : {}),
          })),
        }
      : {}),
    ...(extras.retryAfterSeconds !== undefined ? { retryAfterSeconds: extras.retryAfterSeconds } : {}),
    ...(extras.conflicts !== undefined
      ? {
          conflicts: extras.conflicts.map((item) => ({
            day: item.day,
            capacity: item.capacity,
            held: item.held,
            orders: item.orders.map((order) => ({
              orderId: order.orderId,
              orderNo: order.orderNo,
              status: order.status,
              pickupAt: order.pickupAt,
            })),
          })),
        }
      : {}),
  };
}

export function problemResponse(
  code: ErrorCode,
  traceId: string,
  instance?: string,
  extras: ProblemExtras = {},
  headers: Readonly<Record<string, string>> = {},
): Response {
  const body = problemBody(code, traceId, instance, extras);
  const h = new Headers({ "content-type": "application/problem+json", "cache-control": "no-store", ...headers });
  if (extras.retryAfterSeconds !== undefined) h.set("retry-after", String(extras.retryAfterSeconds));
  if (extras.allow !== undefined) h.set("allow", extras.allow.join(", "));
  return new Response(JSON.stringify(body), { status: body.status, headers: h });
}
