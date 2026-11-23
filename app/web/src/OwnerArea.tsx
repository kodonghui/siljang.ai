import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import type { ApiResult } from "./api";
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
import { ShopRegistration } from "./ShopRegistration";
import { Button, LoadFailure, Skeleton } from "./ui";

/** 업무 화면은 각 WBS 작업에서 붙인다. 세션을 확인하기 전에는 보호된 내용을 표시하지 않는다. */
export function OwnerArea() {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = ownerReturnTo(location.pathname + location.search + location.hash);
  const [revision, setRevision] = useState(0);
  const [checked, setChecked] = useState<{ key: string; revision: number; result: ApiResult<OwnerIdentity> } | null>(
    null,
  );
  const [logout, setLogout] = useState<"pending" | "failed" | null>(null);
  const logoutRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const recheck = (event: PageTransitionEvent) => {
      if (event.persisted) setRevision((r) => r + 1);
    };
    window.addEventListener("pageshow", recheck);
    return () => window.removeEventListener("pageshow", recheck);
  }, []);
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    void fetchOwner(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setChecked({ key: location.key, revision, result });
      })
      .catch(() => {
        /* 화면을 떠날 때 취소한 요청. */
      });
    return () => controller.abort();
  }, [location.key, requested, revision]);
  useEffect(() => () => logoutRequest.current?.abort(), []);

  async function logOut() {
    if (logoutRequest.current) return;
    const controller = new AbortController();
    logoutRequest.current = controller;
    setLogout("pending");
    try {
      const result = await signOutOwner(controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) navigate(OWNER_LOGIN, { replace: true });
      else setLogout("failed");
    } catch {
      if (!controller.signal.aborted) setLogout("failed");
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
  if (requested === OWNER_REGISTER)
    return (
      <ShopRegistration
        key={session.data.owner.ownerId}
        ownerId={session.data.owner.ownerId}
        onRegistered={() => navigate(OWNER_HOME, { replace: true, state: { registered: true } })}
        onSessionExpired={() => navigate(OWNER_LOGIN, { replace: true, state: { returnTo: requested } })}
        onHome={() => navigate(OWNER_HOME, { replace: true })}
        onLogout={() => void logOut()}
        logoutFailed={logout === "failed"}
      />
    );
  return (
    <main>
      <h1>수제케이크 주문제작</h1>
      {location.state?.registered === true ? (
        <p role="status">가게를 등록했어요. 운영자가 영업 신고를 확인하고 있어요</p>
      ) : null}
      <p>준비 중입니다.</p>
      {logout === "failed" ? <p role="alert">로그아웃하지 못했어요. 다시 시도해 주세요</p> : null}
      <Button onClick={() => void logOut()}>로그아웃</Button>
    </main>
  );
}
