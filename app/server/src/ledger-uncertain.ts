const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_CHECKS = 48;

/** 불확실 요청은 5분 대기하고 성공 뒤 최대 24시간, 48회 확인한다. */
export function ledgerUncertainPlan(
  kind: "uncertain" | "written" | "checked",
  now: Date,
  deadline: Date | null,
  count: number,
) {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > MAX_CHECKS ||
    (deadline !== null && !Number.isFinite(deadline.getTime()))
  )
    throw new RangeError("invalid ledger audit state");
  if (kind === "uncertain") return { nextAt: new Date(now.getTime() + 5 * MINUTE), deadline: null, count };
  if (kind === "written")
    return { nextAt: new Date(now.getTime() + 30 * MINUTE), deadline: new Date(now.getTime() + DAY), count: 0 };
  if (deadline === null) throw new RangeError("missing ledger audit deadline");
  const nextCount = Math.min(count + 1, MAX_CHECKS);
  if (nextCount >= MAX_CHECKS || now.getTime() >= deadline.getTime())
    return { nextAt: null, deadline: null, count: nextCount };
  return { nextAt: new Date(Math.min(now.getTime() + 30 * MINUTE, deadline.getTime())), deadline, count: nextCount };
}
