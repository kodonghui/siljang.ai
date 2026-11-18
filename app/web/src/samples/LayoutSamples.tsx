// 레이아웃 견본(TASK-182, 개발 서버의 /samples.html?state=layout-…에서만). 화면 값은 09 목업 견본(research/cake-mockup-2026-11/
// screen_samples.py)의 지어낸 값이고 화면 내용은 화면 작업 몫이라 목록·묶음만 둔다. 링크는 이동하지 않고 window.__sampleNav에 남겨
// scripts/page-check.mjs가 '항목을 누르면 열린 메뉴가 닫힘'을 본다.
import { type MouseEvent, type ReactNode, useEffect } from "react";
import {
  AsOf,
  type ListColumn,
  ListView,
  LoadFailure,
  LoginLayout,
  OperatorLayout,
  OwnerLayout,
  PageSection,
  SetupLayout,
  Skeleton,
} from "../ui";
import { sampleFailure } from "./fake";

export const LAYOUT_STATES = {
  "layout-owner": "레이아웃: 사장님 1뎁스 화면(주문 목록, 1280 표·360 카드)",
  "layout-owner-sub": "레이아웃: 사장님 하위 화면(주문 상세, 뒤로)",
  "layout-owner-list-states": "레이아웃: 목록의 상태(불러오는 중·빈 목록·불러오기 실패)",
  "layout-operator": "레이아웃: 운영자 1뎁스 화면(영업 신고 확인 목록)",
  "layout-operator-sub": "레이아웃: 운영자 하위 화면(가게 기록 보기, 영업 신고 확인 표시)",
  "layout-setup": "레이아웃: 가게 등록 전(메뉴 없음)",
  "layout-login": "레이아웃: 로그인(메뉴 없음)",
  "flow-menu": "플로우: 360 메뉴 열기 → 항목 → 닫기",
} as const;

export type LayoutState = keyof typeof LAYOUT_STATES;

declare global {
  interface Window {
    __sampleNav?: string[];
  }
}

const SHOP = "달빛케이크";
const OPERATOR = "운영자 한빛";
const noop = () => {};

/** 견본의 링크는 이동하지 않고 누른 주소를 남김(라우터가 붙을 자리) */
function navigate(href: string, e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  window.__sampleNav = [...(window.__sampleNav ?? []), href];
}

interface Order {
  readonly code: string;
  readonly kind: string;
  readonly status: string;
  readonly pickup: string;
  readonly customer: string;
  readonly amount: string;
}

/** 09 견본 SCR-020 주문(지어낸 값) */
const ORDERS: readonly Order[] = [
  {
    code: "P4X8N2",
    kind: "맞춤 주문",
    status: "주문 요청",
    pickup: "11월 20일(금) 16:00",
    customer: "박하늘",
    amount: "70,000원부터",
  },
  {
    code: "K7Q3M9",
    kind: "기본 디자인 주문",
    status: "주문 확정",
    pickup: "11월 20일(금) 14:00",
    customer: "이지우",
    amount: "36,000원",
  },
  {
    code: "R2D5T7",
    kind: "기본 디자인 주문 · 재제작",
    status: "주문 확정",
    pickup: "11월 25일(수) 15:00",
    customer: "이지우",
    amount: "0원",
  },
];

/** 08 SCR-020 목록의 열(09 견본의 카드 자리: 제목 0, 라벨 2, 줄 3·4·1, 아래 5) */
const ORDER_COLUMNS: readonly ListColumn<Order>[] = [
  { label: "주문번호", cell: (o) => o.code, card: "title", width: "narrow" },
  { label: "종류", cell: (o) => o.kind, card: "meta" },
  { label: "상태", cell: (o) => o.status, card: "tag", width: "narrow" },
  { label: "픽업 일시", cell: (o) => o.pickup, card: "meta" },
  { label: "손님", cell: (o) => o.customer, card: "meta", width: "narrow" },
  { label: "금액", cell: (o) => o.amount, card: "foot" },
];

const orderList = (rows: readonly Order[]) => (
  <ListView
    label="주문"
    columns={ORDER_COLUMNS}
    rows={rows}
    rowKey={(o) => o.code}
    href={(o) => `/owner/orders/${o.code}`}
    onNavigate={navigate}
    empty="조건에 맞는 주문이 없어요"
  />
);

interface Shop {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly bizNo: string;
  readonly license: string;
  readonly at: string;
}

/** 09 견본 SCR-047(지어낸 값) */
const SHOPS: readonly Shop[] = [
  {
    id: "shop-1",
    name: SHOP,
    owner: "달빛케이크 · 김달빛",
    bizNo: "123-45-67891",
    license: "2026-0123456 · 즉석판매제조·가공업",
    at: "11월 12일 10:05",
  },
];

const SHOP_COLUMNS: readonly ListColumn<Shop>[] = [
  { label: "가게 이름", cell: (s) => s.name, card: "title" },
  { label: "상호·대표자", cell: (s) => s.owner, card: "meta" },
  { label: "사업자등록번호", cell: (s) => s.bizNo, card: "meta" },
  { label: "영업 신고 번호·종류", cell: (s) => s.license, card: "meta", width: "wide" },
  { label: "등록 시각", cell: (s) => s.at, card: "foot" },
];

/** 견본임을 알리는 마지막 묶음(page-check가 이 상태가 그려졌는지 봄) */
function SampleNote({ state }: { readonly state: LayoutState }) {
  return (
    <PageSection>
      <p className="sample__state">
        {LAYOUT_STATES[state]} · {state}
      </p>
    </PageSection>
  );
}

function Ready({ state, children }: { readonly state: LayoutState; readonly children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.sampleReady = state;
  }, [state]);
  return <>{children}</>;
}

function Body({ state }: { readonly state: LayoutState }) {
  switch (state) {
    case "layout-owner":
      return (
        <OwnerLayout screen="SCR-020" title="주문" shopName={SHOP} todoCount={3} onNavigate={navigate}>
          <PageSection>
            <AsOf time="14:05" onRefresh={noop} />
            {orderList(ORDERS)}
          </PageSection>
          <SampleNote state={state} />
        </OwnerLayout>
      );
    case "layout-owner-sub":
      return (
        <OwnerLayout
          screen="SCR-021"
          title="주문 K7Q3M9"
          meta="이지우 · 010-9876-5432 · 11월 12일 13:05 요청"
          back="/owner/orders"
          shopName={SHOP}
          todoCount={3}
          onNavigate={navigate}
        >
          <PageSection title="주문 K7Q3M9">
            <p>상태 주문 확정 · 픽업 11월 20일(금) 14:00 · 금액 36,000원</p>
          </PageSection>
          <PageSection title="주문 내용 (버전 2)">
            <p>1호 · 생크림 · 기본 레터링 · 하트 레터링</p>
          </PageSection>
          <SampleNote state={state} />
        </OwnerLayout>
      );
    case "layout-owner-list-states":
      return (
        <OwnerLayout screen="SCR-028" title="입금 대조" shopName={SHOP} todoCount={3} onNavigate={navigate}>
          <PageSection title="불러오는 중">
            <Skeleton />
          </PageSection>
          <PageSection title="빈 목록">{orderList([])}</PageSection>
          <PageSection title="불러오기 실패">
            <LoadFailure failure={sampleFailure("internal")} onRetry={noop} />
          </PageSection>
          <SampleNote state={state} />
        </OwnerLayout>
      );
    case "layout-operator":
      return (
        <OperatorLayout
          screen="SCR-047"
          title="영업 신고 확인"
          meta="등록이 오래된 순"
          operatorName={OPERATOR}
          onLogout={noop}
          onNavigate={navigate}
        >
          <PageSection>
            <ListView
              label="가게"
              columns={SHOP_COLUMNS}
              rows={SHOPS}
              rowKey={(s) => s.id}
              href={(s) => `/operator/shops/${s.id}`}
              onNavigate={navigate}
              empty="확인할 가게가 없어요"
            />
          </PageSection>
          <SampleNote state={state} />
        </OperatorLayout>
      );
    case "layout-operator-sub":
      return (
        <OperatorLayout
          screen="SCR-050"
          title="가게 기록 보기"
          meta={SHOP}
          back="/operator/shops/shop-1"
          operatorName={OPERATOR}
          onLogout={noop}
          onNavigate={navigate}
        >
          <PageSection title="주문">
            <p>가게 기록은 운영자가 볼 때마다 접속기록에 남아요.</p>
          </PageSection>
          <SampleNote state={state} />
        </OperatorLayout>
      );
    case "layout-setup":
      return (
        <SetupLayout title="가게 등록">
          <p>가게를 등록하면 메뉴가 열려요.</p>
          <p className="sample__state">
            {LAYOUT_STATES[state]} · {state}
          </p>
        </SetupLayout>
      );
    case "layout-login":
      return (
        <LoginLayout title="운영자 로그인">
          <p>우리 서비스 운영자용</p>
          <p className="sample__state">
            {LAYOUT_STATES[state]} · {state}
          </p>
        </LoginLayout>
      );
    case "flow-menu":
      return (
        <OwnerLayout screen="SCR-016" title="할 일" shopName={SHOP} todoCount={3} onNavigate={navigate}>
          <PageSection>
            <button type="button" className="ui-button ui-button--secondary" data-sample="after">
              본문의 첫 버튼
            </button>
          </PageSection>
          <SampleNote state={state} />
        </OwnerLayout>
      );
  }
}

export function LayoutSample({ state }: { readonly state: LayoutState }) {
  return (
    <Ready state={state}>
      <Body state={state} />
    </Ready>
  );
}
