/**
 * 평가 세트의 개인정보 훑기(TASK-027; REQ-139, SPEC-021).
 *
 * - AI 모델이 받는 대화는 마스킹한 글이라(SPEC-021) 사례의 번호는 플레이스홀더 꼴([전화번호1]·[계좌번호1]·[카드번호1]·[긴숫자1])만 쓴다.
 * - 그 밖의 전화번호·계좌번호·카드번호·주민등록번호처럼 보이는 숫자, 9자리가 넘는 숫자, 이메일, 합성 주소(.invalid·.test)가 아닌
 *   주소, 한글로 적은 전화번호 첫머리는 모두 찾은 것으로 친다. 결과에는 위치(사례·필드)와 종류만 싣고 값은 싣지 않는다.
 * - 날짜(2026-11-20)와 시각(14:00)은 숫자 길이를 셀 때 뺀다.
 */
import { EVAL_SHOPS } from "./shops";
import type { EvalCase } from "./types";

export const PLACEHOLDER = /\[(?:전화번호|계좌번호|카드번호|긴숫자)[0-9]{1,3}\]/g;

const CHECKS: readonly (readonly [string, RegExp])[] = [
  ["unknown_placeholder", /\[[가-힣 ]+[0-9]+\]/],
  ["phone", /(?<![0-9])(?:\+?82[-.\s]?)?0[0-9]{1,2}[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{4}(?![0-9])/],
  ["resident_number", /(?<![0-9])[0-9]{6}\s*-\s*[1-8][0-9]{6}(?![0-9])/],
  ["long_number", /(?<![0-9])(?:[0-9][\s-]?){9,}/],
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["hangul_phone", /공일공|영일영|공이\s*[일이삼사오육칠팔구]/],
];

const URL = /https?:\/\/([^/\s)]+)[^\s)]*/g;

export interface ScanFinding {
  readonly caseId: string;
  readonly field: string;
  readonly kind: string;
}

/** 글 하나에서 찾은 종류(값 없음). */
export function scanText(text: string): string[] {
  const kinds: string[] = [];
  for (const m of text.matchAll(URL)) {
    const host = (m[1] ?? "").toLowerCase();
    if (!host.endsWith(".invalid") && !host.endsWith(".test")) kinds.push("url");
  }
  const rest = text
    .replace(URL, " ")
    .replace(PLACEHOLDER, " ")
    .replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}/g, " ")
    .replace(/[0-9]{1,2}:[0-9]{2}/g, " ");
  for (const [kind, re] of CHECKS) if (re.test(rest)) kinds.push(kind);
  return kinds;
}

/** 사례가 AI에 보낼 수 있는 글(손님 말·지난 대화·초안·주문 요약·계산값)을 모두 본다. */
export function caseTexts(c: EvalCase): readonly (readonly [string, string])[] {
  const out: [string, string][] = [["message", c.message]];
  c.history.forEach((t, i) => {
    out.push([`history[${i}]`, t.text]);
  });
  if (c.draft !== undefined) out.push(["draft", JSON.stringify(c.draft)]);
  if (c.mockDraft !== undefined) out.push(["mockDraft", JSON.stringify(c.mockDraft)]);
  c.orders?.forEach((o, i) => {
    out.push([`orders[${i}]`, `${o.orderNo} ${o.summary} ${o.changeDeadline ?? ""}`]);
  });
  if (c.quote !== undefined) out.push(["quote", `${c.quote.options} ${c.quote.validUntil ?? ""}`]);
  return out;
}

export function scanCases(cases: readonly EvalCase[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const c of cases) {
    for (const [field, text] of caseTexts(c)) {
      for (const kind of scanText(text)) findings.push({ caseId: c.id, field, kind });
    }
  }
  return findings;
}

/** 합성 가게(이름·운영규정·처리방침 주소)도 본다. */
export function scanShops(): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const shop of Object.values(EVAL_SHOPS)) {
    const texts: [string, string][] = [
      ["name", shop.name],
      ["policyUrl", shop.policyUrl],
      ...shop.articles.map((a) => [`article${a.no}`, `${a.title} ${a.text}`] as [string, string]),
    ];
    for (const [field, text] of texts) {
      for (const kind of scanText(text)) findings.push({ caseId: shop.key, field, kind });
    }
  }
  return findings;
}
