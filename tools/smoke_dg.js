/* The disc golf app (site/js/flavor.js): the same site seen at a discjerkers.com address (here: ?app=dg).
   Checks its own name and starting layers, Courses near me, map taps without owner lookups, campgrounds, and that its
   layer choices are kept apart from Line Fence's on the account. Needs the API: run with tools/run_all.sh, or
           node tools/smoke_dg.js http://127.0.0.1:8766/ [out-dir]   */
const { chromium, devices } = require('playwright');
const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const OUT = process.argv[3] || '.';
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if(!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], geolocation:{ latitude:45.7778, longitude:-92.4310, accuracy:5 }, permissions:['geolocation'] });
  const page = await ctx.newPage();
  const errors = [], parcelCalls = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', r => { if(/Statewide_Parcels|plan_parcels_open/.test(r.url())) parcelCalls.push(r.url()); });

  await page.goto(BASE + '?app=dg#map=13/45.79/-92.42', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => window.LF && LF.courses && LF.discgolf);
  check(await page.evaluate(() => LF.isDG && document.title === LF.APP.name && /First\s*Available/.test(document.getElementById('menuBtn').textContent)), 'the disc golf app has its own name');
  check(await page.evaluate(() => /manifest-dg\.json$/.test(document.querySelector('link[rel=manifest]').href)), 'and its own install manifest and icon');
  const on = await page.evaluate(() => LF.on);
  check(!on.parcels && on.trout && on.camp && on.padus && await page.isChecked('#l-discgolf'), 'starts with courses, campgrounds, trout water and public land on, property lines off');
  check(await page.evaluate(() => /Play/.test(document.querySelector('#toolsPanel h3').textContent)), 'the + panel starts with the disc golf tools');
  check(await page.evaluate(() => /Recreation/.test(document.querySelector('#layersPanel h3').textContent)), 'the layers panel starts with courses and campgrounds');

  // Courses near me.
  await page.click('#nearBtn');
  await page.waitForSelector('#sheetBody [data-near] ~ .rows .row', { timeout:20000 });
  await page.waitForFunction(() => /where you are/.test(document.getElementById('sheetHead').textContent), null, { timeout:10000 }).catch(() => {});
  const first = await page.textContent('#sheetBody .rows .row');
  check(/Tj(iny|ader) Acres/.test(first), 'Courses near me lists the nearest first: ' + first.replace(/\s+/g, ' ').trim());
  await page.fill('#near-q', 'elver');
  await page.waitForFunction(() => /Elver/.test(document.querySelector('#sheetBody .rows').textContent));
  check(await page.locator('#sheetBody .rows .row').count() >= 1, 'searching finds a course anywhere by name');
  await page.locator('#sheetBody .rows .row').first().click();
  await page.waitForSelector('#sheet:not([hidden]) .tag.dg');
  check(/Elver/.test(await page.textContent('#sheetHead')), 'tapping a course opens it');
  await page.screenshot({ path:path.join(OUT, 'dg-course.png') });

  // A map tap: public land and access, no owner lookups.
  await page.evaluate(() => { LF.closeSheet(); LF.map.setView([45.80, -92.40], 15, { animate:false }); });
  await page.waitForTimeout(500);
  const vw = page.viewportSize();
  await page.mouse.click(vw.width / 2, vw.height / 2);
  await page.waitForFunction(() => !/Looking up/.test(document.getElementById('sheetHead').textContent), null, { timeout:30000 }).catch(() => {});
  check(parcelCalls.length === 0 && !/No parcel at this spot/.test(await page.textContent('#sheetBody')), 'a map tap skips property owners (' + parcelCalls.length + ' parcel requests)');

  // Campgrounds: tent badges in the Superior National Forest, and a tap tells you about one.
  await page.evaluate(() => { LF.closeSheet(); LF.map.setView([47.7, -91.4], 11, { animate:false }); });
  await page.waitForFunction(() => document.querySelectorAll('.camp').length > 0, null, { timeout:30000 }).catch(() => {});
  const camps = await page.locator('.camp').count();
  check(camps > 0, 'campgrounds draw as tent badges: ' + camps);
  if(camps){ // one that's on screen, clear of the buttons
    const vw2 = page.viewportSize();
    const b = await page.evaluate(([w, h]) => { const r = Array.from(document.querySelectorAll('.camp')).map(e => e.getBoundingClientRect())
      .find(r => r.x > 20 && r.y > 120 && r.x < w - 80 && r.y < h - 250); return r && { x:r.x, y:r.y, width:r.width, height:r.height }; }, [vw2.width, vw2.height]);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForFunction(() => /campground|campsite/i.test(document.getElementById('sheetBody').textContent), null, { timeout:30000 }).catch(() => {});
    check(/campground|campsite/i.test(await page.textContent('#sheetBody')), 'tapping one shows the campground: ' + (await page.textContent('#sheetHead')).replace(/\s+/g, ' ').slice(0, 80) + ' / ' + (await page.textContent('#sheetBody')).replace(/\s+/g, ' ').slice(0, 200));
  }

  // Signed in: the disc golf app's layer choices go under .dg on the account, Line Fence's stay as they were.
  await page.evaluate(async () => {
    const c = { email:'tester@example.com', password:'correct horse', name:'Tester' };
    try{ await LF.api('POST', 'signup', c); }catch(e){ await LF.api('POST', 'login', c); }
    await LF.api('POST', 'me/settings', { settings:{ v:1, base:'topo', layers:{ 'l-parcels':true } } });   // as Line Fence left it
    await LF.account.refresh();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => LF.closeSheet());
  await page.click('#layersBtn'); await page.click('label:has(#l-mnaccess)'); await page.click('#layersBtn');
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => LF.api('GET', 'me/settings').then(r => r.settings));
  check(st && st.base === 'topo' && st.layers['l-parcels'] === true && st.dg && st.dg.layers['l-mnaccess'] === true && st.dg.layers['l-parcels'] === false,
    'its layer choices are saved apart from Line Fence\'s');
  check(!on.parcels && await page.evaluate(() => !LF.on.parcels), 'and Line Fence\'s settings don\'t turn property lines on here');

  // The same address without ?app=dg on a test server stays the disc golf app until switched back.
  await page.goto(BASE + '?app=lf', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => window.LF && LF.APP);
  check(await page.evaluate(() => !LF.isDG && document.title === 'Line Fence'), '?app=lf switches back to Line Fence');

  const real = errors.filter(e => !/net::ERR_|Failed to fetch|(carto|hydro)\.nationalmap\.gov/.test(e));
  check(real.length === 0, 'no script errors' + (real.length ? ':\n  ' + real.join('\n  ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
