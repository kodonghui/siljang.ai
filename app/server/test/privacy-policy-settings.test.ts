import { describe, expect, it } from "vitest";
import { readPrivacyPolicySettings } from "../src/privacy-policy-settings";

const recipients = ["anthropic", "openai", "supabase", "cloudflare"].map((provider) => ({
  provider,
  recipient: `${provider} 합성 회사`,
  country: "합성 국가",
  whenAndHow: "이용 시 암호화 전송",
  purposeAndRetention: "합성 시험 목적과 기간",
  howToRefuse: "가게 연락처로 거부하면 온라인 상담을 쓰지 않습니다.",
}));
const env = (entries: unknown = recipients, origin = "https://siljang.example") => ({
  PUBLIC_APP_ORIGIN: origin,
  PRIVACY_TRANSFER_SETTINGS: JSON.stringify(entries),
});

describe("TASK-044 처리방침 설정", () => {
  it.each(["anthropic", "openai"] as const)(
    "선택한 %s와 서버 두 회사만 공개하고 AI의 개인정보 범위를 고정함",
    (provider) => {
      const settings = readPrivacyPolicySettings(env(), provider);
      expect(settings?.origin).toBe("https://siljang.example");
      expect(settings?.transfers.map((x) => x.recipient)).toEqual(
        [provider, "supabase", "cloudflare"].map((x) => `${x} 합성 회사`),
      );
      expect(settings?.transfers[0]?.personalData).toContain("가린");
    },
  );
  it.each([
    undefined,
    "",
    "http://siljang.example",
    "https://user:pass@siljang.example",
    "https://siljang.example/a",
    "https://siljang.example/?query=1",
    "https://siljang.example/#hash",
  ])("공개 원점 %s가 없거나 잘못되면 발급하지 않음", (origin) => {
    expect(readPrivacyPolicySettings({ ...env(), PUBLIC_APP_ORIGIN: origin }, "anthropic")).toBeNull();
  });
  it("모델 미선택/선택한 회사 부재/서버 회사 부재는 발급하지 않음", () => {
    expect(readPrivacyPolicySettings(env(), undefined)).toBeNull();
    for (const provider of ["anthropic", "supabase", "cloudflare"])
      expect(readPrivacyPolicySettings(env(recipients.filter((x) => x.provider !== provider)), "anthropic")).toBeNull();
  });
  it.each(["recipient", "country", "whenAndHow", "purposeAndRetention", "howToRefuse"])(
    "국외 이전 %s 누락·공백·너무 긴 값·NUL은 발급하지 않음",
    (key) => {
      for (const value of [undefined, " \t", "x".repeat(1001), "value\0"]) {
        const entries = recipients.map((x, i) => (i === 0 ? { ...x, [key]: value } : x));
        expect(readPrivacyPolicySettings(env(entries), "anthropic")).toBeNull();
      }
    },
  );
  it.each(
    [
      null,
      {},
      [],
      Array(21).fill(recipients[0]),
      [...recipients, { ...recipients[0], provider: "unknown" }],
      [{ ...recipients[0], personalData: "주문자 이름" }, ...recipients.slice(1)],
    ].map((entries) => [entries]),
  )("잘못된 설정 형식이나 입력 개인정보 필드는 받지 않음", (entries) => {
    expect(readPrivacyPolicySettings(env(entries), "anthropic")).toBeNull();
  });
});
