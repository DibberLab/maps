/* Disc golf layer test, using tools/fixtures/discgolf-elver.json (Elver Park,
   Madison, from OpenStreetMap) in place of site/data/discgolf.json.
   node tools/smoke_discgolf.js [http://127.0.0.1:8766/] [out-dir] */
const { chromium, devices } = require('playwright');
const path = require('path'), fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/', OUT = process.argv[3] || '.';
const FIX = fs.readFileSync(path.join(__dirname, 'fixtures/discgolf-elver.json'));
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if(!ok) failed++; };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/data/discgolf.json', r => r.fulfill({ body: FIX, contentType: 'application/json' }));
  await page.addInitScript(() => { if(!sessionStorage.getItem('dg-set')){ localStorage.setItem('lf.discgolfOn', 'true'); sessionStorage.setItem('dg-set', '1'); } });   // the layer is off by default
  await page.goto(BASE + '#map=12/43.0348/-89.5045&layers=parcels');
  await page.waitForFunction(() => window.LF && LF.discgolf && LF.discgolf.data());
  check(await page.locator('.dg-pin').count() >= 1, 'course pins on the map');
  check(/2 courses, 1 with hole layouts/.test(await page.textContent('#dgNote')), 'layers panel says what loaded: ' + await page.textContent('#dgNote'));
  // Search by name opens the course.
  await page.fill('#q', 'elver'); await page.press('#q', 'Enter');
  await page.waitForSelector('#sheet:not([hidden]) table.holes');
  const head = await page.textContent('#sheetHead'), body = await page.textContent('#sheetBody');
  check(/Elver Park Disc Golf Course/.test(head) && /18 holes/.test(head), 'search finds the course by name: ' + head.replace(/\s+/g, ' ').slice(0, 60));
  check(/Par\s*56/.test(body) && /Madison Parks/.test(body) && /7 USD\/day/.test(body), 'sheet shows par, operator and fee');
  check(await page.locator('table.holes tbody tr').count() === 18, '18 holes listed');
  check(/OpenStreetMap/.test(body), 'credits OpenStreetMap');
  await page.waitForTimeout(800);
  check(await page.evaluate(() => LF.map.getZoom()) >= 15, 'zoomed to the course');
  check(await page.locator('.dg-tee').count() >= 18, 'numbered tees drawn: ' + await page.locator('.dg-tee').count());
  await page.click('table.holes tr[data-ref="4"]');
  check(await page.locator('table.holes tr.on td').first().textContent() === '4', 'tapping a hole highlights it');
  await page.screenshot({ path: path.join(OUT, 'discgolf.png') });
  // Turning the layer off hides it.
  await page.click('#closeSheet'); await page.click('#layersBtn'); await page.click('#l-discgolf');
  check(await page.locator('.dg-pin').count() === 0 && await page.locator('.dg-tee').count() === 0, 'layer switches off');
  check(errors.length === 0, 'no script errors' + (errors.length ? ': ' + errors.join('; ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
