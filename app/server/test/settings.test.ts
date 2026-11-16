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
    expect(s.missingSecrets).toEqual(SECRET_NAMES.filter((n) => !n.endsWith("_API_KEY")));
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

  // 사진 저장소와 서명 주소(TASK-022)
  it("FILE_URL_KEY는 32자 이상만 받고 값은 메시지에 싣지 않는다", () => {
    const short = "Fk-Zq7-short";
    let caught: unknown;
    try {
      readSettings({ FILE_URL_KEY: short });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SettingsError);
    expect(String((caught as Error).message)).not.toContain(short);
    expect(readSettings({ FILE_URL_KEY: "f".repeat(32) }).secrets.FILE_URL_KEY?.reveal()).toBe("f".repeat(32));
  });

  it("저장소 주소는 세 값이 모두 있거나 모두 없어야 하고, https만(development의 localhost는 http도) 받는다", () => {
    expect(readSettings({}).storage).toBeNull();
    const ok = readSettings({
      STORAGE_ENDPOINT: "https://storage.example.test/storage/v1/s3/",
      STORAGE_REGION: "ap-northeast-2",
      STORAGE_BUCKET: "photos",
    });
    expect(ok.storage).toEqual({
      endpoint: "https://storage.example.test/storage/v1/s3",
      region: "ap-northeast-2",
      bucket: "photos",
    });
    const local = { STORAGE_ENDPOINT: "http://127.0.0.1:9000", STORAGE_REGION: "local", STORAGE_BUCKET: "photos" };
    expect(readSettings({ ...local, APP_ENV: "development" }).storage?.endpoint).toBe("http://127.0.0.1:9000");
    const bad: Record<string, string>[] = [
      { STORAGE_ENDPOINT: "https://storage.example.test" },
      { ...local },
      { ...local, APP_ENV: "staging" },
      { ...local, APP_ENV: "development", STORAGE_ENDPOINT: "http://storage.example.test" },
      { ...local, APP_ENV: "development", STORAGE_ENDPOINT: "not a url" },
      { ...local, APP_ENV: "development", STORAGE_ENDPOINT: "https://u:Pw-Zq7@storage.example.test" },
      { ...local, APP_ENV: "development", STORAGE_REGION: "AP NORTH" },
      { ...local, APP_ENV: "development", STORAGE_BUCKET: "a/b" },
    ];
    for (const env of bad) {
      let caught: unknown;
      try {
        readSettings(env);
      } catch (e) {
        caught = e;
      }
      expect(caught, JSON.stringify(Object.keys(env))).toBeInstanceOf(SettingsError);
      expect(String((caught as Error).message)).not.toContain("Pw-Zq7");
    }
  });

  it("저장소 접근 키는 Secret으로 감싸 글·JSON에서 가린다", () => {
    const secret = fakeKey("sb-s3-");
    const s = readSettings({ STORAGE_ACCESS_KEY_ID: "key-id-Zq7", STORAGE_SECRET_ACCESS_KEY: secret });
    expect(s.secrets.STORAGE_SECRET_ACCESS_KEY?.reveal()).toBe(secret);
    expect(JSON.stringify(s)).not.toContain(secret);
    expect(JSON.stringify(s)).not.toContain("key-id-Zq7");
  });
});
