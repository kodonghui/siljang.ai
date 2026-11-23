import { expect, it } from "vitest";
import { type ShopSettingsSource, settingsForm, settingsPatch } from "./shop-settings-form";

const original: ShopSettingsSource = {
  revision: "4821",
  name: "합성 가게",
  contactPhone: "010-1234-5678",
  businessAddress: "서울 합성로 12\n2층",
  contactEmail: "synthetic@example.com",
  pickupAddress: null,
  mailOrderRegNo: null,
  mailOrderAuthority: null,
  mailOrderExemption: "신고 면제 합성 사유",
  completionPhotoEnabled: false,
  idleCloseHours: 24,
  ownerWaitMinutes: 120,
  dailyAiCostLimitKrw: 5000,
  awaitingPaymentLimit: 2,
};

it("빈 선택 필드와 숫자를 입력 값으로 옮기고 바뀐 값이 없으면 저장하지 않음", () => {
  const form = settingsForm(original);
  expect(form.pickupAddress).toBe("");
  expect(form.idleCloseHours).toBe("24");
  expect(settingsPatch(original, form)).toBeNull();
});

it("기준 revision과 바꾼 필드만 보내며 사업자 신원은 보내지 않음", () => {
  const form = { ...settingsForm(original), name: "새 합성 가게", businessName: "바꾸면 안 됨" };
  expect(settingsPatch(original, form)).toEqual({ baseRevision: "4821", name: "새 합성 가게" });
});

it("등록번호·기관을 넣으면 기존 면제 사유도 함께 지움", () => {
  expect(
    settingsPatch(original, {
      ...settingsForm(original),
      mailOrderRegNo: "합성-2026",
      mailOrderAuthority: "합성 구청",
    }),
  ).toEqual({
    baseRevision: "4821",
    mailOrderRegNo: "합성-2026",
    mailOrderAuthority: "합성 구청",
    mailOrderExemption: null,
  });
});

it("등록번호를 지우고 면제로 바꾸면 숨겨진 기관도 함께 지움", () => {
  const registered = {
    ...original,
    mailOrderRegNo: "합성-2026",
    mailOrderAuthority: "합성 구청",
    mailOrderExemption: null,
  };
  expect(
    settingsPatch(registered, {
      ...settingsForm(registered),
      mailOrderRegNo: "",
      mailOrderExemption: "새 합성 면제 사유",
    }),
  ).toEqual({
    baseRevision: "4821",
    mailOrderRegNo: null,
    mailOrderAuthority: null,
    mailOrderExemption: "새 합성 면제 사유",
  });
});

it("빈 숫자는 0으로 바꾸지 않고 서버 필드 검증에 보내며 정수와 스위치는 값으로 보냄", () => {
  expect(
    settingsPatch(original, {
      ...settingsForm(original),
      dailyAiCostLimitKrw: "",
      idleCloseHours: "48",
      completionPhotoEnabled: true,
    }),
  ).toEqual({ baseRevision: "4821", dailyAiCostLimitKrw: "", idleCloseHours: 48, completionPhotoEnabled: true });
});

it("선택한 픽업 장소를 지우면 null로 보내고 숫자의 표현만 바뀌면 다시 저장하지 않음", () => {
  const pickup = { ...original, pickupAddress: "합성 픽업 장소" };
  expect(settingsPatch(pickup, { ...settingsForm(pickup), pickupAddress: "" })).toEqual({
    baseRevision: "4821",
    pickupAddress: null,
  });
  expect(settingsPatch(original, { ...settingsForm(original), idleCloseHours: "024" })).toBeNull();
});

it("공백 신고번호는 화면처럼 미신고로 판단하고 면제 사유를 보냄", () => {
  expect(
    settingsPatch(original, {
      ...settingsForm(original),
      mailOrderRegNo: "   ",
      mailOrderExemption: "새 합성 면제 사유",
    }),
  ).toEqual({ baseRevision: original.revision, mailOrderExemption: "새 합성 면제 사유" });
});
