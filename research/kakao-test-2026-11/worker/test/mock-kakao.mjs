// 로컬 시험용 가짜 카카오 서버(test/local-e2e.sh가 띄움). 실제 카카오에는 닿지 않는다.
// - POST /cb/*: 콜백 받기. 받은 본문을 한 줄 JSON으로 로그 파일에 남기고 카카오 콜백 응답 꼴로 답함
// - GET /img/*: 2048바이트짜리 가짜 사진(image/jpeg)
// - GET /redir/*: /img/로 302(허용 호스트 안 리다이렉트), GET /redir-out/*: 허용 호스트 밖으로 302
// 쓰는 법: node test/mock-kakao.mjs <포트> <로그 파일>
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const [port, logFile] = process.argv.slice(2);
if (!port || !logFile) {
  console.error("쓰는 법: node test/mock-kakao.mjs <포트> <로그 파일>");
  process.exit(2);
}

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "POST" && path.startsWith("/cb/")) {
      appendFileSync(logFile, JSON.stringify({ path, at: Date.now(), body: Buffer.concat(chunks).toString("utf8") }) + "\n");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ taskId: "local-task-0001", status: "SUCCESS", message: "", timestamp: Date.now() }));
      return;
    }
    if (req.method === "GET" && path.startsWith("/redir/")) {
      res.writeHead(302, { location: `/img/${path.slice("/redir/".length)}` });
      res.end();
      return;
    }
    if (req.method === "GET" && path.startsWith("/redir-out/")) {
      res.writeHead(302, { location: "https://example.invalid/out.jpg" });
      res.end();
      return;
    }
    if (req.method === "GET" && path.startsWith("/img/")) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(Buffer.alloc(2048, 0xff));
      return;
    }
    res.writeHead(404);
    res.end();
  });
}).listen(Number(port), "127.0.0.1");
