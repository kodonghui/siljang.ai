import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DELIVERY_CHECK_OFFSETS_MS,
  deliveryChecksDone,
  KAKAO_MAX_ATTEMPTS,
  KAKAO_RESEND_DELAYS_MS,
  LEDGER_RETRY_DELAYS_MS,
  nextDeliveryCheckAt,
  nextKakaoAttemptAt,
  nextLedgerAttemptAt,
} from "../src/retry";

// 다시 하기 때 셈(TASK-023): 04 G4(카카오 1·5·30분, 4번까지), REQ-182(발송 결과 조회 1·5·30분), 1-8(장부).

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = new Date("2026-11-16T00:00:00.000Z");
const plus = (ms: number) => new Date(now.getTime() + ms);

describe("카카오 다시 보내기(G4)", () => {
  it("처음과 1분·5분·30분 뒤, 4번이면 그만", () => {
    expect(KAKAO_RESEND_DELAYS_MS).toEqual([MIN, 5 * MIN, 30 * MIN]);
    expect(nextKakaoAttemptAt(1, now)).toEqual(plus(MIN));
    expect(nextKakaoAttemptAt(2, now)).toEqual(plus(5 * MIN));
    expect(nextKakaoAttemptAt(3, now)).toEqual(plus(30 * MIN));
    expect(nextKakaoAttemptAt(4, now)).toBeNull();
    expect(nextKakaoAttemptAt(9, now)).toBeNull();
  });

  it("최대 횟수가 05 attempts CHECK(0~4)와 같음", () => {
    const schema = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8");
    for (const table of ["owner_alerts", "notifications"]) {
      const body = new RegExp(`^CREATE TABLE ${table} \\(\\n([\\s\\S]*?)^\\);`, "m").exec(schema)?.[1] ?? "";
      expect(body, table).toContain(`CHECK (attempts BETWEEN 0 AND ${KAKAO_MAX_ATTEMPTS})`);
    }
  });

  it("틀린 값은 RangeError", () => {
    expect(() => nextKakaoAttemptAt(0, now)).toThrow(RangeError);
    expect(() => nextKakaoAttemptAt(1.5, now)).toThrow(RangeError);
    expect(() => nextKakaoAttemptAt(1, new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("발송 결과 조회(REQ-182)", () => {
  const requested = now;
  it("요청 뒤 1분, 1분 조회 뒤 5분, 5분 조회 뒤 30분", () => {
    expect(DELIVERY_CHECK_OFFSETS_MS).toEqual([MIN, 5 * MIN, 30 * MIN]);
    expect(nextDeliveryCheckAt(requested, null)).toEqual(plus(MIN));
    expect(nextDeliveryCheckAt(requested, plus(MIN + 5000))).toEqual(plus(5 * MIN));
    expect(nextDeliveryCheckAt(requested, plus(5 * MIN + 5000))).toEqual(plus(30 * MIN));
    // 1분 조회가 늦어 5분을 넘겼으면 다음은 30분.
    expect(nextDeliveryCheckAt(requested, plus(6 * MIN))).toEqual(plus(30 * MIN));
  });

  it("30분 조회까지 했는지", () => {
    expect(deliveryChecksDone(requested, null)).toBe(false);
    expect(deliveryChecksDone(requested, plus(5 * MIN))).toBe(false);
    expect(deliveryChecksDone(requested, plus(30 * MIN))).toBe(true);
  });
});

describe("장부 다시 적기(1-8)", () => {
  it("1분·5분·30분·2시간·6시간, 그 뒤 하루 한 번(끝없음)", () => {
    expect(LEDGER_RETRY_DELAYS_MS).toEqual([MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 6 * HOUR]);
    const got = [1, 2, 3, 4, 5, 6, 7, 100].map((n) => nextLedgerAttemptAt(n, now).getTime() - now.getTime());
    expect(got).toEqual([MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 6 * HOUR, 24 * HOUR, 24 * HOUR, 24 * HOUR]);
    expect(() => nextLedgerAttemptAt(0, now)).toThrow(RangeError);
  });
});
