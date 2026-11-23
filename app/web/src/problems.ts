import { type CalendarConflict, parseCalendarConflicts } from "./calendar-conflicts";
// 06 계약(api/openapi.yaml)의 오류 꼴과 04 G7의 결과를 화면이 한 곳에서 읽는 표.
// - 오류 코드 38개(components.x-corthex.errors): 상태 코드·화면에 보이는 말(06)·G7 결과·08 화면 상태·다시 보내는 법.
// - 필드 오류 사유 24개(components.x-corthex.fieldErrors): 필드 옆에 보이는 한국어 글(화면이 더 맞는 글을 주면 그것).
// - 확인할 것 9개(components.x-corthex.confirmations): 확인 창의 글(06 6절 = 08 README 5절).
// 손으로 적었고, problems.test.ts가 06(코드·상태·말)과 08 화면 정의(화면 상태)와 견준다. 06에 코드가 늘면 시험이 실패한다.

/**
 * 화면이 오류 응답을 어떻게 알릴지(04 G7). 앞의 여섯과 성공(2xx)이 G7의 일곱이고,
 * 뒤의 여섯은 G7 밖에서 06의 '화면이 할 일'과 08 W2에서 온다.
 */
export type Outcome =
  | "field" // 필드 오류(필드마다 이유, 넣은 값은 그대로)
  | "already_done" // 이미 처리됨(먼저 남은 결정을 다시 읽어 보임)
  | "changed" // 이미 바뀜(지금 상태를 다시 읽어 보임)
  | "not_allowed" // 그 상태에서는 할 수 없음
  | "not_found" // 찾을 수 없음(목록으로 돌아가는 길)
  | "server" // 서버 실패(다시 시도와 추적 ID)
  | "login" // 로그인·연결을 다시 함
  | "no_shop" // 가게 등록으로 보냄
  | "empty" // 아직 정하지 않음(빈 입력 화면)
  | "confirm" // 확인 창을 보이고 확인 값을 담아 새 요청 키로 다시 보냄
  | "in_progress" // 첫 요청을 처리하는 중(1초 뒤 같은 요청 키로 다시 보냄)
  | "wait"; // 요청 빈도 한도(Retry-After 초 동안 막힘)

/** 08 README 4절의 화면 상태 가운데 오류 응답이 오는 것(응답→상태 기본값과 W2). */
export type ScreenState = "error" | "permission" | "empty" | "stale" | "confirm" | "submitting" | "rate-limited";

/** 다시 보내는 법(04 G2, 06 DEC-04). same: 같은 요청 키로 같은 본문, new: 새 요청 키로 같은 본문, none: 다시 보내지 않음. */
export type Retry = "same" | "new" | "none";

interface CodeInfo {
  readonly status: number;
  readonly outcome: Outcome;
  readonly state: ScreenState;
  readonly retry: Retry;
  readonly message: string;
  /** false면 사장님·운영자 화면에 오지 않는 코드(카카오 스킬 전용). 화면에서는 일반 서버 실패로 봄 */
  readonly screens?: false;
}

export const ERROR_CODES = {
  validation_failed: {
    status: 422,
    outcome: "field",
    state: "error",
    retry: "none",
    message: "입력한 내용을 확인해 주세요",
  },
  idempotency_key_reused: {
    status: 422,
    outcome: "server",
    state: "error",
    retry: "new",
    message: "다시 시도해 주세요",
  },
  consent_required: {
    status: 422,
    outcome: "field",
    state: "error",
    retry: "none",
    message: "개인정보 처리 위탁 조건에 동의해야 가게를 등록할 수 있어요",
  },
  google_authorization_failed: {
    status: 422,
    outcome: "login",
    state: "error",
    retry: "none",
    message: "구글 연결을 다시 해 주세요",
  },
  sheet_not_accessible: {
    status: 422,
    outcome: "field",
    state: "error",
    retry: "none",
    message: "그 시트를 열 수 없어요. 주소와 탭 이름을 확인해 주세요",
  },
  unauthenticated: {
    status: 401,
    outcome: "login",
    state: "permission",
    retry: "none",
    message: "다시 로그인해 주세요",
  },
  kakao_login_failed: {
    status: 401,
    outcome: "login",
    state: "error",
    retry: "none",
    message: "카카오 로그인을 다시 해 주세요",
  },
  operator_login_failed: {
    status: 401,
    outcome: "login",
    state: "error",
    retry: "none",
    message: "로그인 정보가 맞지 않아요",
  },
  skill_key_invalid: {
    status: 401,
    outcome: "server",
    state: "error",
    retry: "none",
    message: "(손님에게 보이지 않음)",
    screens: false,
  },
  not_found: { status: 404, outcome: "not_found", state: "error", retry: "none", message: "찾을 수 없어요" },
  shop_not_registered: {
    status: 404,
    outcome: "no_shop",
    state: "permission",
    retry: "none",
    message: "가게를 먼저 등록해 주세요",
  },
  not_set: { status: 404, outcome: "empty", state: "empty", retry: "none", message: "아직 정하지 않았어요" },
  method_not_allowed: {
    status: 405,
    outcome: "server",
    state: "error",
    retry: "none",
    message: "지원하지 않는 요청이에요",
  },
  version_conflict: {
    status: 409,
    outcome: "changed",
    state: "stale",
    retry: "none",
    message: "그 사이 바뀌었어요. 지금 상태를 확인해 주세요",
  },
  invalid_state: {
    status: 409,
    outcome: "not_allowed",
    state: "stale",
    retry: "none",
    message: "지금 상태에서는 할 수 없어요",
  },
  already_decided: { status: 409, outcome: "already_done", state: "stale", retry: "none", message: "이미 처리됐어요" },
  order_cancelled: {
    status: 409,
    outcome: "changed",
    state: "stale",
    retry: "none",
    message: "그 사이 주문이 취소됐어요",
  },
  confirmation_required: {
    status: 409,
    outcome: "confirm",
    state: "confirm",
    retry: "new",
    message: "저장하기 전에 확인해 주세요",
  },
  already_registered: {
    status: 409,
    outcome: "already_done",
    state: "stale",
    retry: "none",
    message: "이미 등록한 가게가 있어요",
  },
  channel_setup_incomplete: {
    status: 409,
    outcome: "not_allowed",
    state: "error",
    retry: "none",
    message: "버튼 블록 ID 5개를 모두 넣어 주세요",
  },
  channel_linked_elsewhere: {
    status: 409,
    outcome: "not_allowed",
    state: "error",
    retry: "none",
    message: "이미 다른 가게에 연결된 채널이에요",
  },
  slot_released: {
    status: 409,
    outcome: "not_allowed",
    state: "stale",
    retry: "none",
    message: "자리가 풀린 주문이에요. 먼저 '결제 기한 연장'으로 자리를 다시 잡아 주세요",
  },
  undo_window_passed: {
    status: 409,
    outcome: "not_allowed",
    state: "stale",
    retry: "none",
    message: "5분이 지나 되돌릴 수 없어요",
  },
  photo_consent_missing: {
    status: 409,
    outcome: "not_allowed",
    state: "stale",
    retry: "none",
    message: "손님이 게시에 동의한 사진만 올릴 수 있어요",
  },
  payment_account_missing: {
    status: 409,
    outcome: "not_allowed",
    state: "empty",
    retry: "none",
    message: "결제 계좌 등록을 기다리고 있어요. 사장님이 계좌를 등록하면 확인할 수 있어요",
  },
  holder_not_verified: {
    status: 409,
    outcome: "field",
    state: "error",
    retry: "none",
    message: "확인된 예금주와 다른 계좌로는 바꿀 수 없어요. 우리 서비스 채널로 문의해 주세요",
  },
  identity_change_pending: {
    status: 409,
    outcome: "not_allowed",
    state: "stale",
    retry: "none",
    message: "확인을 기다리는 변경 요청이 있어요",
  },
  original_not_kept: {
    status: 409,
    outcome: "not_allowed",
    state: "error",
    retry: "none",
    message: "원래 값을 두지 않아요",
  },
  original_erased: { status: 409, outcome: "not_allowed", state: "stale", retry: "none", message: "지워진 값이에요" },
  request_in_progress: {
    status: 409,
    outcome: "in_progress",
    state: "submitting",
    retry: "same",
    message: "처리하고 있어요. 잠시 뒤 다시 확인해 주세요",
  },
  file_too_large: {
    status: 413,
    outcome: "field",
    state: "error",
    retry: "none",
    message: "사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요",
  },
  rate_limited: {
    status: 429,
    outcome: "wait",
    state: "rate-limited",
    retry: "same",
    message: "잠시 뒤 다시 시도해 주세요",
  },
  too_many_attempts: {
    status: 429,
    outcome: "wait",
    state: "rate-limited",
    retry: "none",
    message: "잠시 뒤 다시 로그인해 주세요",
  },
  internal: {
    status: 500,
    outcome: "server",
    state: "error",
    retry: "same",
    message: "문제가 생겼어요. 다시 시도해 주세요",
  },
  kakao_unavailable: {
    status: 503,
    outcome: "server",
    state: "error",
    retry: "same",
    message: "카카오에 연결하지 못했어요. 잠시 뒤 다시 해 주세요",
  },
  google_unavailable: {
    status: 503,
    outcome: "server",
    state: "error",
    retry: "same",
    message: "구글에 연결하지 못했어요. 잠시 뒤 다시 해 주세요",
  },
  storage_unavailable: {
    status: 503,
    outcome: "server",
    state: "error",
    retry: "none",
    message: "사진을 저장하지 못했어요. 다시 올려 주세요",
  },
  // 운영자 로그인(API-004)에서 인증 서비스가 답하지 않음(06 DEC-27, TASK-021). 다시 시도 버튼(로그인은 요청 키를 쓰지 않음).
  auth_unavailable: {
    status: 503,
    outcome: "server",
    state: "error",
    retry: "same",
    message: "로그인 서비스에 연결하지 못했어요. 잠시 뒤 다시 해 주세요",
  },
} as const satisfies Record<string, CodeInfo>;

export type ErrorCode = keyof typeof ERROR_CODES;

const codeInfo = (code: ErrorCode): CodeInfo => ERROR_CODES[code];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CODES, value);
}

/**
 * 필드 오류 사유마다 필드 옆에 보이는 글(06 fieldErrors의 뜻을 08 말투로).
 * 화면이 그 필드에 맞는 글(예: '10자리 숫자로 넣어 주세요')을 주면 그것이 먼저다(Field의 messages).
 */
export const FIELD_REASONS = {
  required: "꼭 넣어 주세요",
  too_short: "글자 수나 개수가 모자라요",
  too_long: "글자 수가 너무 많아요",
  bad_format: "형식이 맞지 않아요",
  not_allowed: "고를 수 없는 값이에요",
  out_of_range: "넣을 수 있는 범위를 벗어났어요",
  too_many: "개수가 너무 많아요",
  duplicate: "같은 값이 겹쳐요",
  checksum_failed: "번호가 맞지 않아요. 다시 확인해 주세요",
  upload_not_found: "올린 파일을 찾을 수 없어요. 다시 올려 주세요",
  upload_wrong_purpose: "다른 용도로 올린 파일이에요. 다시 올려 주세요",
  reference_not_found: "가리킨 항목을 찾을 수 없어요",
  conflict: "다른 줄과 충돌해요",
  overlaps: "기간이 다른 단계와 겹쳐요",
  gap: "기간 사이가 비어 있어요",
  exceeds_received: "받은 금액에서 이미 정한 환불을 뺀 금액보다 많아요",
  below_calculated: "환불 계산값보다 낮아요",
  below_quote_min: "견적의 가장 낮은 금액보다 낮아요",
  exceeds_card_limit: "규정 글이 너무 길어 주문 요청 카드에 들어가지 않아요",
  in_past: "지난 날짜나 시각이에요",
  outside_window: "정할 수 있는 시간 밖이에요",
  not_after_start: "끝이 시작보다 늦어야 해요",
  unknown_field: "받지 않는 항목이에요",
  bad_json: "보낸 내용을 읽지 못했어요",
} as const satisfies Record<string, string>;

export type FieldReason = keyof typeof FIELD_REASONS;

export function isFieldReason(value: unknown): value is FieldReason {
  return typeof value === "string" && Object.hasOwn(FIELD_REASONS, value);
}

/** 확인할 것 9개의 확인 창 글(06 6절, 08 README 5절). {count}는 관련 주문 수. */
export const CONFIRMATIONS = {
  lowered_refund:
    "제작 전 취소 환불을 전액보다 낮추면 분쟁 때 가게에 불리할 수 있어요(약관법 제8조, 한국소비자원 조정 사례). 그래도 저장할까요?",
  closed_day_with_orders: "잡힌 자리와 확정 주문 {count}건은 그대로 남아요. 휴무로 바꿀까요?",
  capacity_below_held: "이미 잡힌 자리 {count}개는 그대로 남아요. 하루 최대 개수를 줄일까요?",
  overbooking: "그날 남은 자리가 없어요. 추가로 받을까요?",
  not_pickup_day: "오늘이 픽업 날이 아니에요. 그래도 인도를 기록할까요?",
  closed_day: "휴무일이에요. 이날로 정할까요?",
  past_cutoff: "주문 마감이 지난 날이에요(새 결제 기한은 픽업 일시까지). 결제 기한을 연장할까요?",
  holder_mismatch: "예금주가 상호·대표자와 달라요. 가게 명의 계좌가 맞나요?",
  no_compensation_standard:
    "상함·변질이나 이물은 소비자분쟁해결기준(공정위 고시 제2025-14호 별표, 제빵류)이 교환이나 환급을 정해요. 보상 없이 닫으면 분쟁 때 가게에 불리할 수 있어요. 사유를 남기고 그래도 보상 없이 닫을까요?",
} as const satisfies Record<string, string>;

export type ConfirmationKind = keyof typeof CONFIRMATIONS;

export function isConfirmationKind(value: unknown): value is ConfirmationKind {
  return typeof value === "string" && Object.hasOwn(CONFIRMATIONS, value);
}

/** 06 FieldError. field는 JSON 포인터(/a/b) 또는 header:이름·query:이름·path:이름·file·/ */
export interface FieldError {
  readonly field: string;
  readonly code: FieldReason;
}

/** 06 ConfirmationNeeded */
export interface ConfirmationNeeded {
  readonly kind: ConfirmationKind;
  readonly count?: number;
  readonly day?: string;
}

/** 06 Problem(RFC 9457 + code·traceId). 화면이 쓰는 것만 읽는다. */
export interface Problem {
  readonly conflicts?: readonly CalendarConflict[];
  readonly status: number;
  readonly code: ErrorCode;
  readonly title: string;
  readonly traceId: string | null;
  readonly detail: string | null;
  readonly errors: readonly FieldError[];
  readonly confirm: readonly ConfirmationNeeded[];
  readonly retryAfterSeconds: number | null;
}

/** 06 FieldError.field */
export const FIELD_PATTERN = /^((\/[A-Za-z0-9_]+)+|(header|query|path):[A-Za-z0-9_-]+|file|\/)$/;
/** 06 ConfirmationNeeded.day(format: date) */
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** 06 Problem.traceId */
export const TRACE_PATTERN = /^[0-9a-f]{32}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 오류 응답 본문을 06 Problem으로 읽는다. 코드가 06에 없거나 꼴이 아니면 null(화면은 일반 서버 실패로 봄).
 * 틀린 꼴의 errors·confirm 항목은 버리고, 글은 그대로 화면에 넣지 않는다(코드로 표의 글을 고름).
 */
export function parseProblem(body: unknown, status: number): Problem | null {
  if (!isRecord(body) || !isErrorCode(body.code)) return null;
  const conflicts =
    body.code === "confirmation_required" && body.conflicts !== undefined
      ? parseCalendarConflicts(body.conflicts)
      : undefined;
  if (conflicts === null) return null;
  const errors: FieldError[] = [];
  if (Array.isArray(body.errors)) {
    for (const e of body.errors) {
      if (isRecord(e) && typeof e.field === "string" && FIELD_PATTERN.test(e.field) && isFieldReason(e.code)) {
        errors.push({ field: e.field, code: e.code });
      }
    }
  }
  const confirm: ConfirmationNeeded[] = [];
  if (Array.isArray(body.confirm)) {
    for (const c of body.confirm) {
      if (!isRecord(c) || !isConfirmationKind(c.kind)) continue;
      const item: { kind: ConfirmationKind; count?: number; day?: string } = { kind: c.kind };
      if (typeof c.count === "number" && Number.isInteger(c.count) && c.count >= 0 && c.count <= 10000) {
        item.count = c.count;
      }
      if (typeof c.day === "string" && DAY_PATTERN.test(c.day)) item.day = c.day;
      confirm.push(item);
    }
  }
  const retry = body.retryAfterSeconds;
  return {
    ...(conflicts ? { conflicts } : {}),
    status,
    code: body.code,
    title: typeof body.title === "string" ? body.title : codeInfo(body.code).message,
    traceId: typeof body.traceId === "string" && TRACE_PATTERN.test(body.traceId) ? body.traceId : null,
    detail: typeof body.detail === "string" && body.detail.length <= 1000 ? body.detail : null,
    errors,
    confirm,
    retryAfterSeconds:
      typeof retry === "number" && Number.isInteger(retry) && retry >= 1 ? Math.min(retry, 3600) : null,
  };
}

/** 실패한 응답 하나를 화면이 알릴 꼴로(G7). */
export interface Failure {
  readonly conflicts?: readonly CalendarConflict[];
  readonly outcome: Outcome;
  /** 06 오류 코드. 연결 실패·계약 밖 응답이면 null */
  readonly code: ErrorCode | null;
  /** HTTP 상태. 연결 실패면 0 */
  readonly status: number;
  readonly state: ScreenState;
  readonly retry: Retry;
  /** 화면에 보이는 말(06). 계약 밖이면 internal의 말 */
  readonly message: string;
  readonly detail: string | null;
  readonly traceId: string | null;
  readonly fieldErrors: readonly FieldError[];
  readonly confirm: readonly ConfirmationNeeded[];
  readonly retryAfterSeconds: number | null;
}

/**
 * 오류 응답을 G7 결과로 나눈다. problem이 null(연결 실패·Problem이 아닌 응답)이거나 화면에 오지 않는 코드면
 * 서버 실패로 보고, 연결 실패(0)와 5xx는 같은 요청 키로 다시 시도, 그 밖은 다시 보내지 않는다.
 */
export function classify(status: number, problem: Problem | null, retryAfterSeconds: number | null): Failure {
  if (problem === null || codeInfo(problem.code).screens === false) {
    return {
      outcome: "server",
      code: problem?.code ?? null,
      status,
      state: "error",
      retry: status === 0 || status >= 500 ? "same" : "none",
      message: ERROR_CODES.internal.message,
      detail: null,
      traceId: problem?.traceId ?? null,
      fieldErrors: [],
      confirm: [],
      retryAfterSeconds: null,
    };
  }
  const info = codeInfo(problem.code);
  return {
    outcome: info.outcome,
    ...(problem.conflicts ? { conflicts: problem.conflicts } : {}),
    code: problem.code,
    status,
    state: info.state,
    retry: info.retry,
    message: info.message,
    detail: problem.detail,
    traceId: problem.traceId,
    fieldErrors: problem.errors,
    confirm: problem.confirm,
    retryAfterSeconds: retryAfterSeconds ?? problem.retryAfterSeconds,
  };
}

/** 확인할 것 하나의 글. day가 있으면 앞에 'M월 D일: '을 붙이고 {count}를 채운다. */
export function confirmText(item: ConfirmationNeeded): string {
  const text = CONFIRMATIONS[item.kind].replace(
    "{count}",
    item.count === undefined ? "?" : item.count.toLocaleString("ko-KR"),
  );
  if (item.day === undefined) return text;
  const [, month, day] = item.day.split("-").map(Number);
  return `${month}월 ${day}일: ${text}`;
}

/** 필드 옆에 보일 글. 화면이 준 글이 먼저다. */
export function fieldReasonText(code: FieldReason, messages?: Partial<Record<FieldReason, string>>): string {
  return messages?.[code] ?? FIELD_REASONS[code];
}
