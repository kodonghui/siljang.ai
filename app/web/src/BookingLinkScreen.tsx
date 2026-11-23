import { useEffect, useState } from "react";
import { BOOKING_CONDITIONS, type BookingCondition, type BookingLink, fetchBookingLink } from "./booking-link-api";
import { CopyValue } from "./CopyValue";
import { formatKoreanDateTime, formatSeoulDateTime } from "./format-date";
import { classify } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import { Banner, Button, Icon, LoadFailure, OwnerLayout, Skeleton } from "./ui";
import { useVersionedRead } from "./useVersionedRead";
import "./booking-link-screen.css";

const conditions: Record<BookingCondition, { label: string; href?: string; action?: string; waiting?: string }> = {
  license_verified: { label: "영업 신고 확인", waiting: "운영자가 확인하고 있어요" },
  price_list: { label: "가격표", href: "/owner/price-list", action: "가격표 등록하기" },
  operating_rules: { label: "운영규정", href: "/owner/operating-rules", action: "운영규정 등록하기" },
  calendar: { label: "영업 캘린더", href: "/owner/calendar/settings", action: "영업 캘린더 정하기" },
  payment_destination: { label: "결제 수단", href: "/owner/payment-destination", action: "결제 수단 등록하기" },
  kakao_channel: { label: "채널 연결", href: "/owner/kakao-channel", action: "채널 연결하기" },
  privacy_policy: { label: "개인정보 처리방침", waiting: "운영자가 준비하고 있어요" },
};
export function BookingLinkScreen(props: ShopLicenseProps) {
  const [data, setData] = useState<BookingLink | null>(null),
    [asOf, setAsOf] = useState<number | null>(null);
  const navigationLocked = Boolean(props.sessionChecking || props.logoutPending),
    blocked = navigationLocked || Boolean(props.sessionFailed);
  const { loading, failure, read, retry } = useVersionedRead(fetchBookingLink, {
    sessionChecking: navigationLocked,
    sessionFailed: Boolean(props.sessionFailed),
    onLoaded: (_mode, value) => {
      setData(value);
      setAsOf(Date.now());
    },
    onSessionExpired: props.onSessionExpired,
    onRegisterShop: props.onRegisterShop,
  });
  useEffect(() => {
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) read();
    };
    const visibility = () => {
      if (document.visibilityState !== "hidden") read();
    };
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [read]);
  const locked = blocked || loading;
  const go = (href: string, event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!navigationLocked) props.onNavigate(href);
  };
  return (
    <OwnerLayout
      screen="SCR-043"
      title="예약 링크"
      shopName={props.shopName}
      back="/owner/shop"
      busy={navigationLocked}
      onNavigate={go}
    >
      <div className="booking-link-screen">
        <div className="booking-toolbar">
          <Button
            disabled={navigationLocked}
            busy={Boolean(props.logoutPending)}
            onClick={() => {
              if (!navigationLocked) props.onLogout();
            }}
          >
            로그아웃
          </Button>
          {asOf !== null ? <p>{formatSeoulDateTime(new Date(asOf).toISOString()).slice(-5)} 기준</p> : null}
          <Button
            disabled={locked}
            busy={loading}
            onClick={() => {
              if (!locked) read();
            }}
          >
            새로 고침
          </Button>
        </div>
        {props.logoutFailure ? <Banner tone="danger">{props.logoutFailure.message}</Banner> : null}
        {loading && data === null ? <Skeleton label="예약 링크를 불러오고 있어요" rows={5} /> : null}
        {failure ? (
          <>
            <LoadFailure
              failure={classify(failure.status, failure.problem, failure.retryAfterSeconds)}
              disabled={locked}
              onRetry={() => {
                if (!locked) retry();
              }}
              onLogin={props.onSessionExpired}
              onRegisterShop={props.onRegisterShop}
            />
            {data ? (
              <Banner tone="warning">이전 정보를 보고 있어요. 새로 고침으로 지금 상태를 확인해 주세요.</Banner>
            ) : null}
          </>
        ) : null}
        {data?.status === "issued" && data.url && data.issuedAt ? (
          <section className="booking-issued" aria-label="발급된 예약 링크">
            <CopyValue label="예약 링크" value={data.url} disabled={locked} />
            <a
              className="booking-open"
              href={data.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={locked || undefined}
              tabIndex={locked ? -1 : undefined}
              onClick={(event) => {
                if (locked) event.preventDefault();
              }}
            >
              예약 링크 페이지 열기
            </a>
            <p>발급 시각 {formatKoreanDateTime(data.issuedAt)}</p>
            <p>카카오톡 채널 프로필과 인스타그램 프로필에 이 주소를 넣어 주세요</p>
          </section>
        ) : data?.status === "not_ready" ? (
          <section className="booking-not-ready" aria-label="예약 링크 준비">
            <h2>예약 링크를 만들려면 아래를 마쳐 주세요</h2>
            <ul className="booking-conditions" aria-label="준비 조건">
              {BOOKING_CONDITIONS.map((key) => {
                const condition = conditions[key],
                  href = condition.href,
                  missing = data.missing.includes(key);
                return (
                  <li key={key}>
                    <span>{condition.label}</span>
                    {!missing ? (
                      <span className="booking-done">
                        <Icon name="check" size="sm" />
                        마침
                      </span>
                    ) : href ? (
                      <a
                        href={href}
                        aria-disabled={navigationLocked || undefined}
                        tabIndex={navigationLocked ? -1 : undefined}
                        onClick={(event) => go(href, event)}
                      >
                        {condition.action}
                      </a>
                    ) : (
                      <span>{condition.waiting}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {data?.recommended.includes("pickup_address") ? (
          <p>
            픽업 장소를 넣으면 전날 안내에 함께 나가요{" "}
            <a href="/owner/shop" onClick={(event) => go("/owner/shop", event)}>
              픽업 장소 넣기
            </a>
          </p>
        ) : null}
      </div>
    </OwnerLayout>
  );
}
