import { describe, expect, it, vi } from "vitest";
import { writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

const file = "synthetic_sheet_1234567890",
  access = new Secret("synthetic-access");
const setup = { sheetId: 7, start: 26, end: 38, movedRight: false, ownershipToken: "proof", columns: [] };
const input = {
  file,
  tab: "장부's",
  access,
  setup,
  shopId: crypto.randomUUID(),
  linkId: crypto.randomUUID(),
  eventId: crypto.randomUUID(),
  values: ["ABC123", "이름", "010-1234-5678", "2026-11-28", "케이크", "=1+1", 10000, "확인", "취소", 0, "", "취소됨"],
};

function sheet(initial: string[] = []) {
  const rows = [...initial],
    markers = new Map<number, Record<string, unknown>>(),
    requests: Record<string, unknown>[] = [];
  let delayed: (() => void) | null = null,
    lose = false;
  const send = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(raw));
    if (url.pathname.includes("/developerMetadata/")) {
      const value = markers.get(Number(url.pathname.split("/").at(-1)));
      return value ? Response.json(value) : new Response(null, { status: 404 });
    }
    if (init?.method === "GET") return Response.json({ values: [["주문번호"], ...rows.map((value) => [value])] });
    const body = JSON.parse(String(init?.body)) as { requests: Record<string, unknown>[] };
    requests.push(body.requests[0] ?? {});
    const meta = (body.requests[1] as { createDeveloperMetadata: { developerMetadata: Record<string, unknown> } })
      .createDeveloperMetadata.developerMetadata;
    const apply = () => {
      const id = Number(meta.metadataId);
      if (markers.has(id)) return false;
      markers.set(id, meta);
      if (body.requests[0]?.appendCells) rows.push("ABC123");
      return true;
    };
    if (lose) {
      lose = false;
      delayed = () => {
        apply();
      };
      throw new Error("response lost");
    }
    if (!apply()) return new Response(null, { status: 400 });
    return Response.json({ spreadsheetId: file, replies: [{}, {}] });
  });
  return {
    rows,
    send,
    requests,
    loseNext() {
      lose = true;
    },
    applyDelayed() {
      delayed?.();
    },
  };
}
describe("장부 행 쓰기", () => {
  it("기존 주문 행만 지정하고 수식처럼 보이는 값도 문자열로 쓴다", async () => {
    const f = sheet(["OTHER1", "ABC123"]);
    await writeLedgerSheet(input, { fetch: f.send });
    const update = (
      f.requests[0] as {
        updateCells: {
          start: { rowIndex: number; columnIndex: number };
          rows: { values: { userEnteredValue: unknown }[] }[];
        };
      }
    ).updateCells;
    expect(update.start).toEqual({ sheetId: 7, rowIndex: 2, columnIndex: 26 });
    expect(update.rows[0]?.values[5]?.userEnteredValue).toEqual({ stringValue: "=1+1" });
  });
  it("주문번호가 없으면 한 행을 추가하고 중복 번호는 거절한다", async () => {
    const f = sheet();
    await writeLedgerSheet(input, { fetch: f.send });
    expect(f.rows).toEqual(["ABC123"]);
    expect(f.requests[0]).toHaveProperty("appendCells");
    await expect(writeLedgerSheet(input, { fetch: sheet(["ABC123", "ABC123"]).send })).rejects.toThrow();
  });
  it("응답 없이 늦게 반영된 추가와 재시도가 겹쳐도 주문 행은 하나다", async () => {
    const f = sheet();
    f.loseNext();
    await expect(writeLedgerSheet(input, { fetch: f.send })).rejects.toThrow();
    await writeLedgerSheet(input, { fetch: f.send });
    f.applyDelayed();
    expect(f.rows).toEqual(["ABC123"]);
  });
  it("이미 적용된 응답이 유실되면 재시도는 중복 작성하지 않고 삭제된 행은 복구한다", async () => {
    const f = sheet();
    f.loseNext();
    await expect(writeLedgerSheet(input, { fetch: f.send })).rejects.toThrow();
    f.applyDelayed();
    await writeLedgerSheet(input, { fetch: f.send });
    expect(f.rows).toEqual(["ABC123"]);
    f.rows.splice(0, 1);
    await writeLedgerSheet(input, { fetch: f.send });
    expect(f.rows).toEqual(["ABC123"]);
  });
});
