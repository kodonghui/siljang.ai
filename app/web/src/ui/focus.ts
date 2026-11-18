// 모달 창(확인 창·360 열린 메뉴)이 함께 쓰는 포커스 가둠: Tab·Shift+Tab이 창 안에서 돈다.
import type { KeyboardEvent } from "react";

export const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** 창 안의 누를 수 있는 것(막힌 것 빼고) */
export function focusables(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled"));
}

export function keepFocusInside(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const items = focusables(e.currentTarget);
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
