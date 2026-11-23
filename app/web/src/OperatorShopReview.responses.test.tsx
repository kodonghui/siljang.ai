// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OperatorArea } from "./OperatorArea";
import { ERROR_CODES, type ErrorCode } from "./problems";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const detailPath = "/operator/shops/{shopId}",
  licensePath = `${detailPath}/license-review`,
  changePath = "/operator/identity-changes/{changeId}/review";
const example = (path: string, method: string, name: string) =>
  structuredClone(api.paths[path][method].responses[200].content["application/json"].examples[name].value);
const pending = () => example(detailPath, "get", "pending");
const identity = example("/operator/me", "get", "operator");
const shopId = pending().shopId;
interface Row {
  readonly path: string;
  readonly method: string;
  readonly status: number;
  readonly name: string;
  readonly body: unknown;
}
const rows: Row[] = (
  [
    [detailPath, "get"],
    [licensePath, "post"],
    [changePath, "post"],
  ] as const
).flatMap(([path, method]) =>
  Object.entries(api.paths[path][method].responses).flatMap(([status, response]) =>
    Object.entries(
      Object.values(
        (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
      )[0]?.examples ?? {},
    ).map(([name, row]) => ({
      path,
      method,
      status: status === "default" ? 500 : Number(status),
      name,
      body: row.value,
    })),
  ),
);
rows.push({
  path: detailPath,
  method: "get",
  status: 200,
  name: "already_verified",
  body: example(licensePath, "post", "verified").shop,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function Login() {
  const location = useLocation();
  return (
    <main>
      다시 로그인해 주세요 <span>{location.state?.returnTo}</span>
    </main>
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});
it("SCR-048의34행과 추가 요청 키 누락2개를 합쳐36응답을 대조한다", () => expect(rows).toHaveLength(36));
it.each(rows)("SCR-048 $path $status $name", async (row) => {
  let posted = false,
    reads = 0;
  const base = row.path === changePath ? example(detailPath, "get", "identity_change_pending") : pending();
  const body = row.body as Record<string, unknown>;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/operator/me") return json(identity);
      if (init.method === "GET") {
        reads++;
        if (row.method === "get") return json(row.body, row.status);
        if (!posted) return json(base);
        if (row.status === 200 && row.path === licensePath) return json(body.shop);
        if (body.code === "payment_account_missing") return json(example(detailPath, "get", "no_account"));
        if (body.code === "identity_change_pending") return json(example(detailPath, "get", "identity_change_pending"));
        if (row.path === licensePath && ["already_decided", "invalid_state"].includes(String(body.code)))
          return json(example(licensePath, "post", "verified").shop);
        return json({
          ...base,
          revision: "synthetic-latest",
          ...(row.path === changePath ? { pendingIdentityChange: null } : {}),
        });
      }
      posted = true;
      return json(row.body, row.status);
    }),
  );
  render(
    <MemoryRouter initialEntries={[`/operator/shops/${shopId}`]}>
      <Routes>
        <Route path="/operator/shops/:shopId" element={<OperatorArea />} />
        <Route path="/operator/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  );
  if (row.method === "post") {
    await screen.findByText("영업 신고 번호");
    const scope =
      row.path === changePath
        ? within(screen.getByRole("region", { name: "사업자 정보 변경 요청" }))
        : within(screen.getByRole("main"));
    const hold = row.name === "on_hold" || row.name === "validation_failed";
    fireEvent.click(scope.getByRole("button", { name: hold ? "보류" : row.path === changePath ? "반영" : "확인됨" }));
    if (hold) {
      fireEvent.change(screen.getByLabelText("보류 사유"), { target: { value: "합성 보류 이유" } });
      fireEvent.click(screen.getByRole("button", { name: "보류로 남기기" }));
    } else {
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: row.path === changePath ? "반영하기" : "확인됨으로 남기기" }),
      );
    }
  }
  if (row.status === 200) {
    if (row.method === "get") {
      await screen.findByText("영업 신고 번호");
      if (row.name === "already_verified")
        expect(within(screen.getByRole("main")).queryByRole("button", { name: "확인됨" })).toBeNull();
      if (row.name === "on_hold")
        expect(screen.getByRole("main").textContent).toContain(
          (body as { licenseHoldReason: string }).licenseHoldReason,
        );
      if (row.name === "identity_change_pending")
        expect(screen.getByRole("region", { name: "사업자 정보 변경 요청" })).toBeTruthy();
    } else {
      const message =
        row.name === "unchanged"
          ? row.path === changePath
            ? "이미 처리된 요청이에요"
            : "이미 확인된 가게예요"
          : row.path === changePath
            ? row.name === "on_hold"
              ? "변경 요청을 보류했어요. 사장님께 이유를 알렸어요"
              : "반영했어요. 사장님께 알렸어요"
            : row.name === "on_hold"
              ? "보류로 남겼어요. 사장님께 사유를 알렸어요"
              : "확인됨으로 남겼어요";
      await waitFor(() => expect(within(screen.getByRole("main")).getByText(message)).toBeTruthy());
    }
  } else if (row.status === 401) {
    await screen.findByText(`/operator/shops/${shopId}`);
    expect(document.body.textContent).not.toContain(base.contactPhone);
    expect(document.querySelector("img")).toBeNull();
  } else {
    const code = body.code as ErrorCode;
    await waitFor(() => expect(screen.getByRole("main").textContent).toContain(ERROR_CODES[code].message));
    if (row.status === 404) {
      expect(screen.getByRole("link", { name: "영업 신고 확인 목록으로" })).toBeTruthy();
      expect(screen.getByRole("main").textContent).not.toContain(base.contactPhone);
      expect(document.querySelector("img")).toBeNull();
    }
    if (row.status === 500) expect(screen.getByRole("main").textContent).toContain(body.traceId);
    if (
      [
        "version_conflict",
        "already_decided",
        "invalid_state",
        "identity_change_pending",
        "payment_account_missing",
      ].includes(code)
    )
      await waitFor(() => expect(reads).toBe(2));
    if (row.name === "validation_failed")
      expect((screen.getByLabelText("보류 사유") as HTMLTextAreaElement).value).toBe("합성 보류 이유");
  }
});
