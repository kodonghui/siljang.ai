import { useState } from "react";
import type { PriceList } from "./price-list-api";
import { fetchPriceListVersion, fetchPriceListVersions } from "./price-list-history-api";
import type { ShopLicenseProps } from "./ShopLicense";
import { EmptyState, ListView } from "./ui";
import { historyDate as date, VersionHistory, type VersionHistoryConfig } from "./VersionHistory";
import "./price-list-history.css";

const config: VersionHistoryConfig<PriceList> = {
  path: "/owner/price-list",
  screen: "SCR-037",
  name: "가격표",
  note: "이전 버전은 고칠 수 없어요",
  currentLabel: "현재 가격표로",
  emptyText: "아직 저장한 가격표가 없어요",
  createLabel: "가격표 만들기",
  timestampLabel: "저장",
  list: fetchPriceListVersions,
  detail: fetchPriceListVersion,
  Details: VersionDetails,
};
export function PriceListHistory(props: ShopLicenseProps & { readonly version?: string | null }) {
  return <VersionHistory {...props} config={config} />;
}
const groups = { size: "크기", flavor: "맛", design: "디자인", extra: "추가" };
const money = (list: PriceList["options"][number]) =>
  list.priceKind === "from"
    ? `${list.amount.toLocaleString("ko-KR")}원부터`
    : list.priceKind === "range"
      ? `${list.amount.toLocaleString("ko-KR")}~${list.amountMax?.toLocaleString("ko-KR")}원`
      : `${list.amount.toLocaleString("ko-KR")}원`;
function VersionDetails({ value: list }: { readonly value: PriceList }) {
  const option = (id: string) => list.options.find((o) => o.optionId === id)?.name ?? "연결 없음";
  return (
    <>
      <h2>버전 {list.version} (고른 버전)</h2>
      <p>
        저장 시각 {date(list.createdAt)}
        {list.current ? " · 현재" : list.supersededAt ? ` · 바뀐 시각 ${date(list.supersededAt)}` : ""}
      </p>
      <section>
        <h3>옵션</h3>
        <ListView
          label="고른 버전 옵션"
          rows={list.options}
          rowKey={(row) => row.optionId}
          empty="옵션이 없어요"
          columns={[
            { label: "이름", cell: (row) => row.name, card: "title" },
            { label: "그룹", cell: (row) => groups[row.group], card: "meta" },
            { label: "금액", cell: money, card: "body" },
            {
              label: "기본 디자인 범위",
              cell: (row) => (row.inStandard ? "범위 안" : "맞춤 주문으로만"),
              card: "meta",
            },
          ]}
        />
      </section>
      <section>
        <h3>옵션 규칙</h3>
        <ListView
          label="고른 버전 옵션 규칙"
          rows={list.rules}
          rowKey={(row) => JSON.stringify([row.optionAId, row.optionBId])}
          empty="옵션 규칙이 없어요"
          columns={[
            { label: "옵션 A", cell: (row) => option(row.optionAId), card: "title" },
            { label: "옵션 B", cell: (row) => option(row.optionBId), card: "meta" },
            {
              label: "규칙",
              cell: (row) =>
                row.kind === "exclude" ? "함께 못 고름" : `${row.amount?.toLocaleString("ko-KR")}원 더함`,
              card: "body",
            },
          ]}
        />
      </section>
      <section>
        <h3>도안</h3>
        {list.designs.length === 0 ? (
          <EmptyState>도안이 없어요</EmptyState>
        ) : (
          <ul className="price-history__designs">
            {list.designs.map((design) => (
              <li key={design.designId}>
                <HistoryImage design={design} />
                <strong>{design.name}</strong>
                <span>{design.optionId === null ? "연결 없음" : option(design.optionId)}</span>
                <span>{design.inStandard ? "기본 디자인 범위" : "맞춤 주문으로만"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
function HistoryImage({ design }: { readonly design: PriceList["designs"][number] }) {
  const [failed, setFailed] = useState<string | null>(null);
  return failed === design.imageUrl ? (
    <p>도안 그림을 불러오지 못했어요.</p>
  ) : (
    <img
      src={design.imageUrl}
      alt={`${design.name} 그림`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(design.imageUrl)}
    />
  );
}
