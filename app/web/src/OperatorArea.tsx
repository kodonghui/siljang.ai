import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import type { ApiFailure, ApiResult } from "./api";
import { OperatorShopsList } from "./OperatorShopsList";
import {
  fetchOperator,
  OPERATOR_HOME,
  OPERATOR_LOGIN,
  type OperatorIdentity,
  operatorScreen,
  signOut,
} from "./operator";
import { classify } from "./problems";
import { Button, LoadFailure, OperatorLayout, PageSection, Skeleton, StateBox } from "./ui";

interface CheckedSession {
  readonly key: string;
  readonly revision: number;
  readonly result: ApiResult<OperatorIdentity>;
}

export function OperatorArea() {
  const location = useLocation();
  const navigate = useNavigate();
  const screen = operatorScreen(location.pathname);
  const [revision, setRevision] = useState(0);
  const [checked, setChecked] = useState<CheckedSession | null>(null);
  const [logout, setLogout] = useState<"pending" | "failed" | null>(null);
  const [logoutFailure, setLogoutFailure] = useState<ApiFailure | null>(null);
  const logoutRequest = useRef<AbortController | null>(null);
  const returnTo = location.pathname + location.search + location.hash;
  const sessionExpired = useCallback(() => {
    navigate(OPERATOR_LOGIN, { replace: true, state: { returnTo } });
  }, [navigate, returnTo]);

  useEffect(() => {
    const recheck = (event: PageTransitionEvent) => {
      if (event.persisted) setRevision((current) => current + 1);
    };
    window.addEventListener("pageshow", recheck);
    return () => window.removeEventListener("pageshow", recheck);
  }, []);

  useEffect(() => {
    if (!screen) return;
    const abort = new AbortController();
    void fetchOperator(abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setChecked({ key: location.key, revision, result });
      })
      .catch((error) => {
        if (!abort.signal.aborted) throw error;
      });
    return () => abort.abort();
  }, [location.key, revision, screen]);

  useEffect(() => () => logoutRequest.current?.abort(), []);

  async function logOut() {
    if (logoutRequest.current) return;
    const controller = new AbortController();
    logoutRequest.current = controller;
    setLogout("pending");
    setLogoutFailure(null);
    try {
      const response = await signOut(controller.signal);
      if (controller.signal.aborted) return;
      if (response.ok || response.status === 401) {
        navigate(OPERATOR_LOGIN, { replace: true });
      } else {
        setLogoutFailure(response);
        setLogout("failed");
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      logoutRequest.current = null;
    }
  }

  function follow(href: string, event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    event.preventDefault();
    navigate(href);
  }

  if (!screen)
    return (
      <main>
        <p>찾을 수 없어요</p>
      </main>
    );
  const session = checked?.key === location.key && checked.revision === revision ? checked.result : null;
  if (session === null || logout === "pending") {
    return (
      <main aria-live="polite">
        <Skeleton label="로그인 상태를 확인하고 있어요" />
      </main>
    );
  }
  if (!session.ok) {
    if (session.status === 401) {
      return <Navigate to={OPERATOR_LOGIN} replace state={{ returnTo }} />;
    }
    const failure = classify(session.status, session.problem, session.retryAfterSeconds);
    return (
      <main>
        <LoadFailure failure={failure} onRetry={() => setRevision((current) => current + 1)} />
      </main>
    );
  }

  const back = screen.screen === "SCR-050" ? location.pathname.split("/").slice(0, 4).join("/") : OPERATOR_HOME;
  return (
    <OperatorLayout
      screen={screen.screen}
      title={screen.title}
      {...(screen.top ? {} : { back })}
      operatorName={session.data.displayName}
      onLogout={logOut}
      onNavigate={follow}
    >
      <PageSection>
        {logout === "failed" && screen.screen === "SCR-047" && logoutFailure ? (
          <LoadFailure
            failure={classify(logoutFailure.status, logoutFailure.problem, logoutFailure.retryAfterSeconds)}
            onRetry={logOut}
          />
        ) : logout === "failed" ? (
          <StateBox tone="error" title="로그아웃하지 못했어요" actions={<Button onClick={logOut}>다시 시도</Button>} />
        ) : null}
        {screen.screen === "SCR-047" ? (
          <OperatorShopsList onNavigate={follow} onSessionExpired={sessionExpired} />
        ) : (
          <p>준비 중입니다.</p>
        )}
      </PageSection>
    </OperatorLayout>
  );
}
