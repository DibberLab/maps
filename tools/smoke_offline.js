/* Phase 3 end-to-end test: save a small area for offline, cut the network,
   reload, and check the map, parcel lines and parcel lookups still work.
   Usage:  (cd site && python3 -m http.server 8765) &   then
           node tools/smoke_offline.js [http://localhost:8765/] [out-dir]
   Downloads a few dozen USGS tiles and a few hundred parcels near Siren, WI. */
const { chromium, devices } = require('playwright');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || '.';
const SPOT = { lat: 45.78573, lng: -92.38124 };   // a parcel in Siren

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if(!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + `#map=16/${SPOT.lat}/${SPOT.lng}&layers=parcels,padus,widnr`);
  await page.waitForFunction(() => window.LF && LF.offline && navigator.serviceWorker.controller, null, { timeout: 15000 })
    .catch(async () => { await page.reload(); await page.waitForFunction(() => window.LF && LF.offline && navigator.serviceWorker.controller); });

  // 1. The save sheet frames the area and estimates its size.
  await page.click('#toolsBtn'); await page.click('[data-tool=offline-save]');
  await page.waitForFunction(() => /parcels\./.test(document.getElementById('o-est').textContent), null, { timeout: 20000 }).catch(() => {});
  const est = await page.textContent('#o-est');
  check(/About .*map tiles, [\d,]+ parcels/.test(est), 'estimate: ' + est);
  await page.fill('#o-name', 'Siren test');
  await page.click('input[name=o-z][value="15"]');
  await page.click('[data-act=o-go]');
  await page.waitForSelector('#offChip:not([hidden])', { timeout: 5000 }).catch(() => {});
  check(await page.isVisible('#offChip'), 'progress chip while saving');
  await page.waitForSelector('#offChip', { state: 'hidden', timeout: 120000 });
  const msg = await page.textContent('#zoomHint');
  check(/Saved “Siren test” for offline: [\d,]+ parcels/.test(msg), 'saved: ' + msg);
  const area = await page.evaluate(() => LF.db.all('areas').then(a => a[0]));
  check(area && area.parcels > 50 && area.tiles > 5, `area record: ${area && area.parcels} parcels, ${area && area.tiles} tiles, ${area && Math.round(area.bytes / 1024)} KB`);

  // 2. Online, a tap inside the area answers from the saved copy, with a way to check live data.
  await page.mouse.click(206, 300);
  await page.waitForSelector('#sheet:not([hidden]) .saved-note', { timeout: 5000 }).catch(() => {});
  check(/offline copy of “Siren test”/.test(await page.textContent('#sheetBody')), 'tap inside the area uses the saved copy');
  await page.click('[data-act=live]');
  await page.waitForFunction(() => !/Looking up/.test(document.querySelector('#sheetHead').textContent) && !document.querySelector('.saved-note'), null, { timeout: 30000 }).catch(() => {});
  check(!(await page.locator('.saved-note').count()), 'Check live data does a live lookup');
  await page.click('#closeSheet');

  // 3. No network at all: reload, the app opens, tiles come from the saved area, lookups still work.
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.LF && LF.offline && LF.offline.areas().length, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('.leaflet-tile-pane img')).filter(i => i.complete && i.naturalWidth > 0).length);
  check(tiles > 0, 'base map tiles draw with no network: ' + tiles);
  // Saved-copy lines carry the full owner record; the live layer (which the browser's own
  // HTTP cache can still feed in this test) only carries an id.
  const lines = await page.evaluate(() => { let n = 0; LF.map.eachLayer(l => { if(l.feature && l.options.pane === 'parcelPane' && 'OWNERNME1' in l.feature.properties) n++; }); return n; });
  check(lines >= area.parcels * 0.9 && lines <= area.parcels * 1.2, `parcel lines drawn from the saved copy, once each: ${lines} for ${area.parcels} parcels`);
  await page.mouse.click(206, 300);
  await page.waitForSelector('#sheet:not([hidden]) .saved-note', { timeout: 5000 }).catch(() => {});
  const head = await page.textContent('#sheetHead'), body = await page.textContent('#sheetBody');
  check(/Parcel · Wisconsin|Parcel at this spot/.test(body) && !/Looking up/.test(head), 'offline parcel lookup: ' + head.replace(/\s+/g, ' ').trim().slice(0, 60));
  await page.screenshot({ path: path.join(OUT, 'offline-lookup.png') });
  await page.click('#closeSheet');
  await ctx.setOffline(false);

  // 4. Delete removes the data and the saved tiles.
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click('#toolsBtn'); await page.click('[data-tool=offline-list]');
  await page.waitForSelector('[data-act=o-del]');
  await page.screenshot({ path: path.join(OUT, 'offline-list.png') });
  await page.click('[data-act=o-del]');
  await page.waitForTimeout(800);
  const left = await page.evaluate(async () => [(await LF.db.all('areas')).length, (await LF.db.all('areadata')).length, (await caches.keys()).filter(k => k.startsWith('lft-')).length]);
  check(left.join() === '0,0,0', 'delete removes area, data and tile cache: ' + left.join());

  const real = errors.filter(e => !/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/.test(e));
  check(real.length === 0, 'no script errors' + (real.length ? ':\n  ' + real.join('\n  ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
