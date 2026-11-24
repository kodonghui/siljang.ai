import { afterEach, expect, it, vi } from "vitest";
import type { KakaoOwnerEvents } from "../src/kakao-event";
import { createServices } from "../src/services";
import { readSettings, SettingsError } from "../src/settings";

const auth = {
  KAKAO_REST_API_KEY: crypto.randomUUID(),
  KAKAO_CLIENT_SECRET: crypto.randomUUID(),
  KAKAO_OWNER_REDIRECT_URIS: "https://app.example/api/owner/auth/callback",
  PUBLIC_APP_ORIGIN: "https://app.example",
};
afterEach(() => vi.restoreAllMocks());

it("production에서는 꺼둔 발신 설정이어도 개발 봇 선택을 거절한다", () => {
  expect(() => readSettings({ ...auth, APP_ENV: "production", KAKAO_OWNER_BOT_DEVELOPMENT: "true" })).toThrow(
    SettingsError,
  );
  expect(
    readSettings({ ...auth, APP_ENV: "staging", KAKAO_OWNER_BOT_DEVELOPMENT: "true" }).ownerAlerts.development,
  ).toBe(true);
});

it("MVP는 사장님 알림을 기본으로 끄고 키와 전송기를 요구하지 않는다", () => {
  expect(readSettings({}).ownerAlerts).toEqual({ enabled: false, botId: null, development: false });
  const fetcher = vi.spyOn(globalThis, "fetch");
  expect(() => createServices({}, readSettings({})).kakaoOwnerEvents()).toThrow("KAKAO_REST_API_KEY is not set");
  expect(fetcher).not.toHaveBeenCalled();
});

it("사장님 봇을 켤 때만 로그인 앱과 서비스 봇 번호를 함께 요구한다", () => {
  expect(() => readSettings({ KAKAO_OWNER_ALERTS_ENABLED: "true" })).toThrow(SettingsError);
  expect(() => readSettings({ ...auth, KAKAO_OWNER_ALERTS_ENABLED: "true" })).toThrow(SettingsError);
  expect(() =>
    readSettings({
      ...auth,
      PUBLIC_APP_ORIGIN: "",
      KAKAO_OWNER_ALERTS_ENABLED: "true",
      KAKAO_OWNER_BOT_ID: "b".repeat(24),
    }),
  ).toThrow(SettingsError);
  expect(
    readSettings({ ...auth, KAKAO_OWNER_ALERTS_ENABLED: "true", KAKAO_OWNER_BOT_ID: "b".repeat(24) }).ownerAlerts,
  ).toEqual({ enabled: true, botId: "b".repeat(24), development: false });
  for (const value of ["yes", "1", "TRUE"])
    expect(() => readSettings({ KAKAO_OWNER_ALERTS_ENABLED: value })).toThrow(SettingsError);
  expect(() => readSettings({ KAKAO_OWNER_BOT_DEVELOPMENT: "yes" })).toThrow(SettingsError);
  expect(() => readSettings({ KAKAO_OWNER_BOT_ID: "invalid-owner-bot" })).toThrow(SettingsError);
});

it("사장님 전송기는 별도 주입할 수 있고 만들어도 외부 요청은 하지 않는다", () => {
  const fake: KakaoOwnerEvents = {
    requestAlert: vi.fn(),
    checkDelivery: vi.fn(),
  };
  const fetcher = vi.spyOn(globalThis, "fetch");
  expect(createServices({}, readSettings({}), { kakaoOwnerEvents: fake }).kakaoOwnerEvents()).toBe(fake);
  const services = createServices(auth, readSettings(auth));
  expect(services.kakaoOwnerEvents()).toBe(services.kakaoOwnerEvents());
  expect(fetcher).not.toHaveBeenCalled();
});
