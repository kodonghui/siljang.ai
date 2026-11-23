import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearRegistrationDraft,
  EMPTY_REGISTRATION,
  REGISTRATION_DRAFT_KEY,
  REGISTRATION_DRAFT_TTL_MS,
  readRegistrationDraft,
  saveRegistrationDraft,
} from "./registration-draft";

function storage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
const values = { ...EMPTY_REGISTRATION, name: "합성 케이크", contactEmail: "synthetic@example.com" };
it("같은 사장님에게 글 값만 복구하고 사진/동의/올린파일ID는 저장하지 않음", () => {
  const s = storage();
  saveRegistrationDraft(
    "owner-a",
    {
      ...values,
      photo: "private-photo",
      entrustmentConsent: true,
      licensePhotoUploadId: "private-upload",
    } as typeof values,
    1000,
    s,
  );
  expect(readRegistrationDraft("owner-a", 2000, s)).toEqual(values);
  const raw = s.getItem(REGISTRATION_DRAFT_KEY) ?? "";
  for (const hidden of ["private-photo", "entrustmentConsent", "private-upload"]) expect(raw).not.toContain(hidden);
});
it("다른 계정·1시간 경계·미래 시각이면 지우고 복구하지 않음", () => {
  for (const [owner, now] of [
    ["owner-b", 1001],
    ["owner-a", 1000 + REGISTRATION_DRAFT_TTL_MS],
    ["owner-a", 999],
  ] as const) {
    const s = storage();
    saveRegistrationDraft("owner-a", values, 1000, s);
    expect(readRegistrationDraft(owner, now, s)).toBeNull();
    expect(s.map.size).toBe(0);
  }
});
it("만료 직전까지 복구하고 성공/로그아웃의 정리는 이 키만 지움", () => {
  const s = storage();
  s.setItem("unrelated", "keep");
  saveRegistrationDraft("owner-a", values, 1000, s);
  expect(readRegistrationDraft("owner-a", 999 + REGISTRATION_DRAFT_TTL_MS, s)).toEqual(values);
  clearRegistrationDraft(s);
  expect([...s.map]).toEqual([["unrelated", "keep"]]);
});
it("깨진 자료와 막힌 세션 저장소는 입력을 로그에 쓰거나 등록을 막지 않음", () => {
  const s = storage();
  s.setItem(REGISTRATION_DRAFT_KEY, "{broken");
  expect(readRegistrationDraft("owner-a", 1000, s)).toBeNull();
  const blocked = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  expect(() => saveRegistrationDraft("owner-a", values, 1000, blocked)).not.toThrow();
  expect(readRegistrationDraft("owner-a", 1000, blocked)).toBeNull();
  expect(() => clearRegistrationDraft(blocked)).not.toThrow();
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("로그인 화면에 머물러도1시간 뒤 저장한 글을 지우고 새 저장의기한은따로지킴", () => {
  const s = storage();
  saveRegistrationDraft("owner-a", values, Date.now(), s);
  vi.advanceTimersByTime(30 * 60 * 1000);
  saveRegistrationDraft("owner-a", { ...values, name: "새 합성 이름" }, Date.now(), s);
  vi.advanceTimersByTime(30 * 60 * 1000);
  expect(s.getItem(REGISTRATION_DRAFT_KEY)).not.toBeNull();
  vi.advanceTimersByTime(30 * 60 * 1000);
  expect(s.getItem(REGISTRATION_DRAFT_KEY)).toBeNull();
});
