// SCR-019. 발송 실행기가 전달한 알림과 상태를 카카오 스킬 응답으로 변환한다.
export const TASK_LABELS = {
  handoff: "에스컬레이션 건",
  custom_order: "맞춤 주문",
  change_request: "변경 요청",
  issue_report: "문제 신고",
  payment_claim: "결제 확인 요청",
  payment_mismatch: "맞추는 중",
  payment_overdue: "결제 기한 지남",
  refund_decision: "환불 결정",
  paid_after_cancel: "취소 뒤 들어온 입금",
  refund_send: "환불 보내기",
  arrival_check: "들어온 입금 대조",
  ledger_relink: "장부 다시 연결",
  license_on_hold: "영업 신고 보류",
  calendar_conflict: "영업 캘린더 기준을 넘는 날",
} as const;

export type OwnerAlert =
  | { kind: "new_task"; task: keyof typeof TASK_LABELS; count: number }
  | { kind: "ledger_failing"; count: number; duplicateOrderNo?: string }
  | { kind: "task_realert"; task: keyof typeof TASK_LABELS }
  | {
      kind: "handoff_appended" | "payment_account_changed" | "identity_change_applied" | "channel_event_unavailable";
    }
  | { kind: "license_on_hold" | "identity_change_on_hold"; reason: string }
  | {
      kind: "order_cancelled" | "new_amount_declined" | "change_not_applied" | "health_concern";
      orderId: string;
      orderNo: string;
    };

type AlertState = "normal" | "not-sent" | "error" | "stale";
type Destination = { label: string; path: string };
type AlertCard = { title: "할 일" | "알림"; description: string; destination: Destination };

const TASKS = { label: "할 일 목록 열기", path: "/owner" };
const LICENSE = { label: "영업 신고 보기", path: "/owner/shop/license" };
const PAYMENT = { label: "결제 수단 보기", path: "/owner/payment-destination" };

function taskSubject(task: keyof typeof TASK_LABELS): string {
  const label = TASK_LABELS[task];
  const lastHangulCode = label.charCodeAt(label.length - 1);
  return label + ((lastHangulCode - 0xac00) % 28 === 0 ? "가" : "이");
}

function taskCard(description: string): AlertCard {
  return { title: "할 일", description, destination: TASKS };
}

function noticeCard(description: string, destination: Destination): AlertCard {
  return { title: "알림", description, destination };
}

function orderCard(description: string, alert: { orderId: string; orderNo: string }): AlertCard {
  return noticeCard(description, { label: "주문 보기", path: `/owner/orders/${encodeURIComponent(alert.orderId)}` });
}

function describeAlert(alert: OwnerAlert): AlertCard {
  switch (alert.kind) {
    case "new_task":
      return taskCard(
        alert.count > 1 ? `${TASK_LABELS[alert.task]} ${alert.count}건` : `${taskSubject(alert.task)} 생겼어요`,
      );
    case "task_realert":
      return taskCard(`아직 답하지 않은 ${taskSubject(alert.task)} 있어요`);
    case "handoff_appended":
      return taskCard("에스컬레이션 건에 새 질문이 있어요");
    case "ledger_failing":
      if (alert.duplicateOrderNo !== undefined)
        return taskCard(`장부에 같은 주문(주문번호 ${alert.duplicateOrderNo})이 두 줄 있어요. 하나를 지워 주세요`);
      return taskCard(`장부에 못 적은 주문 ${alert.count}건, 장부 연결을 다시 해 주세요`);
    case "license_on_hold":
      return taskCard(`영업 신고가 보류됐어요: ${alert.reason}`);
    case "payment_account_changed":
      return noticeCard("결제 받을 계좌가 바뀌었어요", PAYMENT);
    case "channel_event_unavailable":
      return noticeCard("손님 안내를 먼저 보낼 수 없어요. 카카오 연결을 확인해 주세요", {
        label: "카카오 연결 보기",
        path: "/owner/kakao-channel",
      });
    case "identity_change_applied":
      return noticeCard("사업자 정보 변경이 반영됐어요", LICENSE);
    case "identity_change_on_hold":
      return noticeCard(`사업자 정보 변경이 보류됐어요: ${alert.reason}`, LICENSE);
    case "order_cancelled":
      return orderCard(`주문이 취소됐어요(주문 ${alert.orderNo})`, alert);
    case "new_amount_declined":
      return orderCard(`손님이 새 금액을 받지 않았어요(주문 ${alert.orderNo})`, alert);
    case "change_not_applied":
      return orderCard(
        `변경이 반영되지 않았어요(주문 ${alert.orderNo}). 차액이 들어오지 않아 원래 주문대로 해요`,
        alert,
      );
    case "health_concern":
      return orderCard(`손님이 몸이 불편하다고 했어요(주문 ${alert.orderNo})`, alert);
  }
}

function fitDescription(text: string, limit: number): string {
  if (text.length <= limit) return text;

  let prefix = "";
  for (const character of text) {
    if (prefix.length + character.length >= limit) break;
    prefix += character;
  }
  return `${prefix}…`;
}

/** 수신자가 보는 카카오 2.0 응답을 만든다. 말풍선이 없는 상태는 null이다. */
export function renderOwnerAlert(alert: OwnerAlert, state: AlertState, origin: URL) {
  if (state === "not-sent" || state === "error") return null;

  const { title, description, destination } = describeAlert(alert);
  return {
    version: "2.0" as const,
    template: {
      outputs: [
        {
          textCard: {
            title,
            description: fitDescription(description, 400 - title.length),
            buttons: [
              {
                action: "webLink" as const,
                label: destination.label,
                webLinkUrl: new URL(destination.path, origin).href,
              },
            ],
          },
        },
      ] as const,
    },
  };
}
