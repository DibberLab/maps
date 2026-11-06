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
  // Hunting
  stand:    ['Tree Stand',   '<path d="M8 3v18M16 3v18M8 7h8M8 11h8M8 15h8M5 3h14"/>', '#e8590c'],
  blind:    ['Ground Blind', '<path d="M3 20 12 5l9 15z"/><path d="M10 15h4"/>', '#e8590c'],
  camera:   ['Trail Camera', '<rect x="4" y="7" width="16" height="12" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="m9 7 1.5-2h3L15 7"/>', '#3b82f6'],
  feeder:   ['Feeder',       '<path d="M7 4h10l-2 7H9z"/><path d="M9 11v9M15 11v9M12 11v4"/>', '#3f9d4a'],
  food:     ['Food Plot',    '<path d="M12 21V11"/><path d="M12 13c-4 0-6-3-6-7 4 0 6 3 6 7zM12 11c0-4 2-7 6-7 0 4-2 7-6 7z"/>', '#3f9d4a'],
  water:    ['Water Source', '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>', '#3b82f6'],
  bedding:  ['Bedding',      '<ellipse cx="12" cy="15" rx="8" ry="4"/><path d="M9 4h4l-4 5h4"/>', '#8a6bb8'],
  scrape:   ['Scrape',       '<path d="M7 5c2 5 2 10 0 14M12 5c2 5 2 10 0 14M17 5c2 5 2 10 0 14"/>', '#9c4a2f'],
  rub:      ['Rub',          '<path d="M12 3v18M8 8l8 2.5M8 12.5l8 2.5"/>', '#9c4a2f'],
  tracks:   ['Tracks',       '<path d="M7 5c-1.5 1-1.5 4 0 5M9 5c1.5 1 1.5 4 0 5M15 13c-1.5 1-1.5 4 0 5M17 13c1.5 1 1.5 4 0 5"/>', '#9c4a2f'],
  scat:     ['Scat',         '<circle cx="8" cy="14" r="2"/><circle cx="13" cy="16" r="2"/><circle cx="15" cy="10" r="2"/>', '#9c4a2f'],
  crossing: ['Crossing',     '<path d="M4 20 20 4M4 4l16 16M15 4h5v5M4 15v5h5"/>', '#d9a21b'],
  funnel:   ['Pinch Point',  '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>', '#d9a21b'],
  saddle:   ['Saddle',       '<path d="M2 17c3 0 4-8 7-8s3 5 3 5 0-5 3-5 4 8 7 8"/>', '#5b665d'],
  sighting: ['Sighting',     '<circle cx="7" cy="15" r="4"/><circle cx="17" cy="15" r="4"/><path d="M7 11V6h3M17 11V6h-3M11 15h2"/>', '#e8590c'],
  lookout:  ['Glassing',     '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', '#5b665d'],
  deer:     ['Deer',         '<path d="M12 21v-7M12 14c-4-1-6-4-6-9M12 14c4-1 6-4 6-9M6 9 3 7M18 9l3-2M8 6 7 3M16 6l1-3"/>', '#9c4a2f'],
  elk:      ['Elk',          '<path d="M12 21v-6M12 15C7 14 5 10 5 4M12 15c5-1 7-5 7-11M5 8 2 6M5 11 2 10M19 8l3-2M19 11l3-1M7 5 6 2M17 5l1-3"/>', '#9c4a2f'],
  turkey:   ['Turkey',       '<path d="M12 20v-6"/><path d="M12 14a8 8 0 0 1-8-8M12 14a8 8 0 0 0 8-8M12 14V5M12 14 7 7M12 14l5-7"/>', '#9c4a2f'],
  bear:     ['Bear',         '<ellipse cx="12" cy="16" rx="5" ry="4"/><circle cx="6" cy="9" r="1.7"/><circle cx="10" cy="6.5" r="1.7"/><circle cx="14" cy="6.5" r="1.7"/><circle cx="18" cy="9" r="1.7"/>', '#1f2b24'],
  duck:     ['Waterfowl',    '<path d="M3 14c2 4 14 4 17 0-1-2-5-2-7-1 1-4-1-7-4-7-2 0-3 2-3 3l-3 1 3 1c0 2 1 3 2 3"/>', '#3f9d4a'],
  hog:      ['Hog',          '<ellipse cx="12" cy="13" rx="7" ry="6"/><ellipse cx="12" cy="15" rx="3" ry="2"/><path d="M7 7 5 4M17 7l2-3"/>', '#9c4a2f'],
  shed:     ['Shed',         '<path d="M5 20c2-6 4-11 4-16M9 10l5-3M8 15l6-1M7 19l3 1"/>', '#d9a21b'],
  harvest:  ['Kill Site',    '<path d="M12 21v-7M12 14c-4-1-6-4-6-9M12 14c4-1 6-4 6-9"/><path d="M15 19l2 2 4-5"/>', '#d62828'],
  // Access and places
  parking:  ['Parking',      '<path d="M9 20V5h4a4 4 0 0 1 0 8H9"/>', '#5b665d'],
  gate:     ['Gate',         '<path d="M3 5v15M21 5v15M3 9h18M3 15h18M3 9l18 6"/>', '#5b665d'],
  fence:    ['Fence',        '<path d="M5 21V6l1.5-2L8 6v15M11 21V6l1.5-2L14 6v15M17 21V6l1.5-2L20 6v15M3 10h19M3 16h19"/>', '#5b665d'],
  trailhead:['Trailhead',    '<path d="M12 21V3M12 5h7l2 2.5-2 2.5h-7M12 12H5l-2 2.5L5 17h7"/>', '#3f9d4a'],
  atv:      ['ATV',          '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h6M6 14l3-5h6l3 5M12 9V6h3"/>', '#5b665d'],
  truck:    ['Vehicle',      '<path d="M2 16V8h12v8M14 11h4l3 3v2h-7"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>', '#5b665d'],
  boat:     ['Boat Launch',  '<path d="M3 15h18l-3 4H6zM12 15V4l6 9h-6"/>', '#3b82f6'],
  fish:     ['Fishing',      '<path d="M3 12c3-4 8-5 12-3l5-3v12l-5-3c-4 2-9 1-12-3z"/><circle cx="8" cy="11" r=".8" fill="currentColor"/>', '#3b82f6'],
  spring:   ['Spring',       '<path d="M12 3c3 4 4.5 6 4.5 8.5a4.5 4.5 0 0 1-9 0C7.5 9 9 7 12 3z"/><path d="M3 19c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0"/>', '#3b82f6'],
  camp:     ['Camp',         '<path d="M2 20h20M12 4 4 20M12 4l8 16M12 20v-5"/>', '#3f9d4a'],
  cabin:    ['Cabin',        '<path d="M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6"/>', '#9c4a2f'],
  hazard:   ['Hazard',       '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>', '#d62828'],
  flag:     ['Flag',         '<path d="M5 21V4M5 4h12l-3 4 3 4H5"/>', '#d62828'],
  star:     ['Favorite',     '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>', '#d9a21b'],
  photo:    ['Photo',        '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/>', '#8a6bb8'],
  // Disc golf
  dgtee:    ['Disc Golf Tee Pad', '<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M9.5 8h5M12 8v8"/>', '#0f766e'],
  dgbasket: ['Disc Golf Basket',  '<path d="M12 3v18M8 21h8M6 6h12M6.5 6l1 4h9l1-4M8 10l1.5 4h5L16 10"/>', '#0f766e'],
  pin:      ['Waypoint',     '<circle cx="12" cy="12" r="3.5" fill="currentColor"/>', '#e8590c']
};
/* Names other apps use for the same marks (onX Hunt and others), matched loosely ("Creek Crossing" -> crossing). */
const ICON_ALIASES = { teepad:'dgtee', tee:'dgtee', discgolftee:'dgtee', discgolfteepad:'dgtee', basket:'dgbasket', discgolfbasket:'dgbasket',
  treestand:'stand', stand:'stand', ladderstand:'stand', climber:'stand', groundblind:'blind', blind:'blind', duckblind:'blind',
  trailcamera:'camera', trailcam:'camera', camera:'camera', cellcam:'camera', feeder:'feeder', foodsource:'food', foodplot:'food', food:'food', crops:'food', mast:'food',
  water:'water', watersource:'water', pond:'water', bedding:'bedding', bed:'bedding', beddingarea:'bedding', scrape:'scrape', rub:'rub',
  tracks:'tracks', track:'tracks', sign:'tracks', scat:'scat', droppings:'scat', crossing:'crossing', creekcrossing:'crossing', fencecrossing:'crossing',
  funnel:'funnel', pinchpoint:'funnel', pinch:'funnel', saddle:'saddle', sighting:'sighting', animalsighting:'sighting', glassing:'lookout', lookout:'lookout',
  overlook:'lookout', vantagepoint:'lookout', deer:'deer', buck:'deer', doe:'deer', whitetail:'deer', mule:'deer', muledeer:'deer', elk:'elk', moose:'elk',
  turkey:'turkey', bear:'bear', duck:'duck', waterfowl:'duck', goose:'duck', hog:'hog', pig:'hog', boar:'hog', shed:'shed', antler:'shed',
  killsite:'harvest', kill:'harvest', harvest:'harvest', bloodtrail:'harvest', recovery:'harvest',
  parking:'parking', park:'parking', gate:'gate', fence:'fence', trailhead:'trailhead', trail:'trailhead', atv:'atv', utv:'atv', sidebyside:'atv',
  vehicle:'truck', truck:'truck', car:'truck', boatlaunch:'boat', boatramp:'boat', boat:'boat', access:'boat', fishing:'fish', fish:'fish', fishinghole:'fish',
  spring:'spring', camp:'camp', campsite:'camp', tent:'camp', cabin:'cabin', house:'cabin', building:'cabin', structure:'cabin', hazard:'hazard', danger:'hazard',
  caution:'hazard', flag:'flag', marker:'flag', star:'star', favorite:'star', photo:'photo', picture:'photo', waypoint:'pin', location:'pin', point:'pin', other:'pin', pin:'pin' };
function iconFor(name){
  const k = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  if(ICONS[k]) return k;
  if(ICON_ALIASES[k]) return ICON_ALIASES[k];
  const hit = Object.keys(ICON_ALIASES).sort((a, b) => b.length - a.length).find(a => a.length > 3 && k.includes(a));
  return hit ? ICON_ALIASES[hit] : 'pin';
}
const iconLabel = r => r.iconName && iconFor(r.iconName) === r.icon ? r.iconName : (ICONS[r.icon] || ICONS.pin)[0];
const COLORS = ['#e8590c', '#ffe14d', '#d62828', '#3b82f6', '#3f9d4a', '#8a6bb8', '#ffffff', '#1f2b24'];
const glyph = (k, size) => `<svg viewBox="0 0 24 24" width="${size||18}" height="${size||18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(ICONS[k] || ICONS.pin)[1]}</svg>`;
const inkOn = c => /^#(ffffff|ffe14d)$/i.test(c) ? '#1f2b24' : '#ffffff';
const wpColor = w => w.color || (ICONS[w.icon] || ICONS.pin)[2];
const KIND = { waypoints:'Waypoint', line:'Line', area:'Area', circle:'Circle', tracks:'Track' };
LF.ICONS = ICONS;

/* ---------- Stats ---------- */
function stats(store, r){
  if(store === 'waypoints') return [];
  if(store === 'tracks' && r.dg){
    const m = geo.length(r.points);
    return [['Length', geo.fmtFt(m)], ['Hole', r.dg.hole || '—'], ['Par', r.dg.par || '—'], ['Fairway', r.dg.fairway ? r.dg.fairway + ' ft wide' : '—']];
  }
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

/* Line look from the item: color, width (weight), solid / dash / dot, and opacity from imports. */
const STYLES = { solid:'Solid', dash:'Dashed', dot:'Dotted' };
function lineOpts(r, w0){
  const w = r.weight || w0;
  return { pane:'savedPane', renderer:touchy, color:r.color || '#e8590c', weight:w, opacity:r.opacity != null ? r.opacity : .95, lineCap:'round',
    dashArray:r.lineStyle === 'dash' ? `${w * 2.5} ${w * 1.8}` : r.lineStyle === 'dot' ? `1 ${w * 2}` : null };
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

/* A tap on a saved item opens it. While a tool is active the tap belongs to the tool: a drawing tool adds a point there,
   any other (Map a course, Measure a throw, Line up the photo…) gets it as a map tap. */
function tap(store, r){ return e => { L.DomEvent.stopPropagation(e);
  if(!LF.mode) return open(store, r.id);
  if(LF.draw.active()) LF.draw.add([e.latlng.lat, e.latlng.lng]);
  else map.fire('click', { latlng:e.latlng, layerPoint:e.layerPoint, containerPoint:e.containerPoint, originalEvent:e.originalEvent }); }; }
function wpIcon(w){
  const c = wpColor(w);
  return L.divIcon({ className:'wp-wrap', iconSize:[32, 32], iconAnchor:[16, 16],
    html:`<div class="wp" style="background:${c};color:${inkOn(c)}">${glyph(w.icon)}</div><div class="wp-label">${esc(w.name)}</div>` });
}
let drawGen = 0;
async function redraw(){
  const gen = ++drawGen;   // a newer redraw wins; two at once would draw everything twice
  if(!(await db.ready())) return;
  // Items marked hidden (the eye in the list, or Hide on map) stay saved but aren't drawn.
  const shown = r => !r.hidden && !(editing && editing.id === r.id);
  const [wps, drs, trs] = await Promise.all([db.all('waypoints'), db.all('drawings'), db.all('tracks')]).then(a => a.map(x => x.filter(shown)));
  if(gen !== drawGen) return;
  layer.clearLayers();
  drawRecords(layer, wps, drs, trs, tap);
}
/* Draws waypoints, drawings and tracks (holes included) into a layer; onTap(store, r) gives each one's click handler.
   Your saved items use it, and so does a shared folder you're looking at. */
function drawRecords(target, wps, drs, trs, onTap){
  drs.forEach(d => {
    const c = d.color || '#e8590c', o = lineOpts(d, 3);
    if(d.kind === 'line') L.polyline(d.points, o).on('click', onTap('drawings', d)).addTo(target);
    else {
      const fill = { baseFill:.15, fillOpacity:LF.fillOf(.15), interactive:false };
      const shape = d.kind === 'circle' ? L.circle(d.center, Object.assign({ radius:d.radius }, o, fill))
                                        : L.polygon(d.points, Object.assign({}, o, fill));
      shape.addTo(target);
      L.marker(where('drawings', d), { pane:'savedMarkers', icon:L.divIcon({ className:'area-label', iconSize:null,
        html:`<span style="border-color:${c}">${esc(d.name)} · ${esc(stats('drawings', d)[0][1])}</span>` }) })
        .on('click', onTap('drawings', d)).addTo(target);
    }
  });
  trs.filter(t => !t.recording && t.points.length > 1).forEach(t => {
    const ll = t.points.map(p => [p[0], p[1]]);
    if(t.dg) drawHole(t, ll, target, onTap);
    L.polyline(ll, lineOpts(Object.assign({ color:t.color || (t.dg ? DG : '#d62828') }, t), 4))
      .on('click', onTap('tracks', t)).addTo(target);
  });
  wps.forEach(w => L.marker([w.lat, w.lng], { pane:'savedMarkers', icon:wpIcon(w), title:w.name, riseOnHover:true, zIndexOffset:1000 })
    .on('click', onTap('waypoints', w)).addTo(target));
}
/* ---------- Disc golf holes ----------
   Words: a "hole" is the whole thing (tee pad + fairway + basket); the start point is the tee pad, the end point the basket.
   A track can be marked a disc golf hole (r.dg = { hole, par, fairway (ft), anchors:[point indexes] }). It's drawn with
   a fairway band of that real width (rescaled as you zoom), arrows from tee to basket, a tee pad at the start and a
   basket at the end. Its edit mode lets you drag the tee, the basket and anchors (see dgEditor). */
const DG = '#0f766e';
let dgBands = [];
const mPerPx = lat => 156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom());
const bandPx = (ft, lat) => Math.max(3, ft * 0.3048 / mPerPx(lat));
map.on('zoomend', () => { dgBands = dgBands.filter(b => map.hasLayer(b)); dgBands.forEach(b => b.setStyle({ weight:bandPx(b.ft, b.lat) })); });
/* Where a fraction of the way along a path is, and which way the path heads there. */
function along(ll, frac){
  const cum = [0]; for(let i = 1; i < ll.length; i++) cum.push(cum[i - 1] + geo.dist(ll[i - 1], ll[i]));
  const want = cum[cum.length - 1] * frac; let i = 1; while(i < ll.length - 1 && cum[i] < want) i++;
  const seg = cum[i] - cum[i - 1] || 1, t = (want - cum[i - 1]) / seg, a = ll[i - 1], b = ll[i];
  return { ll:[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], brg:geo.bearing(a, b) };
}
const dgIcon = (k, label) => L.divIcon({ className:'wp-wrap dg-end', iconSize:[30, 30], iconAnchor:[15, 15],
  html:`<div class="wp" style="background:${DG};color:#fff">${glyph(k, 17)}</div>${label ? `<div class="wp-label">${esc(label)}</div>` : ''}` });
const arrowIcon = brg => L.divIcon({ className:'dg-arrow', iconSize:[18, 18], iconAnchor:[9, 9],
  html:`<svg viewBox="0 0 24 24" width="18" height="18" style="transform:rotate(${brg}deg)"><path d="M12 3 20 19 12 14 4 19z" fill="#fff" stroke="${DG}" stroke-width="2.5" stroke-linejoin="round"/></svg>` });
function drawHole(t, ll, target, onTap){
  const c = t.color || DG, lat = ll[0][0];
  if(t.dg.fairway){ const band = L.polyline(ll, { pane:'savedPane', renderer:touchy, color:c, opacity:.22, weight:bandPx(t.dg.fairway, lat), lineCap:'round', lineJoin:'round' })
    .on('click', onTap('tracks', t)).addTo(target); band.ft = t.dg.fairway; band.lat = lat; dgBands.push(band); }
  const len = geo.length(ll), n = Math.max(1, Math.min(6, Math.round(len / 45)));
  for(let i = 0; i < n; i++){ const a = along(ll, (i + .5) / n);
    L.marker(a.ll, { pane:'savedMarkers', interactive:false, keyboard:false, icon:arrowIcon(a.brg) }).addTo(target); }
  const label = [t.dg.hole ? 'Hole ' + t.dg.hole : t.name, t.dg.par ? 'Par ' + t.dg.par : '', geo.fmtFt(len)].filter(Boolean).join(' · ');
  L.marker(ll[0], { pane:'savedMarkers', icon:dgIcon('dgtee', label), title:'Tee: ' + (t.name || ''), zIndexOffset:900 }).on('click', onTap('tracks', t)).addTo(target);
  L.marker(ll[ll.length - 1], { pane:'savedMarkers', icon:dgIcon('dgbasket'), title:'Basket: ' + (t.name || ''), zIndexOffset:900 }).on('click', onTap('tracks', t)).addTo(target);
}

/* "Hole 7", "#7", "H7" or a bare "7" in a track's name gives its hole number. */
const holeFromName = n => { const m = String(n || '').match(/(?:hole|#|\bh)\s*(\d{1,2})\b/i) || String(n || '').match(/^\s*(\d{1,2})\s*$/); return m ? m[1] : ''; };
/* Editing a hole: drag the tee or the basket and the line bends back to the nearest anchor (the end moves fully, the
   anchor not at all, the points between in proportion to how far along they are). Tap the line to drop an anchor,
   drag one to reshape between its neighbours, tap one to remove it. With no anchors, the middle of the line is the
   built-in one (shown faint; dragging it makes it a real anchor). */
function dgEditor(r, color, onMove){
  const g = L.layerGroup().addTo(map), svg = L.svg({ pane:'editPane' });
  const st = { points:r.points.map(p => p.slice()), anchors:((r.dg && r.dg.anchors) || []).filter(i => i > 0 && i < r.points.length - 1).sort((a, b) => a - b) };
  editing = { id:r.id }; redraw();
  const last = () => st.points.length - 1;
  const lls = () => st.points.map(p => [p[0], p[1]]);
  const cumOf = pts => { const c = [0]; for(let i = 1; i < pts.length; i++) c.push(c[i - 1] + geo.dist(pts[i - 1], pts[i])); return c; };
  const midIndex = () => { const c = cumOf(st.points), half = c[c.length - 1] / 2; let i = 1; while(i < last() && c[i] < half) i++; return i; };
  const anchorsOrMid = () => st.anchors.length ? st.anchors : [midIndex()];
  const line = L.polyline(lls(), { pane:'editPane', renderer:svg, color, weight:4, dashArray:'7 6', interactive:false }).addTo(g);
  // A wide invisible line over it takes the taps that drop anchors.
  const hit = L.polyline(lls(), { pane:'editPane', renderer:svg, color:'#000', opacity:.001, weight:28, interactive:true, bubblingMouseEvents:false }).addTo(g);
  const handles = L.layerGroup().addTo(g);
  const refresh = () => { line.setLatLngs(lls()); hit.setLatLngs(lls()); onMove(); };
  /* Move points lo..hi by delta × weight(i), weight from the drag start's arc lengths. */
  function bend(orig, from, to, lo, hi, weight){
    for(let i = lo; i <= hi; i++){ const w = weight(i); st.points[i][0] = orig[i][0] + (to.lat - from.lat) * w; st.points[i][1] = orig[i][1] + (to.lng - from.lng) * w; }
  }
  function build(){
    handles.clearLayers();
    const mk = (i, cls, html, size) => L.marker([st.points[i][0], st.points[i][1]], { pane:'editPane', draggable:true, autoPan:true, zIndexOffset:3000, keyboard:false,
      icon:L.divIcon({ className:'edit-h ' + cls, iconSize:[size || 36, size || 36], iconAnchor:[(size || 36) / 2, (size || 36) / 2], html }) }).addTo(handles);
    let orig = null, cum = null, from = null;
    const start = e => { orig = st.points.map(p => p.slice()); cum = cumOf(orig); from = e.target.getLatLng(); };
    // The tee: bends from the start back to the first anchor.
    mk(0, 'dg-tee', `<i>${glyph('dgtee', 18)}</i>`, 40).on('dragstart', start).on('drag', e => {
      const a = anchorsOrMid()[0]; bend(orig, from, e.target.getLatLng(), 0, a, i => (cum[a] - cum[i]) / (cum[a] || 1)); refresh(); }).on('dragend', build);
    // The basket: bends from the end back to the last anchor.
    mk(last(), 'dg-basket', `<i>${glyph('dgbasket', 18)}</i>`, 40).on('dragstart', start).on('drag', e => {
      const as = anchorsOrMid(), a = as[as.length - 1], n = last();
      bend(orig, from, e.target.getLatLng(), a, n, i => (cum[i] - cum[a]) / ((cum[n] - cum[a]) || 1)); refresh(); }).on('dragend', build);
    // Anchors (or the faint built-in one): drag to reshape between the neighbours; tap a real one to remove it.
    const list = st.anchors.length ? st.anchors : [midIndex()];
    list.forEach((a, k) => {
      const real = !!st.anchors.length, h = mk(a, 'vertex dg-anchor' + (real ? '' : ' implied'), '<i></i>', 30);
      h.on('dragstart', e => { start(e); if(!real) st.anchors = [a]; });
      h.on('drag', e => { const prev = k > 0 ? list[k - 1] : 0, next = k < list.length - 1 ? list[k + 1] : last(), to = e.target.getLatLng();
        bend(orig, from, to, prev, a, i => (cum[i] - cum[prev]) / ((cum[a] - cum[prev]) || 1));
        bend(orig, from, to, a + 1, next, i => (cum[next] - cum[i]) / ((cum[next] - cum[a]) || 1)); refresh(); });
      h.on('dragend', build);
      if(real) h.on('click', () => { st.anchors = st.anchors.filter(x => x !== a); build(); onMove(); });
    });
  }
  hit.on('click', e => {
    // Drop an anchor at the nearest point of the line (not on the ends, not on top of another anchor).
    const P = map.latLngToLayerPoint(e.latlng); let best = -1, bd = Infinity;
    st.points.forEach((p, i) => { const d = map.latLngToLayerPoint([p[0], p[1]]).distanceTo(P); if(d < bd){ bd = d; best = i; } });
    if(best <= 0 || best >= last() || st.anchors.some(a => Math.abs(a - best) < 2)) return;
    st.anchors = st.anchors.concat(best).sort((a, b) => a - b); build(); onMove();
  });
  build();
  const r6 = v => +(+v).toFixed(6);
  return {
    result(){ return { points:st.points.map(p => [r6(p[0]), r6(p[1])].concat(p.slice(2))), dgAnchors:st.anchors.slice() }; },
    stats(){ return Object.assign({}, r, { points:st.points }); },
    stop(){ map.removeLayer(g); if(editing && editing.id === r.id){ editing = null; redraw(); } }
  };
}

/* ---------- Moving and reshaping while editing ----------
   While an item's edit panel is open it's drawn as an editable copy instead: a waypoint you can drag; a line or
   area with a white dot on every corner and a ✥ handle that moves the whole shape; a circle with a centre handle
   and an edge handle that sets the radius. Nothing is saved until Save; Cancel puts it back. Tracks are recorded
   paths and stay put, except disc golf holes (dgEditor). */
map.createPane('editPane'); map.getPane('editPane').style.zIndex = 470;
map.getPane('editPane').style.pointerEvents = 'none';   // its canvas mustn't swallow taps; the handles take their own
let editing = null;
function geoEditor(store, r, color, onMove, dg){
  if(store === 'tracks') return dg ? dgEditor(r, color, onMove) : null;
  const g = L.layerGroup().addTo(map), st = { lat:r.lat, lng:r.lng, points:(r.points || []).map(p => [p[0], p[1]]), center:r.center && [r.center[0], r.center[1]], radius:r.radius };
  editing = { id:r.id }; redraw();
  const ll = x => [x.lat, x.lng];
  const handle = (at, cls, glyphHtml) => L.marker(at, { pane:'editPane', draggable:true, autoPan:true, zIndexOffset:3000, keyboard:false,
    icon:L.divIcon({ className:'edit-h ' + cls, iconSize:[36, 36], iconAnchor:[18, 18], html:`<i>${glyphHtml || ''}</i>` }) }).addTo(g);
  if(store === 'waypoints'){
    const m = L.marker([st.lat, st.lng], { pane:'editPane', draggable:true, autoPan:true, zIndexOffset:3000, icon:wpIcon(Object.assign({}, r, { color:color || r.color })) }).addTo(g);
    L.DomUtil.addClass(m.getElement(), 'edit-wp');
    m.on('drag', e => { const p = e.target.getLatLng(); st.lat = p.lat; st.lng = p.lng; onMove(); });
  } else if(r.kind === 'circle'){
    const shape = L.circle(st.center, { pane:'editPane', radius:st.radius, color, weight:3, dashArray:'6 5', fillOpacity:.1, interactive:false }).addTo(g);
    const edgeAt = () => geo.dest(st.center, 90, st.radius);
    const edge = handle(edgeAt(), 'edge', '↔');
    const mid = handle(st.center, 'move', '✥');
    mid.on('drag', e => { st.center = ll(e.target.getLatLng()); shape.setLatLng(st.center); edge.setLatLng(edgeAt()); onMove(); });
    edge.on('drag', e => { st.radius = Math.max(5, geo.dist(st.center, ll(e.target.getLatLng()))); shape.setRadius(st.radius); onMove(); });
    edge.on('dragend', () => edge.setLatLng(edgeAt()));
  } else {
    const closed = r.kind === 'area';
    const shape = (closed ? L.polygon : L.polyline)(st.points, { pane:'editPane', color, weight:3, dashArray:'6 5', fillOpacity:.1, interactive:false }).addTo(g);
    const mid = handle(geo.centroid(st.points), 'move', '✥');
    const dots = st.points.map((p, i) => handle(p, 'vertex').on('drag', e => { st.points[i] = ll(e.target.getLatLng()); shape.setLatLngs(st.points); onMove(); })
      .on('dragend', () => mid.setLatLng(geo.centroid(st.points))));
    let from = null, orig = null;
    mid.on('dragstart', e => { from = e.target.getLatLng(); orig = st.points.map(p => p.slice()); });
    mid.on('drag', e => { const to = e.target.getLatLng(), dla = to.lat - from.lat, dln = to.lng - from.lng;
      st.points = orig.map(p => [p[0] + dla, p[1] + dln]); shape.setLatLngs(st.points); dots.forEach((d, i) => d.setLatLng(st.points[i])); onMove(); });
  }
  const r6 = v => +(+v).toFixed(6);
  return {
    result(){
      if(store === 'waypoints') return { lat:r6(st.lat), lng:r6(st.lng) };
      if(r.kind === 'circle') return { center:[r6(st.center[0]), r6(st.center[1])], radius:Math.round(st.radius * 10) / 10 };
      return { points:st.points.map(p => [r6(p[0]), r6(p[1])]) };
    },
    stats(){ return Object.assign({}, r, this.result()); },
    stop(){ map.removeLayer(g); if(editing && editing.id === r.id){ editing = null; redraw(); } }
  };
}

/* Many saves can land at once (an import); redraw once they settle. */
let redrawTimer = null;
db.onChange(() => { clearTimeout(redrawTimer); redrawTimer = setTimeout(redraw, 60); }); redraw();

/* Everything else the item carries: folder, look, icon name and id from the app it came from,
   and any other fields an imported file had. */
function details(store, r){
  const rows = [];
  if(r.folder) rows.push(['Folder', esc(r.folder)]);
  if(store === 'waypoints') rows.push(['Icon', esc(iconLabel(r)) + (r.iconName && iconFor(r.iconName) !== r.icon ? ` <span class="small">(imported as “${esc(r.iconName)}”)</span>` : '')]);
  const c = store === 'waypoints' ? wpColor(r) : r.color || (store === 'tracks' ? '#d62828' : '#e8590c');
  rows.push(['Color', `<span class="swatch-sm" style="background:${esc(c)};vertical-align:-5px"></span> ${esc(c)}${r.opacity != null && r.opacity < 1 ? ' · ' + Math.round(r.opacity * 100) + '% opaque' : ''}`]);
  if(store !== 'waypoints'){
    rows.push(['Line style', STYLES[r.lineStyle || 'solid']]);
    rows.push(['Line width', String(r.weight || (store === 'tracks' ? 4 : 3))]);
  }
  if(r.sourceId) rows.push(['Imported ID', `<span class="mono">${esc(r.sourceId)}</span>`]);
  if(r.gpsAcc) rows.push(['GPS accuracy', `about ±${Math.round(r.gpsAcc * 3.28084)} ft${r.gpsN ? ` (averaged ${r.gpsN} readings)` : ''}`]);
  const extra = Object.entries(r.extra || {});
  return '<div class="block"><dl>' + rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('') + '</dl>' +
    (extra.length ? '<h3>More from the file</h3><dl>' + extra.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>' : '') + '</div>';
}

/* ---------- Viewing an item ---------- */
const head = (store, r) => {
  const icon = store === 'waypoints' ? `<span class="wp inline" style="background:${wpColor(r)};color:${inkOn(wpColor(r))}">${glyph(r.icon, 16)}</span>` : '';
  const kind = store === 'waypoints' ? iconLabel(r) : store === 'tracks' && r.dg ? 'Disc golf hole' : KIND[store === 'tracks' ? 'tracks' : r.kind];
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
    `<label class="switchrow"><span>Show on map<span class="small">${r.hidden ? 'Hidden for now; still saved' : 'Turn off to hide it without deleting'}</span></span>${toggle(store, r)}</label>` + LF.shadeSwitch() +
    '<div class="block">' + dl(stats(store, r).concat(here)) + '</div>' + details(store, r) +
    (r.notes ? `<div class="block"><p class="notes">${esc(r.notes)}</p></div>` : '') +
    (photos ? `<div class="photos">${photos}</div>` : '') +
    `<p class="note">Saved on this device ${r.updated ? new Date(r.updated).toLocaleDateString('en-US') : ''}. Back up from the layers panel to keep a copy.</p>`;
  const back = opts && opts.back;
  LF.showSheet(head(store, r), body, { pin:where(store, r), back, onAct:(act, el) => {
    if(act === 'edit') edit(store, r, false, back);
    if(act === 'route') LF.route.to(store === 'tracks' ? 'start of ' + (r.name || 'track') : r.name || KIND[r.kind] || 'waypoint', where(store, r));
    if(act === 'goto') goto(store === 'tracks' ? 'Start of ' + (r.name || 'track') : r.name || KIND[r.kind] || 'Waypoint', where(store, r));
    if(act === 'lookup'){ const p = where(store, r); LF.inspect(L.latLng(p[0], p[1])); }
    if(act === 'gpx') download(fileName(r.name || 'line-fence') + '.gpx', geo.toGPX({ [store]:[r] }), 'application/gpx+xml');
    if(act === 'photo') el.classList.toggle('big');
    if(act === 'vis') setHidden(store, r.id, !el.checked).then(() => {
      r.hidden = !el.checked;
      el.closest('.switchrow').querySelector('.small').textContent = r.hidden ? 'Hidden for now; still saved' : 'Turn off to hide it without deleting';
    });
    if(act === 'delete' && confirm('Delete "' + (r.name || KIND[store === 'tracks' ? 'tracks' : r.kind || 'waypoints']) + '"? This cannot be undone.')){
      db.del(store, r.id).then(() => { if(back) back.go(); else LF.closeSheet(); flash('Deleted'); });
    }
  } });
  selectItem(store, r);
}
/* Draw the open item prominently: a pulsing ring on a waypoint, a bold cased outline on a line, track, area or circle. */
function selectItem(store, r){
  const color = store === 'waypoints' ? wpColor(r) : r.color || (store === 'tracks' ? '#d62828' : '#e8590c');
  if(store === 'waypoints') return LF.select.point([r.lat, r.lng], { color });
  const w = (r.weight || (store === 'tracks' ? 4 : 3)) + 1;
  if(r.kind === 'circle') return LF.select.shape(geo.circlePts(r.center, r.radius, 64), { color, weight:w, closed:true, fill:.15 });
  const pts = (r.points || []).map(p => [p[0], p[1]]); if(pts.length < 2) return;
  LF.select.shape(pts, { color, weight:w, closed:r.kind === 'area', fill:.15 });
  if(store === 'tracks') LF.select.point(pts[0], { color });
}

/* ---------- Editing ---------- */
function edit(store, r, isNew, back){
  let photos = (r.photos || []).slice(), icon = r.icon || 'pin', color = r.color || (store === 'waypoints' ? '' : store === 'tracks' ? '#d62828' : '#e8590c');
  let lineStyle = r.lineStyle || 'solid', weight = r.weight || (store === 'tracks' ? 4 : 3);
  const iconBtns = () => Object.entries(ICONS).map(([k, v]) =>
    `<button type="button" class="iconpick${k === icon ? ' on' : ''}" data-act="icon" data-k="${k}" title="${esc(v[0])}" aria-label="${esc(v[0])}" style="background:${color || v[2]};color:${inkOn(color || v[2])}">${glyph(k)}</button>`).join('');
  const colorBtns = () => (store === 'waypoints' ? `<button type="button" class="swatch auto${!color ? ' on' : ''}" data-act="color" data-c="" title="Icon's own color">A</button>` : '') +
    COLORS.map(c => `<button type="button" class="swatch${c === color ? ' on' : ''}" data-act="color" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('') +
    `<label class="swatch custom${color && !COLORS.includes(color) ? ' on' : ''}" title="Any color" style="${color && !COLORS.includes(color) ? 'background:' + color : ''}">` +
      `<input type="color" data-act="color-any" value="${/^#[0-9a-f]{6}$/i.test(color) ? color : '#e8590c'}" aria-label="Pick any color">+</label>`;
  const thumbs = () => photos.map((p, i) => `<span class="thumb"><img src="${p}" alt=""><button type="button" data-act="rmphoto" data-i="${i}" aria-label="Remove photo">✕</button></span>`).join('');
  const kindName = store === 'waypoints' ? 'waypoint' : store === 'tracks' ? (r.dg ? 'disc golf hole' : 'track') : KIND[r.kind].toLowerCase();
  const html = `<form class="edit" onsubmit="return false">
    <label>Name<input id="f-name" maxlength="80" value="${esc(r.name || '')}" placeholder="Name this ${kindName}"></label>
    ${store === 'waypoints' ? `<div class="lbl">Icon</div><div class="icons" id="f-icons">${iconBtns()}</div>` : ''}
    <div class="lbl">Color</div><div class="swatches" id="f-colors">${colorBtns()}</div>
    ${store !== 'waypoints' ? `<div class="row2"><label>Line style<select id="f-style">${Object.entries(STYLES).map(([k, v]) => `<option value="${k}"${k === lineStyle ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Line width<select id="f-weight">${[2, 3, 4, 5, 6, 8, 10].concat([weight]).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).map(v => `<option value="${v}"${v === weight ? ' selected' : ''}>${v}</option>`).join('')}</select></label></div>` : ''}
    ${store === 'tracks' ? `<label>Type<select id="f-type" data-act="type"><option value="track"${r.dg ? '' : ' selected'}>Track</option><option value="dg"${r.dg ? ' selected' : ''}>Disc golf hole</option></select></label>
      <div id="f-dg"${r.dg ? '' : ' hidden'}><div class="row3"><label>Hole #<input id="f-hole" maxlength="6" inputmode="numeric" value="${esc((r.dg && r.dg.hole) || '')}"></label>
        <label>Par<select id="f-par">${['', 2, 3, 4, 5, 6].map(v => `<option value="${v}"${String(v) === String((r.dg && r.dg.par) || '') ? ' selected' : ''}>${v || '—'}</option>`).join('')}</select></label>
        <label>Fairway<select id="f-fair">${[0, 10, 15, 20, 30, 40, 60, 80].map(v => `<option value="${v}"${v === ((r.dg && r.dg.fairway) || 0) ? ' selected' : ''}>${v ? v + ' ft' : 'None'}</option>`).join('')}</select></label></div></div>` : ''}
    <label>Folder<input id="f-folder" list="f-folders" maxlength="60" value="${esc(r.folder || '')}" placeholder="None (type a new one or pick)"><datalist id="f-folders"></datalist></label>
    <label>Notes<textarea id="f-notes" rows="3" maxlength="4000" placeholder="Anything to remember">${esc(r.notes || '')}</textarea></label>
    ${store === 'waypoints' ? `<div class="lbl">Photos</div><div class="thumbs" id="f-photos">${thumbs()}</div>
      <label class="btn">Add photo<input type="file" accept="image/*" multiple hidden data-act="addphoto"></label>` : ''}
    <div class="btnrow acts"><button type="button" class="btn primary" data-act="save">Save</button><button type="button" class="btn" data-act="cancel">Cancel</button></div>
  </form>`;
  const DG_HINT = 'Drag the tee or basket; the line bends back to the nearest anchor. Tap the line to add an anchor, tap an anchor to remove it.';
  const hint = store === 'tracks' ? (r.dg ? DG_HINT : '') : store === 'waypoints' ? 'Drag it on the map to move it.'
    : r.kind === 'circle' ? 'Drag ✥ to move the circle, ↔ to change its size.' : 'Drag a white dot to move that corner, or ✥ to move the whole shape.';
  const sub = x => store === 'waypoints' ? geo.fmtLL([x.lat, x.lng]) : stats(store, x).map(s => s[1]).slice(0, 2).join(' · ');
  let ged = null;
  LF.showSheet(`<h2>${isNew ? 'New' : 'Edit'} ${kindName}</h2><div class="small${store === 'waypoints' ? ' mono' : ''}" id="f-where">${esc(sub(r))}</div>` +
    `<div class="edit-hint" id="f-hint"${hint ? '' : ' hidden'}>${hint}</div>`,
    html, { pin:null, onClose:() => { if(ged) ged.stop(); if(isNew) LF.emit('drawCancelled'); }, onAct: async (act, el, e) => {
    const $ = id => document.getElementById(id);
    if(act === 'icon'){ icon = el.dataset.k; $('f-icons').innerHTML = iconBtns(); }
    if(act === 'color'){ color = el.dataset.c; $('f-colors').innerHTML = colorBtns(); if($('f-icons')) $('f-icons').innerHTML = iconBtns(); }
    if(act === 'color-any' && e && e.type === 'change'){ color = el.value.toLowerCase(); $('f-colors').innerHTML = colorBtns(); if($('f-icons')) $('f-icons').innerHTML = iconBtns(); }
    if(act === 'rmphoto'){ photos.splice(+el.dataset.i, 1); $('f-photos').innerHTML = thumbs(); }
    if(act === 'type' && e && e.type === 'change'){
      // Switching to a disc golf hole turns on its handles (and back off for a plain track).
      const dg = el.value === 'dg'; $('f-dg').hidden = !dg; $('f-hint').hidden = !dg; $('f-hint').textContent = dg ? DG_HINT : '';
      if(ged) ged.stop(); ged = startEditor(dg);
    }
    if(act === 'addphoto'){
      for(const f of Array.from(el.files || [])){ try{ photos.push(await shrink(f)); }catch(e){ flash('Could not read that photo'); } }
      el.value = ''; $('f-photos').innerHTML = thumbs();
    }
    if(act === 'cancel'){ if(isNew) LF.closeSheet(); else open(store, r.id, { back }); }
    if(act === 'save'){
      if(!LF.account.require(store === 'waypoints' ? 'waypoints' : store)) return;
      const rec = Object.assign({}, r, { name:$('f-name').value.trim() || defaultName(store, r), notes:$('f-notes').value.trim(), color:color || undefined });
      const folder = cleanFolder($('f-folder').value); if(folder) rec.folder = folder; else delete rec.folder;
      if(ged){ const res = ged.result(); if(res.dgAnchors) delete res.dgAnchors; Object.assign(rec, res); }
      if(store === 'tracks'){
        if($('f-type').value === 'dg') rec.dg = { hole:$('f-hole').value.trim(), par:$('f-par').value, fairway:+$('f-fair').value,
          anchors:ged && ged.result().dgAnchors || (r.dg && r.dg.anchors) || [] };
        else delete rec.dg;
      }
      if(store === 'waypoints'){ if(icon !== r.icon) delete rec.iconName; rec.icon = icon; rec.photos = photos; }
      else { rec.lineStyle = $('f-style').value; rec.weight = +$('f-weight').value; if(rec.color !== r.color) delete rec.opacity; }
      try{
        const saved = await db.put(store, rec);
        if(isNew) db.persist();
        open(store, saved.id, { back });
      }catch(e){ flash(/quota/i.test(e && e.name) ? 'Storage is full. Remove some photos or saved items.' : 'Could not save: ' + (e.message || e), 5000); }
    }
  } });
  const startEditor = dg => geoEditor(store, r, color || (store === 'waypoints' ? wpColor(r) : r.dg || dg ? DG : '#e8590c'), () => {
    const w = document.getElementById('f-where'); if(w && ged) w.textContent = sub(ged.stats()); }, dg);
  ged = startEditor(!!r.dg);
  setTimeout(() => { const n = document.getElementById('f-name'); if(n && isNew && matchMedia('(pointer:fine)').matches) n.focus(); }, 50);
  allItems().then(items => { const dl = document.getElementById('f-folders'); if(dl) dl.innerHTML = folderNames(items).map(f => `<option value="${esc(f)}"></option>`).join(''); });
}
function defaultName(store, r){
  if(store === 'waypoints') return iconLabel(r);
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
db.ready().then(ok => ok && tidyDiscGolf()).catch(() => {});   // on open
LF.items = {
  cleanFolder:f => cleanFolder(f), dgFolder:n => dgFolder(n), dgParent:() => dgParent, tidyDiscGolf,
  open, ICONS,
  newWaypoint(ll, o){ o = o || {}; edit('waypoints', Object.assign({ lat:+(+ll[0]).toFixed(7), lng:+(+ll[1]).toFixed(7), icon:'pin', name:o.name || '' },
    o.gpsAcc ? { gpsAcc:o.gpsAcc, gpsN:o.gpsN } : {}), true); },
  newDrawing(d){ edit('drawings', d, true); },
  newTrack(t){ edit('tracks', t, true); },
  goto,
  editTrack(id){ db.get('tracks', id).then(t => t && edit('tracks', t, true)); },
  list,
  /* The folder tree for the menu: [{ name, path, n (items here and below), shown (any showing), kids }]. */
  tree:async () => {
    const all = await allItems(), root = { kids:new Map() };
    all.forEach(i => { let node = root, path = [];
      geo.folderPath(i.r.folder).forEach(part => { path.push(part);
        if(!node.kids.has(part)) node.kids.set(part, { name:part, path:geo.folderName(path), n:0, shown:false, kids:new Map() });
        node = node.kids.get(part); node.n++; if(!i.r.hidden) node.shown = true; }); });
    const out = m => Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name)).map(k => Object.assign(k, { kids:out(k.kids) }));
    return out(root.kids);
  },
  /* Show or hide everything in a folder and its subfolders. */
  async setFolderHidden(path, hidden){
    for(const i of await allItems()) if(under(i.r.folder, path) && !!i.r.hidden !== hidden) await setHidden(i.store, i.r.id, hidden);
  },
  counts:async () => { const all = await allItems(); const c = { all:all.length, folders:folderNames(all).map(f => [f, all.filter(i => cleanFolder(i.r.folder) === f).length]) };
    Object.keys(TYPES).forEach(t => { c[t] = all.filter(i => typeOf(i) === t).length; }); return c; }
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

/* ---------- Hide on map ----------
   Saved on the item itself, so it sticks across reloads and syncs to your other devices. */
/* An on/off switch: on = shown on the map. Acts on 'change' (data-act="vis"). */
const toggle = (store, r) => `<span class="switch" title="Show on map"><input type="checkbox" role="switch" data-act="vis" data-s="${store}" data-id="${esc(r.id)}"` +
  `${r.hidden ? '' : ' checked'} aria-label="Show ${esc(r.name || 'item')} on map"><span class="knob"></span></span>`;
async function setHidden(store, id, hidden){
  const r = await db.get(store, id); if(!r) return;
  if(hidden) r.hidden = true; else delete r.hidden;
  await db.put(store, r);
}

/* Drag a row by its ⠿ grip to a new place among its folder's rows (mouse, finger or pen); onDrop gets the new key order. */
function dragSort(rows, onDrop){
  rows.addEventListener('pointerdown', e => {
    const grip = e.target.closest('.grip'); if(!grip) return;
    e.preventDefault();
    const item = grip.closest('.row-wrap'), sheetEl = document.getElementById('sheet');
    const grabDy = e.clientY - item.getBoundingClientRect().top; let lastY = e.clientY, moved = false, timer = null;
    item.classList.add('dragging'); grip.setPointerCapture(e.pointerId);
    const place = () => {
      item.style.transform = '';
      // Move the row in the list once the pointer passes the middle of a neighbour, then float it under the pointer.
      const before = Array.from(rows.children).filter(r => r !== item).find(r => { const b = r.getBoundingClientRect(); return lastY < b.top + b.height / 2; });
      if(before ? item.nextElementSibling !== before : rows.lastElementChild !== item) rows.insertBefore(item, before || null);
      item.style.transform = `translateY(${lastY - grabDy - item.getBoundingClientRect().top}px)`;
    };
    // Near the top or bottom of the panel, scroll it so long folders can be sorted.
    const edgeScroll = () => { if(!moved) return; const b = sheetEl.getBoundingClientRect();
      const d = lastY < b.top + 50 ? -12 : lastY > b.bottom - 50 ? 12 : 0; if(d){ sheetEl.scrollTop += d; place(); } };
    const startY = e.clientY;
    const move = ev => { lastY = ev.clientY; if(Math.abs(lastY - startY) > 3) moved = true; place(); };
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      clearInterval(timer); item.classList.remove('dragging'); item.style.transform = '';
      if(moved) onDrop(Array.from(rows.children).map(r => r.dataset.k));
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    timer = setInterval(edgeScroll, 30);
  });
}

/* ---------- Sharing a folder ----------
   Share folder (link) publishes a copy of a folder's items (subfolders too) to the account server and gives a link,
   maps.dibberlab.me/#share=<id>. Anyone who opens it sees them on the map, holes and all, without an account;
   an approved account can Save to my map. Sharing the same folder again updates the copy behind the same link. */
async function shareFolder(f, arr){
  const pack = keepPhotos => arr.map(i => ({ store:i.store, data:Object.assign({}, i.r, keepPhotos ? {} : { photos:undefined }) }));
  let items = pack(true), note = '';
  if(JSON.stringify(items).length > 20e6){ items = pack(false); note = ' Photos were left out to keep it under the size limit.'; }
  const view = LF.shareLink({});   // the map as it is now (centre, zoom, panel tucked or not)
  flash('Sharing…', 8000);
  let res;
  try{ res = await LF.api('POST', 'shares', { folder:f, items }); }catch(e){ flash('Could not share: ' + e.message, 5000); return; }
  shareSheet(f, res, note, await LF.shortLink(view + (view.includes('#') ? '&' : '#') + 'share=' + encodeURIComponent(res.id)));
}
function shareSheet(f, res, note, url){
  LF.showSheet(`<h2>Share “${esc(f)}”</h2><div class="small">${res.count} item${res.count === 1 ? '' : 's'}</div>`,
    `<label>Link<input id="sh-url" readonly value="${esc(url)}"></label>
     <div class="btnrow acts">${navigator.share ? '<button class="btn primary" data-act="sh-send">Send…</button>' : ''}<button class="btn${navigator.share ? '' : ' primary'}" data-act="sh-copy">Copy link</button>
       <button class="btn danger" data-act="sh-stop">Stop sharing</button></div>
     <p class="note">Anyone with the link sees this folder on the map exactly where you're looking now; they don't need an account to look, and
       approved accounts can save a copy. Sharing this folder again updates the copy behind the same link.${esc(note)}</p>`,
    { back:{ label:'Back to ' + f, go:() => list({ folder:f }) }, onAct: async act => {
      if(act === 'sh-copy'){ try{ await navigator.clipboard.writeText(url); flash('Link copied'); }catch(e){ const i = document.getElementById('sh-url'); i.select(); flash('Select and copy the link'); } }
      if(act === 'sh-send'){ try{ await navigator.share({ title:f, text:f + ' on Line Fence', url }); }catch(e){} }
      if(act === 'sh-stop' && confirm(`Stop sharing “${f}”? The link will stop working.`)){
        try{ await LF.api('DELETE', 'shares/' + res.id, {}); flash('Sharing stopped; the link no longer works'); list({ folder:f }); }catch(e){ flash(e.message, 5000); } }
    } });
}

let preview = null;   // the shared folder being looked at: { id, folder, by, items, layer }
async function openShared(id, o){
  o = o || {};
  let sh;
  try{ sh = await LF.api('GET', 'shares/' + encodeURIComponent(id)); }catch(e){ flash(e.status === 404 ? 'That shared folder was removed or the link is wrong.' : 'Could not open the shared folder: ' + e.message, 6000); return; }
  closeShared(true);
  const layerP = L.layerGroup().addTo(map);
  const by = s => sh.items.filter(i => i.store === s).map(i => i.data);
  const wps = by('waypoints'), drs = by('drawings'), trs = by('tracks').filter(t => t.points && t.points.length > 1);
  drawRecords(layerP, wps, drs, trs, (store, r) => e => { L.DomEvent.stopPropagation(e); sharedItem(store, r); });
  preview = Object.assign({ layer:layerP }, sh);
  const b = L.latLngBounds([]); sh.items.forEach(i => { try{ b.extend(boundsOf(i.store, i.data)); }catch(e){} });
  if(b.isValid() && !o.keepView) LF.fitVisible ? LF.fitVisible(b, 17) : map.fitBounds(b);   // a link with a view opens right there
  sharedList();
  const it = o.item && sh.items.find(i => i.data.id === o.item);
  if(it) sharedItem(it.store, it.data);
  if(o.tucked) LF.tuckSheet(true);
}
function sharedList(){
  if(!preview) return;
  const p = preview, holes = p.items.filter(i => i.store === 'tracks' && i.data.dg).length;
  const order = (a, b) => (a.data.order != null ? a.data.order : 1e9) - (b.data.order != null ? b.data.order : 1e9) || String(a.data.name || '').localeCompare(String(b.data.name || ''), undefined, { numeric:true });
  const rows = p.items.slice().sort(order).map((i, n) => `<button class="row" data-act="sh-open" data-n="${p.items.indexOf(i)}"><span><b>${esc(i.data.name || 'Untitled')}</b>` +
    `<span class="small">${esc(i.store === 'tracks' && i.data.dg ? 'Disc golf hole' + (i.data.dg.par ? ' · par ' + i.data.dg.par : '') + ' · ' + geo.fmtFt(geo.length(i.data.points)) : i.store === 'waypoints' ? iconLabel(i.data) : i.store === 'tracks' ? 'Track' : KIND[i.data.kind])}</span></span></button>`).join('');
  LF.showSheet(`<h2>${esc(p.folder)}</h2><div><span class="tag saved">Shared by ${esc(p.by)}</span></div>` +
    `<div class="small">${p.count} item${p.count === 1 ? '' : 's'}${holes ? ` · ${holes} hole${holes === 1 ? '' : 's'}` : ''} · updated ${new Date(p.updated * 1000).toLocaleDateString('en-US')}</div>`,
    `<div class="btnrow acts"><button class="btn primary" data-act="sh-save">Save to my map</button><button class="btn" data-act="sh-close">Close</button></div>
     <div class="folders"><div class="rows">${rows}</div></div>
     <p class="note">You're looking at a copy someone shared. Save to my map keeps your own copy in a folder of the same name (saving again updates it).</p>`,
    { onClose:() => {}, share:{ params:() => ({ share:p.id }) }, onAct: async (act, el) => {
      if(act === 'sh-open'){ const i = p.items[+el.dataset.n]; map.fitBounds(boundsOf(i.store, i.data), { maxZoom:18, padding:[40, 40] }); sharedItem(i.store, i.data); }
      if(act === 'sh-close') closeShared();
      if(act === 'sh-save'){ if(!LF.account.require('waypoints, tracks and drawings')) return; await saveShared(); }
    } });
}
function sharedItem(store, r){
  const body = '<div class="block">' + dl(stats(store, r)) + '</div>' + details(store, r) + (r.notes ? `<div class="block"><p class="notes">${esc(r.notes)}</p></div>` : '');
  LF.showSheet(head(store, r).replace('<span class="tag saved">', '<span class="tag">'), body, { back:{ label:'Back to ' + preview.folder, go:sharedList },
    share:{ params:() => ({ share:preview.id, item:r.id }) } });
  selectItem(store, r);
}
async function saveShared(){
  const p = preview; if(!p) return;
  let n = 0;
  for(const i of p.items){
    // Its own id per share, so saving the same share again updates these copies instead of doubling them.
    const copy = Object.assign({}, i.data, { id:('sh-' + p.id + '-' + i.data.id).slice(0, 64), folder:i.data.folder || p.folder, sharedFrom:p.id });
    delete copy.hidden; delete copy.recording;
    await db.put(i.store, copy); n++;
  }
  db.persist();
  closeShared();
  flash(`Saved ${n} item${n === 1 ? '' : 's'} to “${p.folder}”`, 4000);
  list({ folder:p.folder });
}
function closeShared(keepSheet){
  if(!preview) return;
  map.removeLayer(preview.layer); preview = null;
  if(!keepSheet) LF.closeSheet();
}
LF.openShared = openShared;
// A share link opens the shared folder (at its view, item and panel state), whether the app was just opened with it or
// was already open. LF.fromLink was read before app.js rewrites the address bar with the map view.
const openLink = l => { if(l.share && /^[A-Za-z0-9_-]{8,32}$/.test(l.share)) openShared(l.share, { keepView:!!l.view, item:l.item, tucked:l.tucked }); };
if(LF.fromLink && LF.fromLink.share) setTimeout(() => openLink(LF.fromLink), 300);
window.addEventListener('hashchange', () => { const l = LF.share.parse(location.hash); if(l.share && !(preview && preview.id === l.share)) openLink(l); });

/* ---------- List, folders, selection, export, import ----------
   Items carry an optional folder name (r.folder, "Deer camp" or nested "Deer camp / Stands"), so folders
   sync with the items and exist while something is in them. Select mode adds checkboxes for bulk
   delete / move / hide / show / export. Collapsed folders are remembered per device. */
const NO_FOLDER = '';
let selecting = false, chosen = new Set(), filter = { type:null, folder:null }, backScroll = null;
/* What the list shows: a type (waypoints, tracks, line, area) and/or one folder, or everything. */
const TYPES = { waypoints:'Waypoints', tracks:'Tracks', line:'Lines', area:'Areas' };
const typeOf = i => i.store === 'drawings' ? (i.r.kind === 'circle' ? 'area' : i.r.kind) : i.store;
const keyOf = (store, r) => store + ':' + r.id;
const cleanFolder = f => geo.folderName(geo.folderPath(f));

/* Disc golf lives in one folder with a subfolder per course: "Disc Golf / Fish Lake", "Disc Golf / Rounds".
   tidyDiscGolf() (on open, and after sync brings changes) folds other spellings ("Disc golf") into it and moves a course
   folder made at the top level (a folder holding disc golf holes) underneath it, with everything else in that folder. */
const dgParent = 'Disc Golf';
const isDgParent = part => /^disc\s*golf$/i.test(part || '');
const dgFolder = name => dgParent + ' / ' + (cleanFolder(String(name || '').replace(/\//g, '-')) || 'Course');
async function tidyDiscGolf(){
  if(!(await db.ready())) return 0;
  const stores = ['waypoints', 'drawings', 'tracks'];
  const all = [].concat(...await Promise.all(stores.map(s => db.all(s).then(a => a.map(r => ({ store:s, r }))))));
  // A course folder: it holds disc golf holes, or tee pad / basket waypoints, or says "disc golf" in its name.
  const dgThing = i => (i.store === 'tracks' && i.r.dg) || (i.store === 'waypoints' && /^dg(tee|basket)$/.test(i.r.icon || ''));
  const courseTops = new Set(all.map(i => geo.folderPath(i.r.folder)).filter(p => p.length && !isDgParent(p[0]) && /disc\s*golf/i.test(p[0])).map(p => p[0])
    .concat(all.filter(dgThing).map(i => geo.folderPath(i.r.folder)).filter(p => p.length === 1 && !isDgParent(p[0])).map(p => p[0])));
  let moved = 0;
  for(const i of all){
    const parts = geo.folderPath(i.r.folder); if(!parts.length) continue;
    let to = null;
    if(isDgParent(parts[0]) && parts[0] !== dgParent) to = [dgParent].concat(parts.slice(1));
    else if(courseTops.has(parts[0])) to = [dgParent].concat(parts);
    if(to){ await db.put(i.store, Object.assign({}, i.r, { folder:geo.folderName(to) })); moved++; }
  }
  return moved;
}

async function allItems(){
  const [wps, drs, trs] = await Promise.all([db.all('waypoints'), db.all('drawings'), db.all('tracks')]);
  const me = LF.gps.last && LF.gps.last.ll, byNew = (a, b) => (b.r.updated || 0) - (a.r.updated || 0);
  return [].concat(
    wps.map(r => ({ store:'waypoints', r, icon:`<span class="wp inline" style="background:${wpColor(r)};color:${inkOn(wpColor(r))}">${glyph(r.icon, 16)}</span>`,
      meta:iconLabel(r) + (me ? ' · ' + geo.fmtDist(geo.dist(me, [r.lat, r.lng])) + ' away' : '') })).sort(byNew),
    drs.map(r => ({ store:'drawings', r, icon:`<span class="swatch-sm" style="background:${r.color || '#e8590c'}"></span>`, meta:KIND[r.kind] + ' · ' + stats('drawings', r)[0][1] })).sort(byNew),
    trs.filter(r => !r.recording).map(r => ({ store:'tracks', r, icon:`<span class="swatch-sm" style="background:${r.color || '#d62828'}"></span>`,
      meta:(r.dg ? 'Disc golf hole' + (r.dg.hole ? ' ' + r.dg.hole : '') + (r.dg.par ? ' · par ' + r.dg.par : '') + ' · ' + geo.fmtFt(geo.length(r.points))
        : 'Track · ' + stats('tracks', r).slice(0, 2).map(x => x[1]).join(' · ')) })).sort(byNew));
}
/* A folder holds its subfolders: "Siren cabin" covers "Siren cabin / Hunting". '' is "not in a folder". */
const under = (f, top) => { f = cleanFolder(f); return top ? f === top || f.startsWith(top + ' / ') : !f; };
const folderNames = items => Array.from(new Set(items.map(i => cleanFolder(i.r.folder)).filter(Boolean))).sort((a, b) => a.localeCompare(b));

async function list(opts){
  if(!(await db.ready())){ flash('This browser is blocking on-device storage.', 5000); return; }
  if(opts){ filter = { type:opts.type || null, folder:opts.folder != null ? opts.folder : null }; selecting = false; chosen.clear(); }   // opened fresh: not in Select mode
  const sheetEl = document.getElementById('sheet'), keepScroll = !sheetEl.hidden && LF.sheetBody.querySelector('.folders') ? sheetEl.scrollTop : 0;
  const everything = await allItems();
  const items = everything.filter(i => (!filter.type || typeOf(i) === filter.type) && (filter.folder == null || under(i.r.folder, filter.folder)));
  const counts = { all:everything.length }; Object.keys(TYPES).forEach(t => { counts[t] = everything.filter(i => typeOf(i) === t).length; });
  const chips = '<div class="chips-row">' + [['', 'All', counts.all]].concat(Object.entries(TYPES).map(([k, v]) => [k, v, counts[k]])).map(([k, v, n]) =>
      `<button class="fchip${(filter.type || '') === k && filter.folder == null ? ' on' : ''}" data-act="filter" data-t="${k}">${v} <span>${n}</span></button>`).join('') +
    (filter.folder != null ? `<button class="fchip on" data-act="filter" data-t="">📁 ${esc(filter.folder || 'Not in a folder')} ✕</button>` : '') + '</div>';
  const live = new Set(items.map(i => keyOf(i.store, i.r)));
  chosen = new Set(Array.from(chosen).filter(k => live.has(k)));
  const closed = new Set(LF.prefs.get('foldersClosed', []));
  const groups = new Map();
  folderNames(items).concat([NO_FOLDER]).forEach(f => groups.set(f, []));
  items.forEach(i => groups.get(cleanFolder(i.r.folder)).push(i));
  if(!groups.get(NO_FOLDER).length) groups.delete(NO_FOLDER);
  // Your own order (r.order, set by dragging ⠿) comes first; anything never placed keeps the usual order after it.
  groups.forEach(arr => { const pos = new Map(arr.map((i, n) => [i, n]));
    arr.sort((a, b) => (a.r.order != null ? a.r.order : 1e9 + pos.get(a)) - (b.r.order != null ? b.r.order : 1e9 + pos.get(b))); });
  const sortable = !selecting && !filter.type;   // sorting a type-filtered list would scramble the hidden ones

  const row = i => { const k = keyOf(i.store, i.r);
    return `<div class="row-wrap${i.r.hidden ? ' off' : ''}${chosen.has(k) ? ' picked' : ''}" data-k="${esc(k)}">` +
      (sortable ? `<span class="grip" title="Drag to reorder" aria-label="Drag to reorder ${esc(i.r.name || 'item')}">⠿</span>` : '') +
      (selecting ? `<span class="chk"><input type="checkbox" data-act="pick" data-k="${esc(k)}"${chosen.has(k) ? ' checked' : ''} aria-label="Select ${esc(i.r.name || 'item')}"></span>` : '') +
      `<button class="row" data-act="${selecting ? 'pick-row' : 'open'}" data-s="${i.store}" data-id="${esc(i.r.id)}" data-k="${esc(k)}">${i.icon}<span><b>${esc(i.r.name || 'Untitled')}</b><span class="small">${esc(i.meta)}${i.r.hidden ? ' · hidden' : ''}</span></span></button>` +
      toggle(i.store, i.r) + '</div>'; };
  const folderBlock = (f, arr) => {
    const name = !f ? 'Not in a folder' : filter.folder && f !== filter.folder && f.startsWith(filter.folder + ' / ') ? f.slice(filter.folder.length + 3) : f, isClosed = closed.has(f), anyShown = arr.some(i => !i.r.hidden);
    const allPicked = arr.every(i => chosen.has(keyOf(i.store, i.r)));
    return `<div class="folder${isClosed ? ' closed' : ''}" data-f="${esc(f)}"><div class="fhead">` +
      (selecting ? `<span class="chk"><input type="checkbox" data-act="pick-folder" data-f="${esc(f)}"${allPicked ? ' checked' : ''} aria-label="Select everything in ${esc(name)}"></span>` : '') +
      `<button class="fname" data-act="fold" data-f="${esc(f)}" aria-expanded="${!isClosed}"><span class="caret">▾</span>${f ? '<span class="ficon">📁</span>' : ''}<b>${esc(name)}</b><span class="small">${arr.length}</span></button>` +
      `<span class="switch" title="Show this folder on the map"><input type="checkbox" role="switch" data-act="fvis" data-f="${esc(f)}"${anyShown ? ' checked' : ''} aria-label="Show ${esc(name)} on map"><span class="knob"></span></span>` +
      (f ? `<button class="fmore" data-act="fmenu" data-f="${esc(f)}" aria-label="Folder options">⋯</button>` : '') + '</div>' +
      `<div class="fmenu" hidden><button class="btn" data-act="f-rename" data-f="${esc(f)}">Rename</button><button class="btn" data-act="f-unfile" data-f="${esc(f)}">Remove folder, keep items</button>` +
        (arr.some(i => i.store === 'tracks' && !i.r.dg) ? `<button class="btn" data-act="f-dg" data-f="${esc(f)}">Make its tracks disc golf holes</button>` : '') +
        (f ? `<button class="btn" data-act="f-share" data-f="${esc(f)}">Share folder (link)</button>` : '') +
      `<button class="btn danger" data-act="f-delete" data-f="${esc(f)}">Delete folder and items</button></div>` +
      `<div class="rows">${arr.map(row).join('')}</div></div>`;
  };
  const n = chosen.size, folders = folderNames(items);
  const pickedItems0 = () => items.filter(i => chosen.has(keyOf(i.store, i.r)));
  const bar = selecting ? `<div class="selbar"><label class="chk"><input type="checkbox" data-act="pick-all"${n && n === items.length ? ' checked' : ''}> Select all</label>` +
      `<span class="small">${n} selected</span><button class="btn" data-act="sel-done">Done</button></div>` +
    `<div class="btnrow acts selacts"><button class="btn danger" data-act="bulk-del"${n ? '' : ' disabled'}>Delete</button><button class="btn" data-act="bulk-move"${n ? '' : ' disabled'}>Move to folder</button>` +
      `<button class="btn" data-act="bulk-hide"${n ? '' : ' disabled'}>Hide</button><button class="btn" data-act="bulk-show"${n ? '' : ' disabled'}>Show</button>` +
      (pickedItems0().some(i => i.store === 'tracks') ? '<button class="btn" data-act="bulk-dg">Make disc golf holes</button>' : '') +
      `<button class="btn" data-act="bulk-kml"${n ? '' : ' disabled'}>Export KML</button><button class="btn" data-act="bulk-gpx"${n ? '' : ' disabled'}>Export GPX</button></div>` +
    `<div class="movebox" hidden><label>Move ${n} to<select id="mv-sel">${folders.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}<option value="__new">New folder…</option><option value="__none">Not in a folder</option></select></label>` +
      `<input id="mv-new" placeholder="New folder name" maxlength="60"${folders.length ? ' hidden' : ''}><button class="btn primary" data-act="mv-go">Move</button></div>`
    : '<div class="btnrow acts">' + (items.length ? '<button class="btn" data-act="sel-start">Select</button>' : '') +
      '<button class="btn" data-act="gpx-all">Export GPX</button><button class="btn" data-act="kml-all">Export KML</button>' +
      (items.some(i => i.r.hidden) ? '<button class="btn" data-act="show-all">Show all on map</button>' : '') +
      '<label class="btn">Import GPX/KML<input type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml,application/xml" hidden data-act="import"></label></div>';
  const body = chips + bar + (items.length ? '<div class="folders">' + Array.from(groups).map(([f, arr]) => folderBlock(f, arr)).join('') + '</div>'
      : `<p class="loading">${everything.length ? 'Nothing here. Tap All to see everything.' : 'Nothing saved yet. Use the + button to drop a waypoint, draw, or record a track.'}</p>`) +
    '<p class="note">Folders: pick one when you edit an item, or select several and Move to folder. KML imports keep their folders; other imports go into a folder named after the file.</p>';

  const pickedItems = () => items.filter(i => chosen.has(keyOf(i.store, i.r)));
  const inFolder = f => items.filter(i => cleanFolder(i.r.folder) === f);
  const asStores = arr => ({ waypoints:arr.filter(i => i.store === 'waypoints').map(i => i.r), drawings:arr.filter(i => i.store === 'drawings').map(i => i.r), tracks:arr.filter(i => i.store === 'tracks').map(i => i.r) });
  const setFolder = async (arr, f) => { for(const i of arr){ const r = Object.assign({}, i.r); if(f) r.folder = f; else delete r.folder; await db.put(i.store, r); } };
  const stamp = new Date().toISOString().slice(0, 10);

  const title = filter.folder != null ? (filter.folder || 'Not in a folder') : filter.type ? TYPES[filter.type] : 'My content';
  const shareFolderNow = filter.folder ? { run:() => { if(LF.account.require('sharing folders')) shareFolder(filter.folder, everything.filter(i => under(i.r.folder, filter.folder))); } } : null;
  LF.showSheet(`<h2>${esc(title)}</h2>`, body, { share:shareFolderNow, onAct: async (act, el) => {
    const f = el.dataset.f;
    if(act === 'filter'){ selecting = false; chosen.clear(); return list({ type:el.dataset.t || null }); }
    if(act === 'open'){ const y = sheetEl.scrollTop;
      open(el.dataset.s, el.dataset.id, { fly:true, back:{ label:'Back to ' + title, go:() => { backScroll = y; list(); } } }); }
    if(act === 'vis'){ await setHidden(el.dataset.s, el.dataset.id, !el.checked); list(); }
    if(act === 'fold'){ closed.has(f) ? closed.delete(f) : closed.add(f); LF.prefs.set('foldersClosed', Array.from(closed)); el.closest('.folder').classList.toggle('closed'); el.setAttribute('aria-expanded', String(!closed.has(f))); }
    if(act === 'fvis'){ for(const i of inFolder(f)) if(!!i.r.hidden === el.checked) await setHidden(i.store, i.r.id, !el.checked); list(); }
    if(act === 'fmenu'){ const m = el.closest('.folder').querySelector('.fmenu'); m.hidden = !m.hidden; }
    if(act === 'f-rename'){
      const to = cleanFolder(prompt('Rename folder', f) || '');
      if(to && to !== f){ await setFolder(inFolder(f), to); flash(`Renamed to “${to}”`); list(); }
    }
    if(act === 'f-dg' || act === 'bulk-dg'){
      // Mark tracks as disc golf holes (a folder's, subfolders too, or the selected ones); the hole number comes from the name.
      const arr = (act === 'f-dg' ? items.filter(i => under(i.r.folder, f)) : pickedItems()).filter(i => i.store === 'tracks' && !i.r.dg);
      for(const i of arr) await db.put('tracks', Object.assign({}, i.r, { dg:{ hole:holeFromName(i.r.name), par:'', fairway:0, anchors:[] } }));
      flash(`${arr.length} track${arr.length === 1 ? '' : 's'} marked as disc golf holes`); if(act === 'bulk-dg'){ chosen.clear(); selecting = false; } list();
    }
    if(act === 'f-share'){ if(LF.account.require('sharing folders')) shareFolder(f, items.filter(i => under(i.r.folder, f))); return; }
    if(act === 'f-unfile'){ await setFolder(inFolder(f), ''); flash(`Folder “${f}” removed; its items are kept`); list(); }
    if(act === 'f-delete'){
      const arr = inFolder(f);
      if(confirm(`Delete the folder “${f}” and its ${arr.length} item${arr.length === 1 ? '' : 's'}? This cannot be undone.`)){
        for(const i of arr) await db.del(i.store, i.r.id);
        flash(`Deleted “${f}”`); list();
      }
    }
    // Selecting
    if(act === 'sel-start'){ selecting = true; chosen.clear(); list(); }
    if(act === 'sel-done'){ selecting = false; chosen.clear(); list(); }
    if(act === 'pick' || act === 'pick-row'){
      const k = el.dataset.k;
      const on = act === 'pick' ? el.checked : !chosen.has(k);
      on ? chosen.add(k) : chosen.delete(k); list();
    }
    if(act === 'pick-folder'){ inFolder(f).forEach(i => el.checked ? chosen.add(keyOf(i.store, i.r)) : chosen.delete(keyOf(i.store, i.r))); list(); }
    if(act === 'pick-all'){ chosen = el.checked ? new Set(items.map(i => keyOf(i.store, i.r))) : new Set(); list(); }
    if(act === 'bulk-del'){
      const arr = pickedItems();
      if(arr.length && confirm(`Delete ${arr.length} item${arr.length === 1 ? '' : 's'}? This cannot be undone.`)){
        for(const i of arr) await db.del(i.store, i.r.id);
        chosen.clear(); flash(`Deleted ${arr.length} item${arr.length === 1 ? '' : 's'}`); list();
      }
    }
    if(act === 'bulk-hide' || act === 'bulk-show'){ for(const i of pickedItems()) await setHidden(i.store, i.r.id, act === 'bulk-hide'); list(); }
    if(act === 'bulk-kml') download('line-fence-' + stamp + '.kml', geo.toKML(asStores(pickedItems())), 'application/vnd.google-earth.kml+xml');
    if(act === 'bulk-gpx') download('line-fence-' + stamp + '.gpx', geo.toGPX(asStores(pickedItems())), 'application/gpx+xml');
    if(act === 'bulk-move'){ const m = LF.sheetBody.querySelector('.movebox'); m.hidden = !m.hidden; }
    if(act === 'mv-go'){
      const v = document.getElementById('mv-sel').value;
      const to = v === '__none' ? '' : v === '__new' ? cleanFolder(document.getElementById('mv-new').value) : v;
      if(v === '__new' && !to){ flash('Type a name for the new folder'); return; }
      const arr = pickedItems(); await setFolder(arr, to);
      chosen.clear(); selecting = false;
      flash(to ? `Moved ${arr.length} to “${to}”` : `Moved ${arr.length} out of folders`); list();
    }
    // Everything
    if(act === 'show-all'){ for(const i of items) if(i.r.hidden) await setHidden(i.store, i.r.id, false); list(); flash('Everything is showing on the map'); }
    if(act === 'gpx-all') download('line-fence-' + stamp + '.gpx', geo.toGPX(asStores(items)), 'application/gpx+xml');
    if(act === 'kml-all') download('line-fence-' + stamp + '.kml', geo.toKML(asStores(items)), 'application/vnd.google-earth.kml+xml');
    if(act === 'import'){
      const file = el.files && el.files[0]; el.value = ''; if(!file) return;
      try{ await importFile(await file.text(), file.name); list(); }catch(e){ flash(e.message || 'Import failed', 5000); }
    }
  } });
  const mv = document.getElementById('mv-sel');
  if(mv) mv.addEventListener('change', () => { document.getElementById('mv-new').hidden = mv.value !== '__new'; });
  if(keepScroll) sheetEl.scrollTop = keepScroll;
  if(sortable) LF.sheetBody.querySelectorAll('.folder .rows').forEach(rows => dragSort(rows, async keys => {
    // Save the new order of this folder's items (0, 1, 2…); each save syncs like any other edit.
    const byKey = new Map(items.map(i => [keyOf(i.store, i.r), i]));
    let n = 0; for(const k of keys){ const i = byKey.get(k); if(!i) continue; const o = n++; if(i.r.order !== o) await db.put(i.store, Object.assign({}, i.r, { order:o })); }
    list();
  }));
  if(backScroll != null){ sheetEl.scrollTop = backScroll; backScroll = null; }
}

/* Items keep the folders they had in a KML file (or a Line Fence GPX); everything else goes into a
   folder named after the file, so an import never scatters into the list. */
async function importFile(text, name){
  const got = geo.parseFile(text);
  const n = got.waypoints.length + got.drawings.length + got.tracks.length;
  if(!n) throw new Error('No waypoints, routes or tracks found in that file.');
  const fallback = cleanFolder(String(name || 'Imported').replace(/\.(gpx|kml|xml)$/i, '').replace(/[_]+/g, ' ')) || 'Imported';
  const withFolder = r => { r.folder = cleanFolder(r.folder) || fallback; return r; };
  // Importing the same file again updates what's already here (matched by the other app's id) instead of doubling it.
  // The saved copy keeps its own id, photos, hidden switch and created date.
  // Finish any sync first, so items still arriving from the account aren't added a second time.
  if(LF.sync && LF.sync.now) await Promise.resolve(LF.sync.now()).catch(() => {});
  const known = {}; let updated = 0;
  for(const s of ['waypoints', 'drawings', 'tracks']){ known[s] = new Map(); (await db.all(s)).forEach(r => { known[s].set(r.id, r); if(r.sourceId) known[s].set(r.sourceId, r); }); }
  const keep = (s, r) => { const cur = r.sourceId && known[s].get(r.sourceId); if(!cur) return r; updated++;
    return Object.assign(r, { id:cur.id, created:cur.created, hidden:cur.hidden, photos:cur.photos && cur.photos.length ? cur.photos : r.photos }); };
  const b = L.latLngBounds([]);
  for(const w of got.waypoints){
    if(!w.iconName && w.symName && !ICONS[w.icon]) w.iconName = w.symName;   // a GPX <sym> like "Crossing"
    delete w.symName;
    w.icon = w.iconName ? iconFor(w.iconName) : ICONS[w.icon] ? w.icon : 'pin';
    await db.put('waypoints', keep('waypoints', withFolder(w))); b.extend([w.lat, w.lng]);
  }
  for(const d of got.drawings){ await db.put('drawings', keep('drawings', withFolder(d))); d.points.forEach(p => b.extend(p)); }
  for(const t of got.tracks){
    const times = t.points.map(p => p[3]).filter(Boolean);
    t.started = times[0] || null; t.ended = times[times.length - 1] || null; t.pausedMs = 0;
    await db.put('tracks', keep('tracks', withFolder(t))); t.points.forEach(p => b.extend([p[0], p[1]]));
  }
  db.persist();
  if(b.isValid()) map.fitBounds(b, { maxZoom:16, padding:[40, 40] });
  const folders = new Set([].concat(got.waypoints, got.drawings, got.tracks).map(r => r.folder));
  flash(`Imported ${n} item${n === 1 ? '' : 's'} into ${folders.size === 1 ? '“' + Array.from(folders)[0] + '”' : folders.size + ' folders'}` +
    (updated ? ` (${updated} already here, updated)` : ''), 5000);
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
