/**
 * 시각 계산의 바탕(04 G8). TASK-018.
 * - 저장은 늘 UTC 절대 시각(timestamptz, JS Date). 날짜·시각을 '읽고 정하는' 일은 가게 시간대(shops.time_zone,
 *   기본 Asia/Seoul)로 한다.
 * - 하루 내내 세는 기한(결제 기한·견적 유효 기한·문의 끊김·신고 기한·답 없어 닫히는 때): addAllDay.
 * - 답하는 시간(business_calendars.reply_start~reply_end, 기본 09:00~21:00) 안에서만 세는 기다림(REQ-259):
 *   addWithinReplyHours.
 * 각 기한의 실제 길이와 시작점은 그 SPEC을 만드는 작업이 정한다(이 모듈은 바탕만).
 * Intl(IANA 시간대 자료)만 쓰므로 Workers와 Node에서 같게 돈다.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** 가게 시간대의 벽시계 값. date는 YYYY-MM-DD, time은 HH:MM(초는 버림), weekday는 0(일)~6(토). */
export interface ShopLocal {
  readonly date: string;
  readonly time: string;
  readonly weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    // 틀린 시간대 이름이면 RangeError(값을 메시지에 싣지 않으려면 부르는 쪽이 isTimeZone으로 먼저 봄).
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** IANA 시간대 이름인지(예: Asia/Seoul). */
export function isTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(instant: Date, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) out[p.type] = p.value;
  return {
    y: Number(out.year),
    mo: Number(out.month),
    d: Number(out.day),
    h: Number(out.hour),
    mi: Number(out.minute),
    s: Number(out.second),
    weekday: WEEKDAYS.indexOf(out.weekday ?? ""),
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** UTC 절대 시각을 가게 시간대의 날짜·시각으로. */
export function toShopLocal(instant: Date, timeZone: string): ShopLocal {
  const p = parts(instant, timeZone);
  return { date: `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}`, weekday: p.weekday };
}

/** 그 시각에 그 시간대가 UTC보다 앞선 밀리초(서울은 +9시간). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * 가게 시간대의 날짜·시각(벽시계)을 UTC 절대 시각으로. 서머타임으로 없는 시각은 뒤로 밀린 시각,
 * 두 번 있는 시각은 앞의 것. date는 YYYY-MM-DD, time은 HH:MM이나 HH:MM:SS.
 */
export function shopLocalToUtc(date: string, time: string, timeZone: string): Date {
  const dm = DATE.exec(date);
  const tm = TIME.exec(time);
  if (dm === null || tm === null) throw new RangeError("date must be YYYY-MM-DD and time HH:MM[:SS]");
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError("date must be a real calendar date");
  }
  const wall = Date.UTC(y, mo - 1, d, Number(tm[1]), Number(tm[2]), Number(tm[3] ?? 0));
  // 벽시계 값에서 그 무렵의 시차를 빼고, 시차가 바뀌는 경계면 한 번 더 맞춘다.
  let guess = wall - offsetMs(new Date(wall), timeZone);
  const second = wall - offsetMs(new Date(guess), timeZone);
  if (second !== guess) {
    const third = wall - offsetMs(new Date(second), timeZone);
    guess = third === second ? second : Math.max(second, third);
  }
  return new Date(guess);
}

/** 하루 내내 세는 기한: 시작 시각에 그 길이를 그대로 더함(밤·휴무도 셈, G8). */
export function addAllDay(start: Date, ms: number): Date {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError("duration must be a finite non-negative number");
  return new Date(start.getTime() + ms);
}

/** 가게의 답하는 시간. start < end인 HH:MM(05 business_calendars_reply_chk). */
export interface ReplyHours {
  readonly timeZone: string;
  readonly start: string;
  readonly end: string;
}

function nextDate(date: string): string {
  const m = DATE.exec(date);
  if (m === null) throw new RangeError("bad date");
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + DAY);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * 답하는 시간 안에서만 세는 기다림(REQ-259): start부터 minutes분을 그 날들의 답하는 시간 안에서만 세어 끝나는 UTC 시각.
 * 답하는 시간 밖에서 시작하면 다음 답하는 시간의 시작부터 센다. 0분이면 start 그대로.
 */
export function addWithinReplyHours(start: Date, minutes: number, hours: ReplyHours): Date {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("minutes must be a finite non-negative number");
  if (!TIME.test(hours.start) || !TIME.test(hours.end) || hours.start >= hours.end) {
    throw new RangeError("reply hours must be HH:MM with start before end");
  }
  if (minutes === 0) return new Date(start.getTime());
  let remaining = minutes * MINUTE;
  let cursor = start.getTime();
  let day = toShopLocal(start, hours.timeZone).date;
  // 하루에 적어도 1분은 세므로, 기다림이 길어도 (분 수 + 2)일 안에 끝난다. 그보다 크게 잡아 무한 반복을 막는다.
  for (let i = 0; i < minutes + 3; i += 1) {
    const open = shopLocalToUtc(day, hours.start, hours.timeZone).getTime();
    const close = shopLocalToUtc(day, hours.end, hours.timeZone).getTime();
    if (cursor < open) cursor = open;
    if (cursor < close) {
      const available = close - cursor;
      if (remaining <= available) return new Date(cursor + remaining);
      remaining -= available;
      cursor = close;
    }
    day = nextDate(day);
  }
  throw new RangeError("reply-hours wait did not finish");
}
