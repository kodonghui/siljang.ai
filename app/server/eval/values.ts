/**
 * 값 표기를 같은 꼴로 읽는 층(TASK-027). 답과 AI 입력의 금액·날짜·요일·시각·개수를 같은 값으로 읽어, 잣대가 글 모양이
 * 아니라 값과 서버 판단(견적·날짜 판정·영업 시간·쉬는 요일)을 견주게 한다.
 *
 * - 금액: 35,000원·3만 5천 원·3.5만 원·₩35,000·5천 원과 '61,000~66,000원'의 앞 끝을 원 단위 수로.
 * - 날짜: 2026-11-21·2026년 11월 21일·2026.11.21·11월 21일·11/21·11.21·21일(날)을 'M/D'로. '3일 전·3일 동안'처럼
 *   기간인 'N일'은 날짜로 풀지 않는다. 해와 달은 평가의 오늘(EVAL_TODAY)로 정한다(오늘보다 앞선 날이면 다음 해·다음 달).
 * - 요일·오늘·내일·모레: 그 날로 푼다('토요일'은 오늘부터 가장 가까운 토요일, '이번 주'는 월요일부터 일요일까지,
 *   '다음 주 토요일'은 그 이레 뒤). '그날'은 사례의 날짜 판정으로 푼다(판단 견주기). 숫자가 아니라서 근거 숫자 검사에는 쓰지 않는다.
 * - 시각: HH:MM은 24시간 그대로 한 값(앞에 '오후' 같은 말이 붙으면 그 말대로). 말로 한 'N시'는 오전·오후·밤 같은 말이 붙으면
 *   한 값, 없으면 두 갈래(3시 → 3:00·15:00).
 * - 개수·기간: 3일·2호·30개·350kcal처럼 단위가 붙은 숫자.
 * - 한글 숫자(삼만 원, 열 시)는 읽지 못한다(사람 검토 표본으로 봄).
 */
import { EVAL_TODAY } from "./shops";

// ── 금액 ──────────────────────────────────────────────────────────────────────

export interface AmountSpan {
  readonly start: number;
  readonly end: number;
  readonly won: number;
}

const AMOUNT_RULES: readonly (readonly [RegExp, (m: RegExpMatchArray) => number])[] = [
  // 3만 5천 원, 3만5천원, 12만 원, 3.5만원, 3만 5천 5백 원
  [
    /([0-9]+(?:\.[0-9]+)?)\s*만\s*(?:([0-9])\s*천)?\s*(?:([0-9])\s*백)?\s*원/g,
    (m) => Math.round(Number(m[1]) * 10_000) + Number(m[2] ?? 0) * 1_000 + Number(m[3] ?? 0) * 100,
  ],
  // 만 원(앞에 숫자·한글이 없을 때 1만 원)
  [/(?<![0-9가-힣.])만\s*원/g, () => 10_000],
  // ₩35,000
  [/₩\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/g, (m) => Number((m[1] ?? "").replaceAll(",", ""))],
  // 35,000원, 35000 원
  [/(?<![0-9.,])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\s*원/g, (m) => Number((m[1] ?? "").replaceAll(",", ""))],
  // 5천 원, 5천원
  [/(?<![0-9만])([0-9]+)\s*천\s*원/g, (m) => Number(m[1]) * 1_000],
];

/**
 * '61,000~66,000원'·'6만 1천~6만 6천 원'·'1~2만 원'처럼 '원'이 뒤 끝에만 붙은 범위의 앞 끝(REQ-231의 표시 '50,000~70,000원').
 * 앞 끝에 단위가 없고 뒤 끝이 '만'·'천' 꼴이면 같은 단위로 읽는다.
 */
const RANGE_LEFT =
  /(?<![0-9.,])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)(\s*만(?:\s*([0-9])\s*천)?(?:\s*([0-9])\s*백)?|\s*천)?\s*[~～∼]\s*$/;

function rangeLeftValue(m: RegExpExecArray, right: string): number {
  const n = Number((m[1] ?? "").replaceAll(",", ""));
  const unit = m[2] ?? "";
  if (unit.includes("만")) return Math.round(n * 10_000) + Number(m[3] ?? 0) * 1_000 + Number(m[4] ?? 0) * 100;
  if (unit.includes("천")) return n * 1_000;
  if (right.includes("만") && n < 1_000) return Math.round(n * 10_000);
  if (right.includes("천") && n < 10) return n * 1_000;
  return n;
}

/** 글에 나온 금액(원)과 자리. 앞 규칙이 잡은 자리는 뒤 규칙이 다시 잡지 않는다. */
export function amountSpans(text: string): AmountSpan[] {
  const spans: AmountSpan[] = [];
  for (const [re, value] of AMOUNT_RULES) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (spans.some((s) => start < s.end && s.start < end)) continue;
      spans.push({ start, end, won: value(m) });
    }
  }
  for (const right of [...spans]) {
    const m = RANGE_LEFT.exec(text.slice(0, right.start));
    if (m === null) continue;
    const start = m.index;
    const end = start + (m[1] ?? "").length + (m[2] ?? "").length;
    if (spans.some((s) => start < s.end && s.start < end)) continue;
    spans.push({ start, end, won: rangeLeftValue(m, text.slice(right.start, right.end)) });
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function amountsIn(text: string): number[] {
  return amountSpans(text).map((s) => s.won);
}

// ── 날짜·요일·시각·개수 ───────────────────────────────────────────────────────────

export type MentionKind = "date" | "time" | "count";

/** 글에 나온 값 하나. */
export interface Mention {
  readonly start: number;
  readonly end: number;
  readonly kind: MentionKind;
  /** 근거와 견줄 꼴(날짜 'M/D'·'D일', 시각 'H:MM', 개수 '3일'·'2호'). 숫자로 적지 않은 값(요일·오늘·그날)은 비어 있다. */
  readonly candidates: readonly string[];
  /** 날짜가 가리키는 날(YYYY-MM-DD). '그날'은 null(사례의 날짜 판정으로 푼다). 날짜가 아니면 없다. */
  readonly day?: string | null;
  /** 요일만 말함('월요일', '다음 주 토요일'). */
  readonly weekdayOnly?: boolean;
  /** 시각의 후보(자정부터 분). */
  readonly minutes?: readonly number[];
}

const [TODAY_Y, TODAY_M, TODAY_D] = (/^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(EVAL_TODAY) ?? [])
  .slice(1)
  .map(Number) as [number, number, number];

function isoDay(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

const TODAY_MS = Date.UTC(TODAY_Y, TODAY_M - 1, TODAY_D);
const DAY_MS = 86_400_000;

/** 요일(0=일요일). */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** 'M월 D일'의 해: 오늘보다 앞선 날이면 다음 해. */
function monthDay(m: number, d: number): string {
  const year = m > TODAY_M || (m === TODAY_M && d >= TODAY_D) ? TODAY_Y : TODAY_Y + 1;
  return isoDay(Date.UTC(year, m - 1, d));
}

/** 'D일'만 말함: 오늘보다 앞선 날이면 다음 달. */
function dayOnly(d: number): string {
  return isoDay(Date.UTC(TODAY_Y, d >= TODAY_D ? TODAY_M - 1 : TODAY_M, d));
}

/** 요일 말: '이번 주'는 월요일부터 일요일까지, 아무 말 없으면 오늘부터 가장 가까운 그 요일, '다음 주'는 이레 뒤. */
function weekdayDay(w: number, week: string | undefined): string {
  const today = new Date(TODAY_MS).getUTCDay();
  const monday = TODAY_MS - ((today + 6) % 7) * DAY_MS;
  const thisWeek = monday + ((w + 6) % 7) * DAY_MS;
  if (week === undefined) return isoDay(TODAY_MS + ((w - today + 7) % 7) * DAY_MS);
  if (/다다음/.test(week)) return isoDay(thisWeek + 14 * DAY_MS);
  if (/다음|담주/.test(week)) return isoDay(thisWeek + 7 * DAY_MS);
  return isoDay(thisWeek);
}

const PERIOD = "(오전|오후|낮|밤|저녁|아침|새벽)";

/** 시각 후보(분). 오후·저녁·밤은 12를 더하고, 말이 없으면 12시까지는 두 갈래다. */
function clock(h: number, min: number, part: string | null): number[] {
  if (part === "오후" || part === "저녁" || part === "밤") return [(h < 12 ? h + 12 : h) * 60 + min];
  if (part === "오전" || part === "아침" || part === "새벽") return [h * 60 + min];
  if (part === "낮") return [(h < 7 ? h + 12 : h) * 60 + min];
  return h <= 12 ? [h * 60 + min, (h + 12) * 60 + min] : [h * 60 + min];
}

const timeText = (minutes: number): string => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** 'N일' 뒤에 이 말이 오면 날짜가 아니라 기간이다(3일 전, 3일 동안). */
const DURATION = /^\s*(?:전|이전|후|이후|뒤|동안|간|이내|안에|만에|째|치|정도|가량|넘|이상|이하)/;

/** 단위가 붙은 숫자의 단위. */
const UNITS = "시간|분|일|개월|주|년|개|명|층|단|%|퍼센트|cm|센티|g|그램|kcal|칼로리|장|호";

/**
 * 글에 나온 날짜·요일·시각·개수(자리 차례). 금액은 빼고 읽는다. 영문자·숫자 바로 뒤의 숫자(주문번호 K7Q2M9의 9)는 읽지 않는다.
 * 앞에서 읽은 자리는 빈칸으로 바꿔 뒤 규칙이 다시 읽지 않는다.
 */
export function valueMentions(text: string): Mention[] {
  const out: Mention[] = [];
  let body = text;
  const take = (start: number, end: number, m: Omit<Mention, "start" | "end">): void => {
    out.push({ start, end, ...m });
    body = body.slice(0, start) + " ".repeat(end - start) + body.slice(end);
  };
  const each = (re: RegExp, f: (m: RegExpExecArray, start: number, end: number) => void): void => {
    for (const m of [...body.matchAll(re)] as RegExpExecArray[]) f(m, m.index, m.index + m[0].length);
  };
  for (const a of amountSpans(text)) body = body.slice(0, a.start) + " ".repeat(a.end - a.start) + body.slice(a.end);

  const date = (m: number, d: number): Omit<Mention, "start" | "end"> | null =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { kind: "date", candidates: [`${m}/${d}`], day: monthDay(m, d) } : null;
  const pushDate = (start: number, end: number, v: Omit<Mention, "start" | "end"> | null): void => {
    if (v !== null) take(start, end, v);
  };
  // 2026-11-21, 2026년 11월 21일, 2026.11.21, 2026/11/21
  each(
    /(?<![0-9])20[0-9]{2}\s*(?:-|\.|\/|년)\s*([0-9]{1,2})\s*(?:-|\.|\/|월)\s*([0-9]{1,2})(?:\s*일)?(?![0-9])/g,
    (m, s, e) => pushDate(s, e, date(Number(m[1]), Number(m[2]))),
  );
  // 11월 21일
  each(/(?<![A-Za-z0-9])([0-9]{1,2})\s*월\s*([0-9]{1,2})\s*일/g, (m, s, e) =>
    pushDate(s, e, date(Number(m[1]), Number(m[2]))),
  );
  // 11/21
  each(/(?<![A-Za-z0-9/.])([0-9]{1,2})\/([0-9]{1,2})(?![0-9/])/g, (m, s, e) =>
    pushDate(s, e, date(Number(m[1]), Number(m[2]))),
  );
  // 11.21(토). 뒤에 단위가 오면(1.5배, 2.5kg) 날짜가 아니다.
  each(
    /(?<![A-Za-z0-9.,])([0-9]{1,2})\.([0-9]{1,2})(?![0-9.])(?!\s*(?:[A-Za-z%]|만|천|원|배|개|호|시|분|퍼센트|센티|그램|칼로리))/g,
    (m, s, e) => pushDate(s, e, date(Number(m[1]), Number(m[2]))),
  );
  // 시각 HH:MM(24시간). 앞에 오후 같은 말이 붙으면 그 말대로.
  each(new RegExp(`(?:${PERIOD}\\s*)?(?<![A-Za-z0-9])([0-9]{1,2}):([0-9]{2})(?![0-9])`, "g"), (m, s, e) => {
    const h = Number(m[2]);
    const min = Number(m[3]);
    if (h > 24 || min > 59) return;
    const minutes = m[1] === undefined ? [h * 60 + min] : clock(h, min, m[1]);
    take(s, e, { kind: "time", candidates: minutes.map(timeText), minutes });
  });
  // 말로 한 시각: 오후 3시, 3시 반, 10시 30분
  each(
    new RegExp(`(?:${PERIOD}\\s*)?(?<![A-Za-z0-9])([0-9]{1,2})\\s*시(?!간)(?:\\s*([0-9]{1,2})\\s*분|\\s*(반))?`, "g"),
    (m, s, e) => {
      const minutes = clock(Number(m[2]), m[4] === "반" ? 30 : Number(m[3] ?? 0), m[1] ?? null);
      take(s, e, { kind: "time", candidates: minutes.map(timeText), minutes });
    },
  );
  // 단위가 붙은 숫자. 'N일'은 기간이 아니면 그 달의 날짜다(21일, 21일날).
  each(new RegExp(`(?<![A-Za-z0-9.,])([0-9]+)\\s*(${UNITS})`, "g"), (m, s, e) => {
    const n = Number(m[1]);
    const unit = m[2] === "퍼센트" ? "%" : m[2] === "센티" ? "cm" : m[2] === "그램" ? "g" : m[2];
    const candidates = [`${n}${unit}`];
    if (unit === "일" && n >= 1 && n <= 31 && !DURATION.test(text.slice(e))) {
      take(s, e, { kind: "date", candidates, day: dayOnly(n) });
    } else take(s, e, { kind: "count", candidates });
  });
  // 요일(이번 주·다음 주)
  each(/(?:(이번\s*주|이번주|다다음\s*주|다음\s*주|다음주|담주)\s*)?([월화수목금토일])요일/g, (m, s, e) =>
    take(s, e, {
      kind: "date",
      candidates: [],
      day: weekdayDay("일월화수목금토".indexOf(m[2] ?? ""), m[1]),
      weekdayOnly: true,
    }),
  );
  // 오늘·내일·모레
  each(/(?<![가-힣])(오늘|내일|모레)/g, (m, s, e) =>
    take(s, e, {
      kind: "date",
      candidates: [],
      day: isoDay(TODAY_MS + ["오늘", "내일", "모레"].indexOf(m[1] ?? "") * DAY_MS),
    }),
  );
  // 그날·그 날·그 날짜
  each(/(?<![가-힣])그\s*날(?:짜)?(?!씨)/g, (_m, s, e) => take(s, e, { kind: "date", candidates: [], day: null }));
  return out.sort((a, b) => a.start - b.start);
}

/**
 * 시각·날짜·기간·개수처럼 '사실'이 되는 숫자를 같은 꼴(후보 여럿)로 뽑는다. 금액(원)은 금액 잣대가 본다.
 * 숫자로 적지 않은 값(요일·오늘·그날)은 뽑지 않는다.
 */
export function numberFacts(text: string): string[][] {
  return valueMentions(text)
    .filter((m) => m.candidates.length > 0)
    .map((m) => [...m.candidates]);
}

/** 날짜 'M/D'는 'D일'로도, 시각은 모든 후보로 받아 준다. */
export function supportedSet(input: string): Set<string> {
  const set = new Set<string>();
  for (const candidates of numberFacts(input)) {
    for (const f of candidates) {
      set.add(f);
      const day = /^[0-9]+\/([0-9]+)$/.exec(f);
      if (day !== null) set.add(`${day[1]}일`);
    }
  }
  return set;
}

export function unsupportedNumbers(reply: string, input: string): number {
  const ok = supportedSet(input);
  return numberFacts(reply).filter((candidates) => !candidates.some((f) => ok.has(f))).length;
}

// ── 서술어가 다스리는 값 ─────────────────────────────────────────────────────────────

/** 값과 서술어 사이에 오면 그 서술어가 그 값을 말하지 않는다는 꼴(부정·쉼·빼기·절 끝). */
const BLOCK =
  /없|않|못|아니|어렵|어려|불가|안\s|안돼|안되|안됩|안됐|쉬|휴무|휴일|마감|닫|빼고|빼면|제외|말고|외에|이외|대신|(?:요|다|죠)[\s,]|(?:는데|은데|지만|니까|으니|어서|아서|해서|었고|았고|였고|했고|됐고|이고|하고)\s/;

/** 같은 서술어를 함께 받는 값의 나열(21일, 22일 / 21일이나 22일 / 화요일부터 일요일 / 11:00~20:00). */
const LIST_JOIN =
  /^(?:\([^)]{0,6}\))?\s*(?:에도|에|도|은|는|이|가|날)?\s*(?:,|와|과|이나|나|이랑|랑|하고|또는|및|부터|에서|~|～|∼|-)?\s*$/;

/**
 * 서술어(at에서 시작)가 다스리는 값. 같은 문장에서 서술어 앞의 가장 가까운 값(사이에 부정·쉼·빼기·절 끝이 없을 때)과,
 * 그 값에 나열로 이어진 앞의 값들이다. '21일은 안 되고 22일은 돼요'의 '돼요'는 22일만, '21일, 22일 모두 돼요'는 둘 다 다스린다.
 */
export function governed<T extends Pick<Mention, "start" | "end">>(
  text: string,
  mentions: readonly T[],
  sentenceStart: number,
  at: number,
): T[] {
  const before = mentions.filter((m) => m.start >= sentenceStart && m.end <= at).sort((a, b) => b.start - a.start);
  const out: T[] = [];
  let next = at;
  for (const m of before) {
    const between = text.slice(m.end, next);
    if (out.length === 0 ? BLOCK.test(between) : !LIST_JOIN.test(between)) break;
    out.push(m);
    next = m.start;
  }
  return out;
}
