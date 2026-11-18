// 개발용 견본이 node에서도 그려지는지와 page-check 실행기의 상태 목록이 견본과 같은지(CI에서 브라우저 없이 보는 몫).
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SAMPLE_STATES, SampleIndex, type SampleState, Samples } from "./Samples";

const states = Object.keys(SAMPLE_STATES) as SampleState[];

describe("부품 견본", () => {
  it.each(states)("%s가 그려진다", (state) => {
    const html = renderToString(<Samples state={state} />);
    expect(html).toContain(SAMPLE_STATES[state]);
    // 레이아웃 견본(TASK-182)은 화면 하나를 통째로, 나머지는 견본 레이아웃 안에
    expect(html).toMatch(
      state.startsWith("layout-") || state === "flow-menu" ? /class="ui-(layout|setup|login)/ : /class="sample"/,
    );
  });

  it("08 공통 상태(불러오는 중·빈·오류·권한·오래됨·보내는 중·됨)와 확인 창·필드 오류가 모두 있다", () => {
    for (const state of [
      "loading",
      "empty",
      "load-failed",
      "save-failed",
      "permission",
      "stale",
      "as-of",
      "submitting",
      "done",
      "confirm",
      "confirm-notify",
      "field-error",
    ]) {
      expect(states).toContain(state);
    }
  });

  it("레이아웃 견본: 사장님·운영자의 1뎁스·하위 화면, 목록 상태, 메뉴 없는 두 화면, 360 메뉴 플로우", () => {
    for (const state of [
      "layout-owner",
      "layout-owner-sub",
      "layout-owner-list-states",
      "layout-operator",
      "layout-operator-sub",
      "layout-setup",
      "layout-login",
      "flow-menu",
    ]) {
      expect(states).toContain(state);
    }
  });

  it("scripts/page-check.mjs가 견본 상태를 모두 연다", () => {
    const script = readFileSync(new URL("../../scripts/page-check.mjs", import.meta.url), "utf8");
    const block = /const STATES = \[([\s\S]*?)\];/.exec(script)?.[1] ?? "";
    const listed = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(listed).toEqual(states);
  });

  it("목록 화면은 상태마다 고리", () => {
    const html = renderToString(<SampleIndex />);
    for (const state of states) expect(html).toContain(`href="?state=${state}"`);
  });
});
