import { useEffect, useMemo, useRef, useState } from "react";
import { matchPath, Navigate, useLocation, useNavigate } from "react-router";
import type { ApiFailure, ApiResult } from "./api";
import { BookingLinkScreen } from "./BookingLinkScreen";
import { CalendarScreen } from "./CalendarScreen";
import { CalendarSettingsScreen } from "./CalendarSettingsScreen";
import { ConsultationMessagesScreen } from "./ConsultationMessagesScreen";
import { KakaoChannelSettings } from "./KakaoChannelSettings";
import { OperatingRulesEditor } from "./OperatingRulesEditor";
import { OperatingRulesHistory } from "./OperatingRulesHistory";
import { OwnerTasksScreen, type OwnerTaskTabFocusRequest } from "./OwnerTasksScreen";
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
  // 보류 중에도 사유와 수정 경로를 찾는 읽기 전용 목록은 연다. 로그인 기본 착지는 그대로다.
  { path: OWNER_HOME, Screen: OwnerTasksScreen, checkDestination: false },
  { path: "/owner/shop", Screen: ShopSettings, checkDestination: false },
  { path: "/owner/shop/license", Screen: ShopLicense, checkDestination: false },
  { path: "/owner/payment-destination", Screen: PaymentDestinationEditor, checkDestination: false },
  { path: "/owner/price-list", Screen: PriceListEditor, checkDestination: true },
  { path: "/owner/operating-rules", Screen: OperatingRulesEditor, checkDestination: true },
  { path: "/owner/kakao-channel", Screen: KakaoChannelSettings, checkDestination: true },
  { path: "/owner/booking-link", Screen: BookingLinkScreen, checkDestination: true },
  { path: "/owner/calendar", Screen: CalendarScreen, checkDestination: true },
  { path: "/owner/calendar/settings", Screen: CalendarSettingsScreen, checkDestination: true },
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
interface HomeTabFocus {
  readonly request: OwnerTaskTabFocusRequest;
  readonly href: string;
  readonly fromKey: string;
  readonly visitKey: string | null;
  readonly identityKey: string;
}
const ownerIdentityKey = (identity: OwnerIdentity) => `${identity.owner.ownerId}:${identity.shop?.shopId ?? ""}`;
function pathWithoutCursor(search: string, path = OWNER_HOME): string | null {
  const query = new URLSearchParams(search);
  if (!query.has("cursor")) return null;
  query.delete("cursor");
  const suffix = query.toString();
  return `${path}${suffix ? `?${suffix}` : ""}`;
}

/** 첫 세션 확인 전에는 가린다. 이미 검증한 등록 양식은 재확인·로그아웃 중 잠근 채 보존한다. */
export function OwnerArea() {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = ownerReturnTo(location.pathname + location.search + location.hash);
  const shopPath = requested?.split(/[?#]/)[0]?.replace(/\/+$/, "");
  const historyRoute = matchHistory(shopPath);
  const shopRoute = shopScreens.find((route) => route.path === shopPath);
  const consultationRoute = matchPath(
    { path: "/owner/consultations/:consultationId", caseSensitive: true, end: true },
    shopPath ?? "",
  );
  const screenRoute = consultationRoute ? { Screen: ConsultationMessagesScreen } : (historyRoute ?? shopRoute);
  const isConsultation = consultationRoute !== null;
  const history = historyRoute !== null;
  const [revision, setRevision] = useState(0);
  const visit = useMemo(() => ({ key: location.key, revision }), [location.key, revision]);
  const [checked, setChecked] = useState<{ visit: typeof visit; result: ApiResult<OwnerIdentity> } | null>(null);
  const [logout, setLogout] = useState<"pending" | "failed" | null>(null);
  const [logoutFailure, setLogoutFailure] = useState<ApiFailure | null>(null);
  const logoutRequest = useRef<AbortController | null>(null);
  const verified = useRef<{ key: string; path: string; data: OwnerIdentity; history: boolean } | null>(null);
  const [registrationNotice, setRegistrationNotice] = useState(false);
  const [homeTabFocus, setHomeTabFocus] = useState<HomeTabFocus | null>(null);
  const rejectedHomeIdentity = useRef<string | null>(null);

  useEffect(() => {
    const recheck = () => {
      setRegistrationNotice(false);
      pruneRegistrationDraft();
      setRevision((value) => value + 1);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) recheck();
    };
    const visible = () => {
      // 목록/상담보다 신원을 먼저 확인해 다른 계정의 가게와 섞이지 않게 한다.
      if ((shopPath === OWNER_HOME || isConsultation) && document.visibilityState === "visible") recheck();
    };
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [shopPath, isConsultation]);
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    void fetchOwner(controller.signal, shopPath === OWNER_HOME)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          const previous = verified.current?.data;
          const withoutCursor = pathWithoutCursor(location.search, location.pathname);
          if (
            (shopPath === OWNER_HOME || isConsultation) &&
            previous &&
            ownerIdentityKey(previous) !== ownerIdentityKey(result.data) &&
            withoutCursor !== null
          ) {
            setHomeTabFocus(null);
            navigate(withoutCursor, { replace: true });
            return;
          }
          if (result.data.shop !== null) clearRegistrationDraft();
          else pruneRegistrationDraft(result.data.owner.ownerId);
          verified.current = { key: visit.key, path: location.pathname, data: result.data, history };
        }
        setChecked({ visit, result });
      })
      .catch(() => {
        /* 화면을 떠날 때 취소한 요청. */
      });
    return () => controller.abort();
  }, [visit, requested, history, location.pathname, location.search, navigate, shopPath, isConsultation]);
  useEffect(() => () => logoutRequest.current?.abort(), []);
  useEffect(() => {
    if (requested !== OWNER_HOME) setRegistrationNotice(false);
  }, [requested]);
  useEffect(() => {
    if (!homeTabFocus) return;
    const discard = () => setHomeTabFocus((old) => (old?.request === homeTabFocus.request ? null : old));
    const current = checked?.visit === visit ? checked.result : null;
    if (current && (!current.ok || ownerIdentityKey(current.data) !== homeTabFocus.identityKey)) {
      discard();
      return;
    }
    if (homeTabFocus.visitKey !== null) {
      if (location.key !== homeTabFocus.visitKey || requested !== homeTabFocus.href) discard();
    } else if (location.key !== homeTabFocus.fromKey) {
      if (requested !== homeTabFocus.href) discard();
      else setHomeTabFocus((old) => (old?.request === homeTabFocus.request ? { ...old, visitKey: location.key } : old));
    }
  }, [homeTabFocus, checked, visit, requested, location.key]);

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
    : shopPath === OWNER_HOME
      ? null
      : cached && (cached.key === location.key || cached.path === location.pathname || (history && cached.history))
        ? cached.data
        : null;
  if (screenRoute && candidate?.shop) {
    if (historyRoute || consultationRoute || shopRoute?.checkDestination) {
      const destination = ownerDestination(candidate, requested);
      if (destination !== requested) return <Navigate to={destination} replace />;
    }
    const ShopScreen = screenRoute.Screen;
    const identityKey = ownerIdentityKey(candidate);
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
          {...(shopPath === OWNER_HOME
            ? {
                banners: candidate.banners ?? [],
                registrationNotice,
                tabFocusRequest:
                  homeTabFocus?.visitKey === location.key && homeTabFocus.identityKey === identityKey
                    ? homeTabFocus.request
                    : null,
                onTabNavigate: (href: string, request: OwnerTaskTabFocusRequest) => {
                  setHomeTabFocus({ request, href, fromKey: location.key, visitKey: null, identityKey });
                  navigate(href);
                },
                onTabFocusHandled: (request: OwnerTaskTabFocusRequest) =>
                  setHomeTabFocus((old) => (old?.request === request ? null : old)),
              }
            : {})}
          {...(historyRoute ? { version: historyRoute.version } : {})}
          {...(consultationRoute ? { consultationId: consultationRoute.params.consultationId ?? "" } : {})}
          {...(shopPath === "/owner/payment-destination"
            ? { licenseStatus: candidate.shop.licenseStatus, onSaved: () => setRevision((r) => r + 1) }
            : {})}
          key={identityKey}
          shopId={candidate.shop.shopId}
          shopName={candidate.shop.name}
          onNavigate={(href) => navigate(href)}
          onSessionExpired={() => {
            if ((shopPath === OWNER_HOME || isConsultation) && rejectedHomeIdentity.current !== identityKey) {
              // 두 조회 사이 계정이 바뀌었을 수 있다. 이전 목록을 숨긴 채 한 번만 신원을 다시 읽는다.
              rejectedHomeIdentity.current = identityKey;
              setHomeTabFocus(null);
              const withoutCursor = pathWithoutCursor(location.search, location.pathname);
              if (withoutCursor !== null) navigate(withoutCursor, { replace: true });
              else setRevision((value) => value + 1);
            } else navigate(OWNER_LOGIN, { replace: true, state: { returnTo: requested } });
          }}
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
        {shopPath === OWNER_HOME ? (
          <>
            {logoutFailure ? (
              <LoadFailure
                failure={classify(logoutFailure.status, logoutFailure.problem, logoutFailure.retryAfterSeconds)}
                onRetry={() => void logOut()}
              />
            ) : null}
            <Button onClick={() => void logOut()}>로그아웃</Button>
          </>
        ) : null}
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
