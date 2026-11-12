// Render every mermaid block in the flow files with a given mermaid build; report errors and sizes.
// node render_check.js <mermaid.min.js> <flow-dir> <out-dir> [shots]
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
(async () => {
  const [lib, dir, out, shots] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const files = fs.readdirSync(dir).filter(f => /^FL-\d{3}-.*\.md$/.test(f)).sort();
  const blocks = files.map(f => {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = t.match(/```mermaid\n([\s\S]*?)```/);
    return { f, code: m ? m[1] : '' };
  });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await page.setContent('<html><body style="margin:0;background:#fff"><div id="o"></div></body></html>');
  await page.addScriptTag({ path: lib });
  const version = await page.evaluate(() => (window.mermaid && (mermaid.version || (mermaid.mermaidAPI && mermaid.mermaidAPI.getConfig && 'loaded'))) || 'missing');
  await page.evaluate(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', flowchart: { htmlLabels: true } }));
  let bad = 0;
  for (const [i, b] of blocks.entries()) {
    const res = await page.evaluate(async ({ code, i }) => {
      try {
        const { svg } = await mermaid.render('d' + i, code);
        document.getElementById('o').innerHTML = svg;
        const el = document.querySelector('#o svg');
        const box = el.getBBox();
        const nodes = el.querySelectorAll('g.node').length;
        const edges = el.querySelectorAll('path.flowchart-link, .edgePaths path').length;
        const labels = [...el.querySelectorAll('g.node')].map(n => n.textContent.trim()).filter(t => !t).length;
        return { ok: true, w: Math.round(box.width), h: Math.round(box.height), nodes, edges, emptyLabels: labels };
      } catch (e) { return { ok: false, err: String(e && e.message || e).slice(0, 400) }; }
    }, { code: b.code, i });
    if (!res.ok) bad++;
    console.log(b.f.slice(0, 6), res.ok ? `ok ${res.w}x${res.h} nodes=${res.nodes} edges=${res.edges} emptyLabels=${res.emptyLabels}` : 'ERROR ' + res.err);
    if (res.ok && shots) {
      const el = await page.$('#o svg');
      await el.screenshot({ path: path.join(out, b.f.slice(0, 6) + '.png') });
    }
  }
  console.log('mermaid', version, 'blocks', blocks.length, 'errors', bad);
  await browser.close();
})();
