/* Line Fence: saved waypoints, drawings and tracks.
   Draws them on the map, shows and edits them in the sheet, lists them,
   guides you to one ("Go to"), and moves them in and out as GPX/KML.
   Records live in LF.db: waypoints {name, icon, color, lat, lng, notes, photos[]},
   drawings {kind:'line'|'area'|'circle', name, color, notes, points | center+radius},
   tracks {name, color, notes, points[[lat,lng,alt,t]], started, ended, pausedMs, recording}. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, db, geo, flash } = LF;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- Icons and colors ---------- */
const ICONS = {
  stand:   ['Tree stand',  '<path d="M8 3v18M16 3v18M8 7h8M8 11h8M8 15h8M5 3h14"/>', '#e8590c'],
  blind:   ['Ground blind','<path d="M3 20 12 5l9 15z"/><path d="M10 15h4"/>', '#e8590c'],
  camera:  ['Trail camera','<rect x="4" y="7" width="16" height="12" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="m9 7 1.5-2h3L15 7"/>', '#3b82f6'],
  scrape:  ['Scrape',      '<path d="M7 5c2 5 2 10 0 14M12 5c2 5 2 10 0 14M17 5c2 5 2 10 0 14"/>', '#9c4a2f'],
  rub:     ['Rub',         '<path d="M12 3v18M8 8l8 2.5M8 12.5l8 2.5"/>', '#9c4a2f'],
  bedding: ['Bedding',     '<ellipse cx="12" cy="15" rx="8" ry="4"/><path d="M9 4h4l-4 5h4"/>', '#8a6bb8'],
  food:    ['Food plot',   '<path d="M12 21V11"/><path d="M12 13c-4 0-6-3-6-7 4 0 6 3 6 7zM12 11c0-4 2-7 6-7 0 4-2 7-6 7z"/>', '#3f9d4a'],
  water:   ['Water',       '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>', '#3b82f6'],
  parking: ['Parking',     '<path d="M9 20V5h4a4 4 0 0 1 0 8H9"/>', '#5b665d'],
  gate:    ['Gate',        '<path d="M3 5v15M21 5v15M3 9h18M3 15h18M3 9l18 6"/>', '#5b665d'],
  camp:    ['Camp',        '<path d="M2 20h20M12 4 4 20M12 4l8 16M12 20v-5"/>', '#3f9d4a'],
  harvest: ['Harvest',     '<path d="M12 21v-7M12 14c-4-1-6-4-6-9M12 14c4-1 6-4 6-9M6 9 3 7M18 9l3-2M8 6 7 3M16 6l1-3"/>', '#d62828'],
  pin:     ['Other',       '<circle cx="12" cy="12" r="3.5" fill="currentColor"/>', '#e8590c']
};
const COLORS = ['#e8590c', '#ffe14d', '#d62828', '#3b82f6', '#3f9d4a', '#8a6bb8', '#ffffff', '#1f2b24'];
const glyph = (k, size) => `<svg viewBox="0 0 24 24" width="${size||18}" height="${size||18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(ICONS[k] || ICONS.pin)[1]}</svg>`;
const inkOn = c => /^#(ffffff|ffe14d)$/i.test(c) ? '#1f2b24' : '#ffffff';
const wpColor = w => w.color || (ICONS[w.icon] || ICONS.pin)[2];
const KIND = { waypoints:'Waypoint', line:'Line', area:'Area', circle:'Circle', tracks:'Track' };
LF.ICONS = ICONS;

/* ---------- Stats ---------- */
function stats(store, r){
  if(store === 'waypoints') return [];
  if(store === 'tracks'){
    const m = geo.length(r.points), ms = trackMs(r);
    return [['Distance', geo.fmtDist(m)], ['Moving time', geo.fmtTime(ms)], ['Pace', geo.fmtPace(ms, m)],
      ['Climb', r.points.some(p => p[2] != null) ? geo.fmtFt(geo.gain(r.points.map(p => p[2]))) : '—'],
      ['Started', r.started ? new Date(r.started).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' }) : '—']];
  }
  if(r.kind === 'line') return [['Length', geo.fmtDist(geo.length(r.points))]];
  if(r.kind === 'circle') return [['Area', geo.fmtArea(Math.PI * r.radius * r.radius)], ['Radius', geo.fmtDist(r.radius)]];
  return [['Area', geo.fmtArea(geo.area(r.points))], ['Perimeter', geo.fmtDist(geo.length(r.points, true))]];
}
const trackMs = r => Math.max(0, (r.ended || Date.now()) - (r.started || Date.now()) - (r.pausedMs || 0));
function where(store, r){
  if(store === 'waypoints') return [r.lat, r.lng];
  if(store === 'tracks') return r.points[0];
  if(r.kind === 'circle') return r.center;
  return r.kind === 'area' ? geo.centroid(r.points) : r.points[Math.floor(r.points.length / 2)];
}
function boundsOf(store, r){
  if(store === 'waypoints') return L.latLngBounds([[r.lat, r.lng]]);
  if(r.kind === 'circle') return L.latLngBounds(geo.circlePts(r.center, r.radius, 16));
  return L.latLngBounds(r.points.map(p => [p[0], p[1]]));
}

/* ---------- On the map ---------- */
map.createPane('savedPane'); map.getPane('savedPane').style.zIndex = 440;
/* Waypoints and labels sit above the highlight layer so they stay visible and tappable. */
map.createPane('savedMarkers'); map.getPane('savedMarkers').style.zIndex = 460;
const layer = L.layerGroup();
/* Thin lines are hard to hit with a finger: accept taps within 12 px. */
const touchy = L.canvas({ pane:'savedPane', tolerance:12 });
let show = LF.prefs.get('showSaved', true);
const showBox = document.getElementById('l-saved');
showBox.checked = show;
showBox.addEventListener('change', () => { show = showBox.checked; LF.prefs.set('showSaved', show); show ? layer.addTo(map) : map.removeLayer(layer); });
if(show) layer.addTo(map);
const labels = () => document.getElementById('map').classList.toggle('wp-labels', map.getZoom() >= 15);
map.on('zoomend', labels); labels();

/* A tap on a saved item opens it; while a drawing tool is active it adds a point there instead. */
function tap(store, r){ return e => { L.DomEvent.stopPropagation(e);
  if(LF.mode) LF.draw.add([e.latlng.lat, e.latlng.lng]); else open(store, r.id); }; }
function wpIcon(w){
  const c = wpColor(w);
  return L.divIcon({ className:'wp-wrap', iconSize:[32, 32], iconAnchor:[16, 16],
    html:`<div class="wp" style="background:${c};color:${inkOn(c)}">${glyph(w.icon)}</div><div class="wp-label">${esc(w.name)}</div>` });
}
async function redraw(){
  if(!(await db.ready())) return;
  layer.clearLayers();
  const [wps, drs, trs] = await Promise.all([db.all('waypoints'), db.all('drawings'), db.all('tracks')]);
  drs.forEach(d => {
    const c = d.color || '#e8590c', o = { pane:'savedPane', renderer:touchy, color:c, weight:3, opacity:.95 };
    if(d.kind === 'line') L.polyline(d.points, o).on('click', tap('drawings', d)).addTo(layer);
    else {
      const shape = d.kind === 'circle' ? L.circle(d.center, Object.assign({ radius:d.radius }, o, { fillOpacity:.15, interactive:false }))
                                        : L.polygon(d.points, Object.assign({}, o, { fillOpacity:.15, interactive:false }));
      shape.addTo(layer);
      L.marker(where('drawings', d), { pane:'savedMarkers', icon:L.divIcon({ className:'area-label', iconSize:null,
        html:`<span style="border-color:${c}">${esc(d.name)} · ${esc(stats('drawings', d)[0][1])}</span>` }) })
        .on('click', tap('drawings', d)).addTo(layer);
    }
  });
  trs.filter(t => !t.recording && t.points.length > 1).forEach(t => {
    L.polyline(t.points.map(p => [p[0], p[1]]), { pane:'savedPane', renderer:touchy, color:t.color || '#d62828', weight:4, opacity:.9 })
      .on('click', tap('tracks', t)).addTo(layer);
  });
  wps.forEach(w => L.marker([w.lat, w.lng], { pane:'savedMarkers', icon:wpIcon(w), title:w.name, riseOnHover:true, zIndexOffset:1000 })
    .on('click', tap('waypoints', w)).addTo(layer));
}
/* Many saves can land at once (an import); redraw once they settle. */
let redrawTimer = null;
db.onChange(() => { clearTimeout(redrawTimer); redrawTimer = setTimeout(redraw, 60); }); redraw();

/* ---------- Viewing an item ---------- */
const head = (store, r) => {
  const icon = store === 'waypoints' ? `<span class="wp inline" style="background:${wpColor(r)};color:${inkOn(wpColor(r))}">${glyph(r.icon, 16)}</span>` : '';
  const kind = store === 'waypoints' ? (ICONS[r.icon] || ICONS.pin)[0] : KIND[store === 'tracks' ? 'tracks' : r.kind];
  return `<h2>${icon}${esc(r.name || kind)}</h2><div><span class="tag saved">${esc(kind)}</span></div>` +
    `<div class="small mono">${geo.fmtLL(where(store, r))}</div>`;
};
const dl = pairs => pairs.length ? '<dl>' + pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>' : '';

async function open(store, id, opts){
  const r = await db.get(store, id); if(!r) return;
  if(opts && opts.fly) map.fitBounds(boundsOf(store, r), { maxZoom:17, padding:[40, 40] });
  const here = LF.gps.last ? [['From you', geo.fmtDist(geo.dist(LF.gps.last.ll, where(store, r))) + ' ' + geo.fmtBearing(geo.bearing(LF.gps.last.ll, where(store, r)))]] : [];
  const photos = (r.photos || []).map((p, i) => `<img class="photo" src="${p}" alt="Photo ${i+1}" data-act="photo">`).join('');
  const body = '<div class="btnrow acts">' +
      (store !== 'drawings' || r.kind !== 'line' ? `<button class="btn primary" data-act="route">Directions</button><button class="btn" data-act="goto">${store === 'tracks' ? 'Back to start' : 'Go to'}</button>` : '') +
      '<button class="btn" data-act="edit">Edit</button>' +
      '<button class="btn" data-act="lookup">Parcel here</button>' +
      '<button class="btn" data-act="gpx">Export</button>' +
      '<button class="btn danger" data-act="delete">Delete</button></div>' +
    '<div class="block">' + dl(stats(store, r).concat(here)) + '</div>' +
    (r.notes ? `<div class="block"><p class="notes">${esc(r.notes)}</p></div>` : '') +
    (photos ? `<div class="photos">${photos}</div>` : '') +
    `<p class="note">Saved on this device ${r.updated ? new Date(r.updated).toLocaleDateString('en-US') : ''}. Back up from the layers panel to keep a copy.</p>`;
  LF.showSheet(head(store, r), body, { pin:where(store, r), onAct:(act, el) => {
    if(act === 'edit') edit(store, r);
    if(act === 'route') LF.route.to(store === 'tracks' ? 'start of ' + (r.name || 'track') : r.name || KIND[r.kind] || 'waypoint', where(store, r));
    if(act === 'goto') goto(store === 'tracks' ? 'Start of ' + (r.name || 'track') : r.name || KIND[r.kind] || 'Waypoint', where(store, r));
    if(act === 'lookup'){ const p = where(store, r); LF.inspect(L.latLng(p[0], p[1])); }
    if(act === 'gpx') download(fileName(r.name || 'line-fence') + '.gpx', geo.toGPX({ [store]:[r] }), 'application/gpx+xml');
    if(act === 'photo') el.classList.toggle('big');
    if(act === 'delete' && confirm('Delete "' + (r.name || KIND[store === 'tracks' ? 'tracks' : r.kind || 'waypoints']) + '"? This cannot be undone.')){
      db.del(store, r.id).then(() => { LF.closeSheet(); flash('Deleted'); });
    }
  } });
}

/* ---------- Editing ---------- */
function edit(store, r, isNew){
  let photos = (r.photos || []).slice(), icon = r.icon || 'pin', color = r.color || (store === 'waypoints' ? '' : '#e8590c');
  const iconBtns = () => Object.entries(ICONS).map(([k, v]) =>
    `<button type="button" class="iconpick${k === icon ? ' on' : ''}" data-act="icon" data-k="${k}" title="${esc(v[0])}" aria-label="${esc(v[0])}" style="background:${color || v[2]};color:${inkOn(color || v[2])}">${glyph(k)}</button>`).join('');
  const colorBtns = () => (store === 'waypoints' ? `<button type="button" class="swatch auto${!color ? ' on' : ''}" data-act="color" data-c="" title="Icon's own color">A</button>` : '') +
    COLORS.map(c => `<button type="button" class="swatch${c === color ? ' on' : ''}" data-act="color" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('');
  const thumbs = () => photos.map((p, i) => `<span class="thumb"><img src="${p}" alt=""><button type="button" data-act="rmphoto" data-i="${i}" aria-label="Remove photo">✕</button></span>`).join('');
  const kindName = store === 'waypoints' ? 'waypoint' : store === 'tracks' ? 'track' : KIND[r.kind].toLowerCase();
  const html = `<form class="edit" onsubmit="return false">
    <label>Name<input id="f-name" maxlength="80" value="${esc(r.name || '')}" placeholder="Name this ${kindName}"></label>
    ${store === 'waypoints' ? `<div class="lbl">Icon</div><div class="icons" id="f-icons">${iconBtns()}</div>` : ''}
    <div class="lbl">Color</div><div class="swatches" id="f-colors">${colorBtns()}</div>
    <label>Notes<textarea id="f-notes" rows="3" maxlength="4000" placeholder="Anything to remember">${esc(r.notes || '')}</textarea></label>
    ${store === 'waypoints' ? `<div class="lbl">Photos</div><div class="thumbs" id="f-photos">${thumbs()}</div>
      <label class="btn">Add photo<input type="file" accept="image/*" multiple hidden data-act="addphoto"></label>` : ''}
    <div class="btnrow acts"><button type="button" class="btn primary" data-act="save">Save</button><button type="button" class="btn" data-act="cancel">Cancel</button></div>
  </form>`;
  LF.showSheet(`<h2>${isNew ? 'New' : 'Edit'} ${kindName}</h2>` + (store === 'waypoints' ? `<div class="small mono">${geo.fmtLL([r.lat, r.lng])}</div>` : `<div class="small">${esc(stats(store, r).map(s => s[1]).slice(0, 2).join(' · '))}</div>`),
    html, { pin:null, onClose: isNew ? () => LF.emit('drawCancelled') : null, onAct: async (act, el) => {
    const $ = id => document.getElementById(id);
    if(act === 'icon'){ icon = el.dataset.k; $('f-icons').innerHTML = iconBtns(); }
    if(act === 'color'){ color = el.dataset.c; $('f-colors').innerHTML = colorBtns(); if($('f-icons')) $('f-icons').innerHTML = iconBtns(); }
    if(act === 'rmphoto'){ photos.splice(+el.dataset.i, 1); $('f-photos').innerHTML = thumbs(); }
    if(act === 'addphoto'){
      for(const f of Array.from(el.files || [])){ try{ photos.push(await shrink(f)); }catch(e){ flash('Could not read that photo'); } }
      el.value = ''; $('f-photos').innerHTML = thumbs();
    }
    if(act === 'cancel'){ if(isNew) LF.closeSheet(); else open(store, r.id); }
    if(act === 'save'){
      if(!LF.account.require(store === 'waypoints' ? 'waypoints' : store)) return;
      const rec = Object.assign({}, r, { name:$('f-name').value.trim() || defaultName(store, r), notes:$('f-notes').value.trim(), color:color || undefined });
      if(store === 'waypoints'){ rec.icon = icon; rec.photos = photos; }
      try{
        const saved = await db.put(store, rec);
        if(isNew) db.persist();
        open(store, saved.id);
      }catch(e){ flash(/quota/i.test(e && e.name) ? 'Storage is full. Remove some photos or saved items.' : 'Could not save: ' + (e.message || e), 5000); }
    }
  } });
  setTimeout(() => { const n = document.getElementById('f-name'); if(n && isNew && matchMedia('(pointer:fine)').matches) n.focus(); }, 50);
}
function defaultName(store, r){
  if(store === 'waypoints') return (ICONS[r.icon] || ICONS.pin)[0];
  if(store === 'tracks') return 'Track ' + new Date(r.started || Date.now()).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  return KIND[r.kind];   // the map label and the list add the measurement
}
/* Phone photos are large; keep a 1280 px JPEG so storage and backups stay small. */
function shrink(file){
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    img.src = url;
  });
}

/* ---------- Creating ---------- */
LF.items = {
  open, ICONS,
  newWaypoint(ll, o){ edit('waypoints', { lat:+ll[0].toFixed(6), lng:+ll[1].toFixed(6), icon:'pin', name:(o && o.name) || '' }, true); },
  newDrawing(d){ edit('drawings', d, true); },
  newTrack(t){ edit('tracks', t, true); },
  goto,
  editTrack(id){ db.get('tracks', id).then(t => t && edit('tracks', t, true)); },
  list
};

/* ---------- Go to ---------- */
const gotoChip = document.getElementById('gotoChip');
let target = null, guide = null;
function goto(name, ll){
  if(!LF.gps.start('goto')) return;
  target = { name, ll };
  if(!guide) guide = L.polyline([], { pane:'hiPane', color:'#3b82f6', weight:3, dashArray:'6 8', interactive:false }).addTo(map);
  gotoChip.hidden = false; updateGoto();
  if(!LF.gps.last) gotoChip.querySelector('.txt').textContent = 'Finding you… → ' + name;
  LF.closeSheet();
}
function updateGoto(){
  if(!target || !LF.gps.last) return;
  const me = LF.gps.last.ll, m = geo.dist(me, target.ll);
  guide.setLatLngs([me, target.ll]);
  gotoChip.querySelector('.txt').textContent = `→ ${target.name}: ${geo.fmtDist(m)} ${geo.fmtBearing(geo.bearing(me, target.ll))}` + (m < 15 ? ' · you\'re here' : '');
}
function stopGoto(){ target = null; gotoChip.hidden = true; if(guide){ guide.remove(); guide = null; } LF.gps.stop('goto'); }
gotoChip.querySelector('button').addEventListener('click', stopGoto);
LF.listen('gps', updateGoto);
LF.listen('gpsError', stopGoto);

/* ---------- List, export, import ---------- */
async function list(){
  if(!(await db.ready())){ flash('This browser is blocking on-device storage.', 5000); return; }
  const [wps, drs, trs] = await Promise.all([db.all('waypoints'), db.all('drawings'), db.all('tracks')]);
  const byNew = (a, b) => (b.updated || 0) - (a.updated || 0);
  const row = (store, r, icon, meta) => `<button class="row" data-act="open" data-s="${store}" data-id="${esc(r.id)}">${icon}<span><b>${esc(r.name || 'Untitled')}</b><span class="small">${esc(meta)}</span></span></button>`;
  const me = LF.gps.last && LF.gps.last.ll;
  const sec = (title, rows) => rows.length ? `<div class="block"><h3>${title} (${rows.length})</h3><div class="rows">${rows.join('')}</div></div>` : '';
  const done = trs.filter(t => !t.recording);
  const body = '<div class="btnrow acts"><button class="btn" data-act="gpx-all">Export GPX</button><button class="btn" data-act="kml-all">Export KML</button>' +
      '<label class="btn">Import GPX/KML<input type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml,application/xml" hidden data-act="import"></label></div>' +
    (wps.length + drs.length + done.length ? '' : '<p class="loading">Nothing saved yet. Use the + button to drop a waypoint, draw, or record a track.</p>') +
    sec('Waypoints', wps.sort(byNew).map(w => row('waypoints', w, `<span class="wp inline" style="background:${wpColor(w)};color:${inkOn(wpColor(w))}">${glyph(w.icon, 16)}</span>`,
      (ICONS[w.icon] || ICONS.pin)[0] + (me ? ' · ' + geo.fmtDist(geo.dist(me, [w.lat, w.lng])) + ' away' : '')))) +
    sec('Drawings', drs.sort(byNew).map(d => row('drawings', d, `<span class="swatch-sm" style="background:${d.color || '#e8590c'}"></span>`, KIND[d.kind] + ' · ' + stats('drawings', d)[0][1]))) +
    sec('Tracks', done.sort(byNew).map(t => row('tracks', t, `<span class="swatch-sm" style="background:${t.color || '#d62828'}"></span>`, stats('tracks', t).slice(0, 2).map(s => s[1]).join(' · '))));
  LF.showSheet('<h2>Saved on this device</h2>', body, { onAct: async (act, el) => {
    if(act === 'open') open(el.dataset.s, el.dataset.id, { fly:true });
    const all = { waypoints:wps, drawings:drs, tracks:done };
    const stamp = new Date().toISOString().slice(0, 10);
    if(act === 'gpx-all') download('line-fence-' + stamp + '.gpx', geo.toGPX(all), 'application/gpx+xml');
    if(act === 'kml-all') download('line-fence-' + stamp + '.kml', geo.toKML(all), 'application/vnd.google-earth.kml+xml');
    if(act === 'import'){
      const f = el.files && el.files[0]; el.value = ''; if(!f) return;
      try{ await importFile(await f.text()); list(); }catch(e){ flash(e.message || 'Import failed', 5000); }
    }
  } });
}
async function importFile(text){
  const got = geo.parseFile(text);
  const n = got.waypoints.length + got.drawings.length + got.tracks.length;
  if(!n) throw new Error('No waypoints, routes or tracks found in that file.');
  const b = L.latLngBounds([]);
  for(const w of got.waypoints){ if(!ICONS[w.icon]) w.icon = 'pin'; await db.put('waypoints', w); b.extend([w.lat, w.lng]); }
  for(const d of got.drawings){ await db.put('drawings', d); d.points.forEach(p => b.extend(p)); }
  for(const t of got.tracks){
    const times = t.points.map(p => p[3]).filter(Boolean);
    t.started = times[0] || null; t.ended = times[times.length - 1] || null; t.pausedMs = 0;
    await db.put('tracks', t); t.points.forEach(p => b.extend([p[0], p[1]]));
  }
  db.persist();
  if(b.isValid()) map.fitBounds(b, { maxZoom:16, padding:[40, 40] });
  flash('Imported ' + n + (n === 1 ? ' item' : ' items'));
}
const fileName = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'line-fence';
function download(name, text, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
LF.download = download;
})(window.LF);
