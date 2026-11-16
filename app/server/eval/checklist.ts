/**
 * 평가 세트의 출처 점검표(REQ-139) 만들기(TASK-027). `npm run eval:checklist -w server`가 eval/source-checklist.md를
 * 다시 쓴다. 생성 파일이라 손으로 고치지 않는다. 시험(test/eval-cases.test.ts)이 저장소의 파일과 지금 만든 글이 같은지 본다.
 *
 * - 점검표에는 사례의 손님 말을 싣지 않는다(사례 글은 cases.ts 한 곳). ID·갈래·겨눈 잣대·가게·근거만 싣는다.
 * - 근거 ID는 02 requirements.md의 REQ 행, 04 spec.md의 SPEC 행과 AI-1 절에 있는지 본다.
 */
import { readFileSync } from "node:fs";
import { CASE_MINIMUMS, EVAL_CASES, EVAL_CASES_VERSION } from "./cases";
import { caseTexts, PLACEHOLDER, scanCases, scanShops } from "./scan";
import { EVAL_SHOPS } from "./shops";
import { CATEGORIES, CATEGORY_LABELS, CRITERIA, CRITERION_LABELS, type EvalCase } from "./types";

/** 저장소 뿌리(app/server/eval/에서 세 단계 위). */
export const REPO_ROOT = new URL("../../../", import.meta.url);
export const CHECKLIST_PATH = new URL("./source-checklist.md", import.meta.url);

export interface CaseCounts {
  readonly total: number;
  readonly byCriterion: Readonly<Record<(typeof CRITERIA)[number], number>>;
  readonly byCategory: Readonly<Record<(typeof CATEGORIES)[number], number>>;
  readonly changeAttempt: number;
  readonly firstMessage: number;
  readonly noticeAsked: number;
  readonly withPlaceholder: number;
}

export function countCases(cases: readonly EvalCase[]): CaseCounts {
  const byCriterion = Object.fromEntries(
    CRITERIA.map((k) => [k, cases.filter((c) => c.targets.includes(k)).length]),
  ) as CaseCounts["byCriterion"];
  const byCategory = Object.fromEntries(
    CATEGORIES.map((k) => [k, cases.filter((c) => c.category === k).length]),
  ) as CaseCounts["byCategory"];
  const texts = (c: EvalCase): string => [c.message, ...c.history.map((t) => t.text)].join("\n");
  return {
    total: cases.length,
    byCriterion,
    byCategory,
    changeAttempt: byCategory.change_attempt,
    firstMessage: cases.filter((c) => c.history.length === 0).length,
    noticeAsked: byCriterion.notice,
    withPlaceholder: cases.filter((c) => new RegExp(PLACEHOLDER.source).test(texts(c))).length,
  };
}

/** 근거 ID 가운데 원본에 없는 것. */
export function missingBasis(ids: readonly string[], requirements: string, spec: string): string[] {
  return ids.filter((id) => {
    if (id.startsWith("REQ-")) return !new RegExp(`^\\| ${id} \\|`, "m").test(requirements);
    if (id.startsWith("SPEC-")) return !new RegExp(`^\\| ${id} \\|`, "m").test(spec);
    if (id === "AI-1") return !/^### AI-1 /m.test(spec);
    return true;
  });
}

function readSource(path: string): string {
  return readFileSync(new URL(path, REPO_ROOT), "utf8");
}

export function basisIds(cases: readonly EvalCase[]): string[] {
  const order = (id: string): [number, number] => {
    const m = /^(REQ|SPEC|AI)-([0-9]+)$/.exec(id);
    return [m === null ? 9 : ["REQ", "SPEC", "AI"].indexOf(m[1] ?? ""), Number(m?.[2] ?? 0)];
  };
  return [...new Set(cases.flatMap((c) => c.basis))].sort((a, b) => {
    const [ka, na] = order(a);
    const [kb, nb] = order(b);
    return ka - kb || na - nb;
  });
}

/** 출처 점검표 글(결정적: 같은 사례면 같은 글). */
export function checklistMarkdown(): string {
  const cases = EVAL_CASES;
  const n = countCases(cases);
  const caseFindings = scanCases(cases);
  const shopFindings = scanShops();
  const ids = basisIds(cases);
  const missing = missingBasis(
    ids,
    readSource("docs/02-prd/requirements.md"),
    readSource("docs/04-functional-spec/spec.md"),
  );
  const dupes = cases.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i);
  const fieldCount = cases.reduce((acc, c) => acc + caseTexts(c).length, 0);
  const shops = Object.values(EVAL_SHOPS);
  const min = CASE_MINIMUMS;
  const minRows: [string, number, number][] = [
    ...CRITERIA.filter((k) => k !== "notice").map((k): [string, number, number] => [
      CRITERION_LABELS[k],
      n.byCriterion[k],
      min[k],
    ]),
    ["빠진 AI 상담 고지: 상담의 첫 메시지(서버 고지 경로)", n.firstMessage, min.noticeFirstMessage],
    ["빠진 AI 상담 고지: AI인지 묻거나 사람인 척하라는 사례", n.noticeAsked, min.noticeAsked],
    ["바꾸기 시도(REQ-146)", n.changeAttempt, min.changeAttempt],
    ["전체(REQ-145)", n.total, min.total],
  ];
  const lines = [
    "# AI 평가 세트 출처 점검표(REQ-139)",
    "",
    "<!-- 생성 파일: app/server/eval/checklist.ts가 만듦(npm run eval:checklist -w server). 손으로 고치지 않음 -->",
    "",
    `- 사례 버전 \`${EVAL_CASES_VERSION}\`, 사례 ${n.total}개. 사례 글은 \`app/server/eval/cases.ts\` 한 곳에 있다.`,
    "- 출처: 모든 사례는 이 저장소에서 지은 합성 상담이다(2026-11-16 TASK-027). 실제 손님 대화와 실제 가게 자료는 없다(출시 전이라 실제 대화가 없음).",
    `- 가게: 합성 가게 ${shops.length}곳(${shops.map((s) => `${s.key} ${s.name}`).join(", ")}). 처리방침 주소는 풀리지 않는 이름(.invalid)이다.`,
    `- 번호: 손님 글의 번호는 SPEC-021 플레이스홀더 꼴만 쓴다. 플레이스홀더가 들어간 사례 ${n.withPlaceholder}개.`,
    `- 개인정보 훑기(\`scan.ts\`): 사례 ${n.total}개의 글 ${fieldCount}개(손님 말·지난 대화·초안·모의 초안·주문 요약·견적)와 가게 ${shops.length}곳을 훑어 찾은 것 ${caseFindings.length + shopFindings.length}건.`,
    "  찾는 것: 플레이스홀더가 아닌 전화번호, 주민등록번호, 9자리가 넘는 숫자, 이메일, 합성(.invalid·.test)이 아닌 주소, 모르는 플레이스홀더, 한글로 적은 전화번호.",
    ...[...caseFindings, ...shopFindings].map((f) => `  - ${f.caseId} ${f.field}: ${f.kind}`),
    `- 근거 ID ${ids.length}개 가운데 원본(02 requirements.md의 REQ 행, 04 spec.md의 SPEC 행과 AI-1 절)에 없는 것 ${missing.length}개${missing.length > 0 ? `: ${missing.join(", ")}` : ""}.`,
    `- 사례 ID 중복 ${dupes.length}개.`,
    "",
    "## 잣대별 겨눈 사례 수와 최소",
    "",
    "잣대는 겨눈 사례만이 아니라 모든 사례에서 매긴다. 최소의 이유는 `cases.ts`의 CASE_MINIMUMS 설명과 같다: 잣대마다 가게 셋·갈래·말투를 고루 덮는 수이고, 20개에서 0건이면 실제 실패율의 95% 위 끝이 약 14%라 이 세트는 비율을 재는 것이 아니라 출시 전에 막는 관문이다. 바꾸기 시도 30개는 REQ-146이 정한 수다.",
    "",
    "| 잣대 | 겨눈 사례 | 최소 |",
    "| --- | --- | --- |",
    ...minRows.map(([label, have, need]) => `| ${label} | ${have} | ${need} |`),
    "",
    "## 갈래별 사례 수",
    "",
    "| 갈래 | 사례 |",
    "| --- | --- |",
    ...CATEGORIES.map((k) => `| ${CATEGORY_LABELS[k]} | ${n.byCategory[k]} |`),
    "",
    "## 사례 목록",
    "",
    "| ID | 갈래 | 겨눈 잣대 | 가게 | 첫 메시지 | 근거 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...cases.map(
      (c) =>
        `| ${c.id} | ${CATEGORY_LABELS[c.category]} | ${c.targets.length === 0 ? "-" : c.targets.join(", ")} | ${c.shop} | ${c.history.length === 0 ? "예" : "아니요"} | ${c.basis.join(", ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}
