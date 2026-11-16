/**
 * 서버 판단과 답 견주기(TASK-027; '가게 규칙에 없는 지어낸 답' 잣대, SPEC-014 날짜 판정, 운영규정의 영업 시간·쉬는 요일).
 *
 * 답의 날짜·요일·시각을 values.ts로 같은 값으로 읽은 뒤, 그 값을 된다고 하는 서술어가 있는지 본다. 입력에 같은 값이 있다는
 * 것만으로는 근거가 되지 않는다: 근거는 그 값의 판단(받을 수 있음·없음)까지 맞아야 한다.
 *
 * - 받을 수 없는 날: 서버 날짜 판정이 '받을 수 없음'인 날(어떤 표기든, 요일·'그날' 포함)과 가게가 쉬는 요일의 날.
 * - 영업 시간 밖: 시각의 후보가 모두 운영규정의 영업 시간 밖인 값(말로 한 '8시'는 20:00이 안이라 걸리지 않음).
 * - 서술어(가능해요·돼요·받아요·오셔도 돼요·…하실 수 있어요)가 다스리는 값만 본다(values.ts governed). '21일은 안 되고
 *   일요일은 돼요'의 '돼요'는 일요일만 말한다.
 * - 쉬는 요일과 시각은 픽업·방문을 말하는 문장이거나 손님이 이 메시지에서 물은 값일 때만 실패로 본다(결제 기한 같은 다른
 *   시각과 섞이지 않게). 쉬는 요일을 그 밖의 문장(주문 가능)에서 된다고 하면 사람 검토, 시각이면 보지 않는다. 서버가 판정한
 *   날은 어느 문장이든 본다.
 * - 실패(closed_day_claim·hours_claim): 그 값을 된다고 함. 손님이 하는 일의 조건(오시면·결제하시면)이 붙어도 실패.
 * - 사람 검토(judgment_unclear): 사장님 확인 조건(사장님이 확인하면 …가능해요), 물음표로 끝나는 문장, 남의 말을 옮긴 꼴
 *   (…가능하다고 하셨는데), 서술어 뒤 같은 절의 부정(가능 날짜가 아니에요), 꾸미는 꼴(가능한 날은), 어림(가능할 수 있어요),
 *   날짜 뒤의 '까지', 영업 시간과 겹치는 '이후·전'.
 * - 손님이 이 메시지에서 받을 수 없는 날·시각을 물었는데 답이 값 없이 '네, 가능해요'라고 하면 실패, 값 없이 된다고만 하면
 *   사람 검토다('다른 날은 가능해요'처럼 다른 값을 말하면 보지 않음).
 * - 반대로 받을 수 있는 날·시각을 안 된다고 한 답은 여기서 보지 않는다(사람 검토 표본으로 봄).
 */
import { conditionAt, NEGATION, polarityAt, sentenceBounds, withoutUncertainty } from "./polarity";
import { EVAL_SHOPS } from "./shops";
import type { EvalCase } from "./types";
import { governed, type Mention, valueMentions, weekdayOf } from "./values";

// ── 된다고 하는 서술어 ─────────────────────────────────────────────────────────────

/**
 * 그 값을 된다·맞다고 하는 서술어. 극성은 polarity.ts가 가른다. '가능할 수 있어요·될 수도 있어요'(어림)는 앞에 두어
 * 한 서술어로 잡는다.
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
  ].join("|"),
  "g",
);

/** 어림(될지도 모름). */
const HEDGE = /^(?:가능할|될)\s*수/;

/** '가능한 날은…'처럼 서술어가 이름씨를 꾸미는 꼴(그 값을 된다고 하는지 기계로 가를 수 없음). */
const ADNOMINAL = /^(?:한|하신|할)\s+(?!거|것|겁)[가-힣]/;

/** 서술어 뒤에서 그 서술어의 절이 끝나는 자리(쉼표, -지만·-는데·-고 …). */
const CLAUSE_CUT = /,|(?:지만|는데|은데|니까|으니|어서|아서|해서|하고|이고|고)\s/;

export interface Predicate {
  readonly start: number;
  readonly end: number;
  /** yes: 된다고 함. unclear: 물음표·옮긴 말·사장님 확인 조건·꾸미는 꼴·어림·같은 절의 부정(사람 검토). */
  readonly stance: "yes" | "unclear";
  /** 서술어가 든 문장의 [처음, 끝). */
  readonly sentence: readonly [number, number];
}

/** 답에서 된다고 하는 서술어(부정·묻는 꼴·미루는 꼴은 뺌). 꼴은 모른다는 말을 가린 글에서 찾는다. */
export function possiblePredicates(reply: string): Predicate[] {
  const out: Predicate[] = [];
  for (const p of withoutUncertainty(reply).matchAll(POSSIBLE)) {
    const ps = p.index ?? 0;
    const pe = ps + p[0].length;
    const polarity = polarityAt(reply, ps, pe);
    if (polarity === "no" || polarity === "open") continue;
    const sentence = sentenceBounds(reply, ps);
    const rest = reply.slice(pe, sentence[1]);
    const cut = rest.search(CLAUSE_CUT);
    const unclear =
      polarity === "unclear" ||
      HEDGE.test(p[0]) ||
      ADNOMINAL.test(rest) ||
      NEGATION.test(cut < 0 ? rest : rest.slice(0, cut)) ||
      conditionAt(reply, ps, pe) === "owner";
    out.push({ start: ps, end: pe, stance: unclear ? "unclear" : "yes", sentence });
  }
  return out;
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
const PICKUP =
  /픽업|찾으러|찾아가|찾으실|가지러|가져가|받으러|수령|방문|오시|오셔|오실|와\s*주|들르|들러|영업|문\s*(?:을\s*)?열|여는|열어|가게|매장/;

/** 손님 메시지에서 그 값을 받을 수 있는지 묻는 문장(픽업·방문·주문). */
const ORDER = new RegExp(`${PICKUP.source}|주문|예약|갈게|가도|가면|올게`);

/** 값 없이 된다고 할 때, 손님이 물은 값이 아닌 다른 값을 말하는 꼴. */
const EXCEPT_OTHER =
  /다른\s*(?:날|요일|시간|시각|때)|가능(?:한)?\s*(?:날|요일|시간|시각|일정)|그\s*외|외의|나머지|영업\s*시간|운영\s*시간|시간\s*(?:안|내|중)|말고|빼고|제외|대신/;

/** 첫머리(또는 쉼표 뒤)부터 된다는 대답(네, 가능해요 / 21일이요, 네 가능해요). */
const BLUNT = /(?:^|,)\s*(?:네|넵|예|물론(?:이죠|입니다|이에요)?|당연(?:히|하죠|합니다)?|그럼요|그럼)(?=[\s,!.]|$)/;

type Reason = "closed_day_claim" | "hours_claim";

interface Closed {
  readonly reason: Reason;
  /** 픽업·방문 문장이거나 손님이 물은 값이어야 실패로 보는지(쉬는 요일·영업 시간). 서버가 판정한 날은 false. */
  readonly needsContext: boolean;
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
    if (minutes.length > 0 && minutes.every((x) => x < open || x > close)) {
      return { reason: "hours_claim", needsContext: true };
    }
  }
  return null;
}

/**
 * 값 바로 뒤의 말로 그 값을 된다고 한 것인지. 날짜 뒤 '전·후·다음'은 그날이 아니라 건너뛰고(null), '까지'는 사람 검토(false).
 * 시각 뒤 '이후·넘어'는 그 시각이 마감 뒤일 때만, '전'은 여는 시각 앞일 때만 단정(그 밖은 영업 시간과 겹쳐 사람 검토).
 */
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
      if (claims && p.stance === "yes") fail.add(closed.reason);
      else review.add("judgment_unclear");
    }
    const first = asked[0];
    if (subjects.length === 0 && first !== undefined && !EXCEPT_OTHER.test(sentence)) {
      if (p.stance === "yes" && BLUNT.test(reply.slice(p.sentence[0], p.start))) fail.add(first.closed.reason);
      else review.add("judgment_unclear");
    }
  }
  return { fail: [...fail], review: [...review] };
}
