import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
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
 * 화면의 명령 하나(command.ts의 CommandRunner)를 React 상태로. send는 그린 때마다 새로 넘겨도 된다:
 * 누를 때의 send로 보내고, 그 명령의 '다시 시도'·처리 중 다시 보내기·확인도 같은 send를 쓴다
 * (예: (input, key) => request(`/orders/${orderId}/accept`, { method: "POST", body: input, key })).
 * options는 처음 것만 쓴다.
 */
export function useCommand<I, O>(send: Send<I, O>, options?: CommandOptions): Command<I, O> {
  const [runner] = useState(() => new CommandRunner(send, options));
  // 그린 뒤 바로(눌림보다 먼저) 최신 send를 넘김
  useLayoutEffect(() => {
    runner.setSend(send);
  });
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
