import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("빈 화면이 그려진다", () => {
    const html = renderToString(<App />);
    expect(html).toContain("수제케이크 주문제작");
  });
});
