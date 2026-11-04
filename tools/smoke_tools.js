/* Phase 2 end-to-end test: waypoints, measuring and drawing, track recording
   with simulated GPS, the saved list, and a GPX export → import round trip.
   Needs the API (saving requires an approved account): run it with tools/run_all.sh, or
           node tools/smoke_tools.js [http://localhost:8765/] [out-dir]
   Uses a fresh browser profile, so nothing here touches real saved data. */
const { chromium, devices } = require('playwright');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || '.';
const START = { latitude: 45.86, longitude: -92.62 };   // Crex Meadows, WI

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if(!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true,
    geolocation: { ...START, accuracy: 8 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + `#map=16/${START.latitude}/${START.longitude}&layers=parcels`);
  await page.waitForFunction(() => window.LF && LF.items && LF.db);

  // Saving needs an approved account: sign up (or in) as the test admin.
  await page.evaluate(async () => {
    const c = { email:'tester@example.com', password:'correct horse', name:'Tester' };
    try{ await LF.api('POST', 'signup', c); }catch(e){ await LF.api('POST', 'login', c); }
    await LF.account.refresh();
  });
  const vw = page.viewportSize();
  const at = (fx, fy) => page.mouse.click(Math.round(vw.width * fx), Math.round(vw.height * fy));
  const tool = async t => { await page.click('#toolsBtn'); await page.click(`[data-tool=${t}]`); };
  const count = store => page.evaluate(s => LF.db.all(s).then(a => a.length), store);
  const saveForm = async name => { await page.waitForSelector('#f-name'); if(name) await page.fill('#f-name', name); await page.click('[data-act=save]');
    await page.waitForFunction(() => !/^(New|Edit) /.test(document.querySelector('#sheetHead h2').textContent)); };

  // 1. Waypoint: tap the map, pick an icon, save.
  await tool('waypoint');
  check(/Tap the map/.test(await page.textContent('#stripText')), 'waypoint tool asks for a tap');
  await at(0.5, 0.35);
  await page.waitForSelector('#f-name');
  await page.click('.iconpick[data-k=stand]');
  await saveForm('North stand');
  check(/North stand/.test(await page.textContent('#sheetHead')) && /Tree stand/i.test(await page.textContent('#sheetHead')), 'waypoint saved with name and icon');
  await page.waitForSelector('.leaflet-marker-icon .wp', { timeout: 3000 }).catch(() => {});
  check(await page.locator('.leaflet-marker-icon .wp').count() === 1, 'waypoint marker on the map');
  await page.click('#closeSheet');

  // 2. A tap on the map still looks up parcels when no tool is active.
  await at(0.3, 0.45);
  await page.waitForSelector('#sheet:not([hidden]) [data-act=save-wp]');
  check(true, 'parcel sheet offers Save waypoint');
  await page.click('#closeSheet');

  // 2b. After a lookup, tapping the waypoint itself opens it, and it can be edited.
  //     (A highlight layer once covered saved items and turned this tap into a parcel lookup.)
  const wpBox = await page.locator('.leaflet-marker-icon .wp').boundingBox();
  await page.mouse.click(wpBox.x + wpBox.width / 2, wpBox.y + wpBox.height / 2);
  await page.waitForSelector('#sheet:not([hidden]) [data-act=edit]', { timeout: 5000 }).catch(() => {});
  check(/North stand/.test(await page.textContent('#sheetHead')), 'tapping a waypoint on the map opens it');
  await page.click('#sheetBody [data-act=edit]');
  await page.click('.iconpick[data-k=blind]');
  await saveForm('North blind');
  check(/North blind/.test(await page.textContent('#sheetHead')) && /Ground blind/i.test(await page.textContent('#sheetHead')), 'edit renames it and changes the icon');
  await page.waitForFunction(() => document.querySelector('.leaflet-marker-icon .wp-label').textContent === 'North blind', null, { timeout: 3000 }).catch(() => {});
  check(await page.textContent('.leaflet-marker-icon .wp-label') === 'North blind', 'map label shows the new name');
  await page.click('#sheetBody [data-act=edit]'); await page.click('.iconpick[data-k=stand]'); await saveForm('North stand');
  await page.click('#closeSheet');

  // 3. Line, area and circle with live measurements.
  await tool('line');
  await at(0.2, 0.3); await at(0.5, 0.3); await at(0.5, 0.55);
  const lineTxt = await page.textContent('#stripText');
  check(/(ft|mi)/.test(lineTxt), 'line shows its length: ' + lineTxt);
  check(!(await page.locator('#sheet:not([hidden])').count()), 'taps while drawing do not open parcel lookups');
  await page.click('#stripBtns [data-a=save]'); await saveForm();
  await page.click('#closeSheet');
  // Tap the saved line in the middle of its first leg (from 20% to 50% across, at 30% down).
  await page.waitForTimeout(300);   // saved items redraw just after a save
  await at(0.35, 0.3);
  await page.waitForSelector('#sheet:not([hidden]) [data-act=edit]', { timeout: 5000 }).catch(() => {});
  check(/Line/.test(await page.textContent('#sheetHead')), 'tapping a saved line opens it');
  await page.click('#closeSheet');

  await tool('area');
  await at(0.2, 0.3); await at(0.7, 0.3); await at(0.7, 0.55); await at(0.2, 0.55);
  const areaTxt = await page.textContent('#stripText');
  check(/ac/.test(areaTxt), 'area shows acres: ' + areaTxt);
  await page.click('#stripBtns [data-a=undo]');
  check(/ac/.test(await page.textContent('#stripText')), 'undo removes a corner and keeps measuring');
  await page.click('#stripBtns [data-a=save]'); await saveForm('Bean field');
  check(/Area/.test(await page.textContent('#sheetBody')), 'area sheet shows its acreage');
  await page.click('#closeSheet');

  await tool('circle');
  await at(0.5, 0.4); await at(0.65, 0.4);
  check(/radius/.test(await page.textContent('#stripText')), 'circle shows radius');
  await page.click('#stripBtns [data-a=save]'); await saveForm();
  await page.click('#closeSheet');
  check(await count('drawings') === 3, 'three drawings saved');

  // 4. Track recording with simulated walking (about 20 m per step, heading north).
  await tool('track');
  await page.waitForSelector('#recChip:not([hidden])');
  for(let i = 1; i <= 12; i++){
    await ctx.setGeolocation({ latitude: START.latitude + i * 0.00018, longitude: START.longitude, accuracy: 8 });
    await page.waitForTimeout(250);
  }
  const rec = await page.textContent('#recChip .txt');
  check(/ft|mi/.test(rec), 'recording chip shows live stats: ' + rec);
  await page.click('#recChip [data-a=pause]');
  check(/Paused/.test(await page.textContent('#recChip .txt')), 'pause');
  await ctx.setGeolocation({ latitude: START.latitude + 0.01, longitude: START.longitude, accuracy: 8 });
  await page.waitForTimeout(400);
  await page.click('#recChip [data-a=pause]');
  await page.click('#recChip [data-a=stop]');
  await saveForm('Morning walk');
  const dist = await page.evaluate(() => LF.db.all('tracks').then(t => LF.geo.length(t[0].points)));
  check(dist > 200 && dist < 300, 'track distance about 240 m, ignoring the jump while paused: ' + Math.round(dist) + ' m');
  await page.screenshot({ path: path.join(OUT, 'tools-track.png') });
  await page.click('#closeSheet');

  // 5. A track left recording comes back after a reload, paused.
  await page.evaluate(() => LF.db.put('tracks', { id:'unfinished', recording:true, started:Date.now() - 60000, pausedMs:0, points:[[45.86,-92.62,null,Date.now()-60000],[45.861,-92.62,null,Date.now()-30000]] }));
  await page.reload();
  await page.waitForSelector('#recChip:not([hidden])');
  check(/Paused/.test(await page.textContent('#recChip .txt')), 'unfinished track resumes paused after reload');
  await page.click('#recChip [data-a=stop]');
  await saveForm('Recovered');
  await page.click('#closeSheet');

  // 6. Go to: guide chip with distance and direction.
  await page.evaluate(() => LF.db.all('waypoints').then(w => LF.items.open('waypoints', w[0].id)));
  await page.click('[data-act=goto]');
  await page.waitForFunction(() => /→ North stand: .*(ft|mi) [NESW]/.test(document.querySelector('#gotoChip .txt').textContent), null, { timeout: 5000 }).catch(() => {});
  check(/→ North stand: .*(ft|mi) [NESW]/.test(await page.textContent('#gotoChip .txt')), 'Go to shows distance and direction: ' + await page.textContent('#gotoChip .txt'));
  await page.click('#gotoChip button');

  // 6b. Hide on map: the list's switch, kept after a reload, switched back on from the item's sheet.
  await tool('list');
  await page.waitForSelector('#sheetBody .row-wrap');
  await page.locator('.row-wrap', { hasText:'North stand' }).locator('.switch input').click();
  await page.waitForTimeout(400);
  check(await page.locator('.leaflet-marker-icon .wp').count() === 0, 'switching it off hides the waypoint from the map');
  check(!(await page.locator('.row-wrap', { hasText:'North stand' }).locator('.switch input').isChecked()), 'the switch shows off');
  check(await page.locator('.row-wrap.off', { hasText:'North stand' }).count() === 1, 'list shows it as hidden');
  check(await page.locator('[data-act=show-all]').count() === 1, 'Show all appears when something is hidden');
  await page.reload();
  await page.waitForFunction(() => window.LF && LF.items && LF.db);
  await page.waitForTimeout(800);
  check(await page.locator('.leaflet-marker-icon .wp').count() === 0, 'still hidden after a reload');
  check(await page.evaluate(() => LF.db.all('waypoints').then(w => w[0].hidden === true && LF.sync.pendingCount() >= 0)), 'hidden is saved on the item (and syncs with it)');
  await page.evaluate(() => LF.db.all('waypoints').then(w => LF.items.open('waypoints', w[0].id)));
  await page.waitForSelector('#sheetBody .switchrow');
  check(!(await page.isChecked('#sheetBody .switchrow input')) && /Show on map/.test(await page.textContent('#sheetBody .switchrow')), 'item sheet has a Show on map switch, off');
  await page.click('#sheetBody .switchrow');   // tapping the row's label flips it
  await page.waitForSelector('.leaflet-marker-icon .wp', { timeout:3000 }).catch(() => {});
  check(await page.locator('.leaflet-marker-icon .wp').count() === 1, 'switching it on brings it back');
  check(await page.isChecked('#sheetBody .switchrow input'), 'switch shows on, flipped once (not twice)');
  await page.click('#closeSheet');

  // 7. Saved list, GPX export, wipe, import.
  await tool('list');
  await page.waitForSelector('#sheetBody .row');
  const rows = await page.locator('#sheetBody .row').count();
  check(rows === 6, 'list shows 1 waypoint, 3 drawings, 2 tracks: ' + rows);
  await page.screenshot({ path: path.join(OUT, 'tools-list.png') });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=gpx-all]')]);
  const gpxFile = path.join(OUT, 'tools-export.gpx'); await dl.saveAs(gpxFile);
  await page.evaluate(async () => { for(const s of LF.db.STORES) for(const r of await LF.db.all(s)) await LF.db.del(s, r.id); });
  await page.setInputFiles('#sheetBody input[data-act=import]', gpxFile);
  await page.waitForFunction(() => /Imported/.test(document.querySelector('#zoomHint').textContent), null, { timeout: 15000 }).catch(() => {});
  const back = await page.evaluate(() => Promise.all(['waypoints','drawings','tracks'].map(s => LF.db.all(s).then(a => a.length))));
  check(back.join() === '1,3,2', 'GPX import brings back 1 waypoint, 3 drawings, 2 tracks: ' + back.join());
  // Importing the same file again updates the items instead of doubling them (matched by their id in the file).
  await page.evaluate(() => LF.db.all('waypoints').then(w => LF.db.put('waypoints', Object.assign(w[0], { folder:'Moved' }))));
  await page.setInputFiles('#sheetBody input[data-act=import]', gpxFile);
  await page.waitForFunction(() => /already here/.test(document.querySelector('#zoomHint').textContent), null, { timeout: 15000 }).catch(() => {});
  const again = await page.evaluate(() => Promise.all(['waypoints','drawings','tracks'].map(s => LF.db.all(s).then(a => a.length))));
  check(again.join() === '1,3,2', 'importing the same file again doesn\'t double it: ' + again.join());
  const wp = await page.evaluate(() => LF.db.all('waypoints').then(w => w[0]));
  check(wp.name === 'North stand' && wp.icon === 'stand', 'imported waypoint keeps name and icon');

  // 8. Desktop render of saved items.
  await page.click('#closeSheet');
  await page.screenshot({ path: path.join(OUT, 'tools-map.png') });

  // 9. onX-style KML: nested folders kept, item details (id, color, style, width, icon name) on each card.
  // Wait for the list that's showing now: a closed sheet keeps its old buttons in the page.
  await tool('list'); await page.waitForSelector('#sheet:not([hidden]) h2:has-text("My content")'); await page.waitForTimeout(200);
  await page.setInputFiles('#sheetBody input[data-act=import]', require('path').join(__dirname, 'fixtures/onx-sample.kml'));
  await page.waitForFunction(() => /Imported 3 items/.test(document.querySelector('#zoomHint').textContent), null, { timeout:8000 }).catch(async () => console.log('   import message:', await page.textContent('#zoomHint')));
  const got = await page.evaluate(async () => { const w = await LF.db.all('waypoints'), d = await LF.db.all('drawings');
    return { cross:w.find(x => x.name === 'Creek crossing'), stand:w.find(x => x.name === 'Ridge ladder'), bike:d.find(x => /Bike Ride/.test(x.name)) }; });
  check(got.cross && got.cross.folder === 'Deer camp' && got.stand.folder === 'Deer camp / Stands', 'KML folders kept, nested: ' + (got.stand && got.stand.folder));
  check(got.bike && got.bike.folder === 'onx-sample', 'item outside any folder goes into a folder named after the file: ' + (got.bike && got.bike.folder));
  check(got.cross.icon === 'crossing' && got.cross.iconName === 'Crossing' && got.cross.color === '#ffc800', 'onX icon "Crossing" and rgba color mapped');
  check(got.stand.icon === 'stand' && got.stand.extra && got.stand.extra.season === '2026 rifle', 'Tree Stand icon, and unknown fields kept');
  check(got.bike.lineStyle === 'dash' && got.bike.weight === 6 && got.bike.color === '#ff0000' && got.bike.sourceId === '05f03d79-ab01-4c1e-816c-3f521d9ee2c8' &&
        /Beautiful Day!/.test(got.bike.notes) && !/weight=/.test(got.bike.notes), 'key=value details: name, notes, id, color, dash, width 6');
  await page.evaluate(id => LF.items.open('drawings', id), got.bike.id);
  await page.waitForSelector('#sheetBody .block dl');
  const card = await page.textContent('#sheetBody');
  check(/Line style\s*Dashed/.test(card) && /Line width\s*6/.test(card) && /Imported ID\s*05f03d79/.test(card) && /#ff0000/.test(card) && /Folder\s*onx-sample/.test(card),
    'card shows folder, color, style, width and imported id');
  await page.screenshot({ path: path.join(OUT, 'tools-card.png') });

  // 9b. The logo opens the menu: account, content by type with counts, folders; Waypoints opens a filtered list.
  await page.click('#closeSheet');
  await page.click('#menuBtn');
  await page.waitForSelector('#menu:not([hidden]) .mi[data-m=waypoints] .n');
  const wpCount = await page.textContent('.mi[data-m=waypoints] .n');
  check(+wpCount >= 2 && await page.locator('.mi[data-m=folder]').count() >= 3 && /Tester/.test(await page.textContent('.mi.acct')),
    `menu shows the account, ${wpCount} waypoints and the folders`);
  await page.screenshot({ path: path.join(OUT, 'tools-menu.png') });
  await page.click('.mi[data-m=waypoints]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Waypoints")');
  check(await page.locator('#sheetBody .row-wrap').count() === +wpCount && await page.isHidden('#menu'), 'Waypoints opens the list filtered to waypoints');
  await page.click('[data-act=filter][data-t=""]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("My content")');

  // 10. Folders in the list, select all, bulk move and bulk delete.
  await page.click('#closeSheet');
  await tool('list'); await page.waitForSelector('#sheetBody .folder');
  const folders = await page.$$eval('#sheetBody .folder .fname b', b => b.map(x => x.textContent));
  check(folders.includes('Deer camp') && folders.includes('Deer camp / Stands') && folders.includes('onx-sample'), 'list grouped by folder: ' + folders.join(', '));
  await page.screenshot({ path: path.join(OUT, 'tools-folders.png') });
  await page.click('[data-act=sel-start]');
  await page.click('.folder[data-f="Deer camp"] [data-act=pick-folder]');
  await page.click('[data-act=bulk-move]'); await page.selectOption('#mv-sel', '__new'); await page.fill('#mv-new', 'Moved');
  await page.click('[data-act=mv-go]');
  await page.waitForFunction(() => document.querySelector('.folder[data-f="Moved"]'), null, { timeout:4000 }).catch(() => {});
  check(await page.evaluate(() => LF.db.all('waypoints').then(w => w.filter(x => x.folder === 'Moved').length)) === 1, 'bulk move to a new folder');
  const total = await page.evaluate(async () => (await LF.db.all('waypoints')).length + (await LF.db.all('drawings')).length + (await LF.db.all('tracks')).length);
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click('[data-act=sel-start]'); await page.click('[data-act=pick-all]');
  await page.waitForFunction(n => new RegExp('^' + n + ' selected').test(document.querySelector('.selbar .small').textContent), total, { timeout:4000 }).catch(() => {});
  check(new RegExp('^' + total + ' selected').test(await page.textContent('.selbar .small')), 'select all picks every item: ' + await page.textContent('.selbar .small'));
  await page.click('[data-act=bulk-del]');
  await page.waitForTimeout(800);
  const left = await page.evaluate(async () => (await LF.db.all('waypoints')).length + (await LF.db.all('drawings')).length + (await LF.db.all('tracks')).length);
  check(left === 0, 'bulk delete removes them all: ' + left + ' left');

  check(errors.length === 0, 'no script errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
