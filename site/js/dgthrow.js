/* Line Fence: disc golf, part 3 — measure a throw.
   + > Disc golf > Measure a throw. Mark the throw spot (GPS averaged while you stand still, up to 20 s or until
   tight; or the saved tee pad of a mapped hole you're standing at; or a tap on the map), walk to the disc (a live
   distance counts up), mark the landing the same way, and get the distance with an honest ± (both ends' errors
   combined). Save it with the disc and throw type, or start the next throw from where this one landed.
   Throws live in LF.db 'throws' (synced and backed up): { from:[lat,lng], to:[lat,lng], dist (m), acc (m), disc,
   kind, notes, at, hole?, course? }. The Throws list shows your best per disc; tapping one draws it on the map. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, db, geo, flash, prefs } = LF;
const DG = '#0f766e', AVG_MS = 20000, TIGHT_M = 1.5;
const KINDS = ['Backhand', 'Forehand', 'Roller', 'Overhand', 'Putt', 'Other'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ft = m => Math.round(m * 3.28084);

const bar = document.createElement('div'); bar.className = 'coursebar throwbar'; bar.hidden = true; document.body.appendChild(bar);
const layer = L.layerGroup().addTo(map);
let st = null, avg = null, offGps = null, teeChecked = 0;   // st: { from:{ll,acc,label}|null, to:{ll,acc}|null, live:[lat,lng]|null }

function start(from){
  st = { from:from || null, to:null, live:null };
  LF.mode = 'throw'; LF.gps.start('throw');
  if(!offGps) offGps = LF.listen('gps', fix => {
    if(!st || avg) return;
    if(st.from && !st.to){ st.live = fix.ll; show(); }
    else if(!st.from && Date.now() - teeChecked > 3000){ teeChecked = Date.now(); show(); }   // look again for a tee pad you're standing on
  });
  LF.closeSheet(); bar.hidden = false; show();
}
function stop(){
  stopAverage(); st = null; bar.hidden = true; layer.clearLayers();
  if(offGps){ offGps(); offGps = null; }
  LF.gps.stop('throw'); LF.mode = null;
}
/* A mapped tee pad within 12 m of where you are, so a throw from the tee can use its saved (averaged) spot. */
async function teeNearby(){
  const me = LF.gps.last && LF.gps.last.ll; if(!me) return null;
  let best = null;
  (await db.all('tracks')).filter(t => t.dg && t.points && t.points.length > 1).forEach(t => {
    const d = geo.dist(me, t.points[0]); if(d < 12 && (!best || d < best.d)) best = { d, t };
  });
  return best && best.t;
}
let nearTee = null;
async function show(){
  if(!st){ bar.hidden = true; return; }
  if(!st.from && !avg) nearTee = await teeNearby();
  draw();
  const est = avg && avg.fixes.length ? LF.gpsAverageOf(avg.fixes) : null;
  const status = avg ? `Hold still… ${avg.fixes.length} reading${avg.fixes.length === 1 ? '' : 's'}${est ? ' · ±' + ft(est.acc) + ' ft' : ''} · ${Math.max(0, Math.round((AVG_MS - (Date.now() - avg.started)) / 1000))} s`
    : !st.from ? 'Stand where you threw from, or tap the map'
    : !st.to ? (st.live ? `About ${ft(geo.dist(st.from.ll, st.live))} ft so far · walk to your disc` : 'Walk to your disc, or tap the map')
    : '';
  if(st.from && st.to){ result(); return; }
  bar.innerHTML = `<div class="cb-head"><span><b>Measure a throw</b>${st.from && st.from.label ? ' · from ' + esc(st.from.label) : ''}</span><span class="small">${status}</span></div>
    <div class="cb-btns">${avg ? `<button class="btn primary" data-t="avg-now"${avg.fixes.length ? '' : ' disabled'}>Use now</button><button class="btn" data-t="avg-cancel">Cancel</button>`
      : `<button class="btn primary" data-t="${st.from ? 'to' : 'from'}">${st.from ? 'Mark landing' : 'Mark throw spot'}</button>` +
        (!st.from && nearTee ? `<button class="btn" data-t="tee">From the tee pad of ${esc(nearTee.dg.hole ? 'hole ' + nearTee.dg.hole : nearTee.name)}</button>` : '') +
        (st.from ? '<button class="btn" data-t="restart">Start over</button>' : '') + '<button class="btn" data-t="close">Close</button>'}</div>`;
}
function draw(){
  layer.clearLayers(); if(!st || !st.from) return;
  L.circleMarker(st.from.ll, { pane:'hiPane', radius:7, color:'#fff', weight:3, fillColor:DG, fillOpacity:1, interactive:false }).addTo(layer);
  const end = st.to ? st.to.ll : st.live;
  if(end) L.polyline([st.from.ll, end], { pane:'hiPane', color:DG, weight:3, dashArray:st.to ? null : '6 6', interactive:false }).addTo(layer);
  if(st.to) L.circleMarker(st.to.ll, { pane:'hiPane', radius:7, color:'#fff', weight:3, fillColor:'#e8590c', fillOpacity:1, interactive:false }).addTo(layer);
}
/* Average raw GPS where you stand: up to 20 s, or sooner once 8+ readings agree to ±1.5 m. */
function averageFor(what){
  avg = { what, fixes:[], started:Date.now() };
  avg.off = LF.listen('gpsRaw', fx => { if(!avg) return; avg.fixes.push(fx);
    if(avg.fixes.length >= 8 && LF.gpsAverageOf(avg.fixes).acc <= TIGHT_M) finishAverage(); else show(); });
  avg.timer = setInterval(() => { if(avg && Date.now() - avg.started > AVG_MS && avg.fixes.length) finishAverage(); else show(); }, 1000);
  show();
}
function stopAverage(){ if(!avg) return; clearInterval(avg.timer); avg.off(); avg = null; }
function finishAverage(){
  if(!avg || !avg.fixes.length) return;
  const r = LF.gpsAverageOf(avg.fixes), what = avg.what; stopAverage();
  set(what, { ll:r.ll, acc:r.acc, n:r.n });
}
function set(what, end){ st[what] = end; if(what === 'from') st.live = null; show(); }

/* ---------- The result and saving ---------- */
function result(){
  const d = geo.dist(st.from.ll, st.to.ll), acc = Math.sqrt(st.from.acc * st.from.acc + st.to.acc * st.to.acc);
  const discs = prefs.get('dgDiscs', []);
  bar.innerHTML = `<div class="cb-head"><span class="throw-dist">${ft(d)} ft</span><span class="small">± ${Math.max(1, ft(acc))} ft${st.from.label ? ' · from ' + esc(st.from.label) : ''}</span></div>
    <div class="row2"><input id="t-disc" list="t-discs" maxlength="40" placeholder="Disc (e.g. Destroyer)" value="${esc(discs[0] || '')}"><datalist id="t-discs">${discs.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>
      <select id="t-kind">${KINDS.map(k => `<option${k === (prefs.get('dgKind', 'Backhand')) ? ' selected' : ''}>${k}</option>`).join('')}</select></div>
    <div class="cb-btns"><button class="btn primary" data-t="save">Save throw</button><button class="btn" data-t="next">Save &amp; throw again from here</button><button class="btn" data-t="discard">Discard</button></div>`;
  bar.dataset.d = d; bar.dataset.acc = acc;
}
async function saveThrow(){
  const disc = document.getElementById('t-disc').value.trim(), kind = document.getElementById('t-kind').value;
  const rec = { from:st.from.ll.map(v => +v.toFixed(7)), to:st.to.ll.map(v => +v.toFixed(7)), dist:+(+bar.dataset.d).toFixed(2), acc:+(+bar.dataset.acc).toFixed(2),
    disc, kind, at:Date.now(), name:`${ft(+bar.dataset.d)} ft${disc ? ' · ' + disc : ''}` };
  if(st.from.hole) Object.assign(rec, { hole:st.from.hole, course:st.from.course });
  if(disc) prefs.set('dgDiscs', [disc].concat(prefs.get('dgDiscs', []).filter(x => x !== disc)).slice(0, 20));
  prefs.set('dgKind', kind);
  await db.put('throws', rec); db.persist();
  flash(`Saved: ${rec.name}`, 3000);
  return rec;
}
bar.addEventListener('click', async e => {
  const t = (e.target.closest('[data-t]') || {}).dataset; if(!t || !t.t || !st) return;
  if(t.t === 'from' || t.t === 'to') averageFor(t.t);
  if(t.t === 'avg-now') finishAverage();
  if(t.t === 'avg-cancel'){ stopAverage(); show(); }
  if(t.t === 'tee' && nearTee){ const p = nearTee.points[0]; set('from', { ll:[p[0], p[1]], acc:1.5, label:nearTee.dg.hole ? 'hole ' + nearTee.dg.hole + ' tee' : 'the tee', hole:nearTee.dg.hole, course:nearTee.folder }); }
  if(t.t === 'restart'){ st.from = st.to = st.live = null; show(); }
  if(t.t === 'close') stop();
  if(t.t === 'discard'){ st.to = null; show(); }
  if(t.t === 'save'){ await saveThrow(); stop(); list(); }
  if(t.t === 'next'){ await saveThrow(); const landed = st.to; st.from = { ll:landed.ll, acc:landed.acc, label:'last landing' }; st.to = null; st.live = null; show(); }
});
/* Planning or correcting from the aerial: a tap marks the throw spot, then the landing (pin-point on close-up imagery). */
map.on('click', e => { if(LF.mode !== 'throw' || !st || avg || (st.from && st.to)) return;
  set(st.from ? 'to' : 'from', { ll:[e.latlng.lat, e.latlng.lng], acc:0.5, label:st.from ? undefined : 'a map tap' }); });

/* ---------- Throws list: best per disc, then everything ---------- */
async function list(){
  const all = (await db.all('throws')).sort((a, b) => b.dist - a.dist);
  const best = new Map(); all.forEach(t => { const k = t.disc || '(no disc)'; if(!best.has(k)) best.set(k, t); });
  const row = t => `<button class="row" data-act="show" data-id="${esc(t.id)}"><span><b>${ft(t.dist)} ft</b> <span class="small">± ${Math.max(1, ft(t.acc))} ft</span>` +
    `<span class="small">${esc([t.disc, t.kind, t.hole ? 'hole ' + t.hole + ' tee' : '', new Date(t.at).toLocaleDateString('en-US', { month:'short', day:'numeric' })].filter(Boolean).join(' · '))}</span></span></button>`;
  LF.showSheet('<h2>Throws</h2><div class="small">' + all.length + ' measured</div>',
    '<div class="btnrow acts"><button class="btn primary" data-act="new">Measure a throw</button></div>' +
    (best.size ? '<div class="block"><h3>Best per disc</h3><div class="rows">' + Array.from(best.values()).map(row).join('') + '</div></div>' : '<p class="note">No throws yet.</p>') +
    (all.length > best.size ? '<div class="block"><h3>All throws</h3><div class="rows">' + all.map(row).join('') + '</div></div>' : ''),
    { onAct: async (act, el) => {
      if(act === 'new') start();
      if(act === 'show'){ const t = await db.get('throws', el.dataset.id); if(t) showThrow(t); }
    } });
}
function showThrow(t){
  LF.showSheet(`<h2>${ft(t.dist)} ft</h2><div class="small">± ${Math.max(1, ft(t.acc))} ft · ${esc([t.disc, t.kind].filter(Boolean).join(' · '))}</div>`,
    `<div class="block"><dl><dt>Measured</dt><dd>${new Date(t.at).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' })}</dd>` +
    (t.hole ? `<dt>From</dt><dd>Hole ${esc(t.hole)} tee${t.course ? ' · ' + esc(LF.geo.folderPath(t.course).pop()) : ''}</dd>` : '') + `<dt>Distance</dt><dd>${geo.fmtDist(t.dist)}</dd></dl></div>
     <div class="btnrow acts"><button class="btn danger" data-act="del">Delete</button></div>`,
    { back:{ label:'Throws', go:list }, onAct: async act => { if(act === 'del' && confirm('Delete this throw?')){ await db.del('throws', t.id); list(); } } });
  map.fitBounds(L.latLngBounds([t.from, t.to]), { maxZoom:20, padding:[60, 60] });
  LF.select.shape([t.from, t.to], { color:DG, weight:4 }); LF.select.point(t.to, { color:'#e8590c' });
}

LF.throws = { start, list, stop };
})(window.LF);
