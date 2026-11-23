import { useEffect, useRef, useState } from "react";
import { CALENDAR_ORDER_STATUSES, type CalendarConflict } from "./calendar-conflicts";
import { formatKoreanDate, formatKoreanDateTime } from "./format-date";
import { Button } from "./ui";
import "./calendar-conflicts.css";
export function CalendarConflictList({
  values,
  disabled,
}: {
  readonly values: readonly CalendarConflict[];
  readonly disabled: boolean;
}) {
  const [limit, setLimit] = useState(10);
  const root = useRef<HTMLElement>(null),
    pendingDay = useRef<string | null>(null);
  useEffect(() => {
    const day = pendingDay.current;
    if (!day) return;
    const heading = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-conflict-day]") ?? []).find(
      (item) => item.dataset.conflictDay === day,
    );
    if (!heading?.isConnected) return;
    heading.focus();
    if (heading.ownerDocument.activeElement === heading) pendingDay.current = null;
  });
  if (!values.length) return null;
  return (
    <section ref={root} className="calendar-conflict-list" aria-label="관련 날짜와 주문">
      <p>주문과 잡힌 자리는 그대로 남아요</p>
      {values.slice(0, limit).map((item) => (
        <section key={item.day}>
          <h3 data-conflict-day={item.day} tabIndex={-1}>
            {formatKoreanDate(item.day)} 관련 주문
          </h3>
          <p>
            잡힌 자리 {item.held} · 하루 최대 개수 {item.capacity}
          </p>
          <ul>
            {item.orders.map((order) => (
              <li key={order.orderId}>
                <span>{order.orderNo}</span> · {CALENDAR_ORDER_STATUSES[order.status]} ·{" "}
                {formatKoreanDateTime(order.pickupAt)}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {limit < values.length ? (
        <Button
          disabled={disabled}
          onClick={() => {
            pendingDay.current = values[limit]?.day ?? null;
            setLimit((old) => old + 10);
          }}
        >
          더 보기
        </Button>
      ) : null}
    </section>
  );
}
