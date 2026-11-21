import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("빈 화면이 그려진다", () => {
    const html = renderToString(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(html).toContain("수제케이크 주문제작");
  });

  it("사장님 로그인 주소는 카카오 로그인 버튼과 용도를 표시한다", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/owner/login"]}>
        <App />
      </MemoryRouter>,
    );
    expect(html).toContain("사장님 로그인");
    expect(html).toContain("카카오 로그인");
    expect(html).toContain("가게 사장님용");
  });

  it("카카오에서 돌아온 주소는 처리 중 상태로 시작한다", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/owner/login/callback?code=example-code&state=example-state-123"]}>
        <App />
      </MemoryRouter>,
    );
    expect(html).toContain("로그인하고 있어요");
    expect(html).not.toContain("example-code");
  });
});
