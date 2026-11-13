// usage: node export_png.js <absolute html path> <viewportWidth> <out.png> [deviceScaleFactor, default 2]
// Renders an artboard made standalone by dc2html.py and saves the artboard element (the first element of <body>)
// as a PNG for people to keep. The viewport width is the artboard width ($preview width), as in check_local.js.
const { chromium } = require('playwright');
const [file, w, out, dsf] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const p = await b.newPage({ viewport: { width: +w, height: 900 }, deviceScaleFactor: +(dsf || 2) });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('requestfailed', r => errs.push('requestfailed ' + r.url().slice(0, 80)));
  await p.goto('file://' + file);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  const el = await p.$('body > *');
  await el.screenshot({ path: out });
  const box = await el.boundingBox();
  const fonts = await p.evaluate(() => [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight))]);
  console.log(JSON.stringify({ out: out.split('/').pop(), w: Math.round(box.width), h: Math.round(box.height), fonts, errs }));
  await b.close();
})();
