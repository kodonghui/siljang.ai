// 한 페이지: node check_local.js <page-check.js> <html 절대 경로> <화면 폭> [사진 경로]
// 여러 페이지: node check_local.js --batch <JSON 목록>. 같은 맥락의 HTTP 캐시를 재사용한다.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function checkPage(context, src, item) {
  const p = await context.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('requestfailed', r => errs.push('requestfailed ' + r.url().slice(0, 80)));
  p.on('pageerror', error => errs.push('pageerror ' + error.message));
  try {
    await p.setViewportSize({ width: item.width, height: 900 });
    await p.goto(pathToFileURL(item.file).href);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(800);
    const r = await p.evaluate(src);
    const dims = await p.evaluate(() => {
      const rc = document.body.firstElementChild.getBoundingClientRect();
      return { w: Math.round(rc.width), h: Math.round(rc.height), docW: document.documentElement.scrollWidth };
    });
    const fonts = await p.evaluate(() => [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight))]);
    if (item.shot) await p.screenshot({ path: item.shot, fullPage: true });
    return { file: path.basename(item.file), pass: r.pass, counts: r.counts, byCheck: r.byCheck, dims, fonts, errs, notMeasured: r.notMeasured, issues: r.issues };
  } finally {
    await p.close();
  }
}

(async () => {
  const args = process.argv.slice(2);
  const batch = args[0] === '--batch';
  const input = batch ? JSON.parse(fs.readFileSync(args[1], 'utf8')) : {
    pageCheck: args[0], pages: [{ file: args[1], width: Number(args[2]), shot: args[3] }],
  };
  if (!Array.isArray(input.pages) || !input.pages.length || input.pages.some(item => !path.isAbsolute(item.file) || !Number.isInteger(item.width) || item.width < 1)) throw new Error('검사할 페이지 경로·화면 폭을 확인해 주세요');
  const src = fs.readFileSync(input.pageCheck, 'utf8');
  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    try {
      for (const item of input.pages) {
        let report;
        try { report = await checkPage(context, src, item); }
        catch (error) {
          if (!batch) throw error;
          report = { file: path.basename(item.file), failure: error.message };
        }
        console.log(JSON.stringify(report));
        if (!batch) for (const issue of report.issues) if (issue.level !== 'info') console.log('  ', issue.level, issue.check, issue.msg, '|', issue.where, '|', (issue.text || '').slice(0, 40));
      }
    } finally { await context.close(); }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
