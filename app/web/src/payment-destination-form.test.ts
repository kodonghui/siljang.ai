import { expect, it } from "vitest";
import type { PaymentDestination } from "./payment-destination-api";
import { paymentForm, paymentIssues, paymentPayload, rebasePayment } from "./payment-destination-form";

const base: PaymentDestination = {
  bankName: "합성 은행",
  accountNumber: "000000000000",
  holderName: "합성 예금주",
  holderMismatchConfirmed: true,
  cardPaymentUrl: null,
  createdAt: "2026-11-23T12:00:00Z",
  revision: "synthetic-payment-v1",
};
it("미등록과 기존 계좌의 원문을 양식과 버전 본문으로 옮기고 확인 기록은 복사하지 않는다", () => {
  const empty = paymentForm(null);
  expect(Object.values(empty)).toEqual(["", "", "", ""]);
  const body = paymentPayload(base, paymentForm(base));
  expect(body).toEqual({
    baseRevision: base.revision,
    bankName: base.bankName,
    accountNumber: base.accountNumber,
    holderName: base.holderName,
    cardPaymentUrl: null,
  });
  expect(body).not.toHaveProperty("confirm");
  expect(paymentPayload(null, empty).baseRevision).toBeNull();
});
it("계좌 형식과 https 링크, 코드포인트 이름 길이를 검사하고 입력을 바꾸지 않는다", () => {
  const form = {
    ...paymentForm(base),
    accountNumber: "123-가",
    holderName: "가".repeat(31),
    cardPaymentUrl: "http://pay.example.test",
  };
  expect(paymentIssues(form)).toEqual(
    expect.arrayContaining([
      { field: "/accountNumber", code: "bad_format" },
      { field: "/holderName", code: "too_long" },
      { field: "/cardPaymentUrl", code: "bad_format" },
    ]),
  );
  expect(form.accountNumber).toBe("123-가");
  expect(paymentIssues({ ...paymentForm(base), holderName: "😀".repeat(30) })).toEqual([]);
});
it("다른 기기의 은행·카드 링크를 보존하고 내가 바꾼 계좌만 최신 위에 다시 적용한다", () => {
  const mine = { ...paymentForm(base), accountNumber: "111111111111" };
  const latest = {
    ...base,
    bankName: "다른 합성 은행",
    cardPaymentUrl: "https://pay.example.test/new",
    revision: "synthetic-payment-v2",
  };
  const merged = rebasePayment(base, mine, latest);
  expect(merged).toEqual({ ...paymentForm(latest), accountNumber: mine.accountNumber });
  expect(paymentPayload(latest, merged)).toMatchObject({
    baseRevision: latest.revision,
    accountNumber: mine.accountNumber,
    cardPaymentUrl: latest.cardPaymentUrl,
  });
});
it("같은 필드를 양쪽에서 바꾼 재적용은 내 입력을 사용하고 빈 링크 변경도 보존한다", () => {
  const previous = { ...base, cardPaymentUrl: "https://pay.example.test/old" };
  const mine = { ...paymentForm(previous), holderName: "내 합성 예금주", cardPaymentUrl: "" };
  const latest = { ...previous, holderName: "다른 합성 예금주", cardPaymentUrl: "https://pay.example.test/remote" };
  expect(rebasePayment(previous, mine, latest)).toEqual(mine);
  expect(paymentPayload(latest, mine).cardPaymentUrl).toBeNull();
});
