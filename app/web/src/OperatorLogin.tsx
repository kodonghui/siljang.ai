import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  loginFeedback,
  loginFieldsAfterFailure,
  OPERATOR_HOME,
  type OperatorCredentials,
  operatorReturnTo,
  signIn,
} from "./operator";
import { type Failure, fieldReasonText } from "./problems";
import { Button, fieldErrorsFor, LoginLayout, TextField } from "./ui";

const EMPTY: OperatorCredentials = { email: "", password: "", otp: "" };
const FIELDS = ["/email", "/password", "/otp"];

export function OperatorLogin() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = operatorReturnTo(location.state?.returnTo);
  const [fields, setFields] = useState(EMPTY);
  const [feedback, setFeedback] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (retryAt === null) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) {
        setRetryAt(null);
        setFeedback((failure) => (failure?.status === 429 ? null : failure));
      }
    };
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [retryAt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || (retryAt !== null && Date.now() < retryAt)) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setFeedback(null);
    setRetryAt(null);
    setRemaining(0);
    try {
      const result = await signIn(fields, controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) {
        setFields(EMPTY);
        navigate(returnTo ?? OPERATOR_HOME, { replace: true });
        return;
      }
      const failure = loginFeedback(result);
      setFields(loginFieldsAfterFailure(fields, result.status));
      setFeedback(failure);
      if (failure.retryAfterSeconds !== null) {
        setRemaining(failure.retryAfterSeconds);
        setRetryAt(Date.now() + failure.retryAfterSeconds * 1000);
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const { byField, rest } = fieldErrorsFor(feedback?.fieldErrors ?? [], FIELDS);
  const update = (key: keyof OperatorCredentials, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const retry = feedback?.outcome === "server" && feedback.retry !== "none";

  return (
    <LoginLayout title="운영자 로그인">
      {returnTo === null ? null : <p>로그인하면 보던 화면으로 돌아가요</p>}
      <form className="ui-stack operator-login-form" noValidate aria-busy={pending} onSubmit={submit}>
        {feedback ? (
          <div className="ui-statebox ui-statebox--error" role="alert">
            <p className="ui-statebox__title">{feedback.message}</p>
            {rest.map(({ field, code }) => (
              <p className="ui-statebox__body" key={field + code}>
                {fieldReasonText(code)}
              </p>
            ))}
            {feedback.traceId && feedback.outcome === "server" && feedback.code !== "auth_unavailable" ? (
              <p className="ui-statebox__body">추적 ID {feedback.traceId}</p>
            ) : null}
          </div>
        ) : null}
        {remaining > 0 ? <p role="timer">다시 로그인하기까지 {remaining}초</p> : null}
        <TextField
          pointer="/email"
          label="이메일"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={fields.email}
          disabled={pending}
          errors={byField.get("/email")}
          onChange={(event) => update("email", event.currentTarget.value)}
        />
        <TextField
          pointer="/password"
          label="비밀번호"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={fields.password}
          disabled={pending}
          errors={byField.get("/password")}
          onChange={(event) => update("password", event.currentTarget.value)}
        />
        <TextField
          pointer="/otp"
          label="2단계 인증 번호"
          name="otp"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={fields.otp}
          disabled={pending}
          errors={byField.get("/otp")}
          onChange={(event) => update("otp", event.currentTarget.value)}
        />
        <Button type="submit" kind="primary" block disabled={pending || remaining > 0}>
          {pending ? "로그인하고 있어요" : retry ? "다시 시도" : "로그인"}
        </Button>
      </form>
      <p>우리 서비스 운영자용</p>
    </LoginLayout>
  );
}
