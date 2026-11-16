// 개발 서버의 /samples.html 진입점(운영 빌드에 들어가지 않음: scripts/check-dist.mjs가 봄)
import "../styles";
import "../styles/fonts";
import "./samples.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isSampleState, SampleIndex, Samples } from "./Samples";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root not found");
}
const state = new URLSearchParams(window.location.search).get("state");
createRoot(root).render(<StrictMode>{isSampleState(state) ? <Samples state={state} /> : <SampleIndex />}</StrictMode>);
