import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import kakaoLoginImage from "./assets/kakao-login.png?url&no-inline";
import {
  completeOwnerLogin,
  OWNER_CALLBACK,
  OWNER_RETURN_KEY,
  ownerCallbackInput,
  ownerDestination,
  ownerLoginFeedback,
  ownerReturnTo,
  startOwnerLogin,
} from "./owner";
import type { Failure } from "./problems";
import { Banner, Button, LoginLayout } from "./ui";

function savedReturnTo(): string | null {
  try {
    return ownerReturnTo(sessionStorage.getItem(OWNER_RETURN_KEY));
  } catch {
    return null;
  }
}
function saveReturnTo(value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(OWNER_RETURN_KEY);
    else sessionStorage.setItem(OWNER_RETURN_KEY, value);
  } catch {
    /* 저장을 막은 브라우저에서는 기본 목적지로 간다. */
  }
}
const CALLBACK_FAILED = { ok: false, status: 401, problem: null, retryAfterSeconds: null } as const;

export function OwnerLogin() {
  const location = useLocation();
  const navigate = useNavigate();
  const callback = location.pathname === OWNER_CALLBACK;
  const [returnTo, setReturnTo] = useState(() => ownerReturnTo(location.state?.returnTo));
  const [feedback, setFeedback] = useState<Failure | null>(null);
  const [pending, setPending] = useState(callback);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (retryAt === null) return;
    const timer = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) {
        setRetryAt(null);
        setFeedback((failure) => (failure?.status === 429 ? null : failure));
      }
    }, 250);
    return () => clearInterval(timer);
  }, [retryAt]);

  function failed(failure: Failure) {
    setFeedback(failure);
    if (failure.retryAfterSeconds !== null) {
      setRemaining(failure.retryAfterSeconds);
      setRetryAt(Date.now() + failure.retryAfterSeconds * 1000);
    }
  }

  useEffect(() => {
    if (!callback) return;
    let cancelled = false;
    const previous = savedReturnTo();
    setReturnTo(previous);
    const input = ownerCallbackInput(location.search, new URL(OWNER_CALLBACK, window.location.origin).href);
    // 인가 코드·state·거부 사유가 화면 주소와 이후 Referer에 남지 않게 지운다.
    window.history.replaceState(window.history.state, "", OWNER_CALLBACK);
    if (input === null) {
      setFeedback(ownerLoginFeedback(CALLBACK_FAILED));
      setPending(false);
      return;
    }
    void completeOwnerLogin(input).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        saveReturnTo(null);
        navigate(ownerDestination(result.data, previous), { replace: true });
      } else {
        const failure = ownerLoginFeedback(result);
        setFeedback(failure);
        if (failure.retryAfterSeconds !== null) {
          setRemaining(failure.retryAfterSeconds);
          setRetryAt(Date.now() + failure.retryAfterSeconds * 1000);
        }
        setPending(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [callback, location.search, navigate]);

  async function start() {
    if (active.current || pending || (retryAt !== null && Date.now() < retryAt)) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setFeedback(null);
    setRemaining(0);
    setRetryAt(null);
    try {
      const result = await startOwnerLogin(new URL(OWNER_CALLBACK, window.location.origin).href, controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) {
        saveReturnTo(returnTo);
        window.location.assign(result.data.authorizationUrl);
      } else failed(ownerLoginFeedback(result));
    } catch {
      if (!controller.signal.aborted) failed(ownerLoginFeedback({ ...CALLBACK_FAILED, status: 0 }));
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const kakaoButton = !pending && remaining === 0 && feedback?.outcome !== "server";
  return (
    <LoginLayout title="사장님 로그인">
      {returnTo === null ? null : <p>로그인하면 보던 화면으로 돌아가요</p>}
      <div className="ui-stack owner-login-form" aria-busy={pending}>
        {feedback ? (
          <div role="alert">
            <Banner
              tone="danger"
              detail={
                feedback.traceId && feedback.outcome === "server" && feedback.code !== "kakao_unavailable"
                  ? `추적 ID ${feedback.traceId}`
                  : undefined
              }
            >
              {feedback.message}
            </Banner>
          </div>
        ) : null}
        {remaining > 0 ? <p role="timer">다시 로그인하기까지 {remaining}초</p> : null}
        <Button
          kind="primary"
          block
          data-kakao={kakaoButton ? "true" : undefined}
          disabled={pending || remaining > 0}
          onClick={() => void start()}
        >
          {kakaoButton ? (
            <img src={kakaoLoginImage} alt="카카오 로그인" width={448} height={92} />
          ) : pending ? (
            "로그인하고 있어요"
          ) : feedback?.outcome === "server" ? (
            "다시 시도"
          ) : (
            "카카오 로그인"
          )}
        </Button>
      </div>
      <p className="owner-login-hint">가게 사장님용</p>
    </LoginLayout>
  );
}
