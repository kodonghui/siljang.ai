import { describe, expect, it } from "vitest";
import { serverSources, stringLiterals } from "./support/source-scan";

// 모델 회사 SDK는 모델 호출 모듈(src/ai-model.ts)에서만 부른다는 정적 검사(TASK-026; REQ-266, 06 DEC-25).
// 그래프·도구 코드(뒤 TASK)는 ai-model.ts의 call()만 부르므로, 회사를 바꿔도 설정만 바뀐다.

const sources = serverSources(new URL("../src/", import.meta.url));

/** 회사 SDK와 LangChain 회사 묶음, 추적 도구. */
const PROVIDER_PACKAGES = ["@langchain/anthropic", "@langchain/openai", "@anthropic-ai/sdk", "openai", "langsmith"];

/** 패키지를 가져오는 곳(import·export from·동적 import·require). */
function importsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) out.push(m[1] as string);
  return out;
}

const packageOf = (spec: string): string =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] as string);

/** 패키지마다 가져와도 되는 파일과 까닭. */
const ALLOWED: Record<string, Record<string, string>> = {
  "@langchain/anthropic": { "ai-model.ts": "모델 호출 모듈" },
  "@langchain/openai": { "ai-model.ts": "모델 호출 모듈" },
  "@langchain/core": { "ai-model.ts": "모델 호출 모듈(메시지·채팅 모델 형식)" },
  "@cfworker/json-schema": { "ai-turn-output.ts": "AI 출력의 서버 확인" },
};

describe("모델 호출의 경계", () => {
  it("회사 SDK·LangChain 회사 묶음·추적 도구는 ai-model.ts 밖에서 가져오지 않는다", () => {
    const found: string[] = [];
    for (const file of sources) {
      for (const spec of importsOf(file.text)) {
        const pkg = packageOf(spec);
        if (!PROVIDER_PACKAGES.includes(pkg) && ALLOWED[pkg] === undefined) continue;
        if (ALLOWED[pkg]?.[file.name] !== undefined) continue;
        found.push(`${file.name}: ${spec}`);
      }
    }
    expect(found).toEqual([]);
    // 직접 SDK(@anthropic-ai/sdk·openai)와 langsmith는 어디서도 가져오지 않는다(LangChain을 거침).
    const direct = sources.flatMap((f) =>
      importsOf(f.text)
        .map(packageOf)
        .filter((p) => ["@anthropic-ai/sdk", "openai", "langsmith"].includes(p))
        .map((p) => `${f.name}: ${p}`),
    );
    expect(direct).toEqual([]);
  });

  it("ai_calls에 쓰는 SQL은 ai-calls.ts에만 있다(호출마다 한 행, 내용 열 없음)", () => {
    const writers = sources
      .filter((f) => stringLiterals(f.text).some((s) => /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+ai_calls\b/i.test(s)))
      .map((f) => f.name);
    expect(writers).toEqual(["ai-calls.ts"]);
  });

  it("이 검사가 가져오기를 알아본다(헛돌지 않음)", () => {
    const sample = [
      'import { ChatAnthropic } from "@langchain/anthropic";',
      "import OpenAI from 'openai';",
      'export { x } from "@anthropic-ai/sdk/resources";',
      'const m = await import("langsmith/traceable");',
    ].join("\n");
    expect(importsOf(sample).map(packageOf)).toEqual([
      "@langchain/anthropic",
      "openai",
      "@anthropic-ai/sdk",
      "langsmith",
    ]);
    const model = sources.find((f) => f.name === "ai-model.ts");
    expect(importsOf(model?.text ?? "").map(packageOf)).toEqual(
      expect.arrayContaining(["@langchain/anthropic", "@langchain/openai", "@langchain/core"]),
    );
  });
});
