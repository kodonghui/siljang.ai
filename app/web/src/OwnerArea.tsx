import { useEffect, useMemo, useRef, useState } from "react";
import { matchPath, Navigate, useLocation, useNavigate } from "react-router";
import type { ApiFailure, ApiResult } from "./api";
import { BookingLinkScreen } from "./BookingLinkScreen";
import { CalendarScreen } from "./CalendarScreen";
import { KakaoChannelSettings } from "./KakaoChannelSettings";
import { OperatingRulesEditor } from "./OperatingRulesEditor";
import { OperatingRulesHistory } from "./OperatingRulesHistory";
import {
  fetchOwner,
  OWNER_HOME,
  OWNER_LOGIN,
  OWNER_REGISTER,
  type OwnerIdentity,
  ownerDestination,
  ownerReturnTo,
  signOutOwner,
} from "./owner";
import { PaymentDestinationEditor } from "./PaymentDestinationEditor";
import { PriceListEditor } from "./PriceListEditor";
import { PriceListHistory } from "./PriceListHistory";
import { classify } from "./problems";
import { clearRegistrationDraft, pruneRegistrationDraft } from "./registration-draft";
import { ShopLicense } from "./ShopLicense";
import { ShopRegistration } from "./ShopRegistration";
import { ShopSettings } from "./ShopSettings";
import { Button, LoadFailure, Skeleton } from "./ui";

const shopScreens = [
  { path: "/owner/shop", Screen: ShopSettings, checkDestination: false },
  { path: "/owner/shop/license", Screen: ShopLicense, checkDestination: false },
  { path: "/owner/payment-destination", Screen: PaymentDestinationEditor, checkDestination: false },
  { path: "/owner/price-list", Screen: PriceListEditor, checkDestination: true },
  { path: "/owner/operating-rules", Screen: OperatingRulesEditor, checkDestination: true },
  { path: "/owner/kakao-channel", Screen: KakaoChannelSettings, checkDestination: true },
  { path: "/owner/booking-link", Screen: BookingLinkScreen, checkDestination: true },
  { path: "/owner/calendar", Screen: CalendarScreen, checkDestination: true },
] as const;
const historyScreens = [
  { path: "/owner/price-list/versions/:version?", Screen: PriceListHistory },
  { path: "/owner/operating-rules/versions/:version?", Screen: OperatingRulesHistory },
] as const;
function matchHistory(path: string | undefined) {
  for (const route of historyScreens) {
    const match = matchPath({ path: route.path, caseSensitive: true, end: true }, path ?? "");
    if (match) return { Screen: route.Screen, version: match.params.version ?? null };
  }
  return null;
}

/** 첫 세션 확인 전에는 가린다. 이미 검증한 등록 양식은 재확인·로그아웃 중 잠근 채 보존한다. */
export function OwnerArea() {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = ownerReturnTo(location.pathname + location.search + location.hash);
  const shopPath = requested?.split(/[?#]/)[0]?.replace(/\/+$/, "");
  const historyRoute = matchHistory(shopPath);
  const shopRoute = shopScreens.find((route) => route.path === shopPath);
  const screenRoute = historyRoute ?? shopRoute;
  const history = historyRoute !== null;
  const [revision, setRevision] = useState(0);
  const visit = useMemo(() => ({ key: location.key, revision }), [location.key, revision]);
  const [checked, setChecked] = useState<{ visit: typeof visit; result: ApiResult<OwnerIdentity> } | null>(null);
  const [logout, setLogout] = useState<"pending" | "failed" | null>(null);
  const [logoutFailure, setLogoutFailure] = useState<ApiFailure | null>(null);
  const logoutRequest = useRef<AbortController | null>(null);
  const verified = useRef<{ key: string; data: OwnerIdentity; history: boolean } | null>(null);
  const [registrationNotice, setRegistrationNotice] = useState(false);

  useEffect(() => {
    const recheck = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setRegistrationNotice(false);
        pruneRegistrationDraft();
        setRevision((r) => r + 1);
      }
    };
    window.addEventListener("pageshow", recheck);
    return () => window.removeEventListener("pageshow", recheck);
  }, []);
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    void fetchOwner(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          if (result.data.shop !== null) clearRegistrationDraft();
          else pruneRegistrationDraft(result.data.owner.ownerId);
          verified.current = { key: visit.key, data: result.data, history };
        }
        setChecked({ visit, result });
      })
      .catch(() => {
        /* 화면을 떠날 때 취소한 요청. */
      });
    return () => controller.abort();
  }, [visit, requested, history]);
  useEffect(() => () => logoutRequest.current?.abort(), []);
  useEffect(() => {
    if (requested !== OWNER_HOME) setRegistrationNotice(false);
  }, [requested]);

  async function logOut() {
    if (logoutRequest.current) return;
    const controller = new AbortController();
    logoutRequest.current = controller;
    setLogout("pending");
    setLogoutFailure(null);
    try {
      const result = await signOutOwner(controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) navigate(OWNER_LOGIN, { replace: true });
      else {
        setLogout("failed");
        setLogoutFailure(result);
      }
    } catch {
      if (!controller.signal.aborted) {
        setLogout("failed");
        setLogoutFailure({ ok: false, status: 0, problem: null, retryAfterSeconds: null });
      }
    } finally {
      logoutRequest.current = null;
    }
  }

  if (!requested)
    return (
      <main>
        <p>찾을 수 없어요</p>
      </main>
    );
  const session = checked?.visit === visit ? checked.result : null;
  const cached = verified.current;
  const candidate = session?.ok
    ? session.data
    : cached && (cached.key === location.key || (history && cached.history))
      ? cached.data
      : null;
  if (screenRoute && candidate?.shop) {
    if (historyRoute || shopRoute?.checkDestination) {
      const destination = ownerDestination(candidate, requested);
      if (destination !== requested) return <Navigate to={destination} replace />;
    }
    const ShopScreen = screenRoute.Screen;
    if (session !== null && !session.ok && session.status === 401)
      return <Navigate to={OWNER_LOGIN} replace state={{ returnTo: requested }} />;
    return (
      <>
        {session !== null && !session.ok ? (
          <LoadFailure
            failure={classify(session.status, session.problem, session.retryAfterSeconds)}
            onRetry={() => setRevision((r) => r + 1)}
          />
        ) : null}
        <ShopScreen
          {...(historyRoute ? { version: historyRoute.version } : {})}
          {...(shopPath === "/owner/payment-destination"
            ? { licenseStatus: candidate.shop.licenseStatus, onSaved: () => setRevision((r) => r + 1) }
            : {})}
          key={`${candidate.owner.ownerId}:${candidate.shop.shopId}`}
          shopName={candidate.shop.name}
          onNavigate={(href) => navigate(href)}
          onSessionExpired={() => navigate(OWNER_LOGIN, { replace: true, state: { returnTo: requested } })}
          onRegisterShop={() => navigate(OWNER_REGISTER, { replace: true })}
          onLogout={() => void logOut()}
          logoutPending={logout === "pending"}
          logoutFailure={
            logoutFailure
              ? classify(logoutFailure.status, logoutFailure.problem, logoutFailure.retryAfterSeconds)
              : null
          }
          sessionChecking={session === null}
          sessionFailed={session !== null && !session.ok}
        />
      </>
    );
  }
  if (requested === OWNER_REGISTER && candidate?.shop === null) {
    return (
      <>
        {session !== null && !session.ok && session.status !== 401 ? (
          <LoadFailure
            failure={classify(session.status, session.problem, session.retryAfterSeconds)}
            onRetry={() => setRevision((r) => r + 1)}
          />
        ) : null}
        <ShopRegistration
          key={candidate.owner.ownerId}
          ownerId={candidate.owner.ownerId}
          onRegistered={() => {
            setRegistrationNotice(true);
            navigate(OWNER_HOME, { replace: true, state: null });
          }}
          onSessionExpired={() => navigate(OWNER_LOGIN, { replace: true, state: { returnTo: requested } })}
          onHome={() => navigate(OWNER_HOME, { replace: true })}
          onLogout={() => void logOut()}
          logoutFailed={logout === "failed"}
          logoutPending={logout === "pending"}
          sessionChecking={session === null}
          sessionFailed={session !== null && !session.ok}
          sessionExpired={session !== null && !session.ok && session.status === 401}
        />
      </>
    );
  }
  if (session === null || logout === "pending")
    return (
      <main aria-live="polite">
        <Skeleton label="로그인 상태를 확인하고 있어요" />
      </main>
    );
  if (!session.ok) {
    if (session.status === 401) return <Navigate to={OWNER_LOGIN} replace state={{ returnTo: requested }} />;
    return (
      <main>
        <LoadFailure
          failure={classify(session.status, session.problem, session.retryAfterSeconds)}
          onRetry={() => setRevision((r) => r + 1)}
        />
      </main>
    );
  }
  const destination = ownerDestination(session.data, requested);
  if (destination !== requested) return <Navigate to={destination} replace />;
  return (
    <main>
      <h1>수제케이크 주문제작</h1>
      {registrationNotice ? <p role="status">가게를 등록했어요. 운영자가 영업 신고를 확인하고 있어요</p> : null}
      <p>준비 중입니다.</p>
      {logout === "failed" ? <p role="alert">로그아웃하지 못했어요. 다시 시도해 주세요</p> : null}
      <Button onClick={() => void logOut()}>로그아웃</Button>
    </main>
  );
}
