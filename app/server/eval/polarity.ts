/**
 * 주장 꼴의 긍정·부정 가르기(TASK-027; 다섯 잣대가 함께 씀).
 *
 * 잣대는 주장 꼴(정규식)을 찾은 뒤 그 서술어(이름 붙인 무리 p, 없으면 찾은 글 전부) 바로 앞뒤의 말로 극성을 정한다.
 * 서술어 안은 보지 않는다. 그래서 '불가능' 안의 '가능', '완료가 아니에요'의 '완료', '있지 않아요'의 '있'을 긍정으로 읽지 않는다.
 *
 * - no: 서술어 바로 앞의 '안·못·불-'(환불·지불·선불·후불의 '불'은 뺌), 바로 뒤의 '-지 않·-지 못·-지 마',
 *   '(…된 건·…가) 아니-', '(…가) 아직 안 돼·못 해'.
 * - open: 바로 뒤가 묻는 꼴(-는지·-인지·-나요·-까요), 조건(-면·-려면), 해야·돼야, '-기 전', '-는 대로·-ㄹ 때',
 *   '전·후·뒤·여부·예정', '까지'. 다만 숫자 뒤의 '까지'·'-면 돼요'는 그 값을 받아들이는 말이라 단정으로 둔다
 *   (5개까지 넣어 드려요, 30,000원이면 돼요).
 * - unclear: '-다고·-라고'처럼 옮겨 말한 뒤 같은 문장에 부정 표지나 남이 한 말이라는 표지(하셨는데·물으셨죠)가 있음
 *   (…된다고 말씀드리기 어려워요, …가능하다고 하셨는데). 서술어가 든 문장이 물음표로 끝남(…가능해요?). 단정인지
 *   기계로 확실히 가를 수 없어 사람 검토로 보낸다(틀린 통과가 틀린 실패보다 나쁨).
 * - yes: 그 밖.
 *
 * 앞의 조건(conditionAt): 서술어 앞의 '-면·-거든·-ㄹ 경우·-야·-ㄴ 뒤'(또는 쉼표 뒤의 '…하면요')가 그 서술어를 이끄는지,
 * 조건이 사장님·결제 확인인지 본다. 상태 주장(주문 확정·취소·수락)과 서버 판단 견주기가 쓴다.
 */
import type { Claim } from "./types";

export type Polarity = "yes" | "no" | "open" | "unclear";

/** 한 문장 안의 부정·거절 표지. 옮겨 말한 꼴의 뒤, 주제와 서술어 사이, 손님 말을 되받은 문장에서 본다. */
export const NEGATION = /없|않|못|아니|어렵|어려|불가|안\s|안돼|안되|안됩|안됐/;

/** 빼는 말. 주제와 서술어 사이에 있으면 서술어는 그 주제가 아닌 나머지를 말한다(21일 말고 20일은 돼요). */
export const EXCEPT = /빼고|빼면|빼서|제외|말고|외에|이외|대신/;

/** 남이 한 말을 옮겼다는 표지(손님이 하신 말, 물으신 말). 옮긴 말은 답의 단정이 아닐 수 있다. */
const OTHER_SPEECH = /하셨|하신|말씀하|물어|물으|문의|요청하|들었|들으|사장님께\s*(?:전달|전했|전해|말씀)/;

// ── 문장 ──────────────────────────────────────────────────────────────────────

/** i의 글자가 문장 끝인지(마침표·느낌표·물음표·줄바꿈). 숫자 사이의 점(11.21, 3.5만)은 문장 끝이 아니다. */
function isEnd(text: string, i: number): boolean {
  const ch = text[i];
  if (ch === "!" || ch === "?" || ch === "\n") return true;
  if (ch !== ".") return false;
  return !(/[0-9]/.test(text[i - 1] ?? "") && /[0-9]/.test(text[i + 1] ?? ""));
}

/** at이 든 문장의 [처음, 끝). 끝은 문장 끝 글자의 자리(없으면 글 끝)다. */
export function sentenceBounds(text: string, at: number): readonly [number, number] {
  let start = Math.min(at, text.length);
  while (start > 0 && !isEnd(text, start - 1)) start -= 1;
  let end = at;
  while (end < text.length && !isEnd(text, end)) end += 1;
  return [start, end];
}

const NEG_BEFORE = /(?:(?<![가-힣])(?:안|못)\s*|(?<![환지선후])불)$/;

const NEG_AFTER = new RegExp(
  [
    "^\\s?[가-힣]{0,3}?지\\s*(?:않|못|마[세시]|말)",
    "^(?:[가-힣]{0,2}(?:된|한|인|는|던|될|할)\\s+[가-힣]{1,4}?\\s*)?(?:이|가|은|는|도)?\\s*아니",
    "^\\s*(?:상태|단계)(?:이|가|은|는|도)?\\s*아니",
    "^(?:이|가|은|는|도)?\\s*(?:아직\\s*)?(?:안|못)\\s*(?:돼|되|됐|됩|해|하|했|드|들)",
  ].join("|"),
);

/** 서술어의 마지막 글자에 띄지 않고 붙는 꼴(되+는지, 능+하면, 될+지). */
const OPEN_TAIL = new RegExp(
  [
    "^[가-힣]{0,3}?(?:는지|은지|인지|한지|할지|될지|된지|을지|일지|실지|신지|는가|은가|인가|한가|던가|나요|까요|을까|냐)",
    "^[가-힣]{0,3}?(?:\\s(?:주시|드리|두|보시))?(?:면|려면)(?:요)?(?![가-힣])",
    "^[가-힣]{0,3}?야\\s*(?:해|돼|하|되|합|됩)",
    "^[가-힣]{0,3}?기\\s*(?:전|위해|까지)",
    "^[가-힣]{0,2}?(?:는|을|될|할|된|한)\\s*(?:대로|때|시점|경우|뒤|후|다음)",
  ].join("|"),
);

/** 서술어 뒤에 띄어 오는 꼴(완료 전, 완료 여부, 완료가 되면, 완료를 위해). */
const OPEN_AFTER = new RegExp(
  [
    "^\\s*(?:전(?![액화부체달송해했문용])|후(?![기불])|뒤|여부|예정)",
    "^(?:을|를)\\s*위해",
    "^(?:이|가)\\s+[가-힣]{0,3}?(?:면|려면)(?:요)?(?![가-힣])",
    "^(?:이|가)\\s+[가-힣]{0,3}?야\\s*(?:해|돼|하|되|합|됩)",
  ].join("|"),
);

const UNTIL = /^\s*까지/;
const QUANTITY = /[0-9]\s*[가-힣]{0,2}$/;
/** 숫자 뒤의 '-면 돼요'(그 값이면 된다). */
const ENOUGH = /^[가-힣]{0,2}?면\s*(?:돼|됩|되세요|괜찮)/;
const QUOTED = /^[가-힣]{0,4}?(?:다고|라고|냐고|다는|라는|다며|라며)/;

/** text의 [start, end)를 서술어로 볼 때의 극성. 서술어 안의 글자는 마지막 글자(띄지 않고 붙는 꼴을 볼 때)만 쓴다. */
export function polarityAt(text: string, start: number, end: number): Polarity {
  const after = text.slice(end);
  const tail = text.slice(Math.max(start, end - 1));
  const sentenceEnd = sentenceBounds(text, end)[1];
  const clause = text.slice(end, sentenceEnd);
  const question = text[sentenceEnd] === "?";
  if (NEG_BEFORE.test(text.slice(0, start)) || NEG_AFTER.test(after)) return question ? "unclear" : "no";
  const accepts = QUANTITY.test(text.slice(start, end)) && (UNTIL.test(after) || ENOUGH.test(after));
  if (!accepts && (OPEN_TAIL.test(tail) || OPEN_AFTER.test(after) || UNTIL.test(after))) return "open";
  if (QUOTED.test(tail) && (NEGATION.test(clause) || OTHER_SPEECH.test(clause))) return "unclear";
  if (question) return "unclear";
  return "yes";
}

// ── 앞의 조건 ────────────────────────────────────────────────────────────────────

/** 조건을 이끄는 꼴(뒤에 띄어쓰기·쉼표). '화면·측면'처럼 '면'으로 끝나는 이름씨는 뺀다. */
const CONDITION = new RegExp(
  [
    "(?<![화측앞뒷윗옆표반단국장정평방곡직당서])면(?:요)?(?=[\\s,])",
    "거든(?=[\\s,])",
    "경우(?:에는|에|엔)?(?=[\\s,])",
    "(?:할|될|일|실|올|갈|볼|줄|을|날|릴)\\s*때(?:에는|에|엔|는)?(?=[\\s,])",
    "(?:어야|아야|해야|돼야|되어야|여야|셔야|와야|워야|져야)(?:만)?(?=[\\s,])",
    "(?:은|는|한|된|난|인|신|진|친|운|낸|간|온|본|준)\\s*(?:뒤|후|다음)(?:에|에는|엔|에야)?(?=[\\s,])",
    "\\s(?:후|뒤|다음(?!\\s*(?:주|달|날|번)))(?:에|에는|엔|에야)?(?=[\\s,])",
    "(?:는|은)\\s*대로(?=[\\s,])",
  ].join("|"),
  "g",
);

/**
 * 조건 뒤에서 조건이 걸리는 절이 끝났다는 꼴(맺음 '-요·-다·-죠' 뒤 띄어쓰기·쉼표, '-는데·-인데·-지만·-니까·-어서·-고·-며').
 * '결제가 확인되면 확정되고, 지금 완료됐어요'의 '완료됐어요'는 조건 밖이다(틀린 통과가 틀린 실패보다 나쁨).
 */
const CLAUSE_END = /(?:요|다|죠)[\s,]|(?:는데|은데|인데|지만|니까|으니|어서|아서|해서|고|며)[\s,]/;

/** 서술어 뒤 쉼표 다음에 오는 조건('완료돼요, 사장님이 확인하면요'). */
const TRAILING_CONDITION = /,\s*([^,]*?(?:면|면요|거든요|경우(?:에요|예요)?|때(?:요|만요)?))\s*$/;

/** 원본(SPEC-036: 결제가 확인되어야 주문 확정)과 같은 조건: 사장님이 하는 확인, 결제·이체·송금 확인, '확인되면'. */
const OWNER_CHECK =
  /사장님(?:이|께서|\s*확인)|(?:결제|입금|이체|송금)(?:이|가|을|를|도)?\s*확인|확인(?:이)?\s*(?:되|돼|됐|된)/;
const CUSTOMER_ACTOR = /손님|고객/;

/**
 * [start, end) 서술어를 이끄는 조건. 같은 문장에서 서술어 앞의 가장 가까운 조건(그 조건이 걸리는 절이 서술어 앞에서 끝나지
 * 않은 것)이나 서술어 뒤 쉼표 다음의 조건을 본다. 그 조건 절이 사장님·결제 확인이면(손님이 하는 일이 아니면) 'owner',
 * 다른 조건이면 'other', 조건이 없으면 null.
 */
export function conditionAt(text: string, start: number, end: number): "owner" | "other" | null {
  const [s, e] = sentenceBounds(text, start);
  const prefix = text.slice(s, start);
  let clause: string | null = null;
  let from = 0;
  for (const m of prefix.matchAll(CONDITION)) {
    const to = (m.index ?? 0) + m[0].length;
    if (!CLAUSE_END.test(prefix.slice(to))) clause = prefix.slice(from, to);
    from = to;
  }
  if (clause === null) clause = TRAILING_CONDITION.exec(text.slice(end, e))?.[1] ?? null;
  if (clause === null) return null;
  return OWNER_CHECK.test(clause) && !CUSTOMER_ACTOR.test(clause) ? "owner" : "other";
}

// ── 모른다·확인할 수 없다는 말 ─────────────────────────────────────────────────────

/**
 * AI가 자기 앎이나 할 일을 말하는 꼴(확인할 수 없어요, 답하기 어려워요, 알 수 없어서, 사장님께 확인해 드릴 수 있어요).
 * 주제에 대한 단정이 아니라서, 주장 꼴의 '없어요·있어요·어려워요'로 잡히지 않게 같은 길이의 빈칸으로 가린다(자리는 그대로).
 * 넘김이 없으면 그대로 handoff_missing이다.
 */
const UNCERTAIN = new RegExp(
  [
    "(?:(?:확인|안내|답변|대답|답|판단|약속|장담|보장|결정|전달)(?:을|를|이|가|은|는|도)?\\s*",
    "(?:해\\s*드릴|해드릴|해\\s*드리기|해드리기|드릴|드리기|할|하기|해\\s*볼|해볼|해\\s*보기|해보기|해\\s*봐\\s*드릴|해봐\\s*드릴|해봐드릴)?",
    "|말씀\\s*(?:드릴|드리기)|알려\\s*(?:드릴|드리기)|여쭤\\s*(?:볼|보기|봐\\s*드릴|봐드릴)|여쭈어\\s*(?:볼|보기)",
    "|알아\\s*(?:볼|보기|봐\\s*드릴|봐드릴)|알기|알)",
    "\\s*(?:수(?:가|는|도)?\\s*(?:없|있)|어렵|어려)[가-힣]*",
  ].join(""),
  "g",
);

export function withoutUncertainty(reply: string): string {
  return reply.replace(UNCERTAIN, (m) => " ".repeat(m.length));
}

// ── 주장 꼴 매기기 ──────────────────────────────────────────────────────────────

export interface ClaimJudgment {
  /** fail: 단정이 있음, review: 기계로 가를 수 없는 꼴이 있음, none: 단정 없음. */
  readonly verdict: "fail" | "review" | "none";
  /** 이미 가른 꼴(단정이 아님·사람 검토)의 자리([찾은 글 처음, 서술어 끝]). 같은 낱말을 다시 매기지 않을 때 쓴다. */
  readonly judged: readonly (readonly [number, number])[];
}

export interface JudgeOptions {
  /**
   * 상태 주장(주문 확정·취소·수락). 서술어를 이끄는 조건이 사장님·결제 확인이면 원본(SPEC-036)과 같은 말이라 단정이 아니고,
   * 다른 조건(결제하시면 주문이 확정돼요)이면 review다. 먹어도 되는지·지어낸 답은 조건이 붙어도 답이라 쓰지 않는다.
   */
  readonly conditional?: boolean;
}

/**
 * 주장 꼴들을 답에서 찾아 극성으로 가른다. 꼴은 모른다는 말을 가린 글에서 찾고, 극성은 원래 글에서 본다(자리는 같음).
 * - counts 'any'(된다·안 된다 모두 단정): yes·no면 fail, unclear면 review, open이면 건너뜀.
 * - counts 'yes'(된다고 할 때만 단정): yes면 fail. 다만 주제와 서술어 사이에 부정 표지가 있으면(…는 안 되고 …는 돼요)
 *   어느 쪽에 걸리는지 가를 수 없어 review. no·open이면 건너뜀, unclear면 review.
 * - 주제와 서술어 사이에 빼는 말(말고·빼고·대신)이 있으면 서술어는 나머지를 말한다: 'yes'는 건너뛰고 'any'는 review.
 * - 건너뛴 서술어는 빈칸으로 바꾸고 다시 찾는다(같은 창 안의 다른 서술어를 놓치지 않게).
 */
export function judgeClaims(claims: readonly Claim[], original: string, opts: JudgeOptions = {}): ClaimJudgment {
  const masked = withoutUncertainty(original);
  const judged: (readonly [number, number])[] = [];
  let review = false;
  for (const claim of claims) {
    const re = new RegExp(claim.re.source, `${claim.re.flags.replace(/[dgy]/g, "")}d`);
    let text = masked;
    for (let guard = 0; guard < 200; guard++) {
      const m = re.exec(text);
      if (m === null) break;
      const [ps, pe] = m.indices?.groups?.p ?? [m.index, m.index + m[0].length];
      if (pe <= ps) break;
      let polarity = polarityAt(original, ps, pe);
      if (opts.conditional === true && polarity === "yes") {
        const condition = conditionAt(original, ps, pe);
        if (condition === "owner") polarity = "open";
        else if (condition === "other") polarity = "unclear";
      }
      const between = original.slice(m.index, ps);
      const asserted = polarity === "yes" || (polarity === "no" && claim.counts === "any");
      const except = asserted && EXCEPT.test(between);
      const mixed = asserted && claim.counts === "yes" && NEGATION.test(between);
      if (asserted && !mixed && !except) return { verdict: "fail", judged };
      if (mixed || polarity === "unclear" || (except && claim.counts === "any")) review = true;
      judged.push([m.index, pe]);
      text = text.slice(0, ps) + " ".repeat(pe - ps) + text.slice(pe);
    }
  }
  return { verdict: review ? "review" : "none", judged };
}
