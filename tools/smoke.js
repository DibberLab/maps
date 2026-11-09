/* End-to-end smoke test against the live data services.
   Usage:  (cd site && python3 -m http.server 8765) &   then
           node tools/smoke.js [http://localhost:8765/] [out-dir]
   Exits non-zero if a check fails. Screenshots land in out-dir (default: .). */
const { chromium, devices } = require('playwright');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || '.';
const SIREN = { lat: 45.78573, lng: -92.38124 };   // a parcel in Siren, Burnett County, WI

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if(!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });

  // 1. A link with a pin opens the map there and looks the parcel up.
  await page.goto(BASE + `#map=17/${SIREN.lat}/${SIREN.lng}&pin=${SIREN.lat},${SIREN.lng}&base=hyb&layers=parcels,padus,widnr`, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('#sheet:not([hidden])');
  await page.waitForFunction(() => !/Looking up/.test(document.querySelector('#sheetHead').textContent), null, { timeout: 30000 });
  const head = await page.textContent('#sheetHead');
  const body = await page.textContent('#sheetBody');
  check(/Parcel · Wisconsin/.test(body), 'WI parcel lookup from a shared link: ' + head.replace(/\s+/g, ' ').trim().slice(0, 80));
  check(await page.isChecked('#b-hyb'), 'link chose the Aerial + roads base map');
  check(!(await page.isChecked('#l-mndnr')), 'link turned off layers it did not list');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'smoke-parcel.png') });

  // 2. Address bar follows the map and the pin.
  check(/pin=45\.78573,-92\.38124/.test(page.url()) && /map=17\//.test(page.url()), 'address bar holds view and pin: ' + page.url().split('#')[1]);
  await page.click('#closeSheet');
  check(!/pin=/.test(page.url()), 'closing the sheet drops the pin from the address bar');

  // 3. Share falls back to copying the link when there is no share sheet.
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await page.evaluate(() => { delete Navigator.prototype.share; });
  await page.mouse.click(200, 450);
  await page.waitForSelector('#sheet:not([hidden])');
  await page.click('#shareBtn');
  await page.waitForTimeout(300);
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(/\/api\/s\/[A-Za-z0-9]{6}$/.test(copied), 'Share copies a short link: ' + copied);
  const full = (await page.request.get(copied, { maxRedirects:0 }).catch(() => null));
  const loc = full ? full.headers().location || '' : '';
  check(/#map=.*&pin=.*&base=hyb&layers=/.test(loc), 'the short link leads to the full view: ' + loc.split('#')[1]);

  // 4. Backup and restore round trip.
  await page.click('#closeSheet');
  await page.evaluate(() => LF.db.put('waypoints', { id: 'test-wp', name: 'Smoke test stand', lat: 45.78, lng: -92.38 }));
  await page.click('#layersBtn');
  check(/1 saved item/.test(await page.textContent('#dataNote')), 'data note counts saved items');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backupBtn')]);
  const file = path.join(OUT, 'smoke-backup.json');
  await dl.saveAs(file);
  const backup = require(path.resolve(file));
  check(backup.app === 'linefence' && backup.data.waypoints.length === 1, 'backup file holds the waypoint');
  await page.evaluate(() => LF.db.del('waypoints', 'test-wp'));
  await page.setInputFiles('#restoreFile', file);
  await page.waitForFunction(() => LF.db.get('waypoints', 'test-wp').then(Boolean), null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => LF.db.get('waypoints', 'test-wp').then(Boolean)), 'restore brings the waypoint back');
  await page.evaluate(() => LF.db.del('waypoints', 'test-wp'));
  await page.click('#layersBtn');

  // 5. Installable: manifest and service worker; app opens offline.
  const manifest = await page.evaluate(() => fetch('manifest.json').then(r => r.json()));
  check(manifest.display === 'standalone' && manifest.icons.length >= 3, 'manifest is installable');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // (Reloads wait for the app, not for every map image: outside tile servers can be slow.)
  await page.reload({ waitUntil:'domcontentloaded' }); await page.waitForFunction(() => window.LF && LF.map); await page.waitForTimeout(500);
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
  await ctx.setOffline(true);
  await page.reload({ waitUntil:'domcontentloaded' }); await page.waitForFunction(() => window.LF && LF.map, null, { timeout:15000 }).catch(() => {});
  check(await page.evaluate(() => !!(window.LF && LF.map && document.querySelector('.brand'))), 'app opens with no network');
  await ctx.setOffline(false);

  // 5b. A tap inside public land leads with the whole unit and outlines all of it.
  for(const [name, lat, lng, want] of [['WI DNR', 45.86, -92.62, /Crex Meadows Wildlife Area/], ['PAD-US', 46.2, -91.1, /Chequamegon National Forest/]]){
    await page.goto(BASE + `#map=15/${lat}/${lng}&pin=${lat},${lng}&layers=parcels,padus,widnr,mndnr`);
    await page.waitForFunction(() => !/Looking up/.test(document.querySelector('#sheetHead').textContent), null, { timeout: 30000 });
    const h = await page.textContent('#sheetHead h2'), b = await page.textContent('#sheetBody');
    check(want.test(h) && /Public land/.test(await page.textContent('#sheetHead')), `${name} public land is the title: ${h}`);
    await page.waitForFunction(() => !/measuring/.test(document.querySelector('#sheetBody').textContent), null, { timeout: 20000 }).catch(() => {});
    const area = ((await page.textContent('#sheetBody')).match(/Total area\s*([\d,.]+ ac)/) || [])[1];
    check(!!area, `${name} shows the whole area's acres: ${area}`);
    await page.click('[data-act=unit-zoom]');
    await page.waitForTimeout(800);
    check(await page.evaluate(() => LF.map.getZoom()) < 15, `${name}: Zoom to whole area zooms out to the boundary`);
    if(name === 'WI DNR'){ await page.waitForTimeout(2000); await page.screenshot({ path: path.join(OUT, 'smoke-public.png') });
      // The selection is drawn on its own pane, and Hide shading clears the fills (and comes back off).
      check(await page.evaluate(() => document.querySelectorAll('.leaflet-sel-pane canvas').length > 0), 'selected unit is outlined on the selection pane');
      check(await page.isVisible('#sheetBody input[data-act=shade]'), 'info panel has a Hide shading switch');
      await page.click('#sheetBody label:has(input[data-act=shade])');
      await page.waitForTimeout(1500);
      check(await page.evaluate(() => LF.shading.hidden() && LF.layers.widnr.options.opacity === 0), 'Hide shading hides the public land fill');
      await page.screenshot({ path: path.join(OUT, 'smoke-noshade.png') });
      await page.click('#sheetBody label:has(input[data-act=shade])');
      check(await page.evaluate(() => !LF.shading.hidden()), 'Hide shading turns back off'); }
  }
  await page.click('#closeSheet');

  // 5c. Minnesota close-up: the MnGeo composite, reshaped from UTM, draws over the metro at zoom 18.
  await page.goto(BASE + '#map=18/45.0935/-93.1300&base=img&layers=parcels');
  await page.reload({ waitUntil:'domcontentloaded' });
  const mnOk = await page.waitForFunction(() => { const c = LF.closeup.mn.getContainer(); return c && c.querySelectorAll('canvas.leaflet-tile-loaded').length > 0; }, null, { timeout: 45000 }).then(() => true, () => false);
  check(mnOk, 'Minnesota leaf-off close-up tiles draw (MnGeo composite)');
  await page.screenshot({ path: path.join(OUT, 'smoke-mn-closeup.png') });
  check(await page.isVisible('#l-terrain') || await page.locator('#l-terrain').count() === 1, 'Terrain shading switch is in the layers panel');

  // 5d. MN DNR trails, forest roads and accesses: switched on, a tap on an access and road shows their details first.
  await page.goto('about:blank');
  await page.goto(BASE + '#map=16/47.58774/-91.07932&pin=47.58774,-91.07932&base=img&layers=mntrails,mnmotor,mnroads,mnaccess');
  await page.waitForFunction(() => !/Looking up/.test(document.querySelector('#sheetHead').textContent), null, { timeout: 40000 }).catch(() => {});
  const rec = await page.evaluate(() => { const b = document.querySelector('#sheetBody .block'); return b ? b.textContent : ''; });
  check(/Trails, roads/.test(rec) && /Thunderbird/.test(rec) && /Carry-In/.test(rec), 'tap on a MN water access shows it first: ' + rec.slice(0, 80));
  check(/Forest Road|Thunder Road/.test(rec), 'and the state forest road beside it');
  await page.screenshot({ path: path.join(OUT, 'smoke-mn-access.png') });
  await page.goto('about:blank');
  await page.goto(BASE + '#map=16/45.63025/-92.59687&pin=45.63025,-92.59687&base=img&layers=mntrails,mnmotor,mnroads,mnaccess');
  await page.waitForFunction(() => !/Looking up/.test(document.querySelector('#sheetHead').textContent), null, { timeout: 40000 }).catch(() => {});
  const wiRec = await page.evaluate(() => { const b = document.querySelector('#sheetBody .block'); return b ? b.textContent : ''; });
  check(/Boat landing/.test(wiRec) && /Atlas Park/.test(wiRec), 'tap on a WI DNR boat landing shows it: ' + wiRec.slice(0, 80));
  // Designated trout water: a WI trout stream shows its season and bag limit.
  await page.goto('about:blank');
  await page.goto(BASE + '#map=16/45.8999/-92.6686&pin=45.8999,-92.6686&base=img&layers=trout');
  await page.waitForFunction(() => !/Looking up/.test(document.querySelector('#sheetHead').textContent), null, { timeout: 40000 }).catch(() => {});
  const trout = await page.evaluate(() => { const b = document.querySelector('#sheetBody .block'); return b ? b.textContent : ''; });
  check(/Trout water/.test(trout) && /Ekdall Brook/.test(trout) && /Bag limit/.test(trout), 'tap on a WI trout stream shows its regulations: ' + trout.slice(0, 80));
  check(/Ekdall Brook/.test(await page.textContent('#sheetHead h2')), 'a tap on the creek makes the creek the title (not the parcel it runs through)');

  // 5e. Phones: drag the panel down by its grab bar to tuck it (still open, title showing); a tap brings it back.
  const g = await page.locator('#sheetGrab').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y + 60, { steps: 5 }); await page.mouse.move(g.x + g.width / 2, g.y + 160, { steps: 5 }); await page.mouse.up();
  const tucked = await page.evaluate(() => ({ t:document.getElementById('sheet').classList.contains('tucked'), h:document.getElementById('sheet').getBoundingClientRect().height, open:!document.getElementById('sheet').hidden }));
  check(tucked.t && tucked.open && tucked.h < 130, 'swiping the panel down tucks it out of the way without closing: ' + Math.round(tucked.h) + ' px');
  await page.screenshot({ path: path.join(OUT, 'smoke-tucked.png') });
  await page.click('#sheetGrab');
  check(await page.evaluate(() => !document.getElementById('sheet').classList.contains('tucked')), 'tapping the strip brings the panel back');

  // 6. Desktop layout and dark mode still render.
  const desk = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  desk.on('pageerror', e => errors.push('desktop pageerror: ' + e.message));
  await desk.goto(BASE + `#map=16/${SIREN.lat}/${SIREN.lng}&pin=${SIREN.lat},${SIREN.lng}`);
  await desk.waitForFunction(() => !/Looking up/.test(document.querySelector('#sheetHead').textContent), null, { timeout: 30000 });
  await desk.waitForTimeout(2500);
  await desk.screenshot({ path: path.join(OUT, 'smoke-desktop.png') });

  // USGS's label servers (city and lake names) often refuse requests for a while; labels.js just skips them.
  // A map picture an outside server refuses (it answers an error page without CORS) is that server's hiccup, not a script error.
  const real = errors.filter(e => !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch|ERR_FAILED|Access to image at/.test(e) && !/(carto|hydro)\.nationalmap\.gov/.test(e));
  check(real.length === 0, 'no script errors' + (real.length ? ':\n  ' + real.join('\n  ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
