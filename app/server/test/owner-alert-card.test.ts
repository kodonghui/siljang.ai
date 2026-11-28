import { describe, expect, it } from "vitest";
import { renderOwnerAlert } from "../src/owner-alert-card";

const origin = new URL("https://test.example");
const order = { orderId: "ae7896ba-9fb6-4a79-a6cf-d7b2e1ee88b3", orderNo: "K7Q3M9" };

describe("SCR-019 사장님 알림", () => {
  it.each([
    [{ kind: "new_task", task: "custom_order", count: 1 }, "맞춤 주문이 생겼어요"],
    [{ kind: "new_task", task: "issue_report", count: 3 }, "문제 신고 3건"],
    [{ kind: "task_realert", task: "refund_decision" }, "아직 답하지 않은 환불 결정이 있어요"],
  ] as const)("할 일과 지연 알림에 현재 할 일 목록 주소를 표시", (alert, description) => {
    expect(renderOwnerAlert(alert, "normal", origin)).toEqual({
      version: "2.0",
      template: {
        outputs: [
          {
            textCard: {
              title: "할 일",
              description,
              buttons: [{ action: "webLink", label: "할 일 목록 열기", webLinkUrl: "https://test.example/owner" }],
            },
          },
        ],
      },
    });
  });

  it.each([
    ["order_cancelled", "주문이 취소됐어요(주문 K7Q3M9)"],
    ["new_amount_declined", "손님이 새 금액을 받지 않았어요(주문 K7Q3M9)"],
    ["change_not_applied", "변경이 반영되지 않았어요(주문 K7Q3M9). 차액이 들어오지 않아 원래 주문대로 해요"],
    ["health_concern", "손님이 몸이 불편하다고 했어요(주문 K7Q3M9)"],
  ] as const)("주문 안내 %s가 해당 주문의 주소만 담음", (kind, description) => {
    expect(renderOwnerAlert({ kind, ...order }, "normal", origin)?.template.outputs[0].textCard).toEqual({
      title: "알림",
      description,
      buttons: [
        { action: "webLink", label: "주문 보기", webLinkUrl: new URL(`/owner/orders/${order.orderId}`, origin).href },
      ],
    });
  });

  it.each([["handoff_appended", "에스컬레이션 건에 새 질문이 있어요"]] as const)(
    "추가 질문 %s는 할 일 목록을 엶",
    (kind, description) => {
      const card = renderOwnerAlert({ kind }, "normal", origin)?.template.outputs[0].textCard;
      expect(card?.description).toBe(description);
      expect(card?.buttons[0]?.webLinkUrl).toBe("https://test.example/owner");
    },
  );
  it("장부 실패는 중복 이벤트가 아닌 미기록 주문 수와 재연결을 안내한다", () => {
    const card = renderOwnerAlert({ kind: "ledger_failing", count: 2 }, "normal", origin)?.template.outputs[0].textCard;
    expect(card?.description).toBe("장부에 못 적은 주문 2건, 장부 연결을 다시 해 주세요");
  });

  it("계좌 변경에는 결제 수단 주소만 담음", () => {
    expect(
      renderOwnerAlert({ kind: "payment_account_changed" }, "normal", origin)?.template.outputs[0].textCard,
    ).toEqual({
      title: "알림",
      description: "결제 받을 계좌가 바뀌었어요",
      buttons: [
        { action: "webLink", label: "결제 수단 보기", webLinkUrl: "https://test.example/owner/payment-destination" },
      ],
    });
  });

  it("영업 신고와 사업자 정보 결과는 400자 한도 안에서 표시", () => {
    const onHold = renderOwnerAlert({ kind: "license_on_hold", reason: "사유 확인" }, "normal", origin);
    expect(onHold?.template.outputs[0].textCard.description).toBe("영업 신고가 보류됐어요: 사유 확인");

    const applied = renderOwnerAlert({ kind: "identity_change_applied" }, "normal", origin);
    expect(applied?.template.outputs[0].textCard.description).toBe("사업자 정보 변경이 반영됐어요");

    const alert = renderOwnerAlert({ kind: "identity_change_on_hold", reason: "확인🔸".repeat(250) }, "normal", origin);
    const card = alert?.template.outputs[0].textCard;
    expect(card?.description).toMatch(/^사업자 정보 변경이 보류됐어요: 확인/);
    expect(card?.description.endsWith("…")).toBe(true);
    expect((card?.title.length ?? 0) + (card?.description.length ?? 0)).toBeLessThanOrEqual(400);
    expect(card?.description).not.toMatch(/[\uD800-\uDBFF]…$/);
    expect(alert?.template.outputs).toHaveLength(1);
  });

  it("미발송과 발송 오류에서는 말풍선이 없음", () => {
    const alert = { kind: "new_task", task: "handoff", count: 1 } as const;
    expect(renderOwnerAlert(alert, "not-sent", origin)).toBeNull();
    expect(renderOwnerAlert(alert, "error", origin)).toBeNull();
  });

  it("처리 뒤에도 알림의 링크는 현재 할 일 목록을 엶", () => {
    const alert = { kind: "new_task", task: "payment_claim", count: 1 } as const;
    expect(renderOwnerAlert(alert, "stale", origin)).toEqual(renderOwnerAlert(alert, "normal", origin));
  });
});
