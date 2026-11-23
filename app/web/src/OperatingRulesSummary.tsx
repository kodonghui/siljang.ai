import type { OperatingRules } from "./operating-rules-api";
import "./operating-rules.css";
export const OPERATING_RULE_LABELS = {
  quoteValidHours: "견적 유효 기한(시간)",
  paymentDueHours: "결제 기한(시간)",
  issueReportHours: "문제 신고 기한(시간)",
  changeDeadlineHours: "변경 마감(시간)",
  cancellationFeeKrw: "취소 수수료(원)",
  preProductionRefundPct: "제작 전 취소 환불(%)",
} as const;
export function OperatingRulesSummary({
  value,
  showVersion = true,
}: {
  readonly value: OperatingRules;
  readonly showVersion?: boolean;
}) {
  return (
    <div className="rules-comparison">
      {showVersion ? <p>{value.isTemplate ? "아직 확정 전이에요" : `운영규정 버전 ${value.version}`}</p> : null}
      <dl>
        {(Object.entries(OPERATING_RULE_LABELS) as [keyof typeof OPERATING_RULE_LABELS, string][]).map(
          ([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{value[key]?.toLocaleString("ko-KR") ?? "아직 정하지 않음"}</dd>
            </div>
          ),
        )}
        <div>
          <dt>날짜 변경 환불 기준</dt>
          <dd>
            {value.dateChangeRefundBasis === "original_pickup"
              ? "처음 픽업 일시"
              : value.dateChangeRefundBasis === "new_pickup"
                ? "바꾼 픽업 일시"
                : "아직 정하지 않음"}
          </dd>
        </div>
      </dl>
      {value.clauses.map((row) => (
        <details key={row.position}>
          <summary>{row.title}</summary>
          <p>{row.conditionText}</p>
          <p>{row.effectText}</p>
        </details>
      ))}
      <ul>
        {value.refundTiers.map((row) => (
          <li key={JSON.stringify([row.hoursBeforeMin, row.hoursBeforeMax])}>
            {row.hoursBeforeMin}시간 전부터{" "}
            {row.hoursBeforeMax === null ? "끝없음" : `${row.hoursBeforeMax}시간 전까지`} · {row.refundPct}%
          </li>
        ))}
      </ul>
    </div>
  );
}
