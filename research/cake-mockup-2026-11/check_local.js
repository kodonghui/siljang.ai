// usage: node check_local.js <page-check.js> <absolute html path> <viewportWidth> [shotPath]
// page-check.js is in the corthex plugin: skills/corthex-uxui/scripts/page-check.js
const { chromium } = require('playwright');
const fs = require('fs');
const [pageCheck, file, w, shot] = process.argv.slice(2);
const src = fs.readFileSync(pageCheck, 'utf8');
(async () => {
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const p = await b.newPage({ viewport: { width: +w, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('requestfailed', r => errs.push('requestfailed ' + r.url().slice(0, 80)));
  await p.goto('file://' + file);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  const r = await p.evaluate(src);
  const dims = await p.evaluate(() => { const el = document.body.firstElementChild; const rc = el.getBoundingClientRect(); return { w: Math.round(rc.width), h: Math.round(rc.height), docW: document.documentElement.scrollWidth }; });
  const fonts = await p.evaluate(() => [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight))]);
  if (shot) await p.screenshot({ path: shot, fullPage: true });
  console.log(JSON.stringify({ file: file.split('/').pop(), pass: r.pass, counts: r.counts, byCheck: r.byCheck, dims, fonts, errs, notMeasured: r.notMeasured }));
  for (const i of r.issues) if (i.level !== 'info') console.log('  ', i.level, i.check, i.msg, '|', i.where, '|', (i.text || '').slice(0, 40));
  await b.close();
})();
