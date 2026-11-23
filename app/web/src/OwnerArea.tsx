import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import type { ApiFailure, ApiResult } from "./api";
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
import { classify } from "./problems";
import { clearRegistrationDraft, pruneRegistrationDraft } from "./registration-draft";
import { ShopRegistration } from "./ShopRegistration";
import { ShopSettings } from "./ShopSettings";
import { Button, LoadFailure, Skeleton } from "./ui";

/** 첫 세션 확인 전에는 가린다. 이미 검증한 등록 양식은 재확인·로그아웃 중 잠근 채 보존한다. */
export function OwnerArea() {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = ownerReturnTo(location.pathname + location.search + location.hash);
  const [revision, setRevision] = useState(0);
  const [checked, setChecked] = useState<{ key: string; revision: number; result: ApiResult<OwnerIdentity> } | null>(
    null,
  );
  const [logout, setLogout] = useState<"pending" | "failed" | null>(null);
  const [logoutFailure, setLogoutFailure] = useState<ApiFailure | null>(null);
  const logoutRequest = useRef<AbortController | null>(null);
  const verified = useRef<{ key: string; data: OwnerIdentity } | null>(null);
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
          verified.current = { key: location.key, data: result.data };
        }
        setChecked({ key: location.key, revision, result });
      })
      .catch(() => {
        /* 화면을 떠날 때 취소한 요청. */
      });
    return () => controller.abort();
  }, [location.key, requested, revision]);
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
  const session = checked?.key === location.key && checked.revision === revision ? checked.result : null;
  const candidate = session?.ok ? session.data : verified.current?.key === location.key ? verified.current.data : null;
  if (requested.split(/[?#]/)[0] === "/owner/shop" && candidate?.shop) {
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
        <ShopSettings
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
          sessionChecking={session === null || !session.ok}
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
          sessionChecking={session === null || !session.ok}
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
