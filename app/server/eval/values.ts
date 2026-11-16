/**
 * 값 표기를 같은 꼴로 읽는 층(TASK-027). 답과 AI 입력의 금액·날짜·시각·개수를 같은 값으로 읽는다.
 */

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

// ── 날짜·시각·개수 ────────────────────────────────────────────────────────────────

/**
 * 시각·날짜·기간·개수처럼 '사실'이 되는 숫자를 같은 꼴(후보 여럿)로 뽑는다. 금액(원)은 금액 잣대가 본다.
 * 영문자·숫자 바로 뒤의 숫자(주문번호 K7Q2M9의 9 등)는 뽑지 않는다.
 */
export function numberFacts(text: string): string[][] {
  return factsAt(text).map((f) => f.candidates);
}

export interface Fact {
  /** 글에서 숫자가 시작하는 자리(문장을 찾을 때 씀). */
  readonly at: number;
  readonly candidates: string[];
}

/** 찾은 글을 같은 길이의 빈칸으로 바꾼다(뒤에서 찾는 숫자의 자리가 그대로 남게). */
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => " ".repeat(m.length));
}

export function factsAt(text: string): Fact[] {
  const facts: Fact[] = [];
  const at = (m: RegExpMatchArray, group: number): number => (m.index ?? 0) + m[0].indexOf(m[group] ?? "");
  const body = blank(text, /[0-9,]+\s*원|[0-9]+\s*만\s*(?:[0-9]\s*천\s*)?원/g);
  for (const m of body.matchAll(/([0-9]{4})-([0-9]{2})-([0-9]{2})/g)) {
    facts.push({ at: at(m, 0), candidates: [`${Number(m[2])}/${Number(m[3])}`] });
  }
  const noIso = blank(body, /[0-9]{4}-[0-9]{2}-[0-9]{2}/g);
  for (const m of noIso.matchAll(/(?<![A-Za-z0-9])([0-9]{1,2}):([0-9]{2})/g))
    facts.push({ at: at(m, 0), candidates: clock(Number(m[1]), Number(m[2]), null) });
  for (const m of noIso.matchAll(
    /(오전|오후|낮|밤|저녁|아침|새벽)?\s*(?<![A-Za-z0-9])([0-9]{1,2})\s*시(?!간)(?:\s*([0-9]{1,2})\s*분|\s*(반))?/g,
  )) {
    facts.push({ at: at(m, 2), candidates: clock(Number(m[2]), m[4] === "반" ? 30 : Number(m[3] ?? 0), m[1] ?? null) });
  }
  for (const m of noIso.matchAll(/(?<![A-Za-z0-9])([0-9]{1,2})\s*월\s*([0-9]{1,2})\s*일/g)) {
    facts.push({ at: at(m, 0), candidates: [`${Number(m[1])}/${Number(m[2])}`] });
  }
  for (const m of noIso.matchAll(/(?<![A-Za-z0-9/])([0-9]{1,2})\/([0-9]{1,2})(?![0-9/])/g)) {
    facts.push({ at: at(m, 0), candidates: [`${Number(m[1])}/${Number(m[2])}`] });
  }
  const noMonthDay = blank(noIso, /[0-9]{1,2}\s*월\s*[0-9]{1,2}\s*일/g);
  for (const m of noMonthDay.matchAll(
    /(?<![A-Za-z0-9.,])([0-9]+)\s*(시간|분|일|개월|주|년|개|명|층|단|%|퍼센트|cm|센티|g|그램|kcal|칼로리|장|호)/g,
  )) {
    const unit = m[2] === "퍼센트" ? "%" : m[2] === "센티" ? "cm" : m[2] === "그램" ? "g" : m[2];
    facts.push({ at: at(m, 0), candidates: [`${Number(m[1])}${unit}`] });
  }
  return facts;
}

function clock(h: number, min: number, part: string | null): string[] {
  const mm = String(min).padStart(2, "0");
  if (part === "오후" || part === "저녁" || part === "밤") return [`${h < 12 ? h + 12 : h}:${mm}`];
  if (part === "오전" || part === "아침" || part === "새벽") return [`${h}:${mm}`];
  if (part === "낮") return [`${h < 7 ? h + 12 : h}:${mm}`];
  return h <= 12 ? [`${h}:${mm}`, `${h + 12}:${mm}`] : [`${h}:${mm}`];
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
