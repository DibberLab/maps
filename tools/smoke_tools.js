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

const LF_dist = (w, s) => { const R = 6371000, r = Math.PI / 180, dLa = (w.lat - s.latitude) * r, dLn = (w.lng - s.longitude) * r * Math.cos(s.latitude * r); return R * Math.hypot(dLa, dLn); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true,
    geolocation: { ...START, accuracy: 8 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  // Weather (Open-Meteo) answers from a fixture all run: the real service rate-limits test machines.
  await ctx.route('**/api.open-meteo.com/**', r => r.fulfill({ status:200, contentType:'application/json', headers:{ 'access-control-allow-origin':'*' }, body:JSON.stringify({
    current:{ temperature_2m:61, apparent_temperature:61, wind_speed_10m:10, wind_direction_10m:270, wind_gusts_10m:18, weather_code:1, precipitation:0 },
    hourly:{ time:['2026-11-09T12:00', '2026-11-09T13:00', '2026-11-09T14:00', '2026-11-09T15:00', '2026-11-09T16:00', '2026-11-09T17:00', '2026-11-09T18:00'],
      temperature_2m:[61, 62, 63, 63, 62, 60, 58], precipitation_probability:[0, 0, 10, 20, 20, 10, 0], wind_speed_10m:[10, 11, 12, 12, 10, 8, 6],
      wind_direction_10m:[270, 270, 280, 280, 290, 290, 300], weather_code:[1, 1, 2, 2, 3, 3, 3] } }) }));
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
  const tool = async t => { await page.click('#menuBtn'); await page.click(`[data-tool=${t}]`); };
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

  // 4. Track recording with a simulated drive north (20 m every 0.7 s, about 64 mph: under the 100 mph glitch limit).
  await tool('track');
  await page.waitForSelector('#recChip:not([hidden])');
  for(let i = 1; i <= 12; i++){
    await ctx.setGeolocation({ latitude: START.latitude + i * 0.00018, longitude: START.longitude, accuracy: 8 });
    await page.waitForTimeout(700);
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

  // 9b. + opens your content: by type with counts, folders (the account is at the top of ☰); Waypoints opens a filtered list.
  await page.click('#closeSheet');
  await page.click('#toolsBtn');
  await page.waitForSelector('#toolsPanel:not([hidden]) .mi[data-m=waypoints] .n');
  const wpCount = await page.textContent('.mi[data-m=waypoints] .n');
  check(+wpCount >= 2 && await page.locator('.mi[data-m=folder]').count() >= 2 && /Tester/.test(await page.textContent('#accountEntry .who')),
    `menu shows the account, ${wpCount} waypoints and the folders`);
  // Folders are a tree: Deer camp opens to show Stands; its switch hides both without opening the list.
  await page.click('.mf .caret[data-v="Deer camp"]');
  await page.waitForSelector('.mi[data-m=folder][data-v="Deer camp / Stands"]');
  check(true, 'menu folder tree opens a subfolder');
  const inCamp = () => page.evaluate(() => Promise.all(['waypoints','drawings','tracks'].map(s => LF.db.all(s))).then(a => [].concat(...a)
    .filter(r => /^Deer camp( \/|$)/.test(r.folder || '')).map(r => !!r.hidden)));
  await page.click('.mf:has(.mi[data-v="Deer camp"]) .switch');
  await page.waitForFunction(() => !document.querySelector('.mf:has(.mi[data-v="Deer camp"]) input').checked && !document.querySelector('.mf:has(.mi[data-v="Deer camp"]) input').disabled);
  const hid = await inCamp();
  check(hid.length >= 2 && hid.every(Boolean) && await page.isVisible('#toolsPanel'), `folder switch hides the folder and its subfolders (${hid.length} items), menu stays open`);
  await page.screenshot({ path: path.join(OUT, 'tools-menu.png') });
  await page.click('.mf:has(.mi[data-v="Deer camp"]) .switch');
  await page.waitForFunction(() => document.querySelector('.mf:has(.mi[data-v="Deer camp"]) input').checked && !document.querySelector('.mf:has(.mi[data-v="Deer camp"]) input').disabled);
  await page.waitForTimeout(300);
  check((await inCamp()).every(h => !h), 'and shows them again');
  await page.click('.mi[data-m=folder][data-v="Deer camp"]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Deer camp")');
  check(await page.locator('#sheetBody .folder[data-f="Deer camp / Stands"]').count() === 1, 'opening a folder lists its subfolders too');
  // An item opened from the list has a Back link to the same folder view.
  await page.click('#sheetBody .folder[data-f="Deer camp / Stands"] .row');
  await page.waitForSelector('#sheetBack');
  check(/Back to Deer camp/.test(await page.textContent('#sheetBack')), 'item opened from a folder shows Back to Deer camp');
  await page.screenshot({ path: path.join(OUT, 'tools-back.png') });
  await page.click('#sheetBack');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Deer camp")');
  check(await page.locator('#sheetBody .folder[data-f="Deer camp / Stands"]').count() === 1, 'Back returns to the folder list');
  await page.evaluate(() => LF.closeSheet());   // + sits under an open panel
  await page.click('#toolsBtn');
  await page.click('.mi[data-m=waypoints]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Waypoints")');
  check(await page.locator('#sheetBody .row-wrap').count() === +wpCount && await page.isHidden('#toolsPanel'), 'Waypoints opens the list filtered to waypoints');
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

  // 11. Edit lets you drag things to a new spot: a waypoint, an area's corner, and the whole area (✥).
  await page.evaluate(async () => { if(document.getElementById('sheet').hidden === false) LF.closeSheet();
    LF.map.setView([45.80, -92.40], 16, { animate:false });
    await LF.db.put('waypoints', { id:'drag-wp', name:'Drag me', icon:'pin', lat:45.80, lng:-92.40 });
    await LF.db.put('drawings', { id:'drag-area', kind:'area', name:'Drag area', points:[[45.801, -92.403], [45.801, -92.401], [45.799, -92.401], [45.799, -92.403]] }); });
  await page.waitForTimeout(400);
  const dragBy = async (sel, dx, dy) => { const bb = await page.locator(sel).first().boundingBox();
    const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2; await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps:4 }); await page.mouse.move(x + dx, y + dy, { steps:4 }); await page.mouse.up(); };
  await page.evaluate(() => LF.items.open('waypoints', 'drag-wp'));
  await page.click('[data-act=edit]');
  await page.evaluate(() => LF.tuckSheet && LF.tuckSheet(true));
  await page.waitForSelector('.edit-wp');
  check(/Drag it on the map/.test(await page.textContent('#sheetHead')), 'editing a waypoint says it can be dragged');
  await dragBy('.edit-wp', 60, -40);
  await page.evaluate(() => LF.tuckSheet(false));
  await page.click('[data-act=save]');
  await page.waitForFunction(() => !/^Edit /.test(document.querySelector('#sheetHead h2').textContent));
  const wpAfter = await page.evaluate(() => LF.db.get('waypoints', 'drag-wp'));
  check(wpAfter.lat > 45.8001 && wpAfter.lng > -92.3999, `dragging the waypoint and saving moves it: ${wpAfter.lat}, ${wpAfter.lng}`);
  await page.evaluate(() => LF.items.open('drawings', 'drag-area'));
  await page.click('[data-act=edit]');
  await page.evaluate(() => LF.tuckSheet(true));
  await page.waitForSelector('.edit-h.vertex');
  check(await page.locator('.edit-h.vertex').count() === 4 && await page.locator('.edit-h.move').count() === 1, 'editing an area shows a handle on each corner and a move handle');
  await dragBy('.edit-h.vertex', -40, -40);
  await dragBy('.edit-h.move', 0, 80);
  await page.screenshot({ path: path.join(OUT, 'tools-drag.png') });
  await page.evaluate(() => LF.tuckSheet(false));
  await page.click('[data-act=save]');
  await page.waitForFunction(() => !/^Edit /.test(document.querySelector('#sheetHead h2').textContent));
  const ar = await page.evaluate(() => LF.db.get('drawings', 'drag-area'));
  check(ar.points[0][0] > 45.8012 - 0.003 && ar.points[0][0] < 45.801 && ar.points[2][0] < 45.799 && ar.points[1][1] === ar.points[1][1],
    'dragging a corner reshapes the area and ✥ moves all of it: ' + ar.points.map(p => p.map(v => v.toFixed(5)).join(',')).join(' | '));
  await page.evaluate(() => LF.items.open('drawings', 'drag-area'));
  await page.click('[data-act=edit]'); await page.waitForSelector('.edit-h.move');
  await dragBy('.edit-h.move', 100, 0); await page.click('[data-act=cancel]');
  const ar2 = await page.evaluate(() => LF.db.get('drawings', 'drag-area'));
  check(JSON.stringify(ar2.points) === JSON.stringify(ar.points) && await page.locator('.edit-h').count() === 0, 'Cancel puts it back and removes the handles');

  // 12. Disc golf holes: a folder's tracks become holes in one tap; editing a hole drags the tee/basket and bends to anchors.
  await page.evaluate(async () => { if(!document.getElementById('sheet').hidden) LF.closeSheet();
    LF.map.setView([45.8005, -92.4005], 18, { animate:false });
    const pts = []; for(let i = 0; i <= 40; i++){ const t = i / 40; pts.push([45.8 + t * 0.001, -92.401 + t * 0.001 + Math.sin(t * Math.PI) * 0.0002, null, Date.now() + i * 1000]); }
    await LF.db.put('tracks', { id:'dg-hole', name:'Hole 7', folder:'Fish Lake Disc Golf Course', points:pts, started:Date.now(), ended:Date.now() + 40000 });
    await LF.db.put('tracks', { id:'dg-other', name:'Hole 8 walk', folder:'Fish Lake Disc Golf Course', points:pts.map(p => [p[0] + .002, p[1], p[2], p[3]]) }); });
  await page.evaluate(() => LF.items.list({ folder:'Fish Lake Disc Golf Course' }));
  await page.click('#sheetBody .folder[data-f="Fish Lake Disc Golf Course"] [data-act=fmenu]');
  await page.click('#sheetBody [data-act=f-dg]');
  await page.waitForTimeout(600);
  const marked = await page.evaluate(() => LF.db.all('tracks').then(t => t.filter(x => x.folder === 'Fish Lake Disc Golf Course').map(x => x.dg && x.dg.hole)));
  check(marked.length === 2 && marked.includes('7') && marked.includes('8'), 'folder action marks its tracks as disc golf holes, hole # from the name: ' + marked.join(','));
  // A course folder at the top level moves under Disc Golf (and other spellings of Disc Golf fold into it).
  await page.evaluate(() => LF.db.put('waypoints', { id:'dg-park', name:'Parking', lat:45.8, lng:-92.4, icon:'parking', folder:'disc golf / Rounds' }));
  await page.evaluate(() => LF.items.tidyDiscGolf());
  const tidy = await page.evaluate(() => Promise.all([LF.db.all('tracks'), LF.db.get('waypoints', 'dg-park')]).then(([t, w]) => ({ holes:t.filter(x => x.id === 'dg-hole' || x.id === 'dg-other').map(x => x.folder), park:w.folder })));
  check(tidy.holes.every(f => f === 'Disc Golf / Fish Lake Disc Golf Course') && tidy.park === 'Disc Golf / Rounds', 'course folders go under one Disc Golf folder: ' + JSON.stringify(tidy));
  await page.evaluate(() => { LF.closeSheet(); LF.map.setView([45.8005, -92.4005], 18, { animate:false }); });
  await page.waitForTimeout(500);
  check(await page.locator('.dg-end').count() >= 2 && await page.locator('.dg-arrow').count() >= 1, 'a hole draws a tee, a basket and direction arrows');
  await page.evaluate(() => LF.items.open('tracks', 'dg-hole'));
  await page.click('[data-act=edit]');
  await page.evaluate(() => LF.tuckSheet(true));
  await page.waitForSelector('.edit-h.dg-basket');
  check(await page.locator('.edit-h.dg-tee').count() === 1 && await page.locator('.edit-h.implied').count() === 1, 'editing a hole shows tee, basket and the built-in middle anchor');
  // Tap the line a quarter of the way along to drop an anchor.
  const tapAt = await page.evaluate(async () => { const t = await LF.db.get('tracks', 'dg-hole'); const p = t.points[10]; const c = LF.map.latLngToContainerPoint([p[0], p[1]]), r = LF.map.getContainer().getBoundingClientRect(); return { x:c.x + r.left, y:c.y + r.top }; });
  await page.mouse.click(tapAt.x, tapAt.y);
  await page.waitForTimeout(200);
  check(await page.locator('.edit-h.dg-anchor:not(.implied)').count() === 1, 'tapping the line drops an anchor');
  const bb = await page.locator('.edit-h.dg-basket').boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
  await page.mouse.move(bb.x + 60, bb.y + 20, { steps:4 }); await page.mouse.move(bb.x + 100, bb.y + 40, { steps:4 }); await page.mouse.up();
  await page.screenshot({ path: path.join(OUT, 'tools-dghole.png') });
  await page.evaluate(() => LF.tuckSheet(false));
  await page.selectOption('#f-fair', '30');
  await page.click('[data-act=save]');
  await page.waitForFunction(() => !/^Edit /.test(document.querySelector('#sheetHead h2').textContent));
  const h = await page.evaluate(async () => { const t = await LF.db.get('tracks', 'dg-hole'); return { a:t.dg.anchors, f:t.dg.fairway, p0:t.points[0], p10:t.points[10], pEnd:t.points[t.points.length - 1], n:t.points.length }; });
  check(h.a.length === 1 && h.f === 30 && h.n === 41, 'the hole saves its anchor and a 30 ft fairway: ' + JSON.stringify({ a:h.a, f:h.f }));
  check(h.pEnd[1] > -92.4 + 0.00005 && Math.abs(h.p0[0] - 45.8) < 1e-9, 'dragging the basket moved the end and left the tee where it was');
  check(Math.abs(h.p10[0] - (45.8 + 0.00025)) < 1e-6, 'the anchor held still while the line bent from it');

  // 13. Drag-to-sort inside a folder: drag the third waypoint to the top; the order is saved and comes back.
  await page.evaluate(async () => { if(!document.getElementById('sheet').hidden) LF.closeSheet();
    for(const [id, n, t] of [['s1', 'Alpha', 3], ['s2', 'Bravo', 2], ['s3', 'Charlie', 1]])
      await LF.db.put('waypoints', { id, name:n, icon:'pin', lat:45.8, lng:-92.4, folder:'Sort test', updated:Date.now() - t * 1000 }); });
  await page.evaluate(() => LF.items.list({ folder:'Sort test' }));
  await page.waitForSelector('#sheetBody .folder[data-f="Sort test"] .grip');
  const names = () => page.evaluate(() => Array.from(document.querySelectorAll('#sheetBody .folder[data-f="Sort test"] .row b')).map(b => b.textContent).join(','));
  const before = await names();
  const rowsG = page.locator('#sheetBody .folder[data-f="Sort test"] .grip');
  const g3 = await rowsG.nth(2).boundingBox(), g1 = await rowsG.nth(0).boundingBox();
  await page.mouse.move(g3.x + g3.width / 2, g3.y + g3.height / 2); await page.mouse.down();
  await page.mouse.move(g3.x + g3.width / 2, g1.y + 20, { steps:8 }); await page.mouse.move(g3.x + g3.width / 2, g1.y + 2, { steps:4 }); await page.mouse.up();
  await page.waitForTimeout(800);
  const after = await names();
  check(after.split(',')[0] === before.split(',')[2], `dragging ⠿ moves a row to the top of its folder: ${before} → ${after}`);
  await page.evaluate(() => { LF.closeSheet(); LF.items.list({ folder:'Sort test' }); });
  await page.waitForSelector('#sheetBody .folder[data-f="Sort test"] .row');
  check(await names() === after, 'the new order is saved and comes back');

  // 14. GPS: "Use my location" averages readings while you hold still, and the waypoint keeps its accuracy.
  await page.evaluate(() => { if(!document.getElementById('sheet').hidden) LF.closeSheet(); });
  await ctx.setGeolocation({ latitude: START.latitude, longitude: START.longitude, accuracy: 10 });
  await tool('waypoint');
  await page.click('#stripBtns [data-a=here]');
  for(let i = 0; i < 6; i++){   // readings scattered ±~6 m around the true spot
    await ctx.setGeolocation({ latitude: START.latitude + (i % 2 ? 1 : -1) * 0.00005, longitude: START.longitude + (i % 3 - 1) * 0.00006, accuracy: 10 });
    await page.waitForTimeout(500);
  }
  check(/Hold still… \d+ readings? · about ±\d+ ft/.test(await page.textContent('#stripText')), 'averaging shows readings and accuracy: ' + await page.textContent('#stripText'));
  await page.click('#stripBtns [data-a=avg-now]');
  await page.waitForSelector('#f-name');
  await saveForm('Averaged spot');
  const avgWp = await page.evaluate(() => LF.db.all('waypoints').then(w => w.find(x => x.name === 'Averaged spot')));
  check(avgWp && avgWp.gpsAcc > 0 && avgWp.gpsN >= 2 && LF_dist(avgWp, START) < 6, 'averaged waypoint lands near the true spot and keeps its accuracy: ' + (avgWp && JSON.stringify({ acc:avgWp.gpsAcc, n:avgWp.gpsN, off:Math.round(LF_dist(avgWp, START) * 10) / 10 })));
  check(/GPS accuracy\s*about ±\d+ ft \(averaged \d+ readings\)/.test(await page.textContent('#sheetBody')), 'its card shows the GPS accuracy');
  // Tidy: an out-and-back spike in a track is removed when it's saved.
  const tidied = await page.evaluate(() => { const p = []; for(let i = 0; i < 10; i++) p.push([45.8 + i * 0.0002, -92.4, null, i * 1000]); p.splice(5, 0, [45.801, -92.399, null, 4500]); return LF.trackTidy(p).length; });
  check(tidied === 10, 'a track spike is removed on save (11 points → ' + tidied + ')');

  // 15. Share a folder: a link anyone can open (no account) shows the holes; Save to my map keeps a copy.
  await page.evaluate(async () => { if(!document.getElementById('sheet').hidden) LF.closeSheet(); });
  // Shared from the folder's panel with the top Share button, at this exact view.
  await page.evaluate(() => LF.map.setView([45.8005, -92.4005], 17, { animate:false }));
  await page.evaluate(() => LF.items.list({ folder:'Disc Golf / Fish Lake Disc Golf Course' }));
  await page.waitForSelector('#shareBtn:not([hidden])');
  await page.click('#shareBtn');
  await page.waitForSelector('#sh-url');
  const short = await page.inputValue('#sh-url');
  const link = new URL((await page.request.get(short, { maxRedirects:0 })).headers().location, short).href;
  check(/\/api\/s\/[A-Za-z0-9]{6}$/.test(short), 'the folder link is a short link: ' + short.replace(/^https?:\/\/[^/]+/, ''));
  check(/#map=17\/45\.80050\/-92\.40050.*&share=[A-Za-z0-9_-]{8,}/.test(link), 'Share on a folder\'s panel shares that folder at this view: ' + link.replace(/^.*#/, '#'));
  const guestCtx = await browser.newContext({ viewport:{ width:420, height:800 } });
  const guest = await guestCtx.newPage();
  await guest.goto(short, { waitUntil:'domcontentloaded' }); await guest.waitForSelector('#sheet:not([hidden]) h2:has-text("Fish Lake Disc Golf Course")', { timeout:15000 });   // the short link, as a brother would get it
  const gView = await guest.evaluate(() => { const c = LF.map.getCenter(); return [c.lat, c.lng, LF.map.getZoom()]; });
  check(Math.abs(gView[0] - 45.8005) < 1e-4 && Math.abs(gView[1] + 92.4005) < 1e-4 && gView[2] === 17, 'the link opens at the sharer\'s view: ' + gView.map(v => +v.toFixed(5)).join(', '));
  const gHead = await guest.textContent('#sheetHead');
  check(/Shared by/.test(gHead) && /2 holes/.test(gHead), 'someone without an account opens the link and sees the folder: ' + gHead.replace(/\s+/g, ' ').slice(0, 90));
  await guest.waitForTimeout(800);
  check(await guest.locator('.dg-end').count() >= 4, 'the shared holes are drawn with tee pads and baskets');
  await guest.click('[data-act=sh-save]');
  check(await guest.isVisible('#sheetHead') && /Sign in|account/i.test(await guest.textContent('#sheet')), 'saving a copy asks a guest to sign in');
  await guestCtx.close();
  // A shared folder's item card shares that item (share + item in the link), and the link reopens it.
  const itemLink = await page.evaluate(async l => { location.hash = l.split('#')[1]; await new Promise(r => setTimeout(r, 1500));
    document.querySelector('#sheetBody [data-act=sh-open]').click(); await new Promise(r => setTimeout(r, 300));
    return LF.shareLink(LF.shareCtx.params()); }, link);
  check(/&share=[^&]+&item=[^&]+/.test(itemLink), 'an open shared item gives a link to that item: ' + itemLink.replace(/^.*#/, '#'));
  await page.goto('about:blank'); await page.goto(itemLink, { waitUntil:'domcontentloaded' }); await page.waitForSelector('#sheet:not([hidden]) #sheetBack', { timeout:15000 });
  check(/Hole/.test(await page.textContent('#sheetHead h2')), 'the item link opens on that item: ' + await page.textContent('#sheetHead h2'));
  await page.goto('about:blank'); await page.goto(link, { waitUntil:'domcontentloaded' }); await page.waitForSelector('#sheet:not([hidden]) [data-act=sh-save]', { timeout:15000 });
  await page.click('[data-act=sh-save]');
  await page.waitForTimeout(800);
  const copies = await page.evaluate(() => LF.db.all('tracks').then(t => t.filter(x => x.sharedFrom).length));
  check(copies === 2, 'Save to my map keeps a copy of the shared holes: ' + copies);
  await page.goto('about:blank'); await page.goto(link, { waitUntil:'domcontentloaded' }); await page.waitForSelector('#sheet:not([hidden]) [data-act=sh-save]', { timeout:15000 });
  await page.click('[data-act=sh-save]'); await page.waitForTimeout(800);
  check(await page.evaluate(() => LF.db.all('tracks').then(t => t.filter(x => x.sharedFrom).length)) === 2, 'saving the same share again updates the copies, not doubles them');

  // 16. Disc golf: map a course. Hole 1 walked with GPS (tee averaged, fairway recorded, basket averaged);
  //     hole 2 planned by tapping the map. Saved as disc golf holes in the course folder.
  await page.goto('about:blank'); await page.goto(BASE + '#map=18/45.86/-92.62', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => window.LF && LF.course);
  await ctx.setGeolocation({ latitude:45.86, longitude:-92.62, accuracy:6 });
  await tool('dgcourse');
  await page.fill('#c-name', 'Test Park');
  check(await page.inputValue('#c-folder') === 'Disc Golf / Test Park', 'the course gets a folder named after it');
  await page.click('[data-act=go]');
  await page.waitForSelector('.coursebar:not([hidden]) [data-c=tee]');
  check(/Test Park · Hole 1 · Par 3/.test(await page.textContent('.coursebar')), 'the course bar shows the course, hole and par');
  await page.click('.coursebar [data-c=tee]');
  for(let i = 0; i < 3; i++){ await ctx.setGeolocation({ latitude:45.86 + i * 0.000005, longitude:-92.62, accuracy:6 }); await page.waitForTimeout(400); }
  await page.click('.coursebar [data-c=avg-now]');
  await page.waitForSelector('.coursebar [data-c=basket]');
  for(let i = 1; i <= 5; i++){ await ctx.setGeolocation({ latitude:45.86 + i * 0.0001, longitude:-92.62 + i * 0.00003, accuracy:6 }); await page.waitForTimeout(1200); }
  check(/Fairway \d+ ft/.test(await page.textContent('.coursebar')), 'the fairway records as you walk: ' + (await page.textContent('.coursebar .small')).trim());
  await page.click('.coursebar [data-c=basket]');
  for(let i = 0; i < 3; i++){ await ctx.setGeolocation({ latitude:45.8605 + i * 0.000005, longitude:-92.61985, accuracy:6 }); await page.waitForTimeout(400); }
  await page.click('.coursebar [data-c=avg-now]');
  await page.waitForFunction(() => /Hole 2/.test(document.querySelector('.coursebar').textContent));
  // Hole 2 from the aerial: tap the tee, then the basket.
  const vw2 = page.viewportSize();
  await page.click('.coursebar [data-c="par+"]');
  await page.mouse.click(vw2.width * 0.3, vw2.height * 0.3); await page.waitForTimeout(300);
  await page.mouse.click(vw2.width * 0.7, vw2.height * 0.45); await page.waitForTimeout(800);
  const holes = await page.evaluate(() => LF.db.all('tracks').then(t => t.filter(x => x.folder === 'Disc Golf / Test Park').map(x => ({ n:x.dg.hole, par:x.dg.par, pts:x.points.length, len:Math.round(LF.geo.length(x.points)) }))));
  const h1 = holes.find(h => h.n === '1'), h2 = holes.find(h => h.n === '2');
  check(h1 && h1.pts >= 4 && h1.len > 40 && h1.len < 80, 'hole 1 saved from the walk: ' + JSON.stringify(h1));
  check(h2 && h2.par === '4' && h2.pts === 11, 'hole 2 saved from two taps, par 4, straight fairway: ' + JSON.stringify(h2));
  check(/Hole 3/.test(await page.textContent('.coursebar')), 'the bar moves on to hole 3');
  await page.click('.coursebar [data-c=done]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Disc Golf / Test Park")');
  check(await page.isHidden('.coursebar') && await page.evaluate(() => !LF.mode), 'Done closes the bar and opens the course folder');

  const rtrip = await page.evaluate(() => LF.db.all('tracks').then(ts => { const h = ts.filter(t => t.dg && t.folder === 'Disc Golf / Test Park'); const g = LF.geo;
    const a = g.parseFile(g.toGPX({ tracks:h })).tracks, b = g.parseFile(g.toKML({ tracks:h })).tracks;
    return { n:h.length, gpx:a.map(t => t.dg && t.dg.hole + '/' + t.dg.par).sort().join(','), kml:b.map(t => t.dg && t.dg.hole + '/' + t.dg.par).sort().join(','), folder:a[0] && a[0].folder }; }));
  check(rtrip.n === 2 && rtrip.gpx === '1/3,2/4' && rtrip.kml === '1/3,2/4' && rtrip.folder === 'Disc Golf / Test Park', 'a course exported to GPX or KML imports back as disc golf holes: ' + JSON.stringify(rtrip));

  // 17. Disc golf: score a round on the course just mapped (2 holes: par 3, par 4), me against Ben.
  await page.evaluate(() => { if(!document.getElementById('sheet').hidden) LF.closeSheet(); });
  await tool('dgscore');
  await page.waitForSelector('#r-course');
  await page.selectOption('#r-course', 'Disc Golf / Test Park');
  await page.fill('#r-add', 'Ben'); await page.click('#sheetBody [data-act=add]');
  check(/Tester[\s\S]*Ben/.test(await page.textContent('#r-sides')), 'players added: ' + (await page.textContent('#r-sides')).replace(/✕/g, ' ').trim());
  await page.click('#sheetBody [data-act=go]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 1 · Par 3")');
  await page.waitForFunction(() => LF.track.current() && LF.track.current().round, null, { timeout:5000 }).catch(() => {});
  check(await page.evaluate(() => !!(LF.track.current() && LF.track.current().round)), 'starting a round starts recording its track');
  await page.waitForSelector('#roundChip:not([hidden])', { timeout:5000 }).catch(() => {});
  check(/Round · Test Park · Hole 1/.test(await page.textContent('#roundChip')), 'a pill under the search bar shows the round: ' + (await page.textContent('#roundChip')).trim());
  for(let i = 1; i <= 4; i++){ await ctx.setGeolocation({ latitude:45.86 + i * 0.0001, longitude:-92.62, accuracy:5 }); await page.waitForTimeout(500); }
  const sideBtn = async (n, act) => { await page.locator('#sheetBody .srow').nth(n).locator(`[data-act=${act}]`).click(); await page.waitForTimeout(150); };
  await sideBtn(0, 'par'); await sideBtn(0, 'inc');   // me: 4
  await sideBtn(1, 'dec');                             // Ben: 2
  check(/4/.test(await page.locator('#sheetBody .srow').nth(0).locator('.sval').textContent()) && /\+1/.test(await page.locator('#sheetBody .srow').nth(0).textContent()), 'scores and the running total against par update');
  await page.click('#sheetBody [data-act=next]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 2 · Par 4")');
  await sideBtn(1, 'inc');                             // Ben: 5; me left blank = par 4
  await page.click('#sheetBody [data-act=finish]');
  await page.waitForSelector('#sheetBody .winner');
  check(/Ben wins with 7/.test(await page.textContent('#sheetBody .winner')), 'finishing shows the card and the winner: ' + await page.textContent('#sheetBody .winner'));
  const rd = await page.evaluate(() => LF.db.all('rounds').then(r => r[0]));
  check(rd && rd.finished && JSON.stringify(Object.values(rd.scores)) === '[[4,4],[2,5]]', 'the round is saved with every score: ' + JSON.stringify(rd && rd.scores));
  check(await page.isVisible('#sheetBody [data-act=track-save]') && /round over/.test(await page.textContent('#roundChip')), 'the finished round offers to save its track');
  await page.click('#sheetBody [data-act=track-save]');
  await page.waitForSelector('#sheetBody [data-act=track-show]');
  const rt = await page.evaluate(() => LF.db.all('rounds').then(async r => { const t = await LF.db.get('tracks', r[0].trackId); return t && { folder:t.folder, n:t.points.length, rec:t.recording, name:t.name }; }));
  check(rt && rt.folder === 'Disc Golf / Rounds' && rt.n >= 3 && !rt.rec, 'the track is saved with the round: ' + JSON.stringify(rt));
  check(await page.isHidden('#roundChip') && !(await page.evaluate(() => LF.track.recording())), 'then the pill goes and recording stops');
  await page.click('#sheetBack');
  await page.waitForSelector('#sheetBody h3:has-text("Past rounds")', { timeout:5000 }).catch(() => {});
  check(/Past rounds[\s\S]*Test Park/.test(await page.textContent('#sheetBody')), 'past rounds are listed');

  // 18. A live round: I invite, Ben opens the link on his phone (no account), and both phones score it.
  await page.selectOption('#r-course', 'Disc Golf / Test Park');
  await page.fill('#r-add', 'Ben'); await page.click('#sheetBody [data-act=add]');
  await page.click('#sheetBody [data-act=go]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 1")');
  await page.click('#sheetBody [data-act=invite]');
  await page.waitForSelector('#linkPop:not([hidden]) input');
  const roundLink = await page.inputValue('#linkPop input');
  await page.click('#linkPop [data-p=close]');
  await page.waitForFunction(() => /Live round · Test Park/.test(document.getElementById('roundChip').textContent), null, { timeout:5000 }).catch(() => {});
  check(/Live round · Test Park · Hole 1/.test(await page.textContent('#roundChip')), 'the pill says Live round once invited');
  await page.evaluate(() => LF.closeSheet()); await page.click('#roundChip');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 1")');
  check(true, 'tapping the pill goes back to the round');
  check(/\/api\/s\/[A-Za-z0-9]{6}$/.test(roundLink) && await page.isVisible('#sheetHead .live-tag'), 'Invite makes the round live and gives a short link: ' + roundLink.replace(/^https?:\/\/[^/]+/, ''));
  const benCtx = await browser.newContext({ viewport:{ width:420, height:800 } });
  const ben = await benCtx.newPage();
  await ben.goto(roundLink, { waitUntil:'domcontentloaded' });
  await ben.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 1 · Par 3")', { timeout:15000 });
  check(/Tester[\s\S]*Ben/.test(await ben.textContent('#sheetBody .scard')), 'Ben opens the link and sees the same round, no account needed');
  await ben.locator('#sheetBody .srow').nth(1).locator('[data-act=dec]').click();   // Ben: 2
  await page.waitForFunction(() => /^2$/.test(document.querySelectorAll('#sheetBody .srow')[1].querySelector('.sval').textContent.trim()), null, { timeout:10000 }).catch(() => {});
  check(/^2$/.test((await page.locator('#sheetBody .srow').nth(1).locator('.sval').textContent()).trim()), 'Ben\'s score shows up on my phone');
  await page.locator('#sheetBody .srow').nth(0).locator('[data-act=inc]').click();   // me: 4
  await ben.waitForFunction(() => /^4$/.test(document.querySelectorAll('#sheetBody .srow')[0].querySelector('.sval').textContent.trim()), null, { timeout:10000 }).catch(() => {});
  check(/^4$/.test((await ben.locator('#sheetBody .srow').nth(0).locator('.sval').textContent()).trim()), 'and mine shows up on his');
  await benCtx.close();

  // 19. Disc golf: measure throws. Standing on hole 1's tee pad offers its saved spot; walk ~100 m and mark the
  //     landing (averaged); save and throw again from there; the Throws list shows the best per disc.
  //     (Position set before the page loads: GPS smoothing rightly ignores a lone 45 m jump.)
  await ctx.setGeolocation({ latitude:45.86, longitude:-92.62, accuracy:6 });
  await page.goto('about:blank'); await page.goto(BASE + '#map=18/45.86/-92.62', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => window.LF && LF.throws);
  await ctx.setGeolocation({ latitude:45.86, longitude:-92.62, accuracy:6 });
  await tool('dgthrow');
  await page.waitForSelector('.throwbar:not([hidden]) [data-t=tee]', { timeout:10000 }).catch(() => {});
  check(/tee pad of hole 1/.test(await page.textContent('.throwbar')), 'standing on a mapped tee pad offers it as the throw spot');
  await page.click('.throwbar [data-t=tee]');
  for(let i = 1; i <= 3; i++){ await ctx.setGeolocation({ latitude:45.86 + i * 0.0003, longitude:-92.62, accuracy:6 }); await page.waitForTimeout(700); }
  check(/About \d+ ft so far/.test(await page.textContent('.throwbar')), 'the distance counts up as you walk: ' + (await page.textContent('.throwbar .small')).trim());
  await page.click('.throwbar [data-t=to]');
  for(let i = 0; i < 3; i++){ await ctx.setGeolocation({ latitude:45.8609 + i * 0.000004, longitude:-92.62, accuracy:4 }); await page.waitForTimeout(400); }
  await page.click('.throwbar [data-t=avg-now]');
  await page.waitForSelector('.throwbar .throw-dist');
  const d1 = parseInt(await page.textContent('.throwbar .throw-dist'), 10);
  check(d1 > 320 && d1 < 340, 'a 100 m throw measures about 328 ft: ' + d1 + ' ft, ' + (await page.textContent('.throwbar .cb-head .small')).trim());
  await page.fill('#t-disc', 'Destroyer');
  await page.click('.throwbar [data-t=next]');
  await page.waitForSelector('.throwbar [data-t=to]');
  check(/from last landing/.test(await page.textContent('.throwbar')), 'the next throw starts where the last one landed');
  const vw3 = page.viewportSize();
  await page.mouse.click(vw3.width * 0.5, vw3.height * 0.35); await page.waitForTimeout(500);   // landing tapped on the map
  await page.waitForSelector('.throwbar .throw-dist');
  await page.fill('#t-disc', 'Buzzz'); await page.selectOption('#t-kind', 'Forehand');
  await page.click('.throwbar [data-t=save]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Throws")');
  const thr = await page.evaluate(() => LF.db.all('throws').then(a => a.map(t => ({ disc:t.disc, kind:t.kind, hole:t.hole, ft:Math.round(t.dist * 3.28084) }))));
  check(thr.length === 2 && thr.some(t => t.disc === 'Destroyer' && t.hole === '1') && thr.some(t => t.disc === 'Buzzz' && t.kind === 'Forehand'), 'both throws saved: ' + JSON.stringify(thr));
  check(await page.locator('#sheetBody .block:has(h3:has-text("Best per disc")) .row').count() === 2, 'the list shows the best throw for each disc');
  check(await page.isHidden('.throwbar') && await page.evaluate(() => !LF.mode), 'saving closes the bar');
  await page.locator('#sheetBody .row').first().click();
  await page.waitForSelector('#sheet:not([hidden]) [data-act=del]');
  check(/ft/.test(await page.textContent('#sheetHead h2')), 'a throw opens with its distance and draws on the map');

  // 20. Admin: add a public course from a layout picture. Mark 2 holes (hole 2 with a bend), size from the distances,
  //     drag and turn the picture, publish; everyone sees it; it shows in Score a round; Add to my map; publish back.
  await page.goto('about:blank'); await page.goto(BASE + '#map=17/45.87/-92.60', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => window.LF && LF.dgadmin && LF.account.user());
  await page.evaluate(() => LF.closeSheet()); await page.click('#toolsBtn'); await page.click('.mi[data-m=dgcourses]');
  await page.waitForSelector('#sheetBody [data-act=add]'); await page.click('#sheetBody [data-act=add]');
  // Read pars & distances from a screenshot: the server's Claude call is stubbed here (the test server has no key).
  await page.route('**/api/courses/read', r => r.fulfill({ status:200, contentType:'application/json',
    body:JSON.stringify({ holes:[{ n:'1', par:3, ft:251 }, { n:'2', par:4, ft:508 }], layout:'2 Hole' }) }));
  const tablePng = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 100; return c.toDataURL('image/png').split(',')[1]; });
  const [readReq] = await Promise.all([page.waitForRequest('**/api/courses/read'),
    page.setInputFiles('#a-table', { name:'table.png', mimeType:'image/png', buffer:Buffer.from(tablePng, 'base64') })]);
  await page.waitForFunction(() => /Read 2 holes/.test(document.getElementById('a-read').textContent));
  const sent = JSON.parse(readReq.postData());
  check(await page.inputValue('#a-pars') === '3 4' && await page.inputValue('#a-fts') === '251 508' && sent.media_type === 'image/jpeg' && sent.data.length > 100,
    'a pars table screenshot fills in the pars and distances: ' + (await page.textContent('#a-read')).trim());
  await page.unroute('**/api/courses/read');
  await page.fill('#a-name', 'Pine Test'); await page.fill('#a-pars', '3 4'); await page.fill('#a-fts', '200, 300');
  check(/2 holes, par 7, 2 distances/.test(await page.textContent('#a-count')), 'the form counts holes and par as you type');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d');
    x.fillStyle = '#3a6'; x.fillRect(0, 0, 600, 400); x.strokeStyle = '#fff'; x.lineWidth = 6; x.beginPath(); x.moveTo(100, 300); x.lineTo(250, 250); x.moveTo(300, 300); x.lineTo(400, 200); x.lineTo(500, 120); x.stroke();
    return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#a-pic', { name:'layout.png', mimeType:'image/png', buffer:Buffer.from(png, 'base64') });
  // Claude marks the holes on the layout picture (stubbed: the test server has no key). Hole 2 bends once.
  await page.route('**/api/courses/locate', r => r.fulfill({ status:200, contentType:'application/json',
    body:JSON.stringify({ holes:[{ n:'1', points:[[100, 300], [250, 250]] }, { n:'2', points:[[300, 300], [400, 200], [500, 120]] }] }) }));
  check(await page.isChecked('#a-find'), 'Claude marking the holes is on by default');
  await page.click('#sheetBody [data-act=next]');
  await page.waitForSelector('.dgaddbar:not([hidden])');
  await page.waitForFunction(() => LF.dgadmin.state() && LF.dgadmin.state().holes.join() === '2,3', null, { timeout:10000 }).catch(() => {});
  check(JSON.stringify((await page.evaluate(() => LF.dgadmin.state())).holes) === '[2,3]' && /Marked by Claude/.test(await page.textContent('.dgaddbar')), 'Claude\'s marks land on the picture: tee, bend, basket');
  await page.unroute('**/api/courses/locate');
  // Redo hole 1 by hand.
  await page.click('.dgaddbar [data-a=redo]');
  check(await page.isVisible('img.dgpic') && /Hole 1 of 2 · Par 3 · 200 ft/.test(await page.textContent('.dgaddbar')), 'the picture lies over the map and asks for hole 1');
  await at(0.35, 0.52); await at(0.45, 0.5);
  check(JSON.stringify((await page.evaluate(() => LF.dgadmin.state())).holes) === '[2,3]', 'Redo hole, then taps mark it again');
  await page.click('.dgaddbar [data-a=done]');
  const al = await page.evaluate(() => LF.dgadmin.state());
  check(al.step === 'align' && (al.ft[0] - 200) * (al.ft[1] - 300) <= 0 && al.ft[0] > 100 && al.ft[1] < 600, 'Done sizes the picture from the listed distances: ' + al.ft.join(' / ') + ' ft');
  // Drag the picture 60 px right, then turn it a step.
  const cx = Math.round(vw.width * 0.5), cy = Math.round(vw.height * 0.45);
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy, { steps:3 }); await page.mouse.move(cx + 60, cy, { steps:3 }); await page.mouse.up();
  await page.click('.dgaddbar [data-a=rotr]');
  const al2 = await page.evaluate(() => LF.dgadmin.state());
  check(al2.C[1] > al.C[1] && Math.abs(al2.rot - 0.5) < 1e-9 && Math.abs(al2.ft[1] - al.ft[1]) <= 1, 'dragging moves the picture and the holes with it; ⟳ turns it');
  await page.click('.dgaddbar [data-a=publish]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Pine Test")', { timeout:10000 });
  const pubd = await page.evaluate(() => LF.api('GET', 'courses').then(r => r.courses.find(c => c.name === 'Pine Test')));
  check(pubd && pubd.holes.length === 2 && pubd.holes[1].anchors.length === 1 && pubd.holes[1].par === 4 && pubd.holes[0].ft === 200, 'published with its holes, pars, distances and the bend');
  check(await page.isHidden('.dgaddbar') && await page.evaluate(() => !LF.mode && !document.querySelector('img.dgpic')), 'publishing puts the picture away and opens the course');
  const anon = await browser.newContext(); const ap = await anon.newPage();
  await ap.goto(BASE, { waitUntil:'domcontentloaded' }); await ap.waitForFunction(() => window.LF && LF.discgolf);
  check(await ap.evaluate(() => LF.discgolf.pub().then(l => l.some(c => c.name === 'Pine Test'))), 'anyone sees the published course, no account needed');
  await anon.close();
  await page.evaluate(() => LF.closeSheet());
  await tool('dgscore'); await page.waitForSelector('#r-course');
  check(await page.locator('#r-course option', { hasText:'Pine Test' }).count() === 1, 'Score a round offers the published course');
  await page.evaluate(id => LF.discgolf.openPublic(id), pubd.id);
  await page.waitForSelector('#sheetBody [data-act=copy]'); await page.click('#sheetBody [data-act=copy]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Disc Golf / Pine Test")', { timeout:5000 }).catch(() => {});
  const mine = await page.evaluate(() => LF.db.all('tracks').then(t => t.filter(x => x.folder === 'Disc Golf / Pine Test').map(x => x.dg.hole + '/' + x.dg.par).sort().join(',')));
  check(mine === '1/3,2/4', 'Add to my map copies it as disc golf holes: ' + mine);
  await page.evaluate(() => LF.db.all('tracks').then(t => { const h = t.find(x => x.folder === 'Disc Golf / Pine Test' && x.dg.hole === '1'); h.dg.par = '4'; return LF.db.put('tracks', h); }));
  await page.evaluate(() => LF.closeSheet()); await page.click('#toolsBtn'); await page.click('.mi[data-m=dgcourses]');
  await page.waitForSelector('#pub-folder'); await page.selectOption('#pub-folder', 'Disc Golf / Pine Test');
  page.once('dialog', d => d.accept());
  await page.click('#sheetBody [data-act=publish]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Pine Test")', { timeout:10000 }).catch(() => {});
  const repub = await page.evaluate(() => LF.api('GET', 'courses').then(r => r.courses.filter(c => c.name === 'Pine Test')));
  check(repub.length === 1 && repub[0].id === pubd.id && repub[0].holes[0].par === 4, 'publishing my edited copy updates the same course');

  // 21. Admin: edit a course on the map. Drag the published course's pin and hole 1's tee; then an OpenStreetMap course's pin.
  const drag = async (sel, dx, dy) => { const b = await page.locator(sel).first().boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2, { steps:4 }); await page.mouse.move(x + dx, y + dy, { steps:4 }); await page.mouse.up(); };
  await page.evaluate(() => LF.closeSheet());
  // (Not in my map for this part: take my copy out so the public layout itself is edited.)
  await page.evaluate(() => LF.db.all('tracks').then(ts => Promise.all(ts.filter(t => t.folder === 'Disc Golf / Pine Test').map(t => LF.db.del('tracks', t.id)))));
  await page.waitForTimeout(1500);
  await page.evaluate(id => LF.discgolf.openPublic(id), pubd.id);
  await page.waitForSelector('#sheetBody [data-act=edit]'); await page.click('#sheetBody [data-act=edit]');
  await page.waitForSelector('.dgaddbar:not([hidden]) [data-e=save]');
  check(await page.locator('.ce-pin').count() === 1 && await page.locator('.ce-tee').count() === 2 && await page.locator('.ce-bend').count() === 1, 'Edit course shows the pin, both tees and hole 2\'s bend to drag');
  const ed0 = await page.evaluate(() => LF.dgadmin.editing());
  await drag('.ce-pin', 40, 30); await drag('.ce-tee', -30, 0);
  await page.click('.dgaddbar [data-e=save]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Pine Test")', { timeout:10000 }).catch(() => {});
  const ed = await page.evaluate(() => LF.api('GET', 'courses').then(r => r.courses.find(c => c.name === 'Pine Test')));
  check(ed && ed.pin && (ed.c[0] !== ed0.pin[0] || ed.c[1] !== ed0.pin[1]) && ed.holes[0].line[0][1] !== repub[0].holes[0].line[0][1] && ed.holes[1].anchors.length === 1 && ed.holes[0].par === 4,
    'dragging the pin and a tee saves both; the other hole keeps its bend');
  // Your map is the course: with Pine Test in my map, moving a tee there updates the public course (distances kept),
  // the layer stops drawing its own copy, and Edit course only moves the pin.
  await page.evaluate(() => LF.closeSheet());
  await page.evaluate(id => LF.discgolf.openPublic(id), pubd.id);
  await page.waitForSelector('#sheetBody [data-act=copy]'); await page.click('#sheetBody [data-act=copy]');
  await page.waitForTimeout(1500);
  await page.evaluate(() => LF.db.all('tracks').then(ts => { const h = ts.find(t => t.folder === 'Disc Golf / Pine Test' && t.dg.hole === '1');
    h.points = h.points.map(p => [p[0] + 0.0001, p[1]]); return LF.db.put('tracks', h); }));
  await page.waitForTimeout(4500);   // the public course follows ~3 s after the change
  const auto = await page.evaluate(id => LF.api('GET', 'courses').then(r => r.courses.find(x => x.id === id)), pubd.id);
  check(auto && Math.abs(auto.holes[0].line[0][0] - ed.holes[0].line[0][0] - 0.0001) < 0.00002 && auto.holes[0].ft === 200 && auto.pin,
    'moving a hole in my map updates the public course (distance and pin kept)');
  check(await page.evaluate(id => LF.discgolf.isMine(LF.discgolf.data() ? LF.discgolf.data().courses.find(c => c.pub === id) || { pub:id } : { pub:id }), pubd.id), 'the layer leaves my own course to my map (no second layout)');
  await page.evaluate(id => LF.discgolf.openPublic(id), pubd.id);
  await page.waitForSelector('#sheetBody [data-act=edit]'); await page.click('#sheetBody [data-act=edit]');
  await page.waitForSelector('.dgaddbar:not([hidden]) [data-e=save]');
  check(await page.locator('.ce-tee').count() === 0 && /edit them there/.test(await page.textContent('.dgaddbar')), 'Edit course on my own course moves just the pin');
  await drag('.ce-pin', 20, 0); await page.click('.dgaddbar [data-e=save]'); await page.waitForTimeout(1500);
  const pinOnly = await page.evaluate(id => LF.api('GET', 'courses').then(r => r.courses.find(x => x.id === id)), pubd.id);
  check(pinOnly && pinOnly.holes.length === 2 && pinOnly.c[1] > auto.c[1], 'its pin moves and its holes stay');
  check(await page.evaluate(() => LF.discgolf.sameCourse({ name:'Tjiny Acres', c:[45.7778, -92.4313] }, { name:'Tjiny Acres (putter course)', c:[45.7779, -92.4320] })
    && !LF.discgolf.sameCourse({ name:'Tjiny Acres', c:[45.7778, -92.4313] }, { name:'Tjader Acres Disc Golf Course', c:[45.7778, -92.4319] })), 'the same course under two names counts once');
  await page.evaluate(() => { const b = document.getElementById('l-discgolf'); if(!b.checked){ b.checked = true; b.dispatchEvent(new Event('change')); } return LF.discgolf.load(); });
  const osm = await page.evaluate(() => { const c = LF.discgolf.data().courses.find(x => !x.pub && x.holes && x.holes.length); LF.discgolf.open(c); return { name:c.name, c:c.c, n:c.holes.length }; });
  await page.waitForSelector('#sheetBody [data-act=edit]'); await page.click('#sheetBody [data-act=edit]');
  await page.waitForSelector('.dgaddbar:not([hidden]) [data-e=save]');
  check(await page.locator('.ce-tee').count() === 0 && await page.locator('.ce-pin').count() === 1, 'an OpenStreetMap course offers just its pin');
  await drag('.ce-pin', 0, 50);
  await page.click('.dgaddbar [data-e=save]');
  await page.waitForSelector(`#sheet:not([hidden]) h2:has-text("${osm.name}")`, { timeout:10000 }).catch(() => {});
  const moved = await page.evaluate(n => LF.discgolf.data().courses.find(x => x.name === n), osm.name);
  check(moved && moved.pinOnly && moved.c[0] < osm.c[0] && moved.holes.length === osm.n, 'its pin moves and it keeps its own holes: ' + osm.name);

  // 22. Line up the aerial photo: measure with GPS, tap the spot on the photo, nudge, then move what was placed by eye.
  await page.evaluate(() => { LF.closeSheet(); if(document.querySelector('.dgaddbar:not([hidden]) [data-e=cancel]')) document.querySelector('.dgaddbar [data-e=cancel]').click(); });
  await ctx.setGeolocation({ latitude:45.86, longitude:-92.62, accuracy:3 });
  const hole1Before = await page.evaluate(() => LF.db.all('tracks').then(t => t.find(x => x.folder === 'Disc Golf / Test Park' && x.dg && x.dg.hole === '1').points[0]));
  const pubBefore = await page.evaluate(() => LF.api('GET', 'courses').then(r => r.courses.find(c => c.name === 'Pine Test')));
  await page.evaluate(() => LF.closeSheet()); await page.click('#toolsBtn'); await page.click('.mi[data-m=photo]');
  await page.waitForSelector('.photobar:not([hidden]) [data-p=here]'); await page.click('.photobar [data-p=here]');
  for(let i = 0; i < 4; i++){ await ctx.setGeolocation({ latitude:45.86 + i * 0.000002, longitude:-92.62, accuracy:3 }); await page.waitForTimeout(350); }
  await page.click('.photobar [data-p=use]');
  await page.waitForSelector('.photobar [data-p=again]');
  const gpsPt = await page.evaluate(() => { const p = LF.map.latLngToContainerPoint([45.860003, -92.62]); return { x:p.x, y:p.y }; });
  // A saved area (a house outline) right under the spot: the tap still goes to the photo tool, not to the area.
  await page.evaluate(() => LF.db.put('drawings', { id:'house', kind:'area', name:'House', points:[[45.86005, -92.62005], [45.86005, -92.61985], [45.85995, -92.61985], [45.85995, -92.62005]] }));
  await page.waitForTimeout(800);
  await page.mouse.click(gpsPt.x + 40, gpsPt.y);   // the spot shows 40 px east on the photo
  await page.waitForSelector('.photobar [data-p=done]');
  check(await page.evaluate(() => document.getElementById('sheet').hidden), 'a tap on top of a saved area goes to the photo tool');
  const sh1 = await page.evaluate(() => LF.photoShift.get());
  check(sh1.length === 1 && sh1[0].e < -1 && Math.abs(sh1[0].n) < 0.5 && await page.evaluate(() => /translate/.test(document.querySelector('.leaflet-tile-pane').style.transform)), 'tapping the spot shifts the photo to the GPS: ' + JSON.stringify(sh1));
  await page.click('.photobar [data-p=nudge][data-d=n]');
  const sh2 = await page.evaluate(() => LF.photoShift.get()[0]);
  check(Math.abs(sh2.n - sh1[0].n - 0.3048) < 0.01, 'the arrows move it a foot at a time');
  await page.click('.photobar [data-p=done]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Move what you placed by eye")');
  check(await page.isChecked('#sheetBody [data-top="Disc Golf"]') && await page.isChecked('#sheetBody [data-pub]'), 'Disc Golf and the public courses here are ticked to move along');
  await page.click('#sheetBody [data-act=move]');
  await page.waitForFunction(() => document.getElementById('sheet').hidden, null, { timeout:10000 }).catch(() => {});
  const hole1After = await page.evaluate(() => LF.db.all('tracks').then(t => t.find(x => x.folder === 'Disc Golf / Test Park' && x.dg && x.dg.hole === '1').points[0]));
  const pubAfter = await page.evaluate(() => LF.api('GET', 'courses').then(r => r.courses.find(c => c.name === 'Pine Test')));
  const eM = (a, b) => (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180), nM = (a, b) => (b[0] - a[0]) * 111320;
  check(Math.abs(eM(hole1Before, hole1After) - sh2.e) < 0.05 && Math.abs(nM(hole1Before, hole1After) - sh2.n) < 0.05, 'my disc golf holes move with the photo');
  check(Math.abs(eM(pubBefore.holes[0].line[0], pubAfter.holes[0].line[0]) - sh2.e) < 0.05 && Math.abs(eM(pubBefore.c, pubAfter.c) - sh2.e) < 0.05, 'and the public course near here, pin too');
  await page.waitForTimeout(2000);   // settings reach the account 1.5 s after a change
  await page.reload({ waitUntil:'domcontentloaded' }); await page.waitForFunction(() => window.LF && LF.photoShift);
  await page.waitForTimeout(1500);
  const rl = await page.evaluate(() => ({ n:LF.photoShift.get().length, t:document.querySelector('.leaflet-tile-pane').style.transform, c:LF.map.getCenter(), raw:localStorage.getItem('lf.photoShift') }));
  check(rl.n === 1 && /translate/.test(rl.t), 'the shift is kept after a reload: ' + JSON.stringify(rl));

  // 23. Playing better than the other app: weather on the course panel, distance to the basket and the wind on the hole,
  //     my stats, the crew leaderboard and my bag. (Open-Meteo answers from a fixture: wind 10 mph from the west.)
  await page.route('**/api.open-meteo.com/**', r => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
    current:{ temperature_2m:61, apparent_temperature:61, wind_speed_10m:10, wind_direction_10m:270, wind_gusts_10m:18, weather_code:1, precipitation:0 },
    hourly:{ time:['2026-11-09T12:00', '2026-11-09T13:00', '2026-11-09T14:00', '2026-11-09T15:00', '2026-11-09T16:00', '2026-11-09T17:00', '2026-11-09T18:00'],
      temperature_2m:[61, 62, 63, 63, 62, 60, 58], precipitation_probability:[0, 0, 10, 20, 20, 10, 0], wind_speed_10m:[10, 11, 12, 12, 10, 8, 6],
      wind_direction_10m:[270, 270, 280, 280, 290, 290, 300], weather_code:[1, 1, 2, 2, 3, 3, 3] } }) }));
  await page.evaluate(() => LF.closeSheet());
  await page.evaluate(id => LF.discgolf.openPublic(id), pubd.id);
  await page.waitForFunction(() => /Wind 10 mph from the W/.test((document.getElementById('dg-wx') || {}).textContent || ''), null, { timeout:10000 }).catch(() => {});
  check(/61°F[\s\S]*Wind 10 mph from the W, gusts 18/.test(await page.textContent('#dg-wx')), 'the course panel shows the weather and wind');
  // A round on Test Park, standing on hole 1's tee: distance to the basket and a crosswind.
  await ctx.setGeolocation({ latitude:45.86, longitude:-92.62, accuracy:4 });
  await page.evaluate(() => LF.closeSheet());
  await tool('dgscore'); await page.waitForSelector('#r-course');
  await page.selectOption('#r-course', 'Disc Golf / Test Park');
  await page.click('#sheetBody [data-act=go]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 1")');
  await page.waitForFunction(() => /to the basket/.test(document.getElementById('r-dist').textContent), null, { timeout:10000 }).catch(() => {});
  check(/\d+ ft to the basket/.test(await page.textContent('#r-dist')), 'the scorecard shows the distance to the basket: ' + (await page.textContent('#r-dist')).trim());
  await page.waitForFunction(() => /Crosswind|wind/i.test(document.getElementById('r-wind').textContent), null, { timeout:10000 }).catch(() => {});
  check(/Crosswind, left to right/.test(await page.textContent('#r-wind')), 'and the wind on this hole: ' + (await page.textContent('#r-wind')).trim());
  await page.click('#sheetBody [data-act=fw][data-v=true]');
  await page.click('#sheetBody [data-act="st+"][data-k=putts]'); await page.click('#sheetBody [data-act="st+"][data-k=putts]');
  await page.click('#sheetBody [data-act="st+"][data-k=ob]');
  check(await page.isVisible('#sheetBody [data-act=fw][data-v=true].on'), 'stats tap in: fairway hit, 2 putts, 1 OB');
  page.once('dialog', d => d.accept());
  await page.click('#sheetBody [data-act=finish]');
  await page.waitForSelector('#sheetBody .winner, #sheetBody .sgrid', { timeout:10000 });
  await page.evaluate(() => LF.rounds.myStats());
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("My stats")');
  const ms = await page.textContent('#sheetBody');
  check(/Fairways hit\s*100% \(1 of 1\)/.test(ms) && /Putts per hole\s*2\.00/.test(ms) && /OB per round\s*1\.0/.test(ms), 'My stats adds them up');
  // The crew leaderboard (rounds reach the server with sync).
  await page.evaluate(() => LF.sync.now());
  await page.evaluate(() => LF.leaderboard());
  await page.waitForSelector('#sheetBody table.board', { timeout:10000 }).catch(() => {});
  check(/Ben/.test(await page.textContent('#sheetBody')) && /Tester/.test(await page.textContent('#sheetBody')), 'the leaderboard lists the crew');
  await page.click('#sheetBody [data-act=tab][data-t=course]');
  check(/Test Park/.test(await page.textContent('#sheetBody select')), 'and the best rounds per course');
  // My bag: Destroyer fills in its numbers, and shows its best measured throw (328 ft, from part 19).
  await page.evaluate(() => LF.bag.list());
  await page.waitForSelector('#sheetBody [data-act=add]'); await page.click('#sheetBody [data-act=add]');
  await page.waitForFunction(() => /molds from the/.test(document.getElementById('d-fg').textContent), null, { timeout:20000 }).catch(() => {});
  await page.fill('#d-name', 'Destroyer'); await page.dispatchEvent('#d-name', 'change');
  check(await page.inputValue('#d-speed') === '12' && await page.inputValue('#d-fade') === '3' && /Innova/.test(await page.inputValue('#d-brand')), 'a Flight Guide disc fills in its flight numbers: ' + await page.inputValue('#d-brand'));
  await page.click('#sheetBody [data-act=save]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("My bag")');
  const bag = await page.textContent('#sheetBody');
  check(/Distance Drivers[\s\S]*Destroyer[\s\S]*12 · 5 · -1 · 3[\s\S]*328 ft/.test(bag), 'the bag lists it by type with flight numbers and its best throw');
  // (Open-Meteo stays answered from the fixture for the rest of the run: it rate-limits test machines.)

  // 24. Solo and team rounds, and stats with teammates and against opponents.
  const playRound = async (setup, scoreAct) => {
    await page.evaluate(() => LF.closeSheet());
    await tool('dgscore'); await page.waitForSelector('#r-course');
    await page.selectOption('#r-course', 'Disc Golf / Test Park');
    await setup();
    await page.click('#sheetBody [data-act=go]');
    await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 1")');
    for(let h = 0; h < 2; h++){
      if(scoreAct) await page.locator('#sheetBody .srow').first().locator(`[data-act=${scoreAct}]`).click();
      await page.click(h === 0 ? '#sheetBody [data-act=next]' : '#sheetBody [data-act=finish]');
      if(h === 0) await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 2")');
    }
    await page.waitForSelector('#sheetBody .sgrid', { timeout:10000 });
    return page.evaluate(() => LF.db.all('rounds').then(rs => rs.sort((a, b) => b.started - a.started)[0]));
  };
  const solo = await playRound(async () => { await page.check('input[name=r-format][value=solo]'); });
  check(solo.format === 'solo' && solo.sides.length === 1 && solo.me === 's1' && /Solo/.test(await page.textContent('#sheetHead')), 'a solo round is just me');
  const team = await playRound(async () => {
    await page.check('input[name=r-format][value=teams]');
    await page.fill('#r-mates', 'Ben');
    await page.fill('#r-add', 'Rivals'); await page.fill('#r-members', 'Sam, Jo'); await page.click('#sheetBody [data-act=add]');
  }, 'dec');
  check(team.format === 'teams' && team.sides[0].name === 'Tester & Ben' && JSON.stringify(team.sides[0].members) === '["Tester","Ben"]' && team.sides[1].name === 'Rivals',
    'a team round: my team is me and my teammate, then the other team');
  await page.evaluate(() => LF.rounds.myStats());
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("My stats")');
  const st2 = await page.textContent('#sheetBody');
  check(/Solo, head-to-head and team/.test(st2) && /With teammates\s*Teammate[\s\S]*Ben\s*1\s*[−+\-]?\d[\s\S]*1–0/.test(st2), 'My stats has a record with each teammate');
  check(/Against[\s\S]*Rivals\s*1\s*1–0/.test(st2) && /Against[\s\S]*Ben\s*\d+\s*0–1/.test(st2), 'and against each opponent');
  await page.evaluate(() => LF.sync.now());
  await page.evaluate(() => LF.leaderboard());
  await page.waitForSelector('#sheetBody [data-act=tab][data-t=teams]', { timeout:10000 }); await page.click('#sheetBody [data-act=tab][data-t=teams]');
  check(/Ben & Tester/.test(await page.textContent('#sheetBody')), 'the leaderboard ranks team pairings');

  // 25. Layouts: play part of a mapped course (from hole … to hole …), or any number of holes on an unmapped one.
  await page.evaluate(() => LF.closeSheet());
  await tool('dgscore'); await page.waitForSelector('#r-course');
  await page.selectOption('#r-course', 'Disc Golf / Test Park');
  await page.waitForSelector('#r-from');
  check(/2 holes/.test(await page.textContent('#r-laynote')), 'a mapped course offers its layout: ' + (await page.textContent('#r-laynote')).trim());
  await page.selectOption('#r-to', '0');
  await page.click('#sheetBody [data-act=go]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 1")');
  const lay = await page.evaluate(() => LF.db.all('rounds').then(rs => rs.sort((a, b) => b.started - a.started)[0]));
  check(lay.holes.length === 1 && lay.layout === '1–1' && /holes 1–1/.test(lay.name) && /hole 1 of 1/.test(await page.textContent('#sheetHead')), 'the round plays just that layout: ' + lay.name);
  await page.evaluate(() => LF.closeSheet());
  await tool('dgscore'); await page.waitForSelector('#r-course');
  await page.selectOption('#r-course', 'Disc Golf / Test Park');
  check(await page.inputValue('#r-to') === '0', 'the course remembers its last layout');
  await page.selectOption('#r-course', '');
  await page.fill('#r-name', 'Pine Bluff'); await page.click('#sheetBody [data-act=nholes][data-n="13"]');
  await page.click('#sheetBody [data-act=go]');
  await page.waitForSelector('#sheet:not([hidden]) h2:has-text("Hole 1")');
  check(/hole 1 of 13/.test(await page.textContent('#sheetHead')), 'an unmapped course can be 13 holes');

  // 26. Remove course (admins) takes a published course off the list for everyone.
  await page.evaluate(() => LF.closeSheet());
  await page.evaluate(id => LF.discgolf.openPublic(id), pubd.id);
  await page.waitForSelector('#sheetBody [data-act=unpublish]');
  page.once('dialog', d => d.accept());
  await page.click('#sheetBody [data-act=unpublish]');
  await page.waitForFunction(id => LF.api('GET', 'courses').then(r => !r.courses.some(c => c.id === id)), pubd.id, { timeout:10000 }).catch(() => {});
  check(await page.evaluate(id => LF.api('GET', 'courses').then(r => !r.courses.some(c => c.id === id)), pubd.id), 'Remove course takes it off the public list');

  // Outside map servers sometimes fail a request; that's the network, not the app (smoke.js filters the same).
  const real = errors.filter(e => !/net::ERR_|Failed to fetch|(carto|hydro)\.nationalmap\.gov/.test(e));
  check(real.length === 0, 'no script errors' + (real.length ? ':\n  ' + real.join('\n  ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
