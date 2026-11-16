import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CASE_MINIMUMS, EVAL_CASES } from "../eval/cases";
import { basisIds, CHECKLIST_PATH, checklistMarkdown, countCases, missingBasis, REPO_ROOT } from "../eval/checklist";
import { idealOutput } from "../eval/mock";
import { scanCases, scanShops, scanText } from "../eval/scan";
import { EVAL_SHOPS } from "../eval/shops";
import { CRITERIA } from "../eval/types";
import { checkTurnOutput } from "../src/ai-turn-output";

// TASK-027 AI 평가 세트(REQ-145·139·146). 사례 수와 최소, 출처 점검표, 개인정보 훑기, 근거 ID를 본다. 모두 합성 자료다.

const source = (path: string): string => readFileSync(new URL(path, REPO_ROOT), "utf8");

describe("평가 세트의 사례 수(REQ-145·146)", () => {
  const n = countCases(EVAL_CASES);

  it("합성 상담 100개 이상", () => {
    expect(n.total).toBeGreaterThanOrEqual(CASE_MINIMUMS.total);
  });

  it("잣대마다 겨눈 사례가 최소 이상(고지는 첫 메시지와 AI인지 묻는 사례로 나눔)", () => {
    for (const k of CRITERIA) {
      if (k === "notice") continue;
      expect(n.byCriterion[k], k).toBeGreaterThanOrEqual(CASE_MINIMUMS[k]);
    }
    expect(n.firstMessage).toBeGreaterThanOrEqual(CASE_MINIMUMS.noticeFirstMessage);
    expect(n.noticeAsked).toBeGreaterThanOrEqual(CASE_MINIMUMS.noticeAsked);
  });

  it("바꾸기 시도 30개(REQ-146)", () => {
    expect(n.changeAttempt).toBeGreaterThanOrEqual(CASE_MINIMUMS.changeAttempt);
  });

  it("사례 ID는 갈래 머리글자와 두 자리 번호이고 겹치지 않음", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(AMT|INJ|CNF|EDB|UNK|NTC|FLW)-[0-9]{2}$/);
  });

  it("사례마다 근거 ID가 있고 모두 원본(02 REQ 행, 04 SPEC 행·AI-1 절)에 있음", () => {
    for (const c of EVAL_CASES) expect(c.basis.length, c.id).toBeGreaterThan(0);
    const ids = basisIds(EVAL_CASES);
    expect(ids).toContain("REQ-145");
    expect(missingBasis(ids, source("docs/02-prd/requirements.md"), source("docs/04-functional-spec/spec.md"))).toEqual(
      [],
    );
    // 검사가 헛돌지 않음: 없는 ID는 잡는다.
    expect(missingBasis(["REQ-999", "SPEC-999", "AI-9"], "| REQ-145 |", "### AI-1 x")).toEqual([
      "REQ-999",
      "SPEC-999",
      "AI-9",
    ]);
  });

  it("넘김을 기대하는 사례의 설정이 서로 맞음", () => {
    for (const c of EVAL_CASES) {
      if (c.handoffFor !== undefined) expect(c.handoff, c.id).toBeDefined();
      if (c.handoff?.includes("closed_day")) expect(c.date?.available, c.id).toBe(false);
      if (c.noHandoff === true) expect(c.handoff, c.id).toBeUndefined();
      expect(EVAL_SHOPS[c.shop], c.id).toBeDefined();
    }
  });

  it("모의 응답의 출력은 사례마다 06 AiTurnOutput 스키마에 맞음", () => {
    for (const c of EVAL_CASES) expect(checkTurnOutput(idealOutput(c)).ok, c.id).toBe(true);
  });
});

describe("개인정보 훑기(REQ-139, SPEC-021)", () => {
  it("사례와 합성 가게에서 찾은 것 0건", () => {
    expect(scanCases(EVAL_CASES)).toEqual([]);
    expect(scanShops()).toEqual([]);
  });

  it("훑기가 번호·이메일·주소를 잡고 플레이스홀더·날짜·시각은 넘김(합성 값)", () => {
    expect(scanText("연락처 010-0000-0000")).toContain("phone");
    expect(scanText("000000-1000000")).toContain("resident_number");
    expect(scanText("계좌 0000 0000 0000")).toContain("long_number");
    expect(scanText("메일 test@example.invalid")).toContain("email");
    expect(scanText("https://shop.example.com/a")).toContain("url");
    expect(scanText("[주소1]로 보내 주세요")).toContain("unknown_placeholder");
    expect(scanText("공일공에 연락 주세요")).toContain("hangul_phone");
    expect(scanText("[전화번호1] [계좌번호2] [카드번호3] [긴숫자4]")).toEqual([]);
    expect(scanText("2026-11-20 14:00 픽업, https://shop-s1.example.invalid/privacy")).toEqual([]);
  });

  it("훑기 결과에는 위치와 종류만 있고 값은 없음", () => {
    const findings = scanCases([{ ...(EVAL_CASES[0] as (typeof EVAL_CASES)[number]), message: "010-0000-0000" }]);
    // 11자리 전화번호는 9자리가 넘는 숫자로도 잡힌다.
    expect(findings).toEqual([
      { caseId: "AMT-01", field: "message", kind: "phone" },
      { caseId: "AMT-01", field: "message", kind: "long_number" },
    ]);
    expect(JSON.stringify(findings)).not.toContain("0000");
  });
});

describe("출처 점검표(REQ-139)", () => {
  it("저장소의 source-checklist.md가 지금 사례로 만든 글과 같음(다르면 npm run eval:checklist -w server)", () => {
    expect(readFileSync(CHECKLIST_PATH, "utf8")).toBe(checklistMarkdown());
  });

  it("점검표에는 사례의 손님 말이 없음", () => {
    const text = checklistMarkdown();
    for (const c of EVAL_CASES) expect(text.includes(c.message), c.id).toBe(false);
  });
});
