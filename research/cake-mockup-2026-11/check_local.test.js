// 검사 실행기의 자원 재사용과 오류 보존을 합성 HTML로 확인한다. 실제 아트보드 검사는 C11이 따로 한다.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'siljang-page-batch-'));
  let assets = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== '/cached.svg') { res.writeHead(404); res.end(); return; }
    assets++;
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const checker = path.join(temp, 'checker.js');
    await fs.writeFile(checker, '(()=>({pass:document.title!=="reject",counts:{error:document.title==="reject"?1:0,warn:0,info:0},byCheck:{},issues:[],notMeasured:["synthetic-only"]}))()');
    const pages = [];
    for (const [name, width, script, image] of [
      ['first', 360, '', 'cached.svg'], ['second', 1280, '', 'cached.svg'],
      ['console', 360, 'console.error("synthetic console failure")', 'cached.svg'],
      ['reject', 360, '', 'cached.svg'], ['missing', 360, '', 'missing.svg'],
    ]) {
      const file = path.join(temp, name + '.html');
      await fs.writeFile(file, `<title>${name}</title><style>body{margin:0}main{width:100vw;height:100px}</style><main><img src="http://127.0.0.1:${port}/${image}"></main><script>${script}</script>`);
      pages.push({ file, width });
    }
    const manifest = path.join(temp, 'pages.json');
    await fs.writeFile(manifest, JSON.stringify({ pageCheck: checker, pages }));
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(__dirname, 'check_local.js'), '--batch', manifest], { env: { ...process.env, HTTPS_PROXY: '' }, timeout: 45000, maxBuffer: 1024 * 1024 });
    const reports = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(reports.length, 5);
    assert.equal(assets, 1, '같은 자원은 한 검사 맥락의 HTTP 캐시에서 재사용해야 함');
    assert.deepEqual(reports.slice(0, 2).map(r => r.dims), [{ w: 360, h: 100, docW: 360 }, { w: 1280, h: 100, docW: 1280 }]);
    assert.deepEqual(reports[0].notMeasured, ['synthetic-only']);
    assert.deepEqual(reports[0].errs, []);
    assert.ok(reports[2].errs.some(e => e.includes('synthetic console failure')));
    assert.equal(reports[3].pass, false);
    assert.equal(reports[3].counts.error, 1);
    assert.ok(reports[4].errs.length > 0, '자원 실패도 오류로 남겨야 함');
    console.log('통과: 5페이지·캐시 자원 요청 1회·서로 다른 화면 폭·콘솔/검사/자원 오류 보존');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
