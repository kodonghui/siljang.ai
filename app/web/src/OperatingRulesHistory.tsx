import { OperatingRulesSummary } from "./OperatingRulesSummary";
import type { OperatingRules } from "./operating-rules-api";
import { fetchOperatingRulesVersion, fetchOperatingRulesVersions } from "./operating-rules-history-api";
import type { ShopLicenseProps } from "./ShopLicense";
import { historyDate, VersionHistory, type VersionHistoryConfig } from "./VersionHistory";

const config: VersionHistoryConfig<OperatingRules> = {
  path: "/owner/operating-rules",
  screen: "SCR-039",
  name: "운영규정",
  note: "이전 버전은 고칠 수 없어요. 그 버전으로 받은 주문은 이 조문으로 환불을 계산해요",
  currentLabel: "현재 운영규정으로",
  emptyText: "아직 확정한 운영규정이 없어요",
  createLabel: "운영규정 정하기",
  timestampLabel: "확정",
  list: fetchOperatingRulesVersions,
  detail: fetchOperatingRulesVersion,
  Details,
};
export function OperatingRulesHistory(props: ShopLicenseProps & { readonly version?: string | null }) {
  return <VersionHistory {...props} config={config} />;
}
function Details({ value }: { readonly value: OperatingRules }) {
  return (
    <>
      <h2>버전 {value.version} (고른 버전)</h2>
      <p>
        확정 시각 {value.createdAt ? historyDate(value.createdAt) : "확인할 수 없음"}
        {value.current ? " · 현재" : value.supersededAt ? ` · 바뀐 시각 ${historyDate(value.supersededAt)}` : ""}
      </p>
      <OperatingRulesSummary value={value} showVersion={false} />
    </>
  );
}
