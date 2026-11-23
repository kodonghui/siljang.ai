// 명령 하나의 결과를 04 G7대로 알리는 자리(폼·액션 위). useCommand의 state를 받아 결과마다 08의 모습으로 그린다.
//   성공 → 결과 줄(success), 필드 오류 → 폼 위 '입력한 내용을 확인해 주세요'와 필드 밖 오류(필드 옆 글은 Field가 그림),
//   이미 처리됨·이미 바뀜·그 상태에서는 할 수 없음 → 주의 배너와 '다시 불러오기', 찾을 수 없음 → 상자와 돌아가는 길,
//   서버 실패 → 오류 배너, 추적 ID, (다시 보낼 수 있으면) '다시 시도'. 확인 창은 ConfirmRequired가 그린다.
// 상태가 바뀌면 화면 읽기 프로그램에 한 문장으로 알린다(announce, aria-live).
import { type ReactNode, useEffect } from "react";
import type { CommandState } from "../command";
import { ERROR_CODES, type ErrorCode, type Failure, fieldReasonText } from "../problems";
import { announce } from "./announce";
import { Button } from "./Button";
import { fieldErrorsFor } from "./Field";
import { Banner, StateBox } from "./states";

export const RETRY_LABEL = "다시 시도";
export const RELOAD_LABEL = "다시 불러오기";

export interface CommandStatusProps<O> {
  readonly state: CommandState<O>;
  /** 양식의 전역 잠금은 결과의 재시도·다시 불러오기에도 적용한다. */
  readonly disabled?: boolean;
  /** 화면이 그린 필드의 포인터. 여기에 없는 위치의 필드 오류는 폼 위에 모아 보임 */
  readonly fields?: readonly string[];
  /** 사유 코드 없이 오는 필드 쪽 오류(06: sheet_not_accessible 등)를 붙인 필드가 있으면 그 코드. 폼 위에는 되풀이하지 않음 */
  readonly fieldCodes?: readonly ErrorCode[];
  /** 성공했을 때의 결과 줄(08 done, 예: '손님에게 보냈어요') */
  readonly done?: (data: O) => ReactNode;
  readonly doneActions?: ReactNode;
  /** '다시 시도'(useCommand의 retry) */
  readonly onRetry?: () => void;
  /** 지금 상태를 다시 읽음(이미 처리됨·이미 바뀜·그 상태에서는 할 수 없음) */
  readonly onReload?: () => void;
  /** 로그인·연결로 보냄(다시 로그인해 주세요 등) */
  readonly onLogin?: () => void;
  readonly loginLabel?: string;
  /** 가게 등록으로 보냄(가게를 먼저 등록해 주세요) */
  readonly onRegisterShop?: () => void;
  /** 찾을 수 없을 때 돌아가는 길(예: 목록으로 가는 링크) */
  readonly notFoundAction?: ReactNode;
}

/** 알림 한 문장(화면 읽기용). 화면에 보이는 글과 같음 */
export function announcement<O>(
  state: CommandState<O>,
  doneText?: string,
): { text: string; level: "polite" | "assertive" } | null {
  if (state.kind === "failed") {
    const f = state.failure;
    return { text: f.outcome === "field" ? ERROR_CODES.validation_failed.message : f.message, level: "assertive" };
  }
  if (state.kind === "done" && doneText !== undefined) return { text: doneText, level: "polite" };
  return null;
}

function traceLine(f: Failure): string | undefined {
  return f.traceId === null ? undefined : `추적 ID: ${f.traceId}`;
}

export function CommandStatus<O>(props: CommandStatusProps<O>) {
  const { state } = props;
  const doneNode = state.kind === "done" && props.done !== undefined ? props.done(state.data) : null;
  const doneText = typeof doneNode === "string" ? doneNode : undefined;
  const note = announcement(state, doneText);
  const noteText = note?.text ?? "";
  const noteLevel = note?.level ?? "polite";
  useEffect(() => {
    if (noteText !== "") announce(noteText, noteLevel);
  }, [noteText, noteLevel]);

  if (state.kind === "done") {
    if (doneNode === null) return null;
    return (
      <Banner tone="success" actions={props.doneActions}>
        {doneNode}
      </Banner>
    );
  }
  if (state.kind !== "failed") return null;
  return <FailureView {...props} failure={state.failure} blocked={state.blockedUntil !== null} />;
}

function FailureView<O>(props: CommandStatusProps<O> & { readonly failure: Failure; readonly blocked: boolean }) {
  const { failure: f } = props;
  switch (f.outcome) {
    case "field": {
      const { rest } = fieldErrorsFor(f.fieldErrors, props.fields ?? []);
      const codeShownAtField = f.code !== null && (props.fieldCodes ?? []).includes(f.code);
      const lines = [
        ...(f.code !== "validation_failed" && !codeShownAtField ? [f.message] : []),
        ...rest.map((e) => fieldReasonText(e.code)),
      ];
      return (
        <Banner
          tone="danger"
          detail={
            lines.length === 0 ? undefined : (
              <ul className="ui-banner__list">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )
          }
        >
          {ERROR_CODES.validation_failed.message}
        </Banner>
      );
    }
    case "already_done":
    case "changed":
    case "not_allowed":
      return (
        <Banner
          tone="warning"
          detail={f.outcome === "not_allowed" && f.detail !== null ? f.detail : undefined}
          actions={
            props.onReload === undefined ? undefined : (
              <Button kind="warn" onClick={props.onReload} disabled={props.disabled}>
                {RELOAD_LABEL}
              </Button>
            )
          }
        >
          {f.message}
        </Banner>
      );
    case "not_found":
      return (
        <StateBox tone="error" title={f.message} actions={props.notFoundAction}>
          주소를 다시 확인해 주세요
        </StateBox>
      );
    case "login":
      return (
        <Banner
          tone="danger"
          actions={
            props.onLogin === undefined ? undefined : (
              <Button kind="secondary" onClick={props.onLogin}>
                {props.loginLabel ?? "로그인"}
              </Button>
            )
          }
        >
          {f.message}
        </Banner>
      );
    case "no_shop":
      return (
        <Banner
          tone="warning"
          actions={
            props.onRegisterShop === undefined ? undefined : (
              <Button kind="warn" onClick={props.onRegisterShop}>
                가게 등록
              </Button>
            )
          }
        >
          {f.message}
        </Banner>
      );
    case "wait":
      return <Banner tone="warning">{f.message}</Banner>;
    case "empty":
    case "confirm":
    case "in_progress":
    case "server":
      return (
        <Banner
          tone="danger"
          detail={traceLine(f)}
          actions={
            f.retry === "none" || props.onRetry === undefined ? undefined : (
              <Button kind="secondary" onClick={props.onRetry} disabled={Boolean(props.blocked || props.disabled)}>
                {RETRY_LABEL}
              </Button>
            )
          }
        >
          {f.message}
        </Banner>
      );
  }
}

export interface LoadFailureProps {
  readonly failure: Failure;
  readonly disabled?: boolean;
  readonly onRetry?: () => void;
  readonly onLogin?: () => void;
  readonly loginLabel?: string;
  readonly onRegisterShop?: () => void;
  readonly notFoundAction?: ReactNode;
}

/**
 * 화면의 데이터를 불러오지 못해 내용을 보일 수 없을 때 그 자리의 상자(08 load-failed·permission·찾을 수 없음).
 * 글은 08 화면 정의의 LOAD_FAILED_BOX·LOGIN_BOX·nf_box. (불러온 뒤의 빈 목록은 EmptyState, 06 not_set은 빈 입력 화면)
 */
export function LoadFailure({
  failure: f,
  disabled = false,
  onRetry,
  onLogin,
  loginLabel,
  onRegisterShop,
  notFoundAction,
}: LoadFailureProps) {
  useEffect(() => {
    announce(f.message, "assertive");
  }, [f.message]);
  switch (f.outcome) {
    case "not_found":
      return (
        <StateBox tone="error" title={f.message} actions={notFoundAction}>
          주소를 다시 확인해 주세요
        </StateBox>
      );
    case "login":
      return (
        <StateBox
          icon="lock"
          title={f.message}
          actions={
            onLogin === undefined ? undefined : (
              <Button kind="primary" onClick={onLogin}>
                {loginLabel ?? "로그인"}
              </Button>
            )
          }
        >
          로그인하면 이 화면으로 돌아와요
        </StateBox>
      );
    case "no_shop":
      return (
        <StateBox
          title={f.message}
          actions={
            onRegisterShop === undefined ? undefined : (
              <Button kind="primary" onClick={onRegisterShop}>
                가게 등록
              </Button>
            )
          }
        />
      );
    case "wait":
      return <StateBox title={f.message} />;
    default:
      return (
        <StateBox
          tone="error"
          title={f.message}
          actions={
            f.retry === "none" || onRetry === undefined ? undefined : (
              <Button kind="primary" onClick={onRetry} disabled={disabled}>
                {RETRY_LABEL}
              </Button>
            )
          }
        >
          {traceLine(f)}
        </StateBox>
      );
  }
}
