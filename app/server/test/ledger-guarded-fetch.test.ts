import { expect, it, vi } from "vitest";
import { guardedLedgerFetch } from "../src/ledger-guarded-fetch";

it("연결이 끊기면 진행 중 요청을 취소하고 다음 요청을 시작하지 않는다", async () => {
  const connection = new AbortController(),
    send = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
  const guarded = guardedLedgerFetch(
    { signal: connection.signal, revalidate: async () => true },
    AbortSignal.timeout(10000),
    send,
  );
  const pending = guarded("https://example.test");
  await Promise.resolve();
  await Promise.resolve();
  connection.abort();
  await expect(pending).rejects.toThrow();
  await expect(guarded("https://example.test")).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});
it("잠금 재확인이 거절되면 외부 요청을 시작하지 않는다", async () => {
  const send = vi.fn(async () => new Response());
  const guarded = guardedLedgerFetch(
    { signal: new AbortController().signal, revalidate: async () => false },
    AbortSignal.timeout(10000),
    send,
  );
  await expect(guarded("https://example.test")).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
