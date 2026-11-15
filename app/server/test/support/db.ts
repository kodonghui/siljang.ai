import { describe, it } from "vitest";
import { pgConnector, type RequestDb } from "../../src/db";
import { Secret } from "../../src/settings";

/**
 * 데이터베이스가 있어야 하는 시험의 바탕.
 * - TEST_DATABASE_URL: 마이그레이션 0001~0020을 적용한 시험용 데이터베이스(로컬 예: postgresql://postgres@127.0.0.1:54329/app_test).
 * - 연결 문자열이 없으면 로컬에서는 건너뛴다. CI(REQUIRE_DATABASE_TESTS=1)에서는 건너뛰지 않고 실패한다.
 * - 시험마다 새 ID·키를 써서 여러 파일이 같은 데이터베이스를 함께 써도 겹치지 않는다.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const required = process.env.REQUIRE_DATABASE_TESTS === "1";

export function describeDb(name: string, fn: () => void): void {
  if (TEST_DATABASE_URL !== "") {
    describe(name, fn);
    return;
  }
  if (required) {
    describe(name, () => {
      it("TEST_DATABASE_URL이 있어야 함(REQUIRE_DATABASE_TESTS=1이면 건너뛰지 않음)", () => {
        throw new Error("TEST_DATABASE_URL is required when REQUIRE_DATABASE_TESTS=1");
      });
    });
    return;
  }
  describe.skip(name, fn);
}

/** 시험용 HMAC 키. 저장소 글에 키 꼴이 남지 않게 실행 중에 만든다. */
export const TEST_HASH_KEY = ["test", "only", "request", "hash", "x".repeat(24)].join("-");

/** 앱에 넘기는 env(시험용 연결 문자열과 HMAC 키). */
export function testEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { APP_ENV: "development", DATABASE_URL: TEST_DATABASE_URL, REQUEST_HASH_KEY: TEST_HASH_KEY, ...extra };
}

/** 시험이 직접 확인할 때 쓰는 연결. 다 쓰면 close(). */
export function testDb(): RequestDb {
  return pgConnector(new Secret(TEST_DATABASE_URL));
}

export function newUuid(): string {
  return crypto.randomUUID();
}

/** 16~64자 요청 키. */
export function newRequestKey(): string {
  return `t-${crypto.randomUUID().replaceAll("-", "")}`;
}

/** ops_events.detail의 probe로 시험마다 행을 가린다. */
export function newProbe(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export function collectLogs() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}
