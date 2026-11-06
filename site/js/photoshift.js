/* Line Fence: line the aerial photo up with GPS (Menu > Line up the aerial photo).
   Aerial photos can sit a few metres off the ground truth. Stand on open ground at something you can see in the photo,
   the phone averages its GPS, you tap that thing on the photo, and the photos shift to match (arrows fine-tune by 1 ft).
   A shift is kept per area: { at:[lat,lng], e, n } (metres east / north), used within 30 km of `at`; pref 'photoShift',
   also saved with your account settings. It moves Leaflet's tilePane (base maps and close-up photos), never the data.
   Then "Move what you placed by eye" shifts the items in chosen folders (Disc Golf ticked) and, for admins, the public
   disc golf courses nearby, by the same change, so things drawn on the old photo still sit on the same spots. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, geo, flash, prefs } = LF;
const M_LAT = 111320, REACH = 30000, FT = 0.3048;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ft = m => Math.round(Math.abs(m) / FT);
const mLng = lat => M_LAT * Math.cos(lat * Math.PI / 180);
const move = (ll, e, n) => [+(ll[0] + n / M_LAT).toFixed(7), +(ll[1] + e / mLng(ll[0])).toFixed(7)];

/* ---------- The shift itself ---------- */
let shifts = (prefs.get('photoShift', []) || []).filter(s => s && s.at && isFinite(s.e) && isFinite(s.n));
const near = ll => shifts.map(s => ({ s, d:geo.dist(ll, s.at) })).filter(x => x.d < REACH).sort((a, b) => a.d - b.d).map(x => x.s)[0] || null;
const pane = map.getPane('tilePane');
function place(){
  const c = map.getCenter(), s = near([c.lat, c.lng]);
  if(!s){ pane.style.transform = ''; return; }
  const ppm = 256 * Math.pow(2, map.getZoom()) / (40075016.686 * Math.cos(c.lat * Math.PI / 180));   // screen px per metre
  pane.style.transform = `translate(${(s.e * ppm).toFixed(1)}px,${(-s.n * ppm).toFixed(1)}px)`;
}
map.on('zoom zoomend moveend viewreset resize', place);
function save(){ prefs.set('photoShift', shifts); place(); LF.emit('photoShift', shifts); }
function setAt(at, e, n){
  shifts = shifts.filter(s => geo.dist(s.at, at) >= REACH);   // one shift per area: this one replaces any nearby
  if(Math.hypot(e, n) > 0.05) shifts.push({ at:at.map(v => +v.toFixed(5)), e:+e.toFixed(2), n:+n.toFixed(2) });
  save();
}
place();

/* ---------- The bar ---------- */
const bar = document.createElement('div'); bar.className = 'coursebar photobar'; bar.hidden = true; document.body.appendChild(bar);
const you = L.layerGroup().addTo(map);
let S = null;   // { step:'stand'|'avg'|'tap'|'fine', fixes, gps, before:{e,n}, e, n, at }
function start(){
  LF.closeSheet && LF.closeSheet();
  const c = map.getCenter(), cur = near([c.lat, c.lng]);
  S = { step:'stand', before:cur ? { e:cur.e, n:cur.n } : { e:0, n:0 } };
  LF.mode = 'photo'; LF.gps.start('photo'); bar.hidden = false; show();
}
function stop(){ if(S && S.off) S.off(); clearInterval(S && S.timer); S = null; you.clearLayers(); bar.hidden = true; LF.mode = null; LF.gps.stop('photo'); }
function show(){
  if(!S) return;
  const nowE = S.e != null ? S.e : S.before.e, nowN = S.n != null ? S.n : S.before.n;
  const desc = (e, n) => Math.hypot(e, n) < 0.05 ? 'not moved' : [Math.abs(e) >= 0.05 ? ft(e) + ' ft ' + (e > 0 ? 'east' : 'west') : '', Math.abs(n) >= 0.05 ? ft(n) + ' ft ' + (n > 0 ? 'north' : 'south') : ''].filter(Boolean).join(', ');
  let head = '', btns = '';
  if(S.step === 'stand'){
    head = `<b>Line up the aerial photo</b><span class="small">Stand on open ground at something you can see in the photo (a driveway corner, a post, a pad). Then tap I'm here.${Math.hypot(S.before.e, S.before.n) > 0.05 ? ' Now: ' + desc(S.before.e, S.before.n) + '.' : ''}</span>`;
    btns = `<button class="btn primary" data-p="here">I'm here</button>${Math.hypot(S.before.e, S.before.n) > 0.05 ? '<button class="btn" data-p="reset">Undo the shift here</button>' : ''}<button class="btn" data-p="cancel">Cancel</button>`;
  } else if(S.step === 'avg'){
    const est = S.fixes.length ? LF.gpsAverageOf(S.fixes) : null;
    head = `<b>Hold still…</b><span class="small">${S.fixes.length} GPS reading${S.fixes.length === 1 ? '' : 's'}${est ? ' · ±' + ft(est.acc) + ' ft' : ''} · ${Math.max(0, 30 - Math.round((Date.now() - S.started) / 1000))} s</span>`;
    btns = `<button class="btn primary" data-p="use"${S.fixes.length ? '' : ' disabled'}>Use now</button><button class="btn" data-p="cancel">Cancel</button>`;
  } else if(S.step === 'tap'){
    head = `<b>Now tap where you're standing on the photo</b><span class="small">The blue ring is where GPS puts you (±${ft(S.gps.acc)} ft). Zoom in if it helps.</span>`;
    btns = `<button class="btn" data-p="again">Measure again</button><button class="btn" data-p="cancel">Cancel</button>`;
  } else {
    head = `<b>Photo moved ${desc(S.e, S.n)}</b><span class="small">Check it against the ring and a few things you know. Arrows move it 1 ft.</span>`;
    btns = `<button class="btn primary" data-p="done">Done</button>` +
      ['n', 's', 'w', 'e'].map(d => `<button class="btn" data-p="nudge" data-d="${d}" aria-label="Move the photo ${({ n:'north', s:'south', w:'west', e:'east' })[d]}">${({ n:'↑', s:'↓', w:'←', e:'→' })[d]}</button>`).join('') +
      `<button class="btn" data-p="cancel">Cancel</button>`;
  }
  bar.innerHTML = `<div class="cb-head">${head}</div><div class="cb-btns">${btns}</div>`;
}
function average(){
  S.step = 'avg'; S.fixes = []; S.started = Date.now();
  S.off = LF.listen('gpsRaw', fx => { if(!S || S.step !== 'avg') return; S.fixes.push(fx);
    if(S.fixes.length >= 10 && LF.gpsAverageOf(S.fixes).acc <= 1.5) use(); else show(); });
  S.timer = setInterval(() => { if(S && S.step === 'avg' && Date.now() - S.started > 30000 && S.fixes.length) use(); else show(); }, 1000);
  show();
}
function use(){
  if(!S || !S.fixes.length) return;
  clearInterval(S.timer); if(S.off){ S.off(); S.off = null; }
  const r = LF.gpsAverageOf(S.fixes);
  S.gps = { ll:r.ll, acc:r.acc }; S.at = r.ll; S.step = 'tap';
  you.clearLayers();
  L.circle(r.ll, { radius:Math.max(r.acc, 0.5), pane:'hiPane', color:'#2563eb', weight:2, fillOpacity:.12, interactive:false }).addTo(you);
  L.circleMarker(r.ll, { radius:6, pane:'hiPane', color:'#fff', weight:2, fillColor:'#2563eb', fillOpacity:1, interactive:false }).addTo(you);
  map.setView(r.ll, Math.max(map.getZoom(), 20));
  show();
}
/* The photo shows the spot at the tapped place; it truly is at the GPS spot: shift by the difference (on top of any shift
   already on, since the tap was on the shifted photo). */
map.on('click', e => {
  if(LF.mode !== 'photo' || !S || S.step !== 'tap') return;
  const t = [e.latlng.lat, e.latlng.lng], g = S.gps.ll;
  S.e = S.before.e + (g[1] - t[1]) * mLng(g[0]); S.n = S.before.n + (g[0] - t[0]) * M_LAT;
  S.step = 'fine'; setAt(S.at, S.e, S.n); show();
});
bar.addEventListener('click', e => {
  const b = e.target.closest('[data-p]'); if(!b || !S) return;
  const p = b.dataset.p;
  if(p === 'cancel'){ if(S.step === 'fine') setAt(S.at, S.before.e, S.before.n); stop(); return; }
  if(p === 'here') average();
  if(p === 'use') use();
  if(p === 'again'){ you.clearLayers(); average(); }
  if(p === 'reset'){ const c = map.getCenter(), at = [c.lat, c.lng], was = S.before; setAt(at, 0, 0); stop(); offerMove(at, -was.e, -was.n); return; }
  if(p === 'nudge'){ const d = b.dataset.d; if(d === 'n') S.n += FT; if(d === 's') S.n -= FT; if(d === 'e') S.e += FT; if(d === 'w') S.e -= FT; setAt(S.at, S.e, S.n); }
  if(p === 'done'){ const at = S.at, de = S.e - S.before.e, dn = S.n - S.before.n; stop(); flash('Photo lined up for this area', 2500); offerMove(at, de, dn); return; }
  show();
});

/* ---------- Move what was placed by eye ---------- */
async function offerMove(at, de, dn){
  if(Math.hypot(de, dn) < 0.05 || !(await LF.db.ready())) return;
  const stores = ['waypoints', 'drawings', 'tracks'];
  const all = [].concat(...await Promise.all(stores.map(s => LF.db.all(s).then(a => a.map(r => ({ store:s, r }))))));
  const first = i => i.store === 'waypoints' ? [i.r.lat, i.r.lng] : i.r.center || (i.r.points && i.r.points[0]);
  const close = all.filter(i => { const p = first(i); return p && geo.dist([p[0], p[1]], at) < REACH; });
  const tops = new Map(); close.forEach(i => { const t = geo.folderPath(i.r.folder)[0] || ''; tops.set(t, (tops.get(t) || 0) + 1); });
  const admin = (() => { const u = LF.account && LF.account.user(); return !!(u && u.role === 'admin' && u.status === 'approved'); })();
  const pubs = admin && LF.discgolf ? (await LF.discgolf.pub(true)).filter(c => geo.dist(c.c, at) < REACH) : [];
  if(!tops.size && !pubs.length) return;
  const dir = [Math.abs(de) >= 0.05 ? ft(de) + ' ft ' + (de > 0 ? 'east' : 'west') : '', Math.abs(dn) >= 0.05 ? ft(dn) + ' ft ' + (dn > 0 ? 'north' : 'south') : ''].filter(Boolean).join(' and ');
  LF.showSheet('<h2>Move what you placed by eye?</h2><div class="small">Things you put on the map by looking at the photo now sit ' + esc(dir) + ' off it</div>',
    `<form class="edit" onsubmit="return false"><p class="note">Move them ${esc(dir)} too, so they stay on the same spots in the photo. Leave out anything you placed with GPS.</p>
      ${Array.from(tops).sort((a, b) => a[0].localeCompare(b[0])).map(([t, n]) => `<label class="check"><input type="checkbox" data-top="${esc(t)}"${/^disc\s*golf$/i.test(t) ? ' checked' : ''}> ${esc(t || 'Not in a folder')} <span class="small">(${n})</span></label>`).join('')}
      ${pubs.length ? `<label class="check"><input type="checkbox" data-pub checked> Public disc golf courses here <span class="small">(${pubs.map(c => esc(c.name)).join(', ')})</span></label>` : ''}
      <div class="btnrow acts"><button type="button" class="btn primary" data-act="move">Move them</button><button type="button" class="btn" data-act="skip">Leave them</button></div></form>`,
    { onAct: async (act, b) => {
      if(act === 'skip') return LF.closeSheet();
      if(act !== 'move') return;
      b.disabled = true;
      const picked = new Set(Array.from(document.querySelectorAll('#sheetBody [data-top]:checked')).map(x => x.dataset.top));
      const doPubs = !!document.querySelector('#sheetBody [data-pub]:checked');
      let n = 0, failed = 0;
      // Public courses first, so the map's own copies (which republish themselves) already match them.
      if(doPubs) for(const c of pubs){
        const course = { name:c.name, address:c.address, notes:c.notes, pin:c.pin ? move(c.pin, de, dn) : null,
          holes:c.holes.map(h => Object.assign({}, h, { line:h.line.map(p => move(p, de, dn)) })) };
        if(!c.holes.length) course.pin = move(c.pin || c.c, de, dn);
        try{ await LF.api('POST', 'courses', { id:c.id, course }); n++; }catch(e){ failed++; }
      }
      for(const i of close){
        if(!picked.has(geo.folderPath(i.r.folder)[0] || '')) continue;
        const r = Object.assign({}, i.r);
        if(i.store === 'waypoints'){ const p = move([r.lat, r.lng], de, dn); r.lat = p[0]; r.lng = p[1]; }
        if(r.center) r.center = move(r.center, de, dn);
        if(r.points) r.points = r.points.map(p => move(p, de, dn).concat(p.slice(2)));
        await LF.db.put(i.store, r); n++;
      }
      if(doPubs && LF.discgolf) await LF.discgolf.refresh();
      LF.closeSheet();
      flash(`Moved ${n} thing${n === 1 ? '' : 's'}${failed ? ` (${failed} public course${failed === 1 ? '' : 's'} didn't update)` : ''}`, 4000);
    } });
}

LF.photoShift = { start, get:() => shifts.slice(), set:list => { shifts = (list || []).filter(s => s && s.at); prefs.set('photoShift', shifts); place(); }, offerMove };
})(window.LF);
