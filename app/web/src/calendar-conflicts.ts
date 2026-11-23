import { isApiObject, isApiTimestamp, UUID_PATTERN } from "./api-response";
import { isCalendarDate } from "./calendar-date";
export const CALENDAR_ORDER_STATUSES = {
  requested: "주문 요청",
  awaiting_payment: "입금 기다림",
  payment_overdue: "입금 기한 지남",
  confirmed: "주문 확정",
  received: "인도 완료",
  no_pickup: "미수령",
  rejected: "거절",
  cancelled: "취소",
} as const;
export interface CalendarConflictOrder {
  readonly orderId: string;
  readonly orderNo: string;
  readonly status: keyof typeof CALENDAR_ORDER_STATUSES;
  readonly pickupAt: string;
}
export interface CalendarConflict {
  readonly day: string;
  readonly capacity: number;
  readonly held: number;
  readonly orders: readonly CalendarConflictOrder[];
}
const integer = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
/** API의 확인 자료만 읽고 연락처 등 계약 밖 속성은 복사하지 않는다. */
export function parseCalendarConflicts(value: unknown): readonly CalendarConflict[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 400) return null;
  const result: CalendarConflict[] = [];
  for (const item of value) {
    if (
      !isApiObject(item) ||
      !isCalendarDate(item.day) ||
      !integer(item.capacity, 100) ||
      !integer(item.held, 10000) ||
      !Array.isArray(item.orders) ||
      item.orders.length < 1 ||
      item.orders.length > 100
    )
      return null;
    const orders: CalendarConflictOrder[] = [];
    for (const order of item.orders) {
      if (
        !isApiObject(order) ||
        typeof order.orderId !== "string" ||
        !UUID_PATTERN.test(order.orderId) ||
        typeof order.orderNo !== "string" ||
        !/^[0-9A-Z]{6,8}$/.test(order.orderNo) ||
        typeof order.status !== "string" ||
        !Object.hasOwn(CALENDAR_ORDER_STATUSES, order.status) ||
        !isApiTimestamp(order.pickupAt) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(order.pickupAt) ||
        !isCalendarDate(order.pickupAt.slice(0, 10))
      )
        return null;
      orders.push({
        orderId: order.orderId,
        orderNo: order.orderNo,
        status: order.status as CalendarConflictOrder["status"],
        pickupAt: order.pickupAt,
      });
    }
    result.push({ day: item.day, capacity: item.capacity, held: item.held, orders });
  }
  return result;
}
