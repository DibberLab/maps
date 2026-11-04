/* Directions test (live OSRM on routing.openstreetmap.de): from a simulated GPS
   fix in Siren to a waypoint off-road near Tjader Acres; mode switch; clear.
   Needs the API (saving a waypoint needs an approved account): see run_all.sh. */
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if(!ok) failed++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], geolocation:{ latitude:45.78573, longitude:-92.38124, accuracy:10 }, permissions:['geolocation'] });
  const page = await ctx.newPage();
  // Cloud build sandboxes can't reach the router from the test browser, only from the command line,
  // so the test fetches the real route with curl and hands it to the page.
  let routed = 0;
  await page.route('https://routing.openstreetmap.de/**', r => {
    routed++;
    const body = require('child_process').execFileSync('curl', ['-s', '-m', '30', '-A', 'LineFence-test/1.0 (maps.dibberlab.me)', r.request().url()]);
    r.fulfill({ body, contentType:'application/json', headers:{ 'access-control-allow-origin':'*' } });
  });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '#map=15/45.779/-92.43&layers=parcels');
  await page.waitForFunction(() => window.LF && LF.route && LF.account);
  await page.evaluate(async () => { const c = { email:'tester@example.com', password:'correct horse', name:'Tester' };
    try{ await LF.api('POST', 'signup', c); }catch(e){ await LF.api('POST', 'login', c); } await LF.account.refresh(); });
  const id = await page.evaluate(() => LF.db.put('waypoints', { name:'Back stand', icon:'stand', lat:45.7765, lng:-92.4335 }).then(r => r.id));
  await page.evaluate(i => LF.items.open('waypoints', i), id);
  await page.click('[data-act=route]');
  await page.waitForSelector('#routeChip:not([hidden])', { timeout:30000 });
  const chip = await page.textContent('#routeChip .txt'), body = await page.textContent('#sheetBody');
  check(/mi|ft/.test(chip) && /by car/.test(chip) && /Back stand/.test(chip), 'route chip: ' + chip);
  check(/Head [NESW]/.test(body) && /Turn (left|right)/.test(body), 'turn-by-turn steps listed');
  check(/then walk .* from the end of the route/.test(body), 'off-road last stretch explained: ' + (body.match(/then walk[^.]*/) || [''])[0]);
  check(await page.evaluate(() => { let n = 0; LF.map.eachLayer(l => { if(l instanceof L.Polyline && l.options.color === '#3b82f6') n++; }); return n; }) >= 2, 'route line and walking stretch drawn');
  check(/osm\.org|openstreetmap\.org\/directions/.test(await page.getAttribute('a.btn[href*="openstreetmap.org/directions"]', 'href')), 'link to the same route on openstreetmap.org');
  await page.waitForTimeout(2500); await page.screenshot({ path:(process.argv[3] || '.') + '/route.png' });
  await page.click('[data-act=mode][data-m=foot]');
  await page.waitForFunction(() => /on foot/.test(document.querySelector('#routeChip .txt').textContent), null, { timeout:30000 }).catch(() => {});
  check(/on foot/.test(await page.textContent('#routeChip .txt')), 'switch to walking: ' + await page.textContent('#routeChip .txt'));
  await page.click('[data-act=clear]');
  check(await page.isHidden('#routeChip'), 'clear removes the route');
  check(routed >= 2, 'asked the router once per route: ' + routed);
  check(errors.length === 0, 'no script errors' + (errors.length ? ': ' + errors.join('; ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
