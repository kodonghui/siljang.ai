/** 저장된 ChangeSet의 계약 필드만 표시한다. 주문·차액·기한을 바꾸지 않는다. */
import { toShopLocal } from "./time";

export function paymentChangeSummary(value: unknown, timeZone: string): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const changes = value as Record<string, unknown>;
  const allowed = new Set([
    "size",
    "flavor",
    "design",
    "extras",
    "designNotes",
    "lettering",
    "colors",
    "pickupAt",
    "courierPickup",
  ]);
  if (Object.keys(changes).length === 0 || Object.keys(changes).some((key) => !allowed.has(key))) return null;
  const lines = ["바뀌는 내용"];
  for (const [key, label, minimum, maximum] of [
    ["size", "크기", 1, 30],
    ["flavor", "맛", 1, 30],
    ["design", "디자인", 1, 30],
    ["designNotes", "디자인 설명", 0, 500],
    ["lettering", "문구", 0, 50],
    ["colors", "색", 0, 100],
  ] as const) {
    if (!Object.hasOwn(changes, key)) continue;
    const text = changes[key];
    if (typeof text !== "string" || text.includes("\0") || [...text].length < minimum || [...text].length > maximum)
      return null;
    lines.push(`${label} ${text || "없음"}`);
  }
  if (Object.hasOwn(changes, "extras")) {
    const extras = changes.extras;
    if (
      !Array.isArray(extras) ||
      extras.length > 20 ||
      extras.some(
        (text) => typeof text !== "string" || text.includes("\0") || [...text].length < 1 || [...text].length > 30,
      )
    )
      return null;
    lines.push(`더하는 옵션 ${extras.length ? extras.join(" · ") : "없음"}`);
  }
  if (Object.hasOwn(changes, "pickupAt")) {
    if (
      typeof changes.pickupAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(changes.pickupAt)
    )
      return null;
    const instant = new Date(changes.pickupAt);
    if (!Number.isFinite(instant.getTime())) return null;
    const local = toShopLocal(instant, timeZone);
    lines.push(`픽업 ${local.date} ${local.time}`);
  }
  if (Object.hasOwn(changes, "courierPickup")) {
    if (typeof changes.courierPickup !== "boolean") return null;
    lines.push(changes.courierPickup ? "손님이 부른 퀵으로 받음" : "방문 픽업");
  }
  return lines.join("\n");
}
