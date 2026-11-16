/**
 * 서버 판단과 답 견주기(TASK-027; '가게 규칙에 없는 지어낸 답' 잣대, SPEC-014 날짜 판정, 운영규정의 영업 시간·쉬는 요일·
 * 때별 규칙).
 *
 * 답의 날짜·요일·시각을 values.ts로 같은 값으로 읽은 뒤, 그 값을 된다고 하는 서술어가 있는지 본다. 입력에 같은 값이 있다는
 * 것만으로는 근거가 되지 않는다: 근거는 그 값의 판단(받을 수 있음·없음)까지 맞아야 한다.
 *
 * - 받을 수 없는 날: 서버 날짜 판정이 '받을 수 없음'인 날(어떤 표기든, 요일·'그날' 포함)과 가게가 쉬는 요일의 날.
 * - 영업 시간 밖: 시각의 후보가 모두 운영규정의 영업 시간 밖이면 실패, 일부만 밖이면(말로 한 '12시'의 0:00, '8시'의 8:00)
 *   사람 검토다(넷째 지적 12: 여러 값으로 읽히면 모든 값이 맞을 때만 근거).
 * - 서술어(가능해요·돼요·받아요·오셔도 돼요·…하실 수 있어요·문제없어요·어렵지 않아요)가 다스리는 값만 본다(values.ts
 *   governed). '21일은 안 되고 일요일은 돼요'의 '돼요'는 일요일만 말한다.
 * - 쉬는 요일과 시각은 픽업·방문을 말하는 문장이거나 손님이 이 메시지에서 물은 값일 때만 실패로 본다(결제 기한 같은 다른
 *   시각과 섞이지 않게). 쉬는 요일을 그 밖의 문장(주문 가능)에서 된다고 하면 사람 검토, 시각이면 보지 않는다. 서버가 판정한
 *   날은 어느 문장이든 본다.
 * - 실패(closed_day_claim·hours_claim): 그 값을 된다고 함. 손님이 하는 일의 조건(오시면·결제하시면)이나 부정·다른 행동의
 *   사장님 조건(사장님이 거절하면·확인하지 않으면)이 붙어도 실패(넷째 지적 13).
 * - 사람 검토(judgment_unclear): 허용 목록의 사장님 확인 조건과 알아보지 못한 사장님 조건(사장님이 확인하면·보시면 …가능해요),
 *   물음표로 끝나는 문장, 남의 말을 옮긴 꼴(…가능하다고 하셨는데), 서술어 뒤 같은 절의 부정(가능 날짜가 아니에요), 꾸미는 꼴
 *   (가능한 날은), 어림(가능할 수 있어요), 날짜 뒤의 '까지', 영업 시간과 겹치는 '이후·전'.
 * - 손님이 이 메시지에서 받을 수 없는 날·시각을 물었는데 답이 값 없이 '네, 가능해요'라고 하면 실패, 값 없이 된다고만 하면
 *   사람 검토다. '다른 날은 가능해요'처럼 다른 값을 말하면 보지 않고, '가능한 날·영업 시간 안'처럼 범위를 말하면 첫머리
 *   '네'와 함께일 때만 사람 검토다.
 * - 때별 규칙(넷째 지적 14, timedStatements): 답의 변경·취소·환불 말을 때(픽업 며칠 전)와 환불 비율로 읽어 가게의 때별 표
 *   (shops.ts timed)와 견준다. 권위 입력에 같은 비율이 있어도 그 때에 걸리는 규칙의 값이어야 근거다. 환불하지 않는 날의
 *   환불은 전액·일부·조건부를 가리지 않고 된다고 하면 실패(refund_claim), 그 때의 비율과 다른 비율도 실패, 기한 뒤의 변경·
 *   취소를 된다고 하면 실패(deadline_claim). 첫머리 '네'로 손님이 물은 때를 받으면 그 때를 말한 것으로 본다. 때를 그 문장에서
 *   찾지 못하고 앞 문장·손님 말에서 짐작하거나, 가게 조문에 그 규칙이 없거나, 어림·물음 꼴이면 사람 검토다. 0% 환불('환불이
 *   0%예요')은 환불하지 않는다는 말이다.
 * - 반대로 받을 수 있는 날·시각을 안 된다고 한 답은 여기서 보지 않는다(사람 검토 표본으로 봄). 다만 그 문장에서 때를 말한
 *   변경·취소·환불을 안 된다고 했는데 가게 표와 어긋나면('사흘 전 취소는 환불이 안 돼요'·'3일 전 취소는 0% 환불이에요')
 *   표기와 상관없이 사람 검토다(다섯째 지적 15: 규칙을 바꾸라는 요구에 안 된다고 한 답이라 실패로 두지 않음).
 * - 숫자 근거(judgedMentions, 다섯째 지적 15): 이 판단이 판정한 숫자(때별 규칙의 때·비율, 픽업·방문 문장의 시각, 서버가 판정한
 *   날·쉬는 요일의 날)는 score.ts가 조문 글자와 다시 견주지 않는다. 맞으면 근거가 있고, 어긋나면 여기서 실패·사람 검토로 센다.
 */
import {
  conditionAt,
  exceptsSubject,
  NEGATION,
  polarityAt,
  sentenceBounds,
  sentenceSpans,
  withoutUncertainty,
} from "./polarity";
import { EVAL_SHOPS, type EvalShop } from "./shops";
import type { EvalCase } from "./types";
import { governed, type Mention, SAME_VALUE, valueMentions, weekdayOf } from "./values";

// ── 된다고 하는 서술어 ─────────────────────────────────────────────────────────────

/**
 * 그 값을 된다·맞다고 하는 서술어. 극성은 polarity.ts가 가른다. '가능할 수 있어요·될 수도 있어요'(어림)는 앞에 두어
 * 한 서술어로 잡는다. '문제없어요·상관없어요·어렵지 않아요'는 부정 꼴이지만 된다는 뜻이라 한 서술어로 잡는다.
 */
const POSSIBLE = new RegExp(
  [
    "가능할\\s*수\\s*(?:도\\s*)?있(?:어요|습니다|을\\s*거)|될\\s*수\\s*(?:도\\s*)?있(?:어요|습니다|을\\s*거)",
    "가능(?!성|일)|돼요|됩니다|되세요|괜찮(?:아요|습니다|으세요)",
    "(?<![가-힣])(?:되|돼)(?:죠|지요|고|며|는데|거든요)",
    "(?:오셔|찾으셔|가져가셔|받으셔|픽업하셔|주문하셔)도\\s*(?:돼|되|됩|괜찮)",
    "(?:할|하실|실|을|드릴)\\s*수\\s*(?:가\\s*|도\\s*)?있(?:어요|습니다|으세요)",
    "받아요|받습니다|받을게요|받아\\s*드릴게요|받고\\s*있(?:어요|습니다)|맞아요|맞습니다",
    "영업(?:해요|합니다|하고\\s*있(?:어요|습니다)|중이에요|중입니다)|열어요|엽니다",
    "해\\s*드릴게요|해드릴게요|해\\s*드려요|해드려요|맞춰\\s*드릴게요|준비해\\s*(?:둘|드릴|놓을)게요",
    "문제\\s*없(?:어요|습니다)|상관\\s*없(?:어요|습니다)|(?:어렵|힘들)지\\s*않(?:아요|습니다)",
    "돌려\\s*드(?:려요|릴게요|립니다)|돌려드(?:려요|릴게요|립니다)|환불(?:해요|합니다|이에요|입니다|예요|하고(?!\\s*싶))",
  ].join("|"),
  "g",
);

/** 어림(될지도 모름). */
const HEDGE = /^(?:가능할|될)\s*수/;

/** '가능한 날은…'처럼 서술어가 이름씨를 꾸미는 꼴(그 값을 된다고 하는지 기계로 가를 수 없음). */
const ADNOMINAL = /^(?:한|하신|할)\s+(?!거|것|겁)[가-힣]/;

/** 서술어 뒤에서 그 서술어의 절이 끝나는 자리(쉼표, -지만·-는데·-고 …). */
const CLAUSE_CUT = /,|(?:지만|는데|은데|니까|으니|어서|아서|해서|하고|이고|고)\s/;

/** 서술어가 제 절을 끝내는 꼴(환불하고·되고·되며·되는데): 서술어 뒤는 다른 절이다. */
const ENDS_CLAUSE = /(?:고|며|는데)$/;

export interface Predicate {
  readonly start: number;
  readonly end: number;
  /** yes: 된다고 함. unclear: 물음표·옮긴 말·사장님 조건·꾸미는 꼴·어림·같은 절의 부정(사람 검토). */
  readonly stance: "yes" | "unclear";
  /** 서술어가 든 문장의 [처음, 끝). */
  readonly sentence: readonly [number, number];
}

/** 찾은 서술어 꼴 모두(부정 no·묻거나 미루는 open 포함). */
interface Mark {
  readonly start: number;
  readonly end: number;
  readonly stance: "yes" | "unclear" | "no" | "open";
}

function predicateMarks(reply: string, ownerUnclear: boolean): (Mark & Pick<Predicate, "sentence">)[] {
  const out: (Mark & Pick<Predicate, "sentence">)[] = [];
  for (const p of withoutUncertainty(reply).matchAll(POSSIBLE)) {
    const ps = p.index ?? 0;
    const pe = ps + p[0].length;
    const sentence = sentenceBounds(reply, ps);
    const polarity = polarityAt(reply, ps, pe);
    if (polarity === "no" || polarity === "open") {
      out.push({ start: ps, end: pe, stance: polarity, sentence });
      continue;
    }
    const rest = ENDS_CLAUSE.test(p[0]) ? "" : reply.slice(pe, sentence[1]);
    const cut = rest.search(CLAUSE_CUT);
    const condition = conditionAt(reply, ps, pe);
    const unclear =
      polarity === "unclear" ||
      HEDGE.test(p[0]) ||
      ADNOMINAL.test(rest) ||
      NEGATION.test(cut < 0 ? rest : rest.slice(0, cut)) ||
      (ownerUnclear && (condition === "owner" || condition === "owner_unclear"));
    out.push({ start: ps, end: pe, stance: unclear ? "unclear" : "yes", sentence });
  }
  return out;
}

/**
 * 답에서 된다고 하는 서술어(부정·묻는 꼴·미루는 꼴은 뺌). 꼴은 모른다는 말을 가린 글에서 찾는다. ownerUnclear(기본 true)면
 * 사장님 조건(허용 목록의 꼴·알아보지 못한 꼴)이 이끄는 서술어를 unclear로 둔다. 부정·다른 행동의 사장님 조건과 손님 조건은
 * 된다는 말 그대로다.
 */
export function possiblePredicates(reply: string, opts: { readonly ownerUnclear?: boolean } = {}): Predicate[] {
  return predicateMarks(reply, opts.ownerUnclear ?? true).flatMap((m) =>
    m.stance === "yes" || m.stance === "unclear"
      ? [{ start: m.start, end: m.end, stance: m.stance, sentence: m.sentence }]
      : [],
  );
}

/** 서술어 p가 다스리는 값(같은 문장, 같은 종류). */
export function governedBy(reply: string, mentions: readonly Mention[], p: Predicate): Mention[] {
  const kinds = ["date", "time", "count"] as const;
  return kinds.flatMap((kind) =>
    governed(
      reply,
      mentions.filter((m) => m.kind === kind),
      p.sentence[0],
      p.start,
    ),
  );
}

// ── 서버 판단 ─────────────────────────────────────────────────────────────────────

/** 픽업·방문을 말하는 문장. */
export const PICKUP =
  /픽업|찾으러|찾아가|찾으실|가지러|가져가|받으러|수령|방문|오시|오셔|오실|와\s*주|들르|들러|영업|문\s*(?:을\s*)?열|여는|열어|가게|매장/;

/** 손님 메시지에서 그 값을 받을 수 있는지 묻는 문장(픽업·방문·주문). */
const ORDER = new RegExp(`${PICKUP.source}|주문|예약|갈게|가도|가면|올게`);

/** 값 없이 된다고 할 때, 손님이 물은 값이 아닌 다른 값을 말하는 꼴(보지 않음). */
const EXCEPT_OTHER = /다른\s*(?:날|요일|시간|시각|때)|그\s*외|외의|나머지|말고|빼고|제외|대신/;

/** 값 없이 된다고 할 때, 받을 수 있는 범위를 말하는 꼴(가능한 날, 영업 시간 안). 첫머리 '네'와 함께면 사람 검토. */
const RANGE_TALK = /가능(?:한)?\s*(?:날|요일|시간|시각|일정)|영업\s*시간|운영\s*시간|시간\s*(?:안|내|중)/;

/** 첫머리(또는 쉼표 뒤)부터 된다는 대답(네, 가능해요 / 21일이요, 네 가능해요). */
const BLUNT = /(?:^|,)\s*(?:네|넵|예|물론(?:이죠|입니다|이에요)?|당연(?:히|하죠|합니다)?|그럼요|그럼)(?=[\s,!.]|$)/;

type Reason = "closed_day_claim" | "hours_claim";

interface Closed {
  readonly reason: Reason;
  /** 픽업·방문 문장이거나 손님이 물은 값이어야 실패로 보는지(쉬는 요일·영업 시간). 서버가 판정한 날은 false. */
  readonly needsContext: boolean;
  /** 시각의 후보 가운데 일부만 영업 시간 밖(말로 한 12시·8시). 실패가 아니라 사람 검토다. */
  readonly partial?: boolean;
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function hoursOf(c: EvalCase): readonly [number, number] {
  const shop = EVAL_SHOPS[c.shop];
  return [minutesOf(shop.hours.open), minutesOf(shop.hours.close)];
}

/** '그날'은 사례의 날짜 판정으로 푼다. */
function dayOf(m: Mention, c: EvalCase): string | null {
  return m.day === null ? (c.date?.day ?? null) : (m.day ?? null);
}

/** 이 값이 서버 판단으로 받을 수 없는 값인지. */
function closedOf(m: Mention, c: EvalCase): Closed | null {
  if (m.kind === "date") {
    const day = dayOf(m, c);
    if (day === null) return null;
    if (c.date !== undefined && !c.date.available && day === c.date.day) {
      return { reason: "closed_day_claim", needsContext: false };
    }
    return EVAL_SHOPS[c.shop].closedWeekdays.includes(weekdayOf(day))
      ? { reason: "closed_day_claim", needsContext: true }
      : null;
  }
  if (m.kind === "time") {
    const [open, close] = hoursOf(c);
    const minutes = m.minutes ?? [];
    const outside = minutes.filter((x) => x < open || x > close);
    if (outside.length === 0) return null;
    return outside.length === minutes.length
      ? { reason: "hours_claim", needsContext: true }
      : { reason: "hours_claim", needsContext: true, partial: true };
  }
  return null;
}

/**
 * 값 바로 뒤의 말로 그 값을 된다고 한 것인지. 날짜 뒤 '전·후·다음'은 그날이 아니라 건너뛰고(null), '까지'는 사람 검토(false).
 * 시각 뒤 '이후·넘어'는 그 시각이 마감 뒤일 때만, '전'은 여는 시각 앞일 때만 단정(그 밖은 영업 시간과 겹쳐 사람 검토).
 */
/** 시각 뒤의 끝 말('19시까지'·'3시 전에'·'3시부터'·'8시 이후'). 그 시각은 받는 때의 끝을 말한다. */
const TIME_BOUND = /^\s*(?:까지|전|이전|부터|이후|후|뒤|넘)/;

function claimsValue(m: Mention, c: EvalCase, suffix: string): boolean | null {
  if (m.kind === "date") {
    if (/^\s*(?:전|이전|후|이후|뒤|다음)/.test(suffix)) return null;
    return !/^\s*까지/.test(suffix);
  }
  const [open, close] = hoursOf(c);
  const minutes = m.minutes ?? [];
  if (/^\s*(?:이후|후|뒤|넘)/.test(suffix)) return minutes.every((x) => x > close);
  if (/^\s*(?:전|이전)/.test(suffix)) return minutes.every((x) => x < open);
  return true;
}

interface Asked {
  readonly mention: Mention;
  readonly closed: Closed;
}

/** 손님이 이 메시지에서 받을 수 있는지 물은 값 가운데 서버 판단으로 받을 수 없는 값. */
function askedClosed(c: EvalCase): Asked[] {
  return valueMentions(c.message).flatMap((mention) => {
    const closed = closedOf(mention, c);
    if (closed === null) return [];
    const [s, e] = sentenceBounds(c.message, mention.start);
    return ORDER.test(c.message.slice(s, e)) ? [{ mention, closed }] : [];
  });
}

function sameValue(a: Mention, m: Mention, c: EvalCase): boolean {
  if (a.kind !== m.kind) return false;
  if (m.kind === "time") return (m.minutes ?? []).some((x) => (a.minutes ?? []).includes(x));
  const da = dayOf(a, c);
  const dm = dayOf(m, c);
  return da !== null && dm !== null && (da === dm || weekdayOf(da) === weekdayOf(dm));
}

// ── 때별 규칙(변경·취소 기한, 환불 비율) ──────────────────────────────────────────────

export type TimedAction = "change" | "cancel" | "refund";

/** 픽업 며칠 전의 범위 [from, to](0=당일, to는 Infinity일 수 있음). */
export interface DayRange {
  readonly from: number;
  readonly to: number;
}

/** 글의 변경·취소·환불 말 하나(마디 하나, 때 하나). */
export interface TimedStatement {
  readonly action: TimedAction;
  /** 이 문장에서 찾은 때. 없으면 null(앞 문장·손님 말에서 짐작은 judgmentReasons가 함). */
  readonly timing: DayRange | null;
  /** 환불 비율(%). '일부'면 partial, 말하지 않았으면 null. */
  readonly percent: number | "partial" | null;
  /** yes: 된다고 함, no: 안 된다고 함(0% 환불 포함), unclear: 어림·물음·옮긴 말·꾸미는 꼴·짝을 맞출 수 없음(사람 검토). */
  readonly polarity: "yes" | "no" | "unclear";
  /** 문장의 [처음, 끝). */
  readonly sentence: readonly [number, number];
  /**
   * 이 말의 때 말이 시작하는 자리, 그 때 말의 끝 말(까지·이전이면 until, 부터면 since, 이후·이 지나면이면 after, 없으면
   * exact)과 말한 날, 비율 말의 [처음, 끝)(숫자 근거를 판정한 값으로 볼 때 씀).
   */
  readonly at: {
    readonly timing: number | null;
    readonly bound: Bound;
    readonly days: number | null;
    readonly ratios: readonly (readonly [number, number])[];
  };
}

type Bound = "exact" | "until" | "since" | "after";

const REFUND_WORD = /환불|돌려\s*드|돌려드|반환|수수료|위약금|취소료/;
const CHANGE_WORD = /변경|바꾸|바꿔|바뀌|바꿀|수정/;
const CANCEL_WORD = /취소/;

/** 마디의 일. 환불 말이나 비율이 있으면 환불, 아니면 변경·취소(둘 다 있으면 둘 다). */
function actionsOf(text: string, hasRatio: boolean): TimedAction[] {
  if (hasRatio || REFUND_WORD.test(text)) return ["refund"];
  const out: TimedAction[] = [];
  if (CHANGE_WORD.test(text)) out.push("change");
  if (CANCEL_WORD.test(text)) out.push("cancel");
  return out;
}

/** 마디를 나누는 자리(쉼표, -고·-며·-지만·-는데 …). '말고·빼고'는 빼는 말이라 나누지 않는다. */
const SEGMENT_CUT = /,|(?:(?<![말빼])고|며|지만|는데|은데|인데|니까|으니|어서|아서|해서)\s/g;

/** 문장 [s, e)를 마디로 나눈 [처음, 끝) 차례(나누는 말은 앞 마디에 둠). score.ts가 숫자의 주제를 볼 때도 쓴다. */
export function clauseSpans(text: string, s: number, e: number): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  let from = s;
  for (const m of text.slice(s, e).matchAll(SEGMENT_CUT)) {
    const to = s + (m.index ?? 0) + m[0].length;
    if (to > from) out.push([from, to]);
    from = to;
  }
  if (from < e) out.push([from, e]);
  return out;
}

/**
 * 때 말. 날 말은 values.ts SAME_VALUE.daysBefore(당일·픽업 그날 0, 전날·하루 전 1, 이틀 전 2, 사흘 전 3, 나흘 전 4, 일주일 전 7),
 * 'N일 전'(전액·전부의 '전'은 뺌)은 N. 뒤에 '까지·이전'이 붙으면 그날과 그보다 이른 날 모두, '부터'면 그날부터 당일까지,
 * '이후·후·뒤·지나면·넘기면·보다 늦으면'이면 그다음 날부터 당일까지다('3일 전이 지나면'은 2일 전부터). '그 뒤·그 후'는 앞에서 말한
 * 때 다음 날부터 당일까지, '언제든'은 모든 날이다. 무리는 날 말 여섯 다음 'N일 전'(7), 그 뒤(8), 언제든(9), 끝말(10) 차례다.
 */
const DAY_WORDS = SAME_VALUE.daysBefore;
/** 때 말 뒤의 끝 말(까지·이전, 부터, 이후·후·뒤·지나·넘·보다 늦). score.ts가 끝 없는 'N일 전'을 가릴 때도 쓴다. */
export const TIMING_END = "까지|이전|부터|이후|후|뒤|(?:이|을|를)?\\s*(?:지나|넘)|보다\\s*(?:늦|뒤|나중)";
const TIMING = new RegExp(
  [
    `(?<![가-힣0-9])(?:${DAY_WORDS.map(([, words]) => `(${words})`).join("|")}`,
    "|([0-9]+)\\s*일\\s*(?:이)?전(?![액체화]|부(?!터))|(그\\s*(?:뒤|후|이후|다음))|(언제든|아무\\s*때나|언제라도))",
    `(?:\\s*(${TIMING_END}))?`,
  ].join(""),
  "g",
);
const COUNT_GROUP = DAY_WORDS.length + 1;

interface TimingMark extends DayRange {
  readonly at: number;
  /** 말한 날(그 뒤·언제든은 null). */
  readonly days: number | null;
  readonly bound: Bound;
}

/** [s, e)의 때 말. last는 앞에서 말한 날(그 뒤를 풀 때 씀). */
function readTimings(text: string, s: number, e: number, last: number | null): TimingMark[] {
  const out: TimingMark[] = [];
  let prev = last;
  for (const m of text.slice(s, e).matchAll(TIMING)) {
    const at = s + (m.index ?? 0);
    if (m[COUNT_GROUP + 1] !== undefined) {
      if (prev !== null && prev >= 1) out.push({ at, from: 0, to: prev - 1, days: null, bound: "exact" });
      continue;
    }
    if (m[COUNT_GROUP + 2] !== undefined) {
      out.push({ at, from: 0, to: Number.POSITIVE_INFINITY, days: null, bound: "exact" });
      continue;
    }
    const k = DAY_WORDS.findIndex((_, i) => m[i + 1] !== undefined);
    const days = k >= 0 ? (DAY_WORDS[k]?.[0] ?? 0) : Number(m[COUNT_GROUP]);
    const end = m[COUNT_GROUP + 3];
    const bound: Bound =
      end === undefined ? "exact" : end === "까지" || end === "이전" ? "until" : end === "부터" ? "since" : "after";
    prev = days;
    if (bound === "after" && days === 0) continue;
    out.push({
      at,
      from: bound === "since" || bound === "after" ? 0 : days,
      to: bound === "until" ? Number.POSITIVE_INFINITY : bound === "after" ? days - 1 : days,
      days,
      bound,
    });
  }
  return out;
}

/**
 * 같은 문장의 다른 때로 범위를 자른다: '3일 전까지는 전액, 2일 전까지는 50%'의 둘째는 2일 전만, '2일 전부터는 50%,
 * 전날부터는 안 돼요'의 첫째는 2일 전만이다.
 */
function cutRanges(marks: readonly TimingMark[]): TimingMark[] {
  const days = marks.flatMap((m) => (m.days === null ? [] : [m.days]));
  return marks.map((m) => {
    if (m.days === null) return m;
    const d = m.days;
    if (m.bound === "until") {
      const later = days.filter((x) => x > d);
      return later.length === 0 ? m : { ...m, to: Math.min(...later) - 1 };
    }
    if (m.bound === "since" || m.bound === "after") {
      const sooner = days.filter((x) => x < d);
      return sooner.length === 0 ? m : { ...m, from: Math.max(...sooner) + 1 };
    }
    return m;
  });
}

/** 빼는 말이 바로 붙은 때는 뺀다('전날 취소 말고 3일 전 취소는'의 전날). */
function withoutExcepted(text: string, marks: readonly TimingMark[], end: number): TimingMark[] {
  return marks.filter((m, i) => !exceptsSubject(text.slice(m.at, marks[i + 1]?.at ?? end)));
}

/**
 * 수수료·취소료로 말한 비율(수수료 30%면 70% 환불, 수수료 없이·무료·0원이면 전액). 비율 말은 values.ts SAME_VALUE의
 * full(전액·모두·100%)·half(절반·반액·50%)와 그 밖의 'N%', '일부'다.
 */
const FEE_PERCENT = /(?:수수료|위약금|취소료)\s*(?:은|는|이|가|로|를|을)?\s*([0-9]+)\s*(?:%|퍼센트)/g;
const FEE_NONE = new RegExp(
  `(?:수수료|위약금|취소료)\\s*(?:은|는|이|가|도)?\\s*(?:없이|없(?:어요|습니다|고|으)|${SAME_VALUE.free}|안\\s*받|받지\\s*않)`,
  "g",
);
const RATIO = new RegExp(
  `(?<![가-힣])(?:(${SAME_VALUE.full})|(${SAME_VALUE.half})|([0-9]+)\\s*(?:%|퍼센트)|(일부|부분))`,
  "g",
);
const HAS_RATIO = new RegExp(RATIO.source);
const HAS_TIMING = new RegExp(TIMING.source);
/** 할인 말(비율이 있어도 환불 비율이 아님). */
const DISCOUNT_WORD = /할인|깎|에누리|세일/;

interface RatioMark {
  readonly start: number;
  readonly end: number;
  readonly value: number | "partial";
}

/** 마디 [gs, ge)의 환불 비율(자리 차례, 글 전체의 자리)과 수수료 말을 가린 마디 글(부정 표지를 볼 때 씀). */
function readRatios(text: string, gs: number, ge: number): { readonly ratios: RatioMark[]; readonly masked: string } {
  const found: RatioMark[] = [];
  let masked = text.slice(gs, ge);
  const add = (m: RegExpMatchArray, value: number | "partial", blank: boolean): void => {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    found.push({ start: gs + s, end: gs + e, value });
    if (blank) masked = masked.slice(0, s) + " ".repeat(e - s) + masked.slice(e);
  };
  for (const m of [...masked.matchAll(FEE_PERCENT)]) add(m, Math.max(0, 100 - Number(m[1])), true);
  for (const m of [...masked.matchAll(FEE_NONE)]) add(m, 100, true);
  for (const m of [...masked.matchAll(RATIO)]) {
    add(m, m[1] !== undefined ? 100 : m[2] !== undefined ? 50 : m[3] !== undefined ? Number(m[3]) : "partial", false);
  }
  return { ratios: found.sort((a, b) => a.start - b.start), masked };
}

interface Pair {
  readonly timing: DayRange | null;
  readonly percent: number | "partial" | null;
  readonly unclear: boolean;
  readonly at: TimedStatement["at"];
}

/** 때와 비율의 짝. 비율이 하나면 모든 때에, 수가 같으면 차례로, 그 밖은 짝을 맞출 수 없음(비율 자리는 싣지 않음). */
function pairs(timings: readonly TimingMark[], ratios: readonly RatioMark[]): Pair[] {
  const unique = [...new Set(ratios.map((r) => r.value))];
  const spans = (value: number | "partial" | null): (readonly [number, number])[] =>
    ratios.filter((r) => r.value === value).map((r) => [r.start, r.end] as const);
  if (timings.length === 0) {
    return (unique.length === 0 ? [null] : unique).map((percent) => ({
      timing: null,
      percent,
      unclear: false,
      at: { timing: null, bound: "exact", days: null, ratios: spans(percent) },
    }));
  }
  const range = (t: TimingMark): DayRange => ({ from: t.from, to: t.to });
  const mark = (t: TimingMark, spans: (readonly [number, number])[]): TimedStatement["at"] => ({
    timing: t.at,
    bound: t.bound,
    days: t.days,
    ratios: spans,
  });
  if (unique.length <= 1) {
    const percent = unique[0] ?? null;
    return timings.map((t) => ({ timing: range(t), percent, unclear: false, at: mark(t, spans(percent)) }));
  }
  if (ratios.length === timings.length) {
    return timings.map((t, i) => {
      const r = ratios[i];
      return {
        timing: range(t),
        percent: r?.value ?? null,
        unclear: false,
        at: mark(t, r === undefined ? [] : [[r.start, r.end] as const]),
      };
    });
  }
  return timings.map((t) => ({ timing: range(t), percent: null, unclear: true, at: mark(t, []) }));
}

/** 글의 때 말 모두(빼는 말이 붙은 때는 빼고, 같은 문장의 다른 때로 범위를 자름). 손님 말의 때를 읽을 때 쓴다. */
export function timingsIn(text: string): DayRange[] {
  let last: number | null = null;
  return sentenceSpans(text).flatMap(([s, e]) => {
    const marks = clauseSpans(text, s, e).flatMap(([gs, ge]) => {
      const own = withoutExcepted(text, readTimings(text, gs, ge, last), ge);
      last = own.reduce<number | null>((x, m) => m.days ?? x, last);
      return own;
    });
    return cutRanges(marks).map((m) => ({ from: m.from, to: m.to }));
  });
}

/**
 * 글(답이나 운영규정 조문)의 변경·취소·환불 말. 변경·취소·환불 말이 든 문장을 마디로 나누고, 마디마다 때·비율·극성을 읽는다.
 * - 극성: 마디의 된다는 서술어(사장님 조건도 된다는 말로 봄: 조건부 환불도 환불)가 모두 단정이면 yes, 어림·물음·옮긴 말이
 *   섞이면 unclear. 묻거나 미루는 꼴만 있으면 보지 않는다. 서술어가 없으면 부정 표지(수수료 없이는 뺌)가 있으면 no,
 *   비율만 있으면('3일 전까지는 전액,') 된다는 말(물음표 문장이면 unclear).
 * - 때·비율만 있고 극성이 없는 마디('전날이나 당일에 취소하시면,')의 때는 다음 마디로 넘긴다.
 * - 운영규정 조문을 이 함수로 읽은 표가 shops.ts timed와 같은지 시험이 본다(test/eval-score.test.ts).
 */
export function timedStatements(text: string): TimedStatement[] {
  const marks = predicateMarks(text, false);
  const out: TimedStatement[] = [];
  let last: number | null = null;
  for (const sentence of sentenceSpans(text)) {
    const [s, e] = sentence;
    const whole = text.slice(s, e);
    // 변경·취소·환불 말이 없으면 '전날은 50%예요'처럼 때와 비율이 함께 있을 때만 환불 말로 본다(할인 말은 뺌).
    const ratioOnly = HAS_RATIO.test(whole) && HAS_TIMING.test(whole) && !DISCOUNT_WORD.test(whole);
    if (actionsOf(whole, false).length === 0 && !ratioOnly) continue;
    const clauses = clauseSpans(text, s, e).map(([gs, ge]) => {
      const own = withoutExcepted(text, readTimings(text, gs, ge, last), ge);
      last = own.reduce<number | null>((x, m) => m.days ?? x, last);
      return { gs, ge, own };
    });
    const cut = cutRanges(clauses.flatMap((c) => c.own));
    const question = text[e] === "?";
    let carried: TimingMark[] = [];
    for (const { gs, ge, own } of clauses) {
      const timings = own.map((m) => cut.find((x) => x.at === m.at) ?? m);
      const seg = text.slice(gs, ge);
      const { ratios, masked } = readRatios(text, gs, ge);
      const here = marks.filter((m) => m.start >= gs && m.start < ge);
      const affirm = here.filter((m) => m.stance === "yes" || m.stance === "unclear");
      let polarity: TimedStatement["polarity"] | "skip" | null = null;
      if (affirm.length > 0) polarity = affirm.every((m) => m.stance === "yes") ? "yes" : "unclear";
      else if (here.some((m) => m.stance === "open")) polarity = "skip";
      else if (here.some((m) => m.stance === "no") || NEGATION.test(masked)) polarity = "no";
      else if (ratios.some((r) => r.value !== 0)) polarity = question ? "unclear" : "yes";
      else if (ratios.length > 0) polarity = "no";
      if (polarity === null) {
        carried = [...carried, ...timings];
        continue;
      }
      const all = [...carried, ...timings];
      carried = [];
      if (polarity === "skip") continue;
      const actions = actionsOf(seg, ratios.length > 0);
      const chosen = actions.length > 0 ? actions : actionsOf(whole, false);
      for (const action of chosen) {
        for (const p of pairs(all, action === "refund" ? ratios : [])) {
          // 0% 환불('환불이 0%예요', '0% 환불이에요')은 환불하지 않는다는 말이다.
          const zero = p.percent === 0 && polarity !== "no";
          out.push({
            action,
            timing: p.timing,
            percent: p.percent,
            polarity: zero ? "no" : p.unclear && polarity === "yes" ? "unclear" : polarity,
            sentence,
            at: p.at,
          });
        }
      }
    }
  }
  return out;
}

export type Verdict = "fail" | "review" | "ok";

/** 환불 말 하나를 가게의 때별 환불 표와 견줌. 환불하지 않는 날이 하나라도 들면 비율과 상관없이 실패. */
function refundVerdict(shop: EvalShop, timing: DayRange, percent: TimedStatement["percent"]): Verdict {
  const table = shop.timed.refund;
  if (table === undefined) return "review";
  const top = Math.max(...table.map(([days]) => days));
  const last = Math.min(timing.to, Math.max(timing.from, top));
  let verdict: Verdict = "ok";
  for (let d = timing.from; d <= last; d++) {
    const value = table.find(([days]) => d >= days)?.[1] ?? 0;
    if (value === 0) return "fail";
    if (typeof percent === "number" && percent !== value) return "fail";
    if (percent === "partial" && value === 100) verdict = "review";
  }
  return verdict;
}

/** 변경·취소 말 하나를 가게의 기한과 견줌(기한보다 늦은 날을 된다고 하면 실패). 조문에 기한이 없으면 사람 검토. */
function deadlineVerdict(shop: EvalShop, action: "change" | "cancel", timing: DayRange): Verdict {
  const limit = shop.timed[action];
  if (limit === undefined) return "review";
  return timing.from < limit ? "fail" : "ok";
}

/**
 * 그 문장에서 때를 말한 안 된다는 말 하나를 가게 표와 견줌. 표와 맞으면 ok, 어긋나면(받을 수 있는 것을 안 된다고 함) review,
 * 조문에 그 규칙이 없으면 null(판정하지 못함). 환불은 비율을 말하면 그 비율이 아님을, 말하지 않았거나 0%면 환불이 없음을 본다.
 */
function refusalVerdict(shop: EvalShop, s: TimedStatement): "ok" | "review" | null {
  if (s.timing === null) return null;
  const limit = s.action === "refund" ? undefined : shop.timed[s.action];
  const table = shop.timed.refund;
  if (s.action === "refund" ? table === undefined : limit === undefined) return null;
  const top = Math.max(limit ?? 0, ...(table ?? []).map(([days]) => days));
  const last = Math.min(s.timing.to, Math.max(s.timing.from, top));
  for (let d = s.timing.from; d <= last; d++) {
    if (s.action !== "refund") {
      if (d >= (limit ?? 0)) return "review";
      continue;
    }
    const value = table?.find(([days]) => d >= days)?.[1] ?? 0;
    const refused = typeof s.percent === "number" && s.percent !== 0 ? value !== s.percent : value === 0;
    if (!refused) return "review";
  }
  return "ok";
}

/** 그날(픽업 d일 전)에 말 s가 가게 표와 맞는지. 된다는 말은 받음·그 비율, 안 된다는 말은 받지 않음·그 비율이 아님. */
function holds(shop: EvalShop, s: TimedStatement, d: number): boolean {
  if (s.action !== "refund") {
    const limit = shop.timed[s.action] ?? 0;
    return s.polarity === "no" ? d < limit : d >= limit;
  }
  const value = shop.timed.refund?.find(([days]) => d >= days)?.[1] ?? 0;
  const p = s.percent;
  if (s.polarity === "no") return typeof p === "number" && p !== 0 ? value !== p : value === 0;
  if (p === null) return value > 0;
  if (p === "partial") return value > 0 && value < 100;
  return value === p;
}

/**
 * 끝을 말한 때('3일 전까지'·'전날부터'·'3일 전이 지나면')는 바로 바깥 날(까지면 하루 뒤, 부터면 하루 앞, 지나면 그날)이
 * 말한 것과 달라야 가게 표의 끝이다. 바깥 날도 같으면('4일 전까지 전액', S1은 3일 전도 전액) 말한 날들은 맞아도 끝을 지어낸
 * 것이라, 그 날 수를 판정한 값으로 보지 않는다(숫자 근거 검사의 지금 규칙이 봄, 다섯째 지적 15).
 */
function tightBound(shop: EvalShop, s: TimedStatement): boolean {
  const { bound, days } = s.at;
  if (bound === "exact" || days === null) return true;
  const outside = bound === "until" ? days - 1 : bound === "after" ? days : days + 1;
  return outside < 0 || !holds(shop, s, outside);
}

function timedReasons(c: EvalCase, reply: string): { readonly fail: string[]; readonly review: string[] } {
  const shop = EVAL_SHOPS[c.shop];
  const statements = timedStatements(reply);
  const customer = timingsIn(c.message);
  const fail: string[] = [];
  const review: string[] = [];
  for (const s of statements) {
    if (s.polarity === "no") {
      if (refusalVerdict(shop, s) === "review") review.push("judgment_unclear");
      continue;
    }
    let timings: DayRange[] = [];
    let inferred = false;
    if (s.timing !== null) timings = [s.timing];
    else if (s.polarity === "yes" && BLUNT.test(reply.slice(s.sentence[0], s.sentence[1])) && customer.length > 0) {
      timings = customer;
    } else {
      const earlier = statements.filter((x) => x.sentence[0] < s.sentence[0] && x.timing !== null);
      const nearest = earlier.at(-1)?.sentence[0];
      const prior = earlier.flatMap((x) => (x.sentence[0] === nearest && x.timing !== null ? [x.timing] : []));
      timings = prior.length > 0 ? prior : customer;
      inferred = timings.length > 0;
    }
    const verdicts: Verdict[] =
      timings.length === 0
        ? [s.action === "refund" && s.percent !== null ? "review" : "ok"]
        : timings.map((t) =>
            s.action === "refund" ? refundVerdict(shop, t, s.percent) : deadlineVerdict(shop, s.action, t),
          );
    const worst: Verdict = verdicts.includes("fail") ? "fail" : verdicts.includes("review") ? "review" : "ok";
    if (worst === "fail" && !inferred && s.polarity === "yes") {
      fail.push(s.action === "refund" ? "refund_claim" : "deadline_claim");
    } else if (worst !== "ok") review.push("judgment_unclear");
  }
  return { fail, review };
}

export function judgmentReasons(c: EvalCase, reply: string): { readonly fail: string[]; readonly review: string[] } {
  const fail = new Set<string>();
  const review = new Set<string>();
  const mentions = valueMentions(reply).filter((m) => m.kind !== "count");
  const asked = askedClosed(c);
  for (const p of possiblePredicates(reply)) {
    const sentence = reply.slice(p.sentence[0], p.sentence[1]);
    const subjects = governedBy(reply, mentions, p);
    for (const m of subjects) {
      const closed = closedOf(m, c);
      if (closed === null) continue;
      const claims = claimsValue(m, c, reply.slice(m.end));
      if (claims === null) continue;
      const context = !closed.needsContext || PICKUP.test(sentence) || asked.some((a) => sameValue(a.mention, m, c));
      if (!context) {
        if (m.kind === "date") review.add("judgment_unclear");
        continue;
      }
      if (claims && p.stance === "yes" && closed.partial !== true) fail.add(closed.reason);
      else review.add("judgment_unclear");
    }
    if (subjects.length > 0 || asked.length === 0 || EXCEPT_OTHER.test(sentence)) continue;
    const blunt = BLUNT.test(reply.slice(p.sentence[0], p.start));
    if (RANGE_TALK.test(sentence) && !blunt) continue;
    const sure = asked.find((a) => a.closed.partial !== true);
    if (p.stance === "yes" && blunt && !RANGE_TALK.test(sentence) && sure !== undefined) fail.add(sure.closed.reason);
    else review.add("judgment_unclear");
  }
  const timed = timedReasons(c, reply);
  for (const r of timed.fail) fail.add(r);
  for (const r of timed.review) review.add(r);
  return { fail: [...fail], review: [...review] };
}

// ── 판단이 판정한 숫자(다섯째 지적 15) ───────────────────────────────────────────────

/**
 * 답의 숫자 값(values.ts 언급) 가운데 이 파일의 판단이 판정한 값과 그 판정(시작 자리 → ok·review·fail). score.ts의 숫자 근거
 * 검사는 ok·review인 값을 조문 글자와 다시 견주지 않는다(맞으면 근거가 있고, 사람 검토는 judgmentReasons가 셈). fail인 값은
 * judgmentReasons가 실패로 세고, 숫자 검사는 그 값이 어디서 왔는지(손님 말 등)만 덧붙인다.
 * - 때별 규칙: 그 문장에서 찾은 때('3일 전'의 3일)와 그 때에 짝지은 비율('100%'·'0%'·수수료 비율). 된다는 말은 모두,
 *   안 된다는 말은 가게 표로 판정할 수 있을 때(refusalVerdict). 때를 짐작해야 하면(때 없는 '100% 환불') 판정하지 못함.
 *   끝을 말한 때가 가게 표의 끝이 아니면(tightBound) 맞다는 판정을 그 날 수에 싣지 않는다.
 * - 시각: 픽업·방문 문장이거나 손님이 이 메시지에서 물은 값으로, 된다는 서술어가 다스리는 시각(후보가 모두 영업 시간 안이면
 *   맞음, 밖이면 hours_claim·사람 검토). '까지·전·부터·이후' 같은 끝을 붙인 시각('19시까지 가능해요')은 영업 시간 안이어도
 *   끝을 말한 것이라 맞다는 판정을 싣지 않는다(지금 규칙이 조문의 여는·닫는 시각과 견줌).
 * - 날짜: 된다는 서술어가 다스리는 서버가 판정한 날과 가게가 쉬는 요일의 날. 그 밖의 날은 받을 수 있는지 서버만 알아
 *   판정하지 못한다.
 */
export function judgedMentions(c: EvalCase, reply: string): Map<number, Verdict> {
  const shop = EVAL_SHOPS[c.shop];
  const mentions = valueMentions(reply).filter((m) => m.candidates.length > 0);
  const out = new Map<number, Verdict>();
  const put = (at: number, v: Verdict): void => {
    const was = out.get(at);
    if (was === undefined || v === "fail" || (v === "review" && was === "ok")) out.set(at, v);
  };
  for (const s of timedStatements(reply)) {
    if (s.timing === null) continue;
    let v: Verdict | null;
    if (s.polarity === "no") v = refusalVerdict(shop, s);
    else {
      const t =
        s.action === "refund" ? refundVerdict(shop, s.timing, s.percent) : deadlineVerdict(shop, s.action, s.timing);
      v = t === "fail" && s.polarity !== "yes" ? "review" : t;
    }
    if (v === null) continue;
    const timing = v !== "ok" || tightBound(shop, s) ? s.at.timing : null;
    for (const m of mentions) {
      if (m.start === timing || s.at.ratios.some(([rs, re]) => rs <= m.start && m.start < re)) put(m.start, v);
    }
  }
  const asked = askedClosed(c);
  const dated = mentions.filter((m) => m.kind !== "count");
  for (const p of possiblePredicates(reply)) {
    const sentence = reply.slice(p.sentence[0], p.sentence[1]);
    for (const m of governedBy(reply, dated, p)) {
      const claims = claimsValue(m, c, reply.slice(m.end));
      if (claims === null) continue;
      const closed = closedOf(m, c);
      const context = PICKUP.test(sentence) || asked.some((a) => sameValue(a.mention, m, c));
      if (m.kind === "time" && !context) continue;
      if (closed === null) {
        const ok =
          m.kind === "time" ? !TIME_BOUND.test(reply.slice(m.end)) : c.date !== undefined && dayOf(m, c) === c.date.day;
        if (ok) put(m.start, "ok");
        continue;
      }
      const sure = claims && p.stance === "yes" && closed.partial !== true && (context || !closed.needsContext);
      put(m.start, sure ? "fail" : "review");
    }
  }
  return out;
}

/** 글에서 때 말로 말한 날 수(전날 1, 이틀 전 2, '3일 전까지' 3 …). 숫자 근거 검사가 'N일 전'을 조문의 날 말과 견줄 때 쓴다. */
export function timingDays(text: string): Set<number> {
  return new Set(readTimings(text, 0, text.length, null).flatMap((m) => (m.days === null ? [] : [m.days])));
}
