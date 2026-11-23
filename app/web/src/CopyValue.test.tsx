// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CopyValue } from "./CopyValue";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function clipboard(writeText: (value: string) => Promise<void>) {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
}
it("값 복사는 누른 값만 넘기고 성공을 알린다", async () => {
  const write = vi.fn(async () => {});
  clipboard(write);
  render(<CopyValue label="합성 설정 값" value="synthetic-value" />);
  fireEvent.click(screen.getByRole("button", { name: "합성 설정 값 복사" }));
  await screen.findByText("복사했어요");
  expect(write).toHaveBeenCalledExactlyOnceWith("synthetic-value");
});
it("복사가 막히면 현재 입력 값을 선택하고 직접 복사를 안내한다", async () => {
  clipboard(async () => {
    throw new Error("synthetic-denied");
  });
  render(<CopyValue label="합성 설정 값" value="synthetic-value" />);
  fireEvent.click(screen.getByRole("button", { name: "합성 설정 값 복사" }));
  await screen.findByText("복사가 막혀 있어요. 선택한 값을 복사해 주세요");
  const input = screen.getByLabelText("합성 설정 값") as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);
});
it("잠긴 복사 버튼은 클립보드에 쓰지 않는다", () => {
  const write = vi.fn(async () => {});
  clipboard(write);
  render(<CopyValue label="합성 설정 값" value="synthetic-value" disabled />);
  fireEvent.click(screen.getByRole("button", { name: "합성 설정 값 복사" }));
  expect(write).not.toHaveBeenCalled();
});
it("복사를 기다리다 값이 바뀌면 이전 값의 성공을 새 값의 알림으로 쓰지 않는다", async () => {
  let done: (() => void) | undefined;
  clipboard(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  const view = render(<CopyValue label="합성 설정 값" value="synthetic-before" />);
  fireEvent.click(screen.getByRole("button", { name: "합성 설정 값 복사" }));
  view.rerender(<CopyValue label="합성 설정 값" value="synthetic-after" />);
  await act(async () => {
    done?.();
  });
  await waitFor(() => expect(screen.queryByText("복사했어요")).toBeNull());
});
