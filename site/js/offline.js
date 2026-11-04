/* Line Fence: offline areas.
   Saving an area stores, for the box you framed on screen:
   - base map tiles (USGS only; the OSM tile policy forbids bulk downloads) in
     Cache Storage, one cache per area named lft-<id>; sw.js serves them first;
   - every parcel and public land record (with shapes) in LF.db 'areadata'.
   Inside a saved area, taps answer from the saved copy (LF.offline.lookup),
   and parcel lines and public land are drawn from it, so the map works with
   no signal. Area summaries live in LF.db 'areas'. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, db, geo, flash, SRC } = LF;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtMB = b => b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(b < 104857600 ? 1 : 0) + ' MB';
const MIN_Z = 10, MAX_TILES = 6000, TILE_KB = 22, PARCEL_KB = 0.15, CONCURRENCY = 4;
const BASES = { hyb:'Aerial + roads', img:'Aerial only', topo:'Topo' };
const cacheName = id => 'lft-' + id;

/* ---------- What gets saved ---------- */
const H = LF.lookup;
const inBox = (b, box) => !(b[1][0] < box[0][0] || b[0][0] > box[1][0] || b[1][1] < box[0][1] || b[0][1] > box[1][1]);
const SOURCES = [
  { key:'wi', url:SRC.wiParcels, fields:H.WI_FIELDS, box:H.WI_BOX, parcels:true },
  { key:'mn', url:SRC.mnParcels, fields:H.MN_FIELDS, box:H.MN_BOX, parcels:true },
  { key:'mncov', url:SRC.mnCoverage, fields:['objectid','countyname','gac_open_approval','viewer_url','data_url'], box:H.MN_BOX, offset:0.0005 },
  { key:'padus', url:SRC.padus, fields:['OBJECTID','Mang_Type','Mang_Name','Des_Tp','Unit_Nm','Pub_Access','SUM_GIS_Acres'], offset:0.0003 },
  { key:'widnr', url:SRC.wiDnr + '/9', layerName:'DNR Owned (property)', box:H.WI_BOX, offset:0.0001 },
  { key:'widnr', url:SRC.wiDnr + '/7', layerName:'DNR Easement (property)', box:H.WI_BOX, offset:0.0001 },
  { key:'widnr', url:SRC.wiDnr + '/8', layerName:'Leased Land (property)', box:H.WI_BOX, offset:0.0001 },
  { key:'wiclosed', url:SRC.wiClosed + '/0', layerName:'Closed and Restricted Areas', box:H.WI_BOX, offset:0.0001 },
  { key:'wimfl', url:SRC.wiMfl, fields:H.MFL_FIELDS, where:'AC_OP_PLS > 0', box:H.WI_BOX },
  { key:'mndnr', url:SRC.mnDnr + '/' + LF.MN_DNR_LAYER, layerName:'Dnr Management Units', box:H.MN_BOX, offset:0.0001 },
  { key:'mndnr', url:SRC.mnWia + '/0', layerName:'Walk In Access Sites', box:H.MN_BOX, offset:0.0001 }
];
const envelope = b => [b[0][1], b[0][0], b[1][1], b[1][0]].map(v => v.toFixed(6)).join(',');
function qs(o){ return Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&'); }
async function getJSON(url, signal){
  const res = await fetch(url, { signal, mode:'cors' });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if(j.error) throw new Error(j.error.message || 'service error');
  return j;
}
async function countIn(src, b, signal){
  const j = await getJSON(src.url + '/query?' + qs({ where:src.where || '1=1', geometry:envelope(b), geometryType:'esriGeometryEnvelope', inSR:4326,
    spatialRel:'esriSpatialRelIntersects', returnCountOnly:true, f:'json' }), signal);
  return j.count || 0;
}
/* All features in the box, page by page, as GeoJSON. */
async function fetchAll(src, b, signal, onPage){
  const out = [], page = 1000;
  for(let offset = 0; offset < 30000; offset += page){
    const j = await getJSON(src.url + '/query?' + qs(Object.assign({ where:src.where || '1=1', geometry:envelope(b), geometryType:'esriGeometryEnvelope', inSR:4326,
      spatialRel:'esriSpatialRelIntersects', outFields:(src.fields || ['*']).join(','), outSR:4326, geometryPrecision:6,
      resultOffset:offset, resultRecordCount:page, f:'json' }, src.offset ? { maxAllowableOffset:src.offset } : {})), signal);
    const fc = L.esri.Util.responseToFeatureCollection(j);
    fc.features.forEach(f => { if(src.layerName) f.properties._layer = src.layerName; out.push(f); });
    if(onPage) onPage(fc.features.length);
    if(!j.exceededTransferLimit && fc.features.length < page) break;
  }
  return out;
}

/* ---------- Tiles ---------- */
function tileList(b, bases, maxZ){
  const urls = [];
  for(const k of bases){
    const tpl = LF.bases[k]._url;
    for(let z = MIN_Z; z <= maxZ; z++){
      const nw = map.project([b[1][0], b[0][1]], z).divideBy(256).floor(), se = map.project([b[0][0], b[1][1]], z).divideBy(256).floor();
      for(let x = nw.x; x <= se.x; x++) for(let y = nw.y; y <= se.y; y++) urls.push(L.Util.template(tpl, { z, x, y }));
    }
  }
  return urls;
}
const tileCount = (b, bases, maxZ) => tileList(b, bases, maxZ).length;

/* ---------- Saving ---------- */
const chip = document.getElementById('offChip'), chipTxt = chip.querySelector('.txt');
let job = null;   // the download in progress

async function save(opts){
  if(job){ flash('An area is already downloading'); return; }
  if(!('caches' in window)){ flash('This browser cannot save maps for offline use.', 5000); return; }
  const id = opts.id || db.newId(), ctl = new AbortController();
  const tiles = tileList(opts.bounds, opts.bases, opts.maxZoom);
  const srcs = SOURCES.filter(s => !s.box || inBox(opts.bounds, s.box));
  job = { id, ctl, done:0, total:tiles.length + srcs.length, bytes:0 };
  chip.hidden = false; progress();
  db.persist();
  try{
    // Records first: small, and the part that matters most offline.
    const data = { id, wi:[], mn:[], mncov:[], padus:[], widnr:[], wiclosed:[], wimfl:[], mndnr:[] };
    let dataBytes = 0;
    for(const s of srcs){
      const feats = await fetchAll(s, opts.bounds, ctl.signal);
      data[s.key] = data[s.key].concat(feats);
      dataBytes += JSON.stringify(feats).length;
      job.done++; job.bytes = dataBytes; progress();
    }
    // Then tiles, a few at a time. A refresh replaces the old cache afterwards.
    const tmp = cacheName(id) + (opts.id ? '-new' : '');
    const cache = await caches.open(tmp);
    let next = 0, failed = 0, tileBytes = 0;
    const worker = async () => {
      while(next < tiles.length){
        const url = tiles[next++];
        for(let attempt = 0; attempt < 3; attempt++){
          try{
            const res = await fetch(url, { mode:'cors', signal:ctl.signal });
            if(!res.ok){ if(res.status === 404) break; throw new Error('HTTP ' + res.status); }
            const blob = await res.blob();
            await cache.put(url, new Response(blob, { headers:{ 'Content-Type':res.headers.get('Content-Type') || 'image/jpeg' } }));
            tileBytes += blob.size; break;
          }catch(e){ if(ctl.signal.aborted) throw e; if(attempt === 2) failed++; else await new Promise(r => setTimeout(r, 600 * (attempt + 1))); }
        }
        job.done++; job.bytes = dataBytes + tileBytes; progress();
      }
    };
    await Promise.all(Array.from({ length:CONCURRENCY }, worker));
    if(opts.id){   // refresh: swap the new tiles in
      await caches.delete(cacheName(id));
      const fresh = await caches.open(cacheName(id)), old = await caches.open(tmp);
      for(const req of await old.keys()) await fresh.put(req, await old.match(req));
      await caches.delete(tmp);
    }
    await db.put('areadata', data);
    const parcels = data.wi.length + data.mn.length;
    const area = await db.put('areas', { id, name:opts.name, bounds:opts.bounds, bases:opts.bases, maxZoom:opts.maxZoom,
      tiles:tiles.length - failed, tilesFailed:failed, bytes:dataBytes + tileBytes, parcels,
      publicLand:data.padus.length + data.widnr.length + data.mndnr.length, created:opts.created || Date.now() });
    loaded.delete(id);
    flash(`Saved “${area.name}” for offline: ${parcels.toLocaleString('en-US')} parcels, ${fmtMB(area.bytes)}` + (failed ? ` (${failed} map tiles missing)` : ''), 6000);
    drawAreas(); refreshLocal();
  }catch(e){
    if(!ctl.signal.aborted) flash('Saving the area failed: ' + (e.message || e) + '. Check your connection and try again.', 6000);
    else flash('Download cancelled', 2500);
    if(!opts.id){ await caches.delete(cacheName(id)); await db.del('areadata', id).catch(() => {}); }
    else await caches.delete(cacheName(id) + '-new');
  }finally{ job = null; chip.hidden = true; }
}
function progress(){
  if(!job) return;
  chipTxt.textContent = `Saving area… ${Math.floor(job.done / job.total * 100)}% · ${fmtMB(job.bytes)}`;
}
chip.querySelector('button').addEventListener('click', () => { if(job) job.ctl.abort(); });

async function remove(id){
  await caches.delete(cacheName(id));
  await db.del('areadata', id); await db.del('areas', id);
  loaded.delete(id); drawAreas(); refreshLocal();
}

/* ---------- The saved copy: lookups and drawing ---------- */
const loaded = new Map();   // area id -> areadata, loaded on demand
let areas = [];
async function loadAreas(){ areas = (await db.ready()) ? await db.all('areas') : []; return areas; }
const contains = (a, p) => p[0] >= a.bounds[0][0] && p[0] <= a.bounds[1][0] && p[1] >= a.bounds[0][1] && p[1] <= a.bounds[1][1];
async function dataFor(a){
  if(!loaded.has(a.id)) loaded.set(a.id, await db.get('areadata', a.id));
  return loaded.get(a.id);
}
async function lookup(ll){
  const p = [ll.lat, ll.lng];
  const a = areas.filter(x => contains(x, p)).sort((x, y) => (y.updated || 0) - (x.updated || 0))[0];
  if(!a) return null;
  const d = await dataFor(a); if(!d) return null;
  const hit = list => (list || []).filter(f => geo.pointIn(p, f.geometry));
  const asResult = f => ({ layerName:f.properties._layer, attributes:f.properties, geometry:f.geometry });
  const mfl = (d.wimfl || []).filter(f => f.geometry && geo.dist(p, [f.geometry.coordinates[1], f.geometry.coordinates[0]]) <= 300);
  const r = {
    wi:{ features:hit(d.wi) }, mn:{ features:hit(d.mn) }, mncov:{ features:hit(d.mncov) }, padus:{ features:hit(d.padus) },
    widnr:{ results:hit(d.widnr).map(asResult) }, wiclosed:{ results:hit(d.wiclosed).map(asResult) },
    wimfl: LF.on.wimfl ? H.mflResults({ features:mfl }) : null,
    mndnr:{ results:hit(d.mndnr).map(asResult) }
  };
  return { area:a, r };
}

/* Saved areas on the map: a dashed outline, and their parcel lines and public
   land drawn from the saved copy (so they show with no signal). */
map.createPane('offlinePane'); map.getPane('offlinePane').style.zIndex = 425;
const outlines = L.layerGroup().addTo(map);
const local = L.layerGroup().addTo(map);
const shown = new Map();   // area id -> layer group of its saved records
const building = new Set(); // areas being loaded, so overlapping map moves don't add them twice
function drawAreas(){
  loadAreas().then(() => {
    outlines.clearLayers();
    areas.forEach(a => L.rectangle(a.bounds, { pane:'offlinePane', color:'#ffffff', weight:1.5, dashArray:'6 6', fill:false, interactive:false, opacity:.8 }).addTo(outlines));
  });
}
async function refreshLocal(){
  const z = map.getZoom(), view = map.getBounds();
  for(const [id, g] of shown){ if(!areas.find(a => a.id === id)){ local.removeLayer(g); shown.delete(id); } }
  for(const a of areas){
    const near = view.intersects(L.latLngBounds(a.bounds)) && z >= 13;
    if(!near){ if(shown.has(a.id)){ local.removeLayer(shown.get(a.id)); shown.delete(a.id); } continue; }
    if(shown.has(a.id) || building.has(a.id)) continue;
    building.add(a.id);
    const d = await dataFor(a).finally(() => building.delete(a.id));
    if(!d || shown.has(a.id) || !areas.find(x => x.id === a.id)) continue;
    const css = LF.css, g = L.layerGroup();
    g.parcels = L.geoJSON(d.wi.concat(d.mn), { pane:'parcelPane', interactive:false, style:() => ({ color:css('--parcel'), weight:1.4, fill:false, opacity:.9 }) });
    g.publicLand = L.geoJSON(d.padus, { pane:'publicPane', interactive:false, style:f => { const ac = LF.ACCESS[f.properties.Pub_Access]; const c = ac && ac[2] ? css(ac[2]) : '#888';
      return { color:c, weight:1, fillColor:c, fillOpacity:ac && ac[2] ? 0.32 : 0.08 }; } });
    g.dnr = L.geoJSON(d.widnr.concat(d.mndnr), { pane:'publicPane', interactive:false, style:f => ({ color:/Walk|Management/.test(f.properties._layer) ? '#8a6bb8' : '#2f7d8c', weight:1.5, fillOpacity:.2 }) });
    shown.set(a.id, g); local.addLayer(g);
  }
  syncLocal();
}
/* Parcel lines are always drawn from the saved copy inside an area (they match the live
   ones exactly). Public land fills only when the phone reports no connection, so the
   live and saved fills don't stack. */
function syncLocal(){
  const offline = navigator.onLine === false;
  for(const g of shown.values()){
    const want = [[g.parcels, LF.on.parcels && map.getZoom() >= LF.PARCEL_ZOOM], [g.publicLand, LF.on.padus && offline], [g.dnr, (LF.on.widnr || LF.on.mndnr) && offline]];
    want.forEach(([l, on]) => { if(on && !g.hasLayer(l)) g.addLayer(l); if(!on && g.hasLayer(l)) g.removeLayer(l); });
  }
}
map.on('moveend', refreshLocal);
window.addEventListener('online', syncLocal); window.addEventListener('offline', syncLocal);
document.querySelectorAll('#layersPanel input[type=checkbox]').forEach(b => b.addEventListener('change', syncLocal));
drawAreas(); loadAreas().then(refreshLocal);

/* ---------- Sheets: save an area, list areas ---------- */
/* The part of the map you can actually see: above the sheet on a phone, right of it on a desktop. */
function visibleBounds(){
  const m = map.getContainer().getBoundingClientRect(), s = document.getElementById('sheet');
  let top = 64, left = 0, right = m.width, bottom = m.height;
  if(!s.hidden){ const r = s.getBoundingClientRect(); if(r.left <= 1 && r.width >= m.width - 2) bottom = Math.max(top + 80, r.top); else left = Math.min(right - 80, r.right); }
  const pad = 12, sw = map.containerPointToLatLng([left + pad, bottom - pad]), ne = map.containerPointToLatLng([right - pad, top + pad]);
  return [[+sw.lat.toFixed(6), +sw.lng.toFixed(6)], [+ne.lat.toFixed(6), +ne.lng.toFixed(6)]];
}
async function storageLine(){
  try{
    const e = await navigator.storage.estimate();
    return `This browser is using ${fmtMB(e.usage || 0)} of about ${fmtMB(e.quota || 0)} it allows Line Fence.`;
  }catch(err){ return ''; }
}

function saveSheet(){
  const startBase = ['hyb', 'img', 'topo'].includes(LF.getBase()) ? LF.getBase() : 'hyb';
  let box = null, est = null, countTimer = null, parcelsEst = null, ctl = null;
  const html = `<form class="edit" onsubmit="return false">
      <p class="small" style="margin-top:0">Move and zoom the map so the dashed box covers the area you'll need. Everything inside it is saved on this device.</p>
      <label>Name<input id="o-name" maxlength="60" placeholder="e.g. Deer camp, Crex north"></label>
      <div class="lbl">Map</div>
      ${Object.entries(BASES).map(([k, v]) => `<label class="opt"><input type="checkbox" data-act="o-est" name="o-base" value="${k}"${k === startBase ? ' checked' : ''}> ${v}</label>`).join('')}
      <div class="lbl">Detail</div>
      <label class="opt"><input type="radio" data-act="o-est" name="o-z" value="16" checked> Full (closest zoom)</label>
      <label class="opt"><input type="radio" data-act="o-est" name="o-z" value="15"> Lighter (about a quarter of the size)</label>
      <p id="o-est" class="estimate">Measuring…</p>
      <p class="small" id="o-store"></p>
      <div class="btnrow acts"><button type="button" class="btn primary" data-act="o-go">Download</button><button type="button" class="btn" data-act="o-cancel">Cancel</button></div>
      <p class="small">Street map (OpenStreetMap) can't be saved: its rules don't allow bulk downloads.</p>
    </form>`;
  const pick = () => ({ bases:Array.from(document.querySelectorAll('input[name=o-base]:checked')).map(i => i.value),
                        maxZoom:+(document.querySelector('input[name=o-z]:checked') || { value:16 }).value });
  const update = () => {
    const el = document.getElementById('o-est'); if(!el) return;
    const b = visibleBounds(), o = pick();
    if(box) box.setBounds(b); else box = L.rectangle(b, { pane:'hiPane', color:'#ffffff', weight:2, dashArray:'8 6', fillColor:'#ffffff', fillOpacity:.06, interactive:false }).addTo(map);
    const n = o.bases.length ? tileCount(b, o.bases, o.maxZoom) : 0;
    est = { bounds:b, tiles:n, ...o };
    const go = document.querySelector('[data-act=o-go]');
    const parcelsTxt = parcelsEst == null ? 'counting parcels…' : parcelsEst.toLocaleString('en-US') + ' parcels';
    const mb = n * TILE_KB * 1024 + (parcelsEst || 0) * PARCEL_KB * 1024;
    if(!o.bases.length) el.textContent = 'Pick at least one map.';
    else if(n > MAX_TILES) el.innerHTML = `<b>Too big:</b> ${n.toLocaleString('en-US')} map tiles. Zoom in or pick Lighter detail (limit ${MAX_TILES.toLocaleString('en-US')}).`;
    else el.textContent = `About ${fmtMB(mb)}: ${n.toLocaleString('en-US')} map tiles, ${parcelsTxt}.`;
    go.disabled = !o.bases.length || n > MAX_TILES;
    clearTimeout(countTimer);
    countTimer = setTimeout(async () => {
      if(ctl) ctl.abort(); ctl = new AbortController();
      try{
        const ps = SOURCES.filter(s => s.parcels && inBox(b, s.box));
        const counts = await Promise.all(ps.map(s => countIn(s, b, ctl.signal)));
        parcelsEst = counts.reduce((x, y) => x + y, 0);
      }catch(e){ if(e.name !== 'AbortError') parcelsEst = null; return; }
      const again = document.getElementById('o-est'); if(again) update();
    }, 500);
  };
  const onMove = () => { parcelsEst = null; update(); };
  LF.showSheet('<h2>Save area for offline</h2>', html, {
    onClose: () => { map.off('moveend', onMove); if(box){ box.remove(); box = null; } if(ctl) ctl.abort(); clearTimeout(countTimer); },
    onAct: (act) => {
      if(act === 'o-est') update();
      if(act === 'o-cancel') LF.closeSheet();
      if(act === 'o-go' && est && est.tiles <= MAX_TILES){
        const name = document.getElementById('o-name').value.trim() || 'Offline area ' + new Date().toLocaleDateString('en-US', { month:'short', day:'numeric' });
        const opts = { name, bounds:est.bounds, bases:est.bases, maxZoom:est.maxZoom };
        LF.closeSheet();
        save(opts);
      }
    } });
  map.on('moveend', onMove);
  setTimeout(update, 50);   // after the sheet has laid out
  storageLine().then(t => { const el = document.getElementById('o-store'); if(el) el.textContent = t; });
}

async function listSheet(){
  await loadAreas();
  const rows = areas.sort((a, b) => (b.updated || 0) - (a.updated || 0)).map(a => `<div class="area-row">
      <div><b>${esc(a.name)}</b><div class="small">Saved ${new Date(a.updated || a.created).toLocaleDateString('en-US')} · ${fmtMB(a.bytes || 0)} · ${(a.parcels || 0).toLocaleString('en-US')} parcels · ${a.bases.map(k => BASES[k] || k).join(', ')}${a.tilesFailed ? ` · ${a.tilesFailed} tiles missing` : ''}</div></div>
      <div class="btnrow"><button class="btn" data-act="o-show" data-id="${esc(a.id)}">Show</button><button class="btn" data-act="o-refresh" data-id="${esc(a.id)}">Update</button><button class="btn danger" data-act="o-del" data-id="${esc(a.id)}">Delete</button></div>
    </div>`).join('');
  const body = '<div class="btnrow acts"><button class="btn primary" data-act="o-new">Save a new area</button></div>' +
    (rows || '<p class="loading">No offline areas yet. Save one before you head out of cell range.</p>') +
    `<p class="small" id="o-store"></p><p class="note">Offline areas keep the map, parcel lines, owners and public land for that box. Address search and areas outside it need a connection. Update an area now and then to pick up new owner records.</p>`;
  LF.showSheet('<h2>Offline areas</h2>', body, { onAct: async (act, el) => {
    const a = areas.find(x => x.id === el.dataset.id);
    if(act === 'o-new') saveSheet();
    if(act === 'o-show' && a){ LF.closeSheet(); map.fitBounds(a.bounds); }
    if(act === 'o-refresh' && a){ LF.closeSheet(); save({ id:a.id, name:a.name, bounds:a.bounds, bases:a.bases, maxZoom:a.maxZoom, created:a.created }); }
    if(act === 'o-del' && a && confirm(`Delete the offline copy of “${a.name}”? (${fmtMB(a.bytes || 0)})`)){ await remove(a.id); listSheet(); flash('Offline area deleted'); }
  } });
  storageLine().then(t => { const el = document.getElementById('o-store'); if(el) el.textContent = t; });
}

LF.offline = { lookup, save:saveSheet, list:listSheet, areas:() => areas, busy:() => !!job };
})(window.LF);
