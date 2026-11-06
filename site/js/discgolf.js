/* Line Fence: disc golf courses (MN + WI) from OpenStreetMap.
   Data: data/discgolf.json, built monthly by tools/fetch_discgolf.py in GitHub
   Actions. Course pins from zoom 7; from zoom 15, the hole layout (hole lines,
   numbered tees, baskets) for courses on screen. Tapping a pin or hole opens
   the course: holes, par, lengths, fees, website, directions.
   © OpenStreetMap contributors, ODbL — credited on the map while shown. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, geo } = LF;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ft = m => Math.round(m / 0.3048).toLocaleString('en-US') + ' ft';
const PIN_ZOOM = 7, LAYOUT_ZOOM = 15, ATTR = 'Disc golf: © OpenStreetMap contributors';
const box = document.getElementById('l-discgolf'), note = document.getElementById('dgNote');
/* Off unless you turn it on. Saved only when you tap it ('discgolfOn'); the old 'discgolf' key was
   written for everyone on load, so it doesn't say what anyone chose and is ignored. */
let data = null, loading = null, on = LF.prefs.get('discgolfOn', false);

map.createPane('dgPane'); map.getPane('dgPane').style.zIndex = 445;
map.createPane('dgMarkers'); map.getPane('dgMarkers').style.zIndex = 455;
const renderer = L.canvas({ pane:'dgPane', tolerance:10 });
const pins = L.layerGroup(), layout = L.layerGroup(), hi = L.layerGroup().addTo(map);

const BASKET = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18M6 6h12M7 6l1.5 6h7L17 6M8 12l1 3h6l1-3M8 21h8"/></svg>';
const pinIcon = c => L.divIcon({ className:'dg-wrap', iconSize:[28, 28], iconAnchor:[14, 14],
  html:`<div class="dg-pin">${BASKET}</div><div class="dg-label">${esc(c.name)}</div>` });

function load(){
  if(data || loading) return loading;
  loading = Promise.all([fetch('data/discgolf.json').then(r => { if(!r.ok) throw new Error('missing'); return r.json(); }).catch(() => null), pub()])
    .then(([d, mine]) => {
      if(!(d && d.courses.length) && !mine.length) throw new Error('empty');   // placeholder until the first monthly build
      data = d && d.courses.length ? d : { courses:[], counts:{ courses:0, with_holes:0 } };
      base = data.courses.slice(); merge();
      note.textContent = d && d.courses.length ? `${d.counts.courses.toLocaleString('en-US')} courses, ${d.counts.with_holes} with hole layouts · OpenStreetMap, updated ${new Date(d.generated).toLocaleDateString('en-US')}` +
        (mine.length ? ` · ${mine.length} added by Line Fence` : '') : `${mine.length} courses added by Line Fence`;
      build(); })
    .catch(() => { note.textContent = 'Course list not available yet.'; loading = null; });
  return loading;
}

/* ---------- Courses added by Line Fence admins (GET /api/courses, public; plain fetch, as account.js loads later) ----------
   Each is { id, name, c, holes:[{ n, par, ft, line, anchors }], address, notes }. On the layer it replaces the
   OpenStreetMap entry with the same name nearby (keeping that entry's details), or is added as its own course. */
let pubList = null, pubLoading = null, base = null;
function pub(refresh){
  if(refresh){ pubList = null; pubLoading = null; }
  if(pubList) return Promise.resolve(pubList);
  return pubLoading || (pubLoading = fetch('/api/courses', { cache:'no-cache' }).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }).then(r => (pubList = r.courses || [])).catch(() => { pubLoading = null; return []; }));
}
const norm = n => String(n || '').toLowerCase().replace(/\b(disc golf|dgc|course|park|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function asCourse(p, osm){
  if(!p.holes.length) return Object.assign({}, osm, { c:p.c, pub:p.id, pinOnly:true });   // only the pin was moved
  const holes = p.holes.map(h => ({ ref:h.n, par:h.par, ft:h.ft, line:h.line, anchors:h.anchors, m:geo.length(h.line) }));
  const info = Object.assign({}, osm && osm.info, p.address ? { address:p.address } : {}, p.notes ? { description:p.notes } : {});
  return Object.assign({}, osm || {}, { name:p.name, c:p.c, n:holes.length, par:holes.reduce((a, h) => a + (+h.par || 0), 0), holes, info,
    pub:p.id, outline:null, tees:null, baskets:null, src:null });
}
/* One course, however it's named: "Tjiny Acres" = "Tjiny Acres (putter course)" = "Tjiny Acres Disc Golf Course",
   when they're within 3 km of each other. */
const key = n => norm(String(n || '').replace(/\(.*?\)/g, ' '));
function sameCourse(a, b){
  const x = key(a.name), y = key(b.name);
  return !!x && !!y && geo.dist(a.c, b.c) < 3000 && (x === y || x.startsWith(y + ' ') || y.startsWith(x + ' '));
}
function merge(){
  if(!data || !base) return;
  const out = base.slice();
  (pubList || []).slice().sort((a, b) => (a.updated || 0) - (b.updated || 0)).forEach(p => {
    const i = out.findIndex(c => sameCourse(c, p));
    if(i < 0){ if(p.holes.length) out.push(asCourse(p)); return; }
    const cur = out[i];
    if(!p.holes.length && cur.pub && !cur.pinOnly) out[i] = Object.assign({}, cur, { c:p.c });   // a pin moved on a published layout
    else out[i] = asCourse(p, cur);
  });
  data.courses = out;
}

/* Courses in the person's own map (a Disc Golf folder of holes): there the map's own holes are the course, so the
   layer shows only the pin, not a second set of hole lines. */
let mine = { ids:new Set(), keys:new Set() };
async function loadMine(){
  if(!(await LF.db.ready())) return;
  const ids = new Set(), keys = new Set();
  (await LF.db.all('tracks')).filter(t => t.dg && t.folder).forEach(t => { if(t.fromCourse) ids.add(t.fromCourse); keys.add(key(geo.folderPath(t.folder).pop())); });
  mine = { ids, keys }; view();
}
const isMine = c => (c.pub && mine.ids.has(c.pub)) || mine.keys.has(key(c.name));
let mineT = 0;
LF.listen('dbWrite', e => { if(e.store === 'tracks'){ clearTimeout(mineT); mineT = setTimeout(loadMine, 800); } });
setTimeout(loadMine, 1000);
/* After an admin adds, changes or removes a course. */
async function refresh(){ await pub(true); if(data){ merge(); build(); } }
function build(){
  pins.clearLayers();
  data.courses.forEach(c => L.marker(c.c, { pane:'dgMarkers', icon:pinIcon(c), title:c.name, keyboard:false })
    .on('click', e => { L.DomEvent.stopPropagation(e); if(!LF.mode) open(c); }).addTo(pins));
  view();
}
function show(v){
  on = v; box.checked = v;
  if(v){ load(); view(); map.attributionControl.addAttribution(ATTR); }
  else { map.removeLayer(pins); map.removeLayer(layout); hi.clearLayers(); map.attributionControl.removeAttribution(ATTR); }
}

/* Pins at mid zooms; the full layout close in. */
function view(){
  if(!on || !data) return;
  const z = map.getZoom();
  document.getElementById('map').classList.toggle('dg-labels', z >= 12);
  document.getElementById('map').classList.toggle('dg-small', z < 10);   // statewide views: small dots, not piles of pins
  if(z >= PIN_ZOOM){ if(!map.hasLayer(pins)) pins.addTo(map); } else map.removeLayer(pins);
  layout.clearLayers();
  if(z < LAYOUT_ZOOM){ map.removeLayer(layout); return; }
  const b = map.getBounds().pad(0.3);
  data.courses.filter(c => !isMine(c) && (b.contains(c.c) || (c.holes && c.holes.some(h => b.contains(h.line[0]))))).forEach(c => drawLayout(c, layout));
  layout.addTo(map);
}
function drawLayout(c, group){
  (c.outline || []).forEach(r => L.polygon(r, { pane:'dgPane', renderer, color:'#ffffff', weight:1.5, dashArray:'4 6', fill:false, interactive:false }).addTo(group));
  (c.holes || []).forEach(h => {
    L.polyline(h.line, { pane:'dgPane', renderer, color:'#0b3d2e', weight:6, opacity:.55 }).addTo(group);
    L.polyline(h.line, { pane:'dgPane', renderer, color:'#ffffff', weight:2.5, dashArray:'1 6', lineCap:'round' })
      .on('click', e => { L.DomEvent.stopPropagation(e); if(!LF.mode) open(c, h.ref); }).addTo(group);
    if(h.ref) L.marker(h.line[0], { pane:'dgMarkers', interactive:false, keyboard:false,
      icon:L.divIcon({ className:'dg-tee', iconSize:[22, 16], iconAnchor:[11, 8], html:String(h.ref) }) }).addTo(group);
  });
  const numbered = new Set((c.holes || []).map(h => h.line[0].join()));
  (c.tees || []).filter(t => !numbered.has(t.slice(0, 2).join())).forEach(t =>
    L.marker(t.slice(0, 2), { pane:'dgMarkers', interactive:false, keyboard:false,
      icon:L.divIcon({ className:'dg-tee', iconSize:[t[2] ? 22 : 12, t[2] ? 16 : 8], html:t[2] ? esc(t[2]) : '' }) }).addTo(group));
  (c.baskets || []).forEach(p => L.circleMarker(p.slice(0, 2), { pane:'dgPane', renderer, radius:5, color:'#1f2b24', weight:1.5,
    fillColor:p[2] && /^(red|blue|white|yellow|green|orange)$/i.test(p[2]) ? p[2] : '#ffe14d', fillOpacity:1, interactive:false }).addTo(group));
}

/* ---------- The course sheet ---------- */
const OSM_TYPE = { n:'node', w:'way', r:'relation' };
function open(c, holeRef){
  hi.clearLayers();
  const holes = c.holes || [], total = holes.reduce((s, h) => s + h.m, 0);
  const i = c.info || {};
  const web = i.website || i.url;
  const rows = [['Holes', c.n], ['Par', c.par], ['Total length', holes.length && holes.length === c.n ? ft(total) : null],
    ['Address', i.address], ['Operator', i.operator], ['Fee', i.charge || (i.fee === 'yes' ? 'Yes' : i.fee === 'no' ? 'Free' : i.fee)], ['Hours', i.opening_hours],
    ['Access', i.access && i.access !== 'yes' ? i.access : null], ['Dogs', i.dog], ['Surface', i.surface], ['Phone', i.phone]]
    .filter(r => r[1] != null && r[1] !== '');
  const table = holes.length ? `<div class="block"><h3>Holes${holes.length < (c.n || 0) ? ` (${holes.length} of ${c.n} mapped)` : ''}</h3>
      <table class="holes"><thead><tr><th>#</th><th>Par</th><th>Length</th></tr></thead><tbody>` +
      holes.map(h => `<tr data-act="hole" data-ref="${h.ref || ''}"${h.ref != null && h.ref === holeRef ? ' class="on"' : ''}><td>${h.ref || '–'}</td><td>${h.par || '–'}</td><td>${h.ft ? h.ft.toLocaleString('en-US') + ' ft' : ft(h.m)}</td></tr>`).join('') +
      `</tbody></table><p class="small">${c.pub ? 'Lengths as listed for the course.' : 'Lengths are measured along the mapped hole line, tee to basket.'}</p></div>`
    : '<p class="small">No hole layout mapped for this course yet.</p>';
  const body = '<div class="btnrow acts">' +
      `<button class="btn primary" data-act="zoom">Show course</button>` +
      `<button class="btn" data-act="route">Directions</button>` +
      (web ? `<a class="btn" href="${esc(/^https?:/i.test(web) ? web : 'https://' + web)}" target="_blank" rel="noopener">Website</a>` : '') +
      /* UDisc: a direct link when we know the course page, otherwise a web search of udisc.com. */
      (c.udisc || /udisc\.com/i.test(web || '') ? `<a class="btn" href="${esc(c.udisc || web)}" target="_blank" rel="noopener">UDisc</a>`
        : `<a class="btn" href="https://duckduckgo.com/?q=${encodeURIComponent('site:udisc.com/courses ' + c.name.replace(/^Disc golf at /, '') + (/disc golf/i.test(c.name) ? '' : ' disc golf'))}" target="_blank" rel="noopener">Find on UDisc</a>`) +
      (c.pub && !c.pinOnly ? '<button class="btn" data-act="copy">Add to my map</button>' : '') +
      '<button class="btn" data-act="save">Save waypoint</button>' +
      (isAdmin() ? '<button class="btn" data-act="edit">Edit course</button>' : '') +
      (c.pub && !c.pinOnly && isAdmin() ? '<button class="btn danger" data-act="unpublish">Remove course</button>' : '') +
      '</div>' + LF.shadeSwitch() +
    (rows.length ? '<div class="block"><dl>' + rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl></div>' : '') +
    (i.description ? `<div class="block"><p class="notes">${esc(i.description)}</p></div>` : '') + table +
    (c.pub && !c.pinOnly ? '<p class="note">Hole layout added by Line Fence. Add it to your map to score rounds on it or change the holes.</p>' :
    c.src ? `<p class="note">Course details from ${esc(c.src)}. The pin is ${esc(c.located || 'approximate')}. ` +
      `Know the course? <a href="https://www.openstreetmap.org/#map=17/${c.c[0]}/${c.c[1]}" target="_blank" rel="noopener">Map it on OpenStreetMap</a> and its holes and tees will show up here.</p>` :
    `<p class="note">Course data © OpenStreetMap contributors. Missing or wrong? ` +
    (c.id ? `<a href="https://www.openstreetmap.org/${OSM_TYPE[c.id[0]]}/${c.id.slice(1)}" target="_blank" rel="noopener">Fix it on OpenStreetMap</a>` : `<a href="https://www.openstreetmap.org/#map=17/${c.c[0]}/${c.c[1]}" target="_blank" rel="noopener">Add it to OpenStreetMap</a>`) +
    '; changes show up here within a month.</p>');
  LF.showSheet(`<h2>${esc(c.name)}</h2><div><span class="tag dg">Disc golf${c.n ? ' · ' + c.n + ' holes' : ''}</span></div><div class="small mono">${geo.fmtLL(c.c)}</div>`,
    body, { pin:c.c, onClose:() => hi.clearLayers(), onAct:(act, el) => {
      if(act === 'zoom') fit(bounds(c), 17);
      if(act === 'route') LF.route.to(c.name, c.c);
      if(act === 'save' && LF.account.require('waypoints')) LF.items.newWaypoint(c.c, { name:c.name });
      if(act === 'copy') copyToMine(c);
      if(act === 'edit') LF.dgadmin.editCourse(c);
      if(act === 'unpublish' && confirm(`Remove ${c.name} from the public course list? Copies people added to their maps stay.`))
        LF.api('DELETE', 'courses/' + c.pub).then(() => { LF.flash('Removed ' + c.name); LF.closeSheet(); refresh(); }).catch(e => LF.flash('Could not remove it: ' + e.message, 5000));
      if(act === 'hole'){ const h = holes.find(x => String(x.ref || '') === el.dataset.ref); if(h){ focus(h); el.parentNode.querySelectorAll('tr').forEach(r => r.classList.toggle('on', r === el)); } }
    } });
  // The selected course: its outline (or hole lines) bold and cased, and a pulsing ring at the pin.
  (c.outline || []).forEach(r => LF.select.shape(r, { color:'#0f766e', weight:3, closed:true, fill:.1 }));
  if(!(c.outline || []).length) holes.forEach(x => LF.select.shape(x.line, { color:'#0f766e', weight:2 }));
  LF.select.point(c.c, { color:'#0f766e' });
  const h = holeRef != null && holes.find(x => x.ref === holeRef);
  if(h) focus(h, true);
}
function focus(h, keepView){
  hi.clearLayers();
  L.polyline(h.line, { pane:'dgPane', renderer, color:'#e8590c', weight:5, interactive:false }).addTo(hi);
  if(!keepView) fit(L.latLngBounds(h.line), 18);
}
const fit = (b, z) => LF.fitVisible(b, z);
const isAdmin = () => { const u = LF.account && LF.account.user(); return !!(u && u.role === 'admin' && u.status === 'approved'); };
/* While an admin edits a course, the layer fades so the points being dragged stand out. */
function dim(on){ ['dgPane', 'dgMarkers'].forEach(p => { map.getPane(p).style.opacity = on ? .25 : ''; }); }
/* A public course into my own map: a folder "Disc Golf / <name>" of disc golf holes (ids pc-<course>-<hole>, so doing
   it again updates them instead of adding copies). Then rounds, throws and the hole editor all work on it. */
async function copyToMine(c){
  if(!LF.account.require('disc golf courses')) return;
  const folder = LF.items.dgFolder(c.name);
  for(const h of c.holes){
    const id = 'pc-' + c.pub + '-' + String(h.ref).replace(/[^\w-]/g, '');
    const cur = await LF.db.get('tracks', id);
    await LF.db.put('tracks', Object.assign(cur || { created:Date.now() }, { id, name:'Hole ' + h.ref, folder, color:'#0f766e', points:h.line.map(p => [p[0], p[1]]),
      dg:{ hole:String(h.ref), par:String(h.par || 3), fairway:(cur && cur.dg && cur.dg.fairway) || 0, anchors:h.anchors || [] }, fromCourse:c.pub }));
  }
  LF.db.persist();
  LF.flash(`Added ${c.holes.length} holes to “${folder}”`, 4000);
  LF.items.list({ folder });
}
function bounds(c){
  const b = L.latLngBounds([c.c]);
  (c.outline || []).forEach(r => r.forEach(p => b.extend(p)));
  (c.holes || []).forEach(h => h.line.forEach(p => b.extend(p)));
  return b;
}

/* Search box: course names match before the address search. */
function find(q){
  if(!data) return null;
  const s = q.toLowerCase().replace(/\s+/g, ' ').trim();
  if(s.length < 3) return null;
  const hits = data.courses.filter(c => c.name.toLowerCase().includes(s) || c.name.toLowerCase().replace(/ disc golf course$/, '').includes(s));
  return hits.length ? hits.sort((a, b) => a.name.length - b.name.length)[0] : null;
}

box.addEventListener('change', () => { LF.prefs.set('discgolfOn', box.checked); show(box.checked); });
map.on('moveend zoomend', view);
show(on);
LF.discgolf = { dim, sameCourse, key, isMine:c => isMine(c), find:q => { const c = find(q); if(c){ open(c); fit(bounds(c), 16); } return !!c; }, open, data:() => data, load, pub, refresh,
  openPublic:async id => { await pub(); const p = (pubList || []).find(x => x.id === id); if(!p) return;
    const c = (data && data.courses.find(x => x.pub === id)) || asCourse(p); open(c); fit(bounds(c), 17); } };
})(window.LF);
