import "./styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { pruneRegistrationDraft } from "./registration-draft";

pruneRegistrationDraft();

// 글꼴 CSS는 커서 따로 싣는다(styles/fonts.ts). 실패해도 대체 글꼴로 보이므로 결과는 기다리지 않는다
import("./styles/fonts").catch(() => {});

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}
