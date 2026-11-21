import { Route, Routes } from "react-router";
import { OperatorArea } from "./OperatorArea";
import { OperatorLogin } from "./OperatorLogin";
import { OwnerArea } from "./OwnerArea";
import { OwnerLogin } from "./OwnerLogin";
import { OPERATOR_LOGIN } from "./operator";
import { OWNER_CALLBACK, OWNER_LOGIN } from "./owner";

// 뼈대(TASK-015)의 빈 화면. 화면은 07 사이트맵·08 화면 정의·09 시안을 따라 뒤 작업에서 만든다.
function Home() {
  return (
    <main>
      <h1>수제케이크 주문제작</h1>
      <p>준비 중입니다.</p>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path={OWNER_LOGIN} element={<OwnerLogin />} />
      <Route path={OWNER_CALLBACK} element={<OwnerLogin />} />
      <Route path="/owner/*" element={<OwnerArea />} />
      <Route path={OPERATOR_LOGIN} element={<OperatorLogin />} />
      <Route path="/operator/*" element={<OperatorArea />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
