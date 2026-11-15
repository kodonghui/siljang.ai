import { describe, expect, it } from "vitest";
import { readSettings, SECRET_NAMES, Secret, SettingsError } from "../src/settings";

// 시험용 가짜 키는 실행 중에 만든다. 저장소 글에 키 꼴의 값이 남지 않게(tools/check-no-keys.mjs).
const fakeKey = (prefix: string) => `${prefix}${"Zq7".repeat(16)}`;

describe("readSettings", () => {
  it("APP_ENV가 없으면 production으로 친다", () => {
    expect(readSettings({}).appEnv).toBe("production");
    expect(readSettings({ APP_ENV: "" }).appEnv).toBe("production");
  });

  it("development·staging·production만 받는다", () => {
    expect(readSettings({ APP_ENV: "development" }).appEnv).toBe("development");
    expect(readSettings({ APP_ENV: "staging" }).appEnv).toBe("staging");
  });

  it("틀린 APP_ENV는 값을 메시지에 싣지 않고 멈춘다", () => {
    const wrong = "prod-Q9x";
    let caught: unknown;
    try {
      readSettings({ APP_ENV: wrong });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SettingsError);
    expect(String((caught as Error).message)).not.toContain(wrong);
  });

  it("키가 없으면 이름만 빠진 목록에 남는다", () => {
    const s = readSettings({});
    expect(s.missingSecrets).toEqual([...SECRET_NAMES]);
    expect(s.secrets.ANTHROPIC_API_KEY).toBeNull();
    expect(s.secrets.OPENAI_API_KEY).toBeNull();
  });

  it("키는 Secret으로 감싸고, 글·JSON·inspect에서 가린다", () => {
    const anthropic = fakeKey("sk-ant-api03-");
    const openai = fakeKey("sk-proj-");
    const s = readSettings({ ANTHROPIC_API_KEY: anthropic, OPENAI_API_KEY: openai });
    expect(s.missingSecrets).toEqual(["DATABASE_URL", "REQUEST_HASH_KEY"]);
    const a = s.secrets.ANTHROPIC_API_KEY;
    expect(a).toBeInstanceOf(Secret);
    expect(a?.reveal()).toBe(anthropic);
    const texts = [
      String(a),
      `${a}`,
      JSON.stringify(s),
      JSON.stringify({ nested: { s } }),
      (a as unknown as Record<symbol, () => string>)[Symbol.for("nodejs.util.inspect.custom")]?.() ?? "",
    ];
    for (const text of texts) {
      expect(text).not.toContain(anthropic);
      expect(text).not.toContain(openai);
      expect(text).toContain("**********");
    }
  });

  it("공백만 있는 값은 없는 것으로 친다", () => {
    const s = readSettings({ ANTHROPIC_API_KEY: "   " });
    expect(s.secrets.ANTHROPIC_API_KEY).toBeNull();
    expect(s.missingSecrets).toContain("ANTHROPIC_API_KEY");
  });

  it("DATABASE_URL은 postgres:// 꼴만, REQUEST_HASH_KEY는 32자 이상만 받고 값은 메시지에 싣지 않는다", () => {
    const pw = "Pw-Zq7-only";
    const ok = readSettings({
      DATABASE_URL: `postgresql://u:${pw}@127.0.0.1:5432/db`,
      REQUEST_HASH_KEY: "k".repeat(32),
    });
    expect(ok.secrets.DATABASE_URL?.reveal()).toContain(pw);
    expect(JSON.stringify(ok)).not.toContain(pw);
    for (const env of [{ DATABASE_URL: `mysql://u:${pw}@h/db` }, { REQUEST_HASH_KEY: `${pw}-short` }]) {
      let caught: unknown;
      try {
        readSettings(env);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SettingsError);
      expect(String((caught as Error).message)).not.toContain(pw);
    }
  });
});
