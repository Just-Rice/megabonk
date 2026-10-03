/* ============================================================
   MEGABONK — smoke test

   Loads the game at a desktop and a phone viewport and fails on any
   console error or uncaught exception. It also checks the two things
   the mobile pass fixed: every menu / pause control can be reached on a
   short landscape phone, and the pickers work from the keyboard.

     npm i --no-save playwright      # once; nothing is added to the repo
     node tests/smoke.js

   Offline, point THREE_JS at a local copy of three.min.js r128 and the
   CDN request is answered from disk instead.
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg' };

const VIEWPORTS = [
  ['desktop 1366x768', { viewport: { width: 1366, height: 768 } }],
  ['phone 390x844', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ['phone 844x390', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }]
];

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(ok => srv.listen(0, () => ok(srv)));
}

// every visible control inside the open overlay can be scrolled into view
async function reachable(page, overlay) {
  return page.evaluate(sel => {
    const box = document.querySelector(sel);
    const bad = [];
    for (const el of box.querySelectorAll('button, [role="button"], .logo, .lu-title')) {
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      if (r.top < -1 || r.bottom > innerHeight + 1) bad.push(el.id || el.className);
    }
    box.scrollTop = 0;
    return bad;
  }, overlay);
}

(async () => {
  const srv = await serve();
  const url = 'http://localhost:' + srv.address().port + '/';
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  let failed = 0;

  for (const [name, opts] of VIEWPORTS) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    if (process.env.THREE_JS) {
      await page.route('**/three.min.js', r => r.fulfill({ path: process.env.THREE_JS, contentType: 'text/javascript' }));
    }

    const problems = [];
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), null, { timeout: 20000 });

    const portraitPhone = await page.evaluate(() => !document.getElementById('rotate').classList.contains('hidden'));
    if (!portraitPhone) {
      const off = await reachable(page, '#menu');
      if (off.length) problems.push('menu controls out of reach: ' + off.join(', '));

      if (!opts.hasTouch) {
        // Tab to the second bonker and press Enter: it should select, not start the run
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Tab');
          if (await page.evaluate(() => document.activeElement === document.querySelectorAll('#chars .char')[1])) break;
        }
        await page.keyboard.press('Enter');
        const st = await page.evaluate(() => [Game.state, Game.selectedChar]);
        if (st[0] !== 'menu' || st[1] !== 1) problems.push('keyboard picker: state=' + st[0] + ' char=' + st[1]);
      }

      await page.evaluate(() => Game.start());
      await page.waitForTimeout(600);
      await page.evaluate(() => Game.togglePause());
      const offPause = await reachable(page, '#pause');
      if (offPause.length) problems.push('pause controls out of reach: ' + offPause.join(', '));
    }

    await page.waitForTimeout(300);
    if (errors.length) problems.push('console errors:\n    ' + errors.join('\n    '));
    console.log((problems.length ? 'FAIL ' : 'ok   ') + name + (portraitPhone ? ' (rotate prompt shown)' : ''));
    problems.forEach(p => console.log('  - ' + p));
    failed += problems.length ? 1 : 0;
    await ctx.close();
  }

  await browser.close();
  srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
