/* Line Fence: disc golf, part 1 — map a course.
   + > Disc golf > Map a course. Name the course (saved as a folder). A bar at the bottom walks each hole:
   Tee pad here (GPS averaged for a few seconds) → the fairway records as you walk → Basket here (averaged) saves the
   hole as a disc golf hole track (tee pad, fairway, basket, hole #, par) and gets ready for the next tee.
   While mapping, a tap on the map places the tee or basket there instead (planning from the aerial), with a straight
   fairway when nothing was walked. An unfinished course comes back after a reload (pref 'dgCourse'). */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, db, geo, flash, prefs } = LF;
const DG = '#0f766e', AVG_MS = 12000;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ft = m => Math.round(m * 3.28084);

const bar = document.createElement('div'); bar.className = 'coursebar'; bar.hidden = true; document.body.appendChild(bar);
const preview = L.layerGroup().addTo(map);
let st = prefs.get('dgCourse', null);   // { name, folder, hole, par, tee:[lat,lng]|null, pts:[[lat,lng,alt,t]] }
let avg = null, offGps = null;
const save = () => prefs.set('dgCourse', st);

/* ---------- Starting ---------- */
async function courseFolders(){
  const trs = await db.all('tracks'), m = new Map();
  trs.filter(t => t.dg && t.folder).forEach(t => { const n = +t.dg.hole || 0; m.set(t.folder, Math.max(m.get(t.folder) || 0, n)); });
  return m;   // folder -> highest hole number in it
}
async function start(){
  if(st){ resume(); return; }
  const known = await courseFolders();
  const opts = Array.from(known.keys()).sort().map(f => `<option value="${esc(f)}"></option>`).join('');
  LF.showSheet('<h2>Map a course</h2><div class="small">Saved as a folder of holes</div>',
    `<form class="edit" onsubmit="return false">
      <label>Course name<input id="c-name" maxlength="60" placeholder="e.g. Fish Lake" autocomplete="off"></label>
      <label>Folder<input id="c-folder" list="c-known" maxlength="80" value="Disc golf / "><datalist id="c-known">${opts}</datalist></label>
      <div class="row2"><label>First hole #<input id="c-hole" inputmode="numeric" value="1"></label>
        <label>Par<select id="c-par">${[2, 3, 4, 5].map(v => `<option${v === 3 ? ' selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <p class="note">Walk to the first tee, tap <b>Tee pad here</b>, walk the fairway, tap <b>Basket here</b> at the basket. Or tap the map to place
        tees and baskets from the aerial. Picking an existing course folder carries on from its next hole.</p>
      <div class="btnrow acts"><button type="button" class="btn primary" data-act="go">Start mapping</button><button type="button" class="btn" data-act="cancel">Cancel</button></div>
    </form>`,
    { onAct:(act) => {
      const $ = id => document.getElementById(id);
      if(act === 'cancel') LF.closeSheet();
      if(act === 'go'){
        const name = $('c-name').value.trim(), folder = LF.items.cleanFolder($('c-folder').value) || ('Disc golf / ' + (name || 'Course'));
        if(!name && !known.has(folder)){ flash('Name the course first'); return; }
        st = { name:name || LF.geo.folderPath(folder).pop(), folder, hole:Math.max(1, parseInt($('c-hole').value, 10) || 1), par:+$('c-par').value, tee:null, pts:[] };
        save(); LF.closeSheet(); resume();
        flash('Walk to the tee for hole ' + st.hole + ', or tap the map', 4000);
      }
    } });
  const name = document.getElementById('c-name'), folder = document.getElementById('c-folder'), hole = document.getElementById('c-hole');
  let folderTouched = false;
  name.addEventListener('input', () => { if(!folderTouched) folder.value = 'Disc golf / ' + name.value.trim(); });
  folder.addEventListener('input', () => { folderTouched = true; const f = LF.items.cleanFolder(folder.value); if(known.has(f)) hole.value = known.get(f) + 1; });
  setTimeout(() => name.focus(), 50);
}

/* ---------- Mapping ---------- */
function resume(){
  if(!st) return;
  LF.mode = 'course';
  LF.gps.start('course');
  if(!offGps) offGps = LF.listen('gps', onFix);
  bar.hidden = false; drawPreview(); show();
}
function onFix(fix){
  if(!st || !st.tee || avg || fix.acc > 30) return;
  const last = st.pts.length ? st.pts[st.pts.length - 1] : st.tee;
  if(geo.dist(last, fix.ll) < Math.max(3, fix.acc / 3)) return;
  st.pts.push([+fix.ll[0].toFixed(7), +fix.ll[1].toFixed(7), fix.alt != null ? +fix.alt.toFixed(1) : null, fix.t]);
  save(); drawPreview(); show();
}
function drawPreview(){
  preview.clearLayers(); if(!st || !st.tee) return;
  const ll = [st.tee].concat(st.pts).map(p => [p[0], p[1]]);
  if(ll.length > 1) L.polyline(ll, { pane:'hiPane', color:DG, weight:4, dashArray:'6 6', interactive:false }).addTo(preview);
  L.circleMarker(ll[0], { pane:'hiPane', radius:8, color:'#fff', weight:3, fillColor:DG, fillOpacity:1, interactive:false }).addTo(preview);
}
function show(){
  if(!st){ bar.hidden = true; return; }
  const walked = st.tee ? geo.length([st.tee].concat(st.pts)) : 0;
  const status = avg ? `Hold still… ${avg.fixes.length} reading${avg.fixes.length === 1 ? '' : 's'}${avg.fixes.length ? ' · ±' + ft(LF.gpsAverageOf(avg.fixes).acc) + ' ft' : ''}`
    : st.tee ? `Fairway ${ft(walked)} ft · walk to the basket` : 'Go to the tee, or tap the map';
  bar.innerHTML = `<div class="cb-head"><span><b>${esc(st.name)}</b> · Hole ${st.hole} · Par ${st.par}</span><span class="small">${status}</span></div>
    <div class="cb-btns">
      ${avg ? '<button class="btn primary" data-c="avg-now"' + (avg.fixes.length ? '' : ' disabled') + '>Use now</button><button class="btn" data-c="avg-cancel">Cancel</button>'
        : `<button class="btn primary" data-c="${st.tee ? 'basket' : 'tee'}">${st.tee ? 'Basket here' : 'Tee pad here'}</button>
           <button class="btn" data-c="par-">Par −</button><button class="btn" data-c="par+">Par +</button>
           <button class="btn" data-c="undo">${st.tee ? 'Redo hole' : 'Undo last'}</button><button class="btn" data-c="done">Done</button>`}
    </div>`;
}
/* Average raw GPS readings at a spot (tee or basket): stops itself after AVG_MS or once tight, or on Use now. */
function averageFor(what){
  avg = { what, fixes:[], started:Date.now() };
  avg.off = LF.listen('gpsRaw', fx => { if(avg){ avg.fixes.push(fx); if(avg.fixes.length >= 5 && LF.gpsAverageOf(avg.fixes).acc <= 2) finishAverage(); else show(); } });
  avg.timer = setInterval(() => { if(avg && Date.now() - avg.started > AVG_MS && avg.fixes.length) finishAverage(); else show(); }, 1000);
  show();
}
function stopAverage(){ if(!avg) return; clearInterval(avg.timer); avg.off(); avg = null; show(); }
function finishAverage(){
  if(!avg || !avg.fixes.length) return;
  const r = LF.gpsAverageOf(avg.fixes), what = avg.what; stopAverage();
  if(what === 'tee') setTee(r.ll); else setBasket(r.ll);
}
function setTee(ll){
  st.tee = [+ll[0].toFixed(7), +ll[1].toFixed(7), null, Date.now()]; st.pts = [];
  save(); drawPreview(); show(); flash('Tee pad set for hole ' + st.hole + '. Walk the fairway to the basket.', 3000);
}
async function setBasket(ll){
  const basket = [+ll[0].toFixed(7), +ll[1].toFixed(7), null, Date.now()];
  let pts = [st.tee].concat(st.pts).concat([basket]);
  if(pts.length < 4){   // nothing walked: a straight fairway, with points along it so the hole can be bent later
    const a = st.tee, b = basket; pts = [];
    for(let i = 0; i <= 10; i++) pts.push([+(a[0] + (b[0] - a[0]) * i / 10).toFixed(7), +(a[1] + (b[1] - a[1]) * i / 10).toFixed(7), null, a[3] + (b[3] - a[3]) * i / 10]);
  } else if(LF.trackTidy) pts = LF.trackTidy(pts);
  const n = st.hole, rec = { name:'Hole ' + n, folder:st.folder, color:DG, points:pts, started:st.tee[3], ended:basket[3], pausedMs:0,
    dg:{ hole:String(n), par:String(st.par), fairway:0, anchors:[] } };
  await db.put('tracks', rec); db.persist();
  flash(`Hole ${n} saved · ${ft(geo.length(pts))} ft. Next: hole ${n + 1}.`, 3500);
  st.hole = n + 1; st.par = 3; st.tee = null; st.pts = []; save(); drawPreview(); show();
}
async function undo(){
  if(st.tee){ st.tee = null; st.pts = []; save(); drawPreview(); show(); flash('Hole ' + st.hole + ' cleared; set its tee again'); return; }
  const prev = (await db.all('tracks')).find(t => t.dg && t.folder === st.folder && +t.dg.hole === st.hole - 1);
  if(prev && confirm(`Delete hole ${st.hole - 1} and map it again?`)){ await db.del('tracks', prev.id); st.hole -= 1; save(); show(); }
}
function done(){
  const folder = st.folder;
  stopAverage(); preview.clearLayers(); bar.hidden = true;
  if(offGps){ offGps(); offGps = null; }
  LF.gps.stop('course'); LF.mode = null; st = null; prefs.set('dgCourse', null);
  LF.items.list({ folder });
}
bar.addEventListener('click', e => {
  const c = (e.target.closest('[data-c]') || {}).dataset; if(!c || !c.c || !st) return;
  if(c.c === 'tee' || c.c === 'basket') averageFor(c.c);
  if(c.c === 'avg-now') finishAverage();
  if(c.c === 'avg-cancel') stopAverage();
  if(c.c === 'par-'){ st.par = Math.max(2, st.par - 1); save(); show(); }
  if(c.c === 'par+'){ st.par = Math.min(7, st.par + 1); save(); show(); }
  if(c.c === 'undo') undo();
  if(c.c === 'done') done();
});
/* Planning from the aerial: a tap places the tee, then the basket. */
map.on('click', e => { if(LF.mode !== 'course' || !st || avg) return; const ll = [e.latlng.lat, e.latlng.lng]; st.tee ? setBasket(ll) : setTee(ll); });

LF.course = { start, active:() => !!st };
if(st) setTimeout(resume, 500);   // an unfinished course comes back after a reload
})(window.LF);
