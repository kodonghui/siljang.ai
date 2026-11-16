/**
 * 다시 하기 때 셈(TASK-023). 서버 안의 일이 실패한 뒤 다음 때를 행의 열(next_attempt_at 따위)에 적을 때 쓴다.
 * 시각은 늘 UTC 절대 시각(Date)이고, 하루 내내 센다(밤·휴무도 셈, 04 G8). 실행기가 넘긴 기준 시각(now)에서 센다.
 *
 * - 카카오 보내기(04 G4): 처음과 1분·5분·30분 뒤, 모두 4번까지(05 owner_alerts·notifications의 attempts 0~4).
 * - 발송 결과 조회(REQ-182, SPEC-066·067): 카카오가 요청을 받은 때부터 1분·5분·30분 뒤. 30분 뒤에도 모르면 끝.
 *   due-sources.ts의 owner_alert_check·notification_check SQL과 같은 셈이다(시험이 데이터베이스에서 견줌).
 * - 장부 다시 적기(04 1-8, SPEC-064): 1분·5분·30분·2시간·6시간 뒤, 그 뒤 하루 한 번(끝없이. 24시간 실패 알림은 TASK-157).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 카카오 다시 보내기 간격(G4): 첫 실패 뒤 1분, 두 번째 뒤 5분, 세 번째 뒤 30분. */
export const KAKAO_RESEND_DELAYS_MS: readonly number[] = [MINUTE, 5 * MINUTE, 30 * MINUTE];

/** 카카오 보내기 최대 횟수(처음 포함). 05 attempts CHECK (0~4)와 같다. */
export const KAKAO_MAX_ATTEMPTS = KAKAO_RESEND_DELAYS_MS.length + 1;

/** 발송 결과 조회 때: 요청을 받은 때부터 1분·5분·30분 뒤. */
export const DELIVERY_CHECK_OFFSETS_MS: readonly number[] = [MINUTE, 5 * MINUTE, 30 * MINUTE];

/** 장부 다시 적기 간격(1-8): 1분·5분·30분·2시간·6시간, 그 뒤 하루 한 번. */
export const LEDGER_RETRY_DELAYS_MS: readonly number[] = [MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR];
export const LEDGER_RETRY_AFTER_LAST_MS = DAY;

function count(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${what} must be a non-negative integer`);
}

function instant(d: Date, what: string): number {
  const t = d.getTime();
  if (Number.isNaN(t)) throw new RangeError(`${what} must be a valid date`);
  return t;
}

/**
 * 카카오 보내기가 실패한 뒤 다음에 보낼 때. attemptsDone은 이번 것까지 보낸 횟수(1~4). 더 보내지 않으면 null
 * (손님 안내는 다음 대화 때, 사장님 알림은 할 일 목록에만, G4).
 */
export function nextKakaoAttemptAt(attemptsDone: number, now: Date): Date | null {
  count(attemptsDone, "attemptsDone");
  if (attemptsDone < 1) throw new RangeError("attemptsDone must be at least 1");
  const delay = KAKAO_RESEND_DELAYS_MS[attemptsDone - 1];
  return delay === undefined ? null : new Date(instant(now, "now") + delay);
}

/**
 * 다음 발송 결과 조회 때. lastCheckedAt은 마지막으로 조회한 시각(없으면 null). 1분 조회 전이면 요청 뒤 1분,
 * 5분 조회 전이면 5분, 그 밖은 30분(30분 조회까지 했으면 이미 지난 때라 곧 '모름'으로 끝냄).
 */
export function nextDeliveryCheckAt(requestedAt: Date, lastCheckedAt: Date | null): Date {
  const base = instant(requestedAt, "requestedAt");
  const [first, second, third] = DELIVERY_CHECK_OFFSETS_MS as [number, number, number];
  if (lastCheckedAt === null) return new Date(base + first);
  if (instant(lastCheckedAt, "lastCheckedAt") < base + second) return new Date(base + second);
  return new Date(base + third);
}

/** 30분 조회까지 했는지(그래도 모르면 '모름'으로 끝냄, SPEC-066·067). */
export function deliveryChecksDone(requestedAt: Date, lastCheckedAt: Date | null): boolean {
  if (lastCheckedAt === null) return false;
  const last = DELIVERY_CHECK_OFFSETS_MS[DELIVERY_CHECK_OFFSETS_MS.length - 1] as number;
  return instant(lastCheckedAt, "lastCheckedAt") >= instant(requestedAt, "requestedAt") + last;
}

/** 장부 적기가 실패한 뒤 다음에 적을 때. failures는 이번 것까지 실패한 횟수(1 이상). 끝이 없다(그 뒤 하루 한 번). */
export function nextLedgerAttemptAt(failures: number, now: Date): Date {
  count(failures, "failures");
  if (failures < 1) throw new RangeError("failures must be at least 1");
  const delay = LEDGER_RETRY_DELAYS_MS[failures - 1] ?? LEDGER_RETRY_AFTER_LAST_MS;
  return new Date(instant(now, "now") + delay);
}
