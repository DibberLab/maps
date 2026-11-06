/* Line Fence: public disc golf courses, for admins (Menu > Admin > Disc golf courses).
   The list of published courses, Publish a course from my map (a folder of disc golf holes), and Add course from a
   layout picture (a screenshot of the course map):
     1. Name, pars and distances (typed in hole order), the picture. The map should already be at the course.
     2. Mark: the picture lies over the map; tap each hole's tee pad, any bends, then its basket. Points are kept in
        picture pixels, so they move with the picture.
     3. Line up: the picture is sized from the listed distances (median of listed ÷ marked), then dragged, pinched
        and turned (or nudged with buttons) until it matches the aerial underneath.
     4. Publish: POST /api/courses. The picture never leaves the phone; only the hole lines are published.
   The picture is placed by its centre C [lat,lng], mpp (metres per picture pixel) and rot (degrees clockwise). */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, geo, flash } = LF;
const DG = '#0f766e', M_LAT = 111320;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const nums = s => String(s || '').split(/[^\d.]+/).map(Number).filter(x => isFinite(x) && x > 0);

/* ---------- The list ---------- */
async function myCourses(){
  const m = new Map();
  (await LF.db.all('tracks')).filter(t => t.dg && t.folder && t.points && t.points.length > 1).forEach(t => { if(!m.has(t.folder)) m.set(t.folder, []); m.get(t.folder).push(t); });
  m.forEach(a => a.sort((x, y) => (+x.dg.hole || 999) - (+y.dg.hole || 999)));
  return m;
}
async function list(){
  const [pub, mine] = await Promise.all([LF.discgolf.pub(true), LF.db.ready().then(ok => ok ? myCourses() : new Map())]);
  LF.showSheet('<h2>Disc golf courses</h2><div class="small">Published courses show for everyone on the disc golf layer</div>',
    '<div class="btnrow acts"><button class="btn primary" data-act="add">Add course</button></div>' +
    (pub.length ? '<div class="block"><h3>Published</h3><div class="rows">' + pub.map(c => `<button class="row" data-act="open" data-id="${esc(c.id)}"><span><b>${esc(c.name)}</b>` +
      `<span class="small">${c.holes.length ? `${c.holes.length} holes · par ${c.holes.reduce((a, h) => a + h.par, 0)}` : 'Pin moved'} · updated ${new Date(c.updated * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric' })}</span></span></button>`).join('') + '</div></div>'
      : '<p class="note">No courses published yet.</p>') +
    (mine.size ? `<div class="block"><h3>Publish a course from my map</h3><p class="small">A folder of disc golf holes. Publishing one with the same name as a published course updates it.</p>
      <div class="row2"><select id="pub-folder">${Array.from(mine.keys()).sort().map(f => `<option value="${esc(f)}">${esc(geo.folderPath(f).pop())} · ${mine.get(f).length} holes</option>`).join('')}</select>
      <button class="btn" data-act="publish">Publish</button></div></div>` : ''),
    { onAct: async (act, el) => {
      if(act === 'add') addStart();
      if(act === 'open'){ layerOn(); LF.discgolf.openPublic(el.dataset.id); }
      if(act === 'publish'){
        const f = document.getElementById('pub-folder').value, ts = mine.get(f); if(!ts) return;
        const same = linked(pub, f, ts);
        if(same && !confirm(`Replace the published ${same.name} with the holes in “${f}”?`)) return;
        const id = await publish(folderCourse(f, ts, same), same && same.id);
        if(id) await link(ts, id);
      }
    } });
}
/* A folder of holes and the published course it is: the one its holes came from or were published as (fromCourse), or
   the published course with the same name nearby. */
function linked(pub, f, ts){
  const name = geo.folderPath(f).pop(), c = ts[0].points[0];
  return pub.find(p => p.id === ts[0].fromCourse) || pub.find(p => LF.discgolf.sameCourse({ name, c }, { name:p.name, c:p.c }));
}
const folderCourse = (f, ts, same) => Object.assign({ name:same ? same.name : geo.folderPath(f).pop() }, same ? { address:same.address, notes:same.notes, pin:same.pin || null } : {},
  { holes:ts.map((t, i) => { const n = String(t.dg.hole || i + 1), was = same && same.holes.find(h => String(h.n) === n);   // keep the listed distance
    return Object.assign({ n, par:+t.dg.par || 3, line:t.points.map(p => [+p[0].toFixed(7), +p[1].toFixed(7)]), anchors:t.dg.anchors || [] }, was && was.ft ? { ft:was.ft } : {}); }) });
async function link(ts, id){ for(const t of ts) if(t.fromCourse !== id) await LF.db.put('tracks', Object.assign({}, t, { fromCourse:id })); }

/* Your map is the course: when an admin changes a hole in a folder that's published (drags a tee, adds a hole), the
   public course follows a few seconds later. Only real changes are sent. */
const dirtyFolders = new Set(); let pubT = 0;
LF.listen('dbWrite', e => {
  if(e.store !== 'tracks') return;
  const u = LF.account && LF.account.user(); if(!u || u.role !== 'admin' || u.status !== 'approved') return;
  LF.db.get('tracks', e.id).then(t => { if(t && t.dg && t.folder) dirtyFolders.add(t.folder); else if(e.deleted) dirtyFolders.add('*'); });
  clearTimeout(pubT); pubT = setTimeout(autoPublish, 3000);
});
async function autoPublish(){
  const which = new Set(dirtyFolders); dirtyFolders.clear();
  const [pub, mine] = await Promise.all([LF.discgolf.pub(), myCourses()]);
  for(const [f, ts] of mine){
    if(!which.has(f) && !which.has('*')) continue;
    const same = linked(pub, f, ts); if(!same || !same.holes.length) continue;   // not published (pin-only entries don't count)
    const course = folderCourse(f, ts, same);
    const strip = hs => JSON.stringify(hs.map(h => [String(h.n), +h.par, h.line.map(p => [+(+p[0]).toFixed(6), +(+p[1]).toFixed(6)]), h.anchors || []]));
    if(strip(course.holes) === strip(same.holes)) continue;
    try{ await LF.api('POST', 'courses', { id:same.id, course }); await LF.discgolf.refresh(); flash(`Updated the public ${same.name}`, 2500); }
    catch(e){ flash(`Couldn't update the public ${same.name}: ${e.message}`, 5000); }
  }
}
const layerOn = () => { const b = document.getElementById('l-discgolf'); if(b && !b.checked){ b.checked = true; b.dispatchEvent(new Event('change')); } };
async function publish(course, id){
  try{
    const res = await LF.api('POST', 'courses', id ? { id, course } : { course });
    await LF.discgolf.refresh();
    flash(`Published ${course.name}`, 3000);
    layerOn(); LF.discgolf.openPublic(res.id);
    return res.id;
  }catch(e){ flash('Could not publish: ' + e.message, 5000); return null; }
}

/* ---------- Add course: 1. the details ---------- */
let A = null;   // { name, pars, fts, address, notes, url, w, h, C, mpp, rot, holes:[[[x,y]…]…], cur, step, opacity, movePic }
function addStart(){
  LF.showSheet('<h2>Add course</h2><div class="small">From a layout picture</div>',
    `<form class="edit" onsubmit="return false">
      <p class="note">First move the map to the course (search its address). The picture stays on this phone; only the hole lines are published.</p>
      <label>Course name<input id="a-name" maxlength="80" placeholder="Tjader Acres"></label>
      <div class="readbox"><label class="btn">Read pars &amp; distances from a screenshot<input type="file" id="a-table" accept="image/*" hidden></label>
        <p class="small" id="a-read">A screenshot of the hole list (UDisc's Layout maps table works). Claude reads it and fills in the boxes below; check them.</p></div>
      <label>Pars, in hole order<textarea id="a-pars" rows="2" placeholder="3 3 3 4 3 4 3 3 3"></textarea></label>
      <label>Distances in feet, in hole order (optional)<textarea id="a-fts" rows="2" placeholder="251 238 382 508 288 406 228 316 205"></textarea></label>
      <label>Address (optional)<input id="a-addr" maxlength="120"></label>
      <label>Notes (optional)<textarea id="a-notes" rows="2" maxlength="1000"></textarea></label>
      <label class="btn">Choose the layout picture<input type="file" id="a-pic" accept="image/*" hidden></label> <span class="small" id="a-picname"></span>
      <label class="check"><input type="checkbox" id="a-find" checked> Have Claude mark the tees and baskets on it (you check them)</label>
      <p class="small" id="a-count"></p>
      <div class="btnrow acts"><button type="button" class="btn primary" data-act="next">Next: mark the holes</button></div>
    </form>`,
    { back:{ label:'Disc golf courses', go:list }, onAct: async act => {
      if(act !== 'next') return;
      const $ = id => document.getElementById(id), file = $('a-pic').files[0];
      const name = $('a-name').value.trim(), pars = nums($('a-pars').value).map(Math.round), fts = nums($('a-fts').value).map(Math.round);
      if(!name) return flash('Give the course a name');
      if(!pars.length || pars.length > 54 || pars.some(p => p < 2 || p > 7)) return flash('Type each hole’s par (2 to 7), in hole order');
      if(fts.length && fts.length !== pars.length) return flash(`${pars.length} pars but ${fts.length} distances: they need to match`);
      if(!file) return flash('Choose the layout picture');
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => begin({ name, pars, fts, address:$('a-addr').value.trim(), notes:$('a-notes').value.trim(), url, w:img.naturalWidth, h:img.naturalHeight }, $('a-find').checked && file);
      img.onerror = () => flash('That picture could not be opened');
      img.src = url;
    } });
  const $ = id => document.getElementById(id);
  const count = () => { const p = nums($('a-pars').value).length, f = nums($('a-fts').value).length;
    $('a-count').textContent = p ? `${p} holes, par ${nums($('a-pars').value).reduce((a, b) => a + Math.round(b), 0)}` + (f ? `, ${f} distances` : '') : ''; };
  $('a-pars').addEventListener('input', count); $('a-fts').addEventListener('input', count);
  $('a-table').addEventListener('change', async () => {
    const f = $('a-table').files[0]; if(!f) return;
    const say = (t, bad) => { $('a-read').textContent = t; $('a-read').classList.toggle('bad', !!bad); };
    say('Reading the table… (up to half a minute)');
    try{
      const res = await LF.api('POST', 'courses/read', await shrink(f));
      $('a-pars').value = res.holes.map(h => h.par).join(' ');
      $('a-fts').value = res.holes.every(h => h.ft) ? res.holes.map(h => h.ft).join(' ') : '';
      count();
      const par = res.holes.reduce((a, h) => a + h.par, 0), fts = res.holes.filter(h => h.ft).length;
      say(`Read ${res.holes.length} holes, par ${par}${fts ? `, ${fts} distances` : ', no distances'}${res.layout ? ' (' + res.layout + ')' : ''}. Check them against the picture.`);
    }catch(e){ say(e.message || 'Could not read that picture.', true); }
    $('a-table').value = '';
  });
  $('a-pic').addEventListener('change', () => { $('a-picname').textContent = $('a-pic').files[0] ? $('a-pic').files[0].name : ''; });
}

/* A screenshot as a JPEG at most `max` (2000) px on its long side (plenty to read, and a small upload). */
function shrink(file, max){
  return new Promise((ok, bad) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, (max || 2000) / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok({ media_type:'image/jpeg', data:c.toDataURL('image/jpeg', 0.9).split(',')[1], width:c.width, height:c.height, k:c.width / img.naturalWidth });
    };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('That picture could not be opened')); };
    img.src = url;
  });
}

/* ---------- The picture on the map ---------- */
map.createPane('dgPicPane'); map.getPane('dgPicPane').style.zIndex = 420; map.getPane('dgPicPane').style.pointerEvents = 'none';
const ppm = () => 256 * Math.pow(2, map.getZoom()) / (40075016.686 * Math.cos(A.C[0] * Math.PI / 180));   // screen px per metre
const Pic = L.Layer.extend({
  onAdd(){ this._el = L.DomUtil.create('img', 'dgpic leaflet-zoom-animated', map.getPane('dgPicPane')); this._el.src = A.url; this._el.alt = ''; this.update(); },
  onRemove(){ this._el.remove(); },
  getEvents(){ return { zoom:this.update, viewreset:this.update, zoomanim:this._anim }; },
  update(){ if(A) this._place(map.latLngToLayerPoint(A.C), A.mpp * ppm()); },
  _anim(e){ if(A) this._place(map._latLngToNewLayerPoint(L.latLng(A.C), e.zoom, e.center), A.mpp * ppm() * map.getZoomScale(e.zoom)); },
  _place(p, k){ const s = this._el.style; s.width = A.w + 'px'; s.height = A.h + 'px'; s.opacity = A.opacity;
    s.transform = `translate(${p.x - A.w / 2}px,${p.y - A.h / 2}px) rotate(${A.rot}deg) scale(${k})`; }
});
let pic = null;
const marks = L.layerGroup();
/* Picture pixel <-> map, with the picture's centre, scale and turn. */
function toLL(pt){
  const t = A.rot * Math.PI / 180, dx = (pt[0] - A.w / 2) * A.mpp, dy = (pt[1] - A.h / 2) * A.mpp;
  const X = dx * Math.cos(t) - dy * Math.sin(t), Y = dx * Math.sin(t) + dy * Math.cos(t);
  return [A.C[0] - Y / M_LAT, A.C[1] + X / (M_LAT * Math.cos(A.C[0] * Math.PI / 180))];
}
function toPx(ll){
  const t = A.rot * Math.PI / 180, X = (ll[1] - A.C[1]) * M_LAT * Math.cos(A.C[0] * Math.PI / 180), Y = -(ll[0] - A.C[0]) * M_LAT;
  return [(X * Math.cos(t) + Y * Math.sin(t)) / A.mpp + A.w / 2, (-X * Math.sin(t) + Y * Math.cos(t)) / A.mpp + A.h / 2];
}
const pxLen = pts => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
function redraw(){
  if(!A) return;
  if(pic) pic.update();
  marks.clearLayers();
  A.holes.forEach((pts, i) => {
    if(!pts.length) return;
    const ll = pts.map(toLL), on = i === A.cur && A.step === 'mark';
    if(ll.length > 1){
      L.polyline(ll, { pane:'hiPane', color:'#fff', weight:on ? 7 : 5, opacity:.9, interactive:false }).addTo(marks);
      L.polyline(ll, { pane:'hiPane', color:on ? '#e8590c' : DG, weight:on ? 4 : 3, interactive:false }).addTo(marks);
      L.circleMarker(ll[ll.length - 1], { pane:'hiPane', radius:6, color:'#fff', weight:2, fillColor:'#ffe14d', fillOpacity:1, interactive:false }).addTo(marks);
    }
    L.marker(ll[0], { pane:'hiPane', interactive:false, keyboard:false, icon:L.divIcon({ className:'dg-tee', iconSize:[22, 16], iconAnchor:[11, 8], html:String(i + 1) }) }).addTo(marks);
  });
}
function begin(o, findFile){
  const sz = map.getSize();
  A = Object.assign(o, { C:[map.getCenter().lat, map.getCenter().lng], rot:0, holes:o.pars.map(() => []), cur:0, step:'mark', opacity:.85, movePic:false, auto:new Set() });
  A.mpp = 0.8 * Math.min(sz.x, sz.y) / Math.max(A.w, A.h) / ppm();   // fills most of the screen to start
  LF.closeSheet(); LF.mode = 'dgadd';
  pic = new Pic().addTo(map); marks.addTo(map);
  bar.hidden = false; redraw(); show();
  if(findFile) find(findFile);
}
/* Claude marks each hole on the picture (POST /api/courses/locate, in the picture's pixels; 1568 px is the size it
   sees pictures at, so its numbers line up). Holes it can't find stay empty for tapping. */
async function find(file){
  const mine = A; A.finding = true; show();
  try{
    const p = await shrink(file, 1568);
    const res = await LF.api('POST', 'courses/locate', { data:p.data, media_type:p.media_type, width:p.width, height:p.height, count:A.holes.length });
    if(A !== mine) return;
    let got = 0;
    const free = () => A.holes.findIndex(h => !h.length);
    res.holes.forEach(h => {
      let i = parseInt(h.n, 10) - 1;
      if(!(i >= 0 && i < A.holes.length) || A.holes[i].length) i = free();
      if(i < 0) return;
      A.holes[i] = h.points.map(q => [+(q[0] / p.k).toFixed(1), +(q[1] / p.k).toFixed(1)]); A.auto.add(i); got++;
    });
    A.cur = Math.max(0, A.holes.findIndex(h => !h.length));
    flash(`Claude marked ${got} of ${A.holes.length} holes. Check them; Redo any that are off.`, 5000);
  }catch(e){ if(A === mine) flash((e.message || 'Claude could not find the holes') + ' Tap them in instead.', 6000); }
  if(A === mine){ A.finding = false; redraw(); show(); }
}
function stop(){
  if(!A) return;
  movePicture(false);
  if(pic){ map.removeLayer(pic); pic = null; }
  marks.clearLayers(); map.removeLayer(marks);
  URL.revokeObjectURL(A.url); A = null; bar.hidden = true; LF.mode = null;
}

/* ---------- 2. Mark the holes ---------- */
map.on('click', e => {
  if(LF.mode !== 'dgadd' || !A || A.step !== 'mark') return;
  const p = toPx([e.latlng.lat, e.latlng.lng]);
  if(p[0] < 0 || p[1] < 0 || p[0] > A.w || p[1] > A.h){ flash('Tap on the picture'); return; }
  A.holes[A.cur].push([+p[0].toFixed(1), +p[1].toFixed(1)]); redraw(); show();
});
/* The size that makes the marked holes as long as the listed distances (the middle ratio, so a hole or two marked
   a bit off, or measured along a bend, doesn't skew it). */
function fitSize(){
  const r = A.holes.map((pts, i) => A.fts[i] && pts.length > 1 ? A.fts[i] * 0.3048 / pxLen(pts) : null).filter(Boolean).sort((a, b) => a - b);
  if(r.length) A.mpp = r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2;
}
const ftOf = pts => pxLen(pts) * A.mpp * 3.28084;

/* ---------- 3. Line it up: drag, pinch and turn the picture ---------- */
const box = map.getContainer(), ptrs = new Map();
let gest = null;
function movePicture(on){
  if(!A) return;
  A.movePic = on;
  ['dragging', 'touchZoom', 'doubleClickZoom', 'boxZoom'].forEach(h => map[h] && map[h][on ? 'disable' : 'enable']());
  ptrs.clear(); gest = null;
}
const cp = e => { const r = box.getBoundingClientRect(); return L.point(e.clientX - r.left, e.clientY - r.top); };
box.addEventListener('pointerdown', e => {
  if(!A || !A.movePic || e.target.closest('.leaflet-control')) return;
  ptrs.set(e.pointerId, cp(e)); gest = { C:A.C.slice(), mpp:A.mpp, rot:A.rot, start:new Map(ptrs) };
  e.preventDefault(); e.stopPropagation();
}, true);
box.addEventListener('pointermove', e => {
  if(!A || !A.movePic || !ptrs.has(e.pointerId) || !gest) return;
  ptrs.set(e.pointerId, cp(e)); e.preventDefault(); e.stopPropagation();
  const ids = Array.from(gest.start.keys()).filter(id => ptrs.has(id)).slice(0, 2);
  const c0 = map.latLngToContainerPoint(gest.C);
  if(ids.length === 1){
    const d = ptrs.get(ids[0]).subtract(gest.start.get(ids[0])), ll = map.containerPointToLatLng(c0.add(d));
    A.C = [ll.lat, ll.lng];
  } else {
    const a0 = gest.start.get(ids[0]), b0 = gest.start.get(ids[1]), a1 = ptrs.get(ids[0]), b1 = ptrs.get(ids[1]);
    const k = a1.distanceTo(b1) / Math.max(1, a0.distanceTo(b0));
    const dt = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
    const m0 = a0.add(b0).divideBy(2), m1 = a1.add(b1).divideBy(2), v = c0.subtract(m0);
    const c1 = L.point(m1.x + k * (v.x * Math.cos(dt) - v.y * Math.sin(dt)), m1.y + k * (v.x * Math.sin(dt) + v.y * Math.cos(dt)));
    const ll = map.containerPointToLatLng(c1);
    A.C = [ll.lat, ll.lng]; A.mpp = gest.mpp * k; A.rot = gest.rot + dt * 180 / Math.PI;
  }
  redraw(); throttledShow();
}, true);
const up = e => { if(!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
  gest = ptrs.size ? { C:A.C.slice(), mpp:A.mpp, rot:A.rot, start:new Map(ptrs) } : null; };
box.addEventListener('pointerup', up, true); box.addEventListener('pointercancel', up, true);
let showT = 0; const throttledShow = () => { if(Date.now() - showT > 150){ showT = Date.now(); show(); } };

/* ---------- The bar ---------- */
const bar = document.createElement('div'); bar.className = 'coursebar dgaddbar'; bar.hidden = true; document.body.appendChild(bar);
function show(){
  if(!A) return;
  const n = A.holes.length, pts = A.holes[A.cur], par = A.pars[A.cur], ft = A.fts[A.cur];
  if(A.finding){
    bar.innerHTML = `<div class="cb-head"><span><b>${esc(A.name)}</b></span><span class="small">Claude is finding the holes on the picture… (up to half a minute)</span></div>
      <div class="cb-btns"><button class="btn" data-a="cancel">Cancel</button></div>`;
    return;
  }
  if(A.step === 'mark'){
    const ready = A.holes.every(h => h.length > 1);
    const status = A.auto.has(A.cur) && pts.length > 1 ? 'Marked by Claude. If it’s off, tap Redo hole and tap the tee, bends and basket' : !pts.length ? 'Tap its tee pad on the picture' : pts.length === 1 ? 'Tap the basket (tap bends first if it bends)' : 'Basket = your last tap. Tap more to extend it';
    bar.innerHTML = `<div class="cb-head"><span><b>${esc(A.name)}</b> · Hole ${A.cur + 1} of ${n} · Par ${par}${ft ? ' · ' + ft + ' ft' : ''}</span><span class="small">${status}</span></div>
      <div class="cb-btns"><button class="btn primary" data-a="next"${pts.length > 1 ? '' : ' disabled'}>${A.cur < n - 1 ? `Hole ${A.cur + 2} ›` : 'Done: line it up'}</button>
        ${ready && A.cur < n - 1 ? '<button class="btn" data-a="done">All good: line it up</button>' : ''}
        <button class="btn" data-a="undo"${pts.length ? '' : ' disabled'}>Undo</button>${pts.length > 1 ? '<button class="btn" data-a="redo">Redo hole</button>' : ''}<button class="btn" data-a="prev"${A.cur ? '' : ' disabled'}>‹ Hole ${A.cur || ''}</button>
        <button class="btn" data-a="fade">See-through</button><button class="btn" data-a="cancel">Cancel</button></div>`;
  } else {
    const marked = A.holes.reduce((a, p) => a + ftOf(p), 0), listed = A.fts.reduce((a, b) => a + b, 0);
    bar.innerHTML = `<div class="cb-head"><span><b>Line the picture up with the aerial</b></span><span class="small">` +
      (listed ? `Holes ${Math.round(marked).toLocaleString('en-US')} ft · listed ${listed.toLocaleString('en-US')} ft (${marked >= listed ? '+' : '−'}${Math.abs(Math.round((marked / listed - 1) * 100))}%)` : `Holes ${Math.round(marked).toLocaleString('en-US')} ft`) +
      ` · ${A.movePic ? 'Drag to move, two fingers to turn and size' : 'Moving the map'}</span></div>
      <div class="cb-btns"><button class="btn primary" data-a="publish">Apply: publish the course</button>
        <button class="btn${A.movePic ? ' on' : ''}" data-a="mode">${A.movePic ? 'Moving picture ✓' : 'Move picture'}</button>
        <button class="btn" data-a="rotl" aria-label="Turn left">⟲</button><button class="btn" data-a="rotr" aria-label="Turn right">⟳</button>
        <button class="btn" data-a="smaller" aria-label="Smaller">−</button><button class="btn" data-a="bigger" aria-label="Bigger">+</button>
        ${listed ? '<button class="btn" data-a="fit">Size from distances</button>' : ''}
        <button class="btn" data-a="fade">See-through</button><button class="btn" data-a="back">‹ Holes</button><button class="btn" data-a="cancel">Cancel</button></div>`;
  }
}
bar.addEventListener('click', async e => {
  const b = e.target.closest('[data-a]'); if(!b || !A) return;
  const a = b.dataset.a, pts = A.holes[A.cur];
  if(a === 'cancel'){ if(confirm('Stop adding this course? Nothing is published.')) stop(); return; }
  if(a === 'undo') pts.pop();
  if(a === 'redo'){ A.holes[A.cur] = []; A.auto.delete(A.cur); }
  if(a === 'done') A.cur = A.holes.length - 1;   // then on as Next from the last hole
  if(a === 'prev') A.cur = Math.max(0, A.cur - 1);
  if(a === 'next' || a === 'done'){
    if(A.cur < A.holes.length - 1) A.cur++;
    else { const missing = A.holes.findIndex(p => p.length < 2); if(missing >= 0){ A.cur = missing; flash(`Hole ${missing + 1} isn't marked yet`); }
      else { fitSize(); A.step = 'align'; A.opacity = .45; movePicture(true); flash('Sized from the distances. Now drag and turn it to match the aerial, then Apply.', 4000); } }
  }
  if(a === 'fade') A.opacity = A.opacity > .7 ? .55 : A.opacity > .4 ? .3 : .9;
  if(a === 'mode') movePicture(!A.movePic);
  if(a === 'rotl' || a === 'rotr') A.rot += a === 'rotl' ? -0.5 : 0.5;
  if(a === 'smaller' || a === 'bigger') A.mpp *= a === 'bigger' ? 1.01 : 1 / 1.01;
  if(a === 'fit') fitSize();
  if(a === 'back'){ movePicture(false); A.step = 'mark'; A.opacity = .85; }
  if(a === 'publish'){
    b.disabled = true;
    const course = { name:A.name, address:A.address, notes:A.notes, holes:A.holes.map((p, i) => Object.assign({ n:String(i + 1), par:A.pars[i] }, A.fts[i] ? { ft:A.fts[i] } : {}, line(p.map(toLL)))) };
    const id = await publish(course, null);
    if(id) stop(); else b.disabled = false;
    return;
  }
  redraw(); show();
});
/* A hole as the app draws holes: about 11 points along it, the bends kept as anchors (so the hole editor bends there). */
function line(ll){
  const seg = ll.slice(1).map((p, i) => geo.dist(ll[i], p)), tot = seg.reduce((a, b) => a + b, 0) || 1;
  const out = [ll[0].map(v => +v.toFixed(7))], anchors = [];
  seg.forEach((len, i) => {
    const k = Math.max(2, Math.round(10 * len / tot));
    for(let j = 1; j <= k; j++){ const t = j / k; out.push([+(ll[i][0] + (ll[i + 1][0] - ll[i][0]) * t).toFixed(7), +(ll[i][1] + (ll[i + 1][1] - ll[i][1]) * t).toFixed(7)]); }
    if(i < seg.length - 1) anchors.push(out.length - 1);
  });
  return { line:out, anchors };
}

/* ---------- Edit a course on the map (admins): drag its pin, and for a published layout each hole's tee pad, bends
   and basket. The holes are rebuilt from those points (line()), so the bends stay bends. An OpenStreetMap course
   gets only its pin: saved as a pin-only course that the layer lays over the OSM one. ---------- */
let E = null;
const edits = L.layerGroup();
function editCourse(c){
  if(A || E) return;
  const layout = c.pub && !c.pinOnly && !LF.discgolf.isMine(c);   // in my map, the map's own holes are the course: pin only here
  E = { c, pin:c.c.slice(), holes:layout ? c.holes.map(h => ({ ref:h.ref, par:h.par, ft:h.ft,
    keys:[h.line[0]].concat((h.anchors || []).map(i => h.line[i]), [h.line[h.line.length - 1]]).map(p => [p[0], p[1]]) })) : [], changed:false };
  LF.closeSheet(); LF.mode = 'dgedit'; LF.discgolf.dim(true);
  const b = L.latLngBounds([E.pin]); E.holes.forEach(h => h.keys.forEach(k => b.extend(k)));   // the whole course in view
  if(E.holes.length) map.fitBounds(b, { padding:[40, 40], maxZoom:18, animate:false }); else map.setView(E.pin, Math.max(map.getZoom(), 17), { animate:false });
  edits.addTo(map); drawEdits(); showEdit();
}
const handle = (ll, html, cls, size, onMove) => L.marker(ll, { pane:'popupPane', draggable:true, keyboard:false, autoPan:true,
  icon:L.divIcon({ className:cls, iconSize:size, iconAnchor:[size[0] / 2, size[1] / 2], html }) })
  .on('drag', e => { const p = e.target.getLatLng(); onMove([+p.lat.toFixed(7), +p.lng.toFixed(7)]); E.changed = true; lines(); })
  .on('dragend', showEdit);
let lineLayers = [];
function lines(){
  lineLayers.forEach(l => l.setLatLngs(E.holes[l.i].keys));
}
function drawEdits(){
  edits.clearLayers(); lineLayers = [];
  E.holes.forEach((h, i) => {
    const l = L.polyline(h.keys, { pane:'hiPane', color:'#e8590c', weight:4, interactive:false }).addTo(edits); l.i = i; lineLayers.push(l);
    h.keys.forEach((k, j) => {
      const tee = j === 0, basket = j === h.keys.length - 1;
      handle(k, tee ? esc(h.ref) : '', tee ? 'dg-tee ce-tee' : basket ? 'ce-basket' : 'ce-bend', tee ? [26, 18] : basket ? [20, 20] : [14, 14],
        ll => { h.keys[j] = ll; }).addTo(edits);
    });
  });
  handle(E.pin, '<div class="dg-pin">' + PIN_SVG + '</div>', 'ce-pin', [34, 34], ll => { E.pin = ll; E.pinMoved = true; }).addTo(edits);
}
const PIN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18M6 6h12M7 6l1.5 6h7L17 6M8 12l1 3h6l1-3M8 21h8"/></svg>';
function showEdit(){
  if(!E) return;
  bar.hidden = false;
  bar.innerHTML = `<div class="cb-head"><span><b>Edit ${esc(E.c.name)}</b></span><span class="small">${E.holes.length ? 'Drag the course pin, tee pads (numbered), bends (white) and baskets (yellow)' : 'Drag the course pin to where it belongs (the parking lot or first tee)' + (E.c.pub && LF.discgolf.isMine(E.c) ? '. Its holes are in your map: edit them there and the public course follows.' : '')}</span></div>
    <div class="cb-btns"><button class="btn primary" data-e="save"${E.changed ? '' : ' disabled'}>Save</button><button class="btn" data-e="cancel">Cancel</button></div>`;
}
async function saveEdit(btn){
  btn.disabled = true;
  const p = (await LF.discgolf.pub()).find(x => x.id === E.c.pub);
  let course, id = E.c.pub || null;
  if(E.holes.length && p){
    course = { name:p.name, address:p.address, notes:p.notes, pin:E.pinMoved ? E.pin : p.pin || null,
      holes:E.holes.map(h => Object.assign({ n:String(h.ref), par:+h.par || 3 }, h.ft ? { ft:h.ft } : {}, line(h.keys))) };
  } else if(p && p.holes.length) course = { name:p.name, address:p.address, notes:p.notes, pin:E.pin, holes:p.holes };   // just the pin
  else course = { name:E.c.name, holes:[], pin:E.pin };
  try{
    const res = await LF.api('POST', 'courses', id ? { id, course } : { course });
    const name = E.c.name; stopEdit();
    await LF.discgolf.refresh(); flash('Saved ' + name, 3000);
    LF.discgolf.openPublic(res.id);
  }catch(e){ flash('Could not save: ' + e.message, 5000); btn.disabled = false; }
}
function stopEdit(){ if(!E) return; edits.clearLayers(); map.removeLayer(edits); LF.discgolf.dim(false); E = null; LF.mode = null; bar.hidden = true; }
bar.addEventListener('click', e => {
  const b = e.target.closest('[data-e]'); if(!b || !E) return;
  if(b.dataset.e === 'cancel' && (!E.changed || confirm('Throw away these changes?'))) stopEdit();
  if(b.dataset.e === 'save') saveEdit(b);
});

LF.dgadmin = { list, add:addStart, editCourse, autoPublish, editing:() => E && { holes:E.holes.map(h => h.keys.length), pin:E.pin.slice(), changed:E.changed }, state:() => A && { step:A.step, cur:A.cur, holes:A.holes.map(p => p.length), mpp:A.mpp, rot:A.rot, C:A.C.slice(), ft:A.holes.map(p => Math.round(ftOf(p))) } };
})(window.LF);
