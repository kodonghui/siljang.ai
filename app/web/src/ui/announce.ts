// 화면 읽기 프로그램에 상태를 알리는 곳(aria-live). 부품이 새로 나타날 때 그 안에 live 속성을 두면 읽지 않는 경우가 있어
// (live 영역은 바뀌기 전부터 있어야 함), 문서에 늘 있는 보이지 않는 영역 둘(polite·assertive)에 글을 넣는다.
// 서버 렌더·시험(document 없음)에서는 아무것도 하지 않는다.

const CLEAR_AFTER_MS = 7000;

let regions: { polite: HTMLElement; assertive: HTMLElement } | null = null;

function region(level: "polite" | "assertive"): HTMLElement {
  const el = document.createElement("div");
  el.className = "ui-sr-only";
  el.setAttribute("aria-live", level);
  el.setAttribute("aria-relevant", "additions text");
  el.dataset.announcer = level;
  document.body.append(el);
  return el;
}

/** 지금 상태를 한 문장으로 알림. 오류는 assertive, 그 밖은 polite */
export function announce(message: string, level: "polite" | "assertive" = "polite"): void {
  if (typeof document === "undefined" || message === "") return;
  if (regions === null || !regions.polite.isConnected || !regions.assertive.isConnected) {
    regions = { polite: region("polite"), assertive: region("assertive") };
  }
  const target = regions[level];
  const line = document.createElement("div");
  line.textContent = message;
  // 같은 글을 잇달아 알려도 다시 읽게 새 줄을 더하고, 조금 뒤 지움
  target.replaceChildren(line);
  setTimeout(() => line.remove(), CLEAR_AFTER_MS);
}
