import { useEffect, useState, useSyncExternalStore } from "react";
import { type CommandOptions, CommandRunner, type CommandState, type Send } from "./command";

export interface Command<I, O> {
  readonly state: CommandState<O>;
  /** 보내는 중(버튼은 '처리하고 있어요', 이 화면의 다른 액션도 막음, 08 submitting) */
  readonly busy: boolean;
  readonly submit: (input: I) => boolean;
  readonly retry: () => boolean;
  readonly confirm: () => boolean;
  readonly cancelConfirm: () => void;
  readonly reset: () => void;
}

/**
 * 화면의 명령 하나(command.ts의 CommandRunner)를 React 상태로. send는 처음 것을 계속 쓴다
 * (요청을 바꾸려면 send 안에서 최신 값을 읽거나 key를 바꿔 다시 그림).
 */
export function useCommand<I, O>(send: Send<I, O>, options?: CommandOptions): Command<I, O> {
  const [runner] = useState(() => new CommandRunner(send, options));
  const state = useSyncExternalStore(runner.subscribe, runner.getState, runner.getState);
  useEffect(() => runner.stopTimers, [runner]);
  return {
    state,
    busy: state.kind === "submitting",
    submit: runner.submit,
    retry: runner.retry,
    confirm: runner.confirm,
    cancelConfirm: runner.cancelConfirm,
    reset: runner.reset,
  };
}
