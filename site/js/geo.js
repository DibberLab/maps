/* Line Fence: geometry, formatting and GPX/KML. Pure functions, no map or DOM
   except DOMParser for imports, so this file also runs in Node for tests.
   Points are [lat, lng] (tracks: [lat, lng, altMeters|null, timeMs]). */
(function(root){
'use strict';

const R = 6378137, D2R = Math.PI / 180, M_PER_MI = 1609.344, M_PER_FT = 0.3048, M2_PER_AC = 4046.8564224;

/* ---------- Geometry ---------- */
function dist(a, b){   // haversine, meters
  const dLat = (b[0]-a[0])*D2R, dLng = (b[1]-a[1])*D2R;
  const h = Math.sin(dLat/2)**2 + Math.cos(a[0]*D2R)*Math.cos(b[0]*D2R)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
}
function length(pts, closed){
  let m = 0;
  for(let i=1;i<pts.length;i++) m += dist(pts[i-1], pts[i]);
  if(closed && pts.length > 2) m += dist(pts[pts.length-1], pts[0]);
  return m;
}
function area(pts){    // spherical polygon area, m² (same method as Leaflet.draw)
  if(pts.length < 3) return 0;
  let a = 0;
  for(let i=0;i<pts.length;i++){
    const p1 = pts[i], p2 = pts[(i+1) % pts.length];
    a += (p2[1]-p1[1])*D2R * (2 + Math.sin(p1[0]*D2R) + Math.sin(p2[0]*D2R));
  }
  return Math.abs(a * R * R / 2);
}
function bearing(a, b){  // degrees from north, 0-360
  const f1 = a[0]*D2R, f2 = b[0]*D2R, dl = (b[1]-a[1])*D2R;
  const y = Math.sin(dl)*Math.cos(f2), x = Math.cos(f1)*Math.sin(f2) - Math.sin(f1)*Math.cos(f2)*Math.cos(dl);
  return (Math.atan2(y, x)/D2R + 360) % 360;
}
function dest(a, brgDeg, m){  // point m meters from a along bearing
  const d = m/R, t = brgDeg*D2R, f1 = a[0]*D2R, l1 = a[1]*D2R;
  const f2 = Math.asin(Math.sin(f1)*Math.cos(d) + Math.cos(f1)*Math.sin(d)*Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(f1), Math.cos(d) - Math.sin(f1)*Math.sin(f2));
  return [f2/D2R, ((l2/D2R + 540) % 360) - 180];
}
function circlePts(c, r, n){ n = n || 64; const o = []; for(let i=0;i<n;i++) o.push(dest(c, 360*i/n, r)); return o; }
function centroid(pts){ let la = 0, ln = 0; pts.forEach(p => { la += p[0]; ln += p[1]; }); return [la/pts.length, ln/pts.length]; }

/* Area of a GeoJSON Polygon or MultiPolygon in m², holes subtracted. */
function geojsonArea(g){
  if(!g) return 0;
  if(g.type === 'Feature') return geojsonArea(g.geometry);
  if(g.type === 'FeatureCollection') return g.features.reduce((s, f) => s + geojsonArea(f), 0);
  const poly = rings => rings.reduce((s, r, i) => s + (i ? -1 : 1) * area(r.map(c => [c[1], c[0]])), 0);
  if(g.type === 'Polygon') return Math.max(0, poly(g.coordinates));
  if(g.type === 'MultiPolygon') return g.coordinates.reduce((s, p) => s + Math.max(0, poly(p)), 0);
  return 0;
}

/* Is [lat, lng] inside a GeoJSON Polygon/MultiPolygon (holes respected)? */
function inRing(p, ring){   // ring of [lng, lat]
  let inside = false;
  for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if(((yi > p[0]) !== (yj > p[0])) && (p[1] < (xj - xi) * (p[0] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointIn(p, g){
  if(!g) return false;
  if(g.type === 'Feature') return pointIn(p, g.geometry);
  const poly = rings => rings.length && inRing(p, rings[0]) && !rings.slice(1).some(h => inRing(p, h));
  if(g.type === 'Polygon') return poly(g.coordinates);
  if(g.type === 'MultiPolygon') return g.coordinates.some(poly);
  return false;
}

/* Climb from noisy GPS altitudes: count a rise only once it beats `step` meters. */
function gain(alts, step){
  step = step || 4;
  let up = 0, base = null;
  for(const a of alts){
    if(a == null || !isFinite(a)) continue;
    if(base == null){ base = a; continue; }
    if(a - base >= step){ up += a - base; base = a; }
    else if(base - a >= step) base = a;
  }
  return up;
}

/* ---------- Formatting (US units) ---------- */
const n0 = v => Math.round(v).toLocaleString('en-US');
function fmtDist(m){
  if(!isFinite(m)) return '—';
  const ft = m / M_PER_FT;
  return ft < 1000 ? n0(ft) + ' ft' : (m / M_PER_MI).toFixed(m < 16093 ? 2 : 1) + ' mi';
}
function fmtArea(m2){
  const ac = m2 / M2_PER_AC;
  return ac < 0.1 ? n0(m2 / (M_PER_FT*M_PER_FT)) + ' sq ft' : (ac < 100 ? ac.toFixed(2) : n0(ac)) + ' ac';
}
function fmtTime(ms){
  const s = Math.max(0, Math.round(ms/1000)), h = Math.floor(s/3600), m = Math.floor(s%3600/60), sec = s%60;
  return (h ? h + ':' + String(m).padStart(2,'0') : m) + ':' + String(sec).padStart(2,'0');
}
function fmtPace(ms, m){  // minutes per mile
  if(m < 30 || ms < 1000) return '—';
  return fmtTime(ms / (m / M_PER_MI)) + ' /mi';
}
const fmtFt = m => m == null || !isFinite(m) ? '—' : n0(m / M_PER_FT) + ' ft';
const DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const fmtBearing = d => DIRS[Math.round(d / 22.5) % 16] + ' ' + Math.round(d) + '°';
const fmtLL = p => p[0].toFixed(5) + ', ' + p[1].toFixed(5);

/* ---------- GPX / KML export ---------- */
const xml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const iso = t => new Date(t).toISOString();
const shapePts = d => d.kind === 'circle' ? circlePts(d.center, d.radius) : d.points;

function toGPX(items){
  const o = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Line Fence (maps.dibberlab.me)" xmlns="http://www.topografix.com/GPX/1/1" xmlns:lf="https://maps.dibberlab.me/gpx/1">'];
  // GPX has no folders; Line Fence keeps an item's folder in an extension so its own exports round-trip.
  const fx = r => { const f = { folder:r.folder, id:r.sourceId || r.id, color:r.color, style:r.lineStyle, weight:r.weight, icon:r.iconName };
    Object.assign(f, r.extra || {});
    const rows = Object.entries(f).filter(([k, v]) => v != null && v !== '' && /^[a-z][\w-]*$/i.test(k)).map(([k, v]) => `<lf:${k}>${xml(v)}</lf:${k}>`).join('');
    return rows ? `<extensions>${rows}</extensions>` : ''; };
  (items.waypoints || []).forEach(w => o.push(`<wpt lat="${w.lat}" lon="${w.lng}"><name>${xml(w.name)}</name>` +
    (w.notes ? `<desc>${xml(w.notes)}</desc>` : '') + `<sym>${xml(w.icon || 'pin')}</sym>${fx(w)}</wpt>`));
  (items.drawings || []).forEach(d => {
    const pts = shapePts(d); if(d.kind !== 'line') pts.push(pts[0]);
    o.push(`<rte><name>${xml(d.name)}</name>` + (d.notes ? `<desc>${xml(d.notes)}</desc>` : '') +
      `<type>${d.kind === 'line' ? 'line' : 'area'}</type>${fx(d)}` + pts.map(p => `<rtept lat="${p[0]}" lon="${p[1]}"/>`).join('') + '</rte>');
  });
  (items.tracks || []).forEach(t => o.push(`<trk><name>${xml(t.name)}</name>` + (t.notes ? `<desc>${xml(t.notes)}</desc>` : '') + fx(t) + '<trkseg>' +
    t.points.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}">` + (p[2] != null ? `<ele>${p[2].toFixed(1)}</ele>` : '') +
      (p[3] ? `<time>${iso(p[3])}</time>` : '') + '</trkpt>').join('') + '</trkseg></trk>'));
  o.push('</gpx>');
  return o.join('\n');
}

const kmlColor = (hex, alpha) => { const h = (hex || '#e8590c').replace('#',''); return (alpha || 'ff') + h.slice(4,6) + h.slice(2,4) + h.slice(0,2); };
function toKML(items){
  const coords = pts => pts.map(p => p[1] + ',' + p[0] + (p[2] != null ? ',' + p[2].toFixed(1) : '')).join(' ');
  const data = r => { const f = { notes:r.notes, id:r.sourceId || r.id, color:r.color, style:r.lineStyle, weight:r.weight, icon:r.iconName || (r.icon ? r.icon : null) };
    Object.assign(f, r.extra || {});
    const rows = Object.entries(f).filter(([, v]) => v != null && v !== '').map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(v)}</value></Data>`).join('');
    return rows ? `<ExtendedData>${rows}</ExtendedData>` : ''; };
  const pm = (name, notes, style, geom, r) => `<Placemark><name>${xml(name)}</name>` + (notes ? `<description>${xml(notes)}</description>` : '') + (r ? data(r) : '') + style + geom + '</Placemark>';
  // Folders become KML <Folder>s; "Deer camp / Stands" nests Stands inside Deer camp.
  const tree = { kids:new Map(), marks:[] };
  const into = (folder, mark) => {
    let node = tree;
    folderPath(folder).forEach(part => { if(!node.kids.has(part)) node.kids.set(part, { kids:new Map(), marks:[] }); node = node.kids.get(part); });
    node.marks.push(mark);
  };
  (items.waypoints || []).forEach(w => into(w.folder, pm(w.name, w.notes, `<Style><IconStyle><color>${kmlColor(w.color)}</color></IconStyle></Style>`, `<Point><coordinates>${w.lng},${w.lat}</coordinates></Point>`, w)));
  (items.drawings || []).forEach(d => {
    const st = `<Style><LineStyle><color>${kmlColor(d.color)}</color><width>${d.weight || 3}</width></LineStyle><PolyStyle><color>${kmlColor(d.color,'44')}</color></PolyStyle></Style>`;
    const pts = shapePts(d);
    into(d.folder, pm(d.name, d.notes, st, d.kind === 'line' ? `<LineString><coordinates>${coords(pts)}</coordinates></LineString>`
      : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(pts.concat([pts[0]]))}</coordinates></LinearRing></outerBoundaryIs></Polygon>`, d));
  });
  (items.tracks || []).forEach(t => into(t.folder, pm(t.name, t.notes, `<Style><LineStyle><color>${kmlColor(t.color)}</color><width>${t.weight || 4}</width></LineStyle></Style>`,
    `<LineString><coordinates>${coords(t.points)}</coordinates></LineString>`, t)));
  const write = node => node.marks.join('\n') + Array.from(node.kids).map(([name, k]) => `\n<Folder><name>${xml(name)}</name>\n${write(k)}\n</Folder>`).join('');
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Line Fence</name>', write(tree), '</Document></kml>'].join('\n');
}

/* ---------- Item details carried in files (onX and others) ----------
   Files keep extra fields per item: KML <ExtendedData> (<Data name> / <SimpleData name>), GPX <extensions>,
   or "key=value" lines in the description (onX: name, notes, id, color=rgba(...), style=dash, weight=6.0,
   icon=Crossing). Known ones map onto the item; everything else is kept in item.extra and shown on its card. */
const hex2 = n => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
function parseColor(v){
  v = String(v || '').trim();
  let m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if(m) return { color:'#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]), opacity:m[4] != null ? +m[4] : 1 };
  m = v.match(/^#?([0-9a-f]{6})$/i);
  if(m) return { color:'#' + m[1].toLowerCase(), opacity:1 };
  m = v.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);   // KML: aabbggrr
  if(m) return { color:'#' + m[4] + m[3] + m[2], opacity:parseInt(m[1], 16) / 255 };
  return null;
}
const normStyle = v => /dot/i.test(v) ? 'dot' : /dash/i.test(v) ? 'dash' : /solid|line/i.test(v) ? 'solid' : null;
const KNOWN = new Set(['name', 'notes', 'note', 'desc', 'description', 'id', 'uuid', 'color', 'colour', 'style', 'linestyle', 'weight', 'width', 'linewidth',
  'icon', 'sym', 'folder', 'type', 'hidden']);
function kvLines(text){
  const lines = String(text || '').split(/\r?\n/), out = {};
  let n = 0;
  lines.forEach(l => { const m = l.match(/^\s*([A-Za-z][\w :-]{0,30}?)\s*=\s*(.*)$/); if(m){ out[m[1].trim().toLowerCase()] = m[2].trim(); n++; } });
  return n >= 2 ? out : null;
}
function applyFields(item, f){
  if(!f) return item;
  const get = (...ks) => { for(const k of ks) if(f[k] != null && String(f[k]).trim() !== '') return String(f[k]).trim(); return null; };
  const name = get('name'); if(name) item.name = name;
  const notes = get('notes', 'note'); if(notes != null) item.notes = notes;
  const id = get('id', 'uuid'); if(id) item.sourceId = id;
  const c = parseColor(get('color', 'colour')); if(c){ item.color = c.color; if(c.opacity < 1) item.opacity = +c.opacity.toFixed(2); }
  const st = normStyle(get('style', 'linestyle') || ''); if(st) item.lineStyle = st;
  const w = parseFloat(get('weight', 'width', 'linewidth')); if(isFinite(w) && w > 0) item.weight = Math.min(12, Math.max(1, +w.toFixed(1)));
  const ic = get('icon'); if(ic) item.iconName = ic;
  const extra = {};
  Object.entries(f).forEach(([k, v]) => { if(!KNOWN.has(k) && v != null && String(v).trim() !== '') extra[k] = String(v).trim(); });
  if(Object.keys(extra).length) item.extra = extra;
  return item;
}

/* "Deer camp / Stands" -> ['Deer camp', 'Stands']; the one way folder names nest. */
const folderPath = f => String(f || '').split('/').map(s => s.trim()).filter(Boolean);
const folderName = parts => parts.map(s => s.replace(/\//g, '-').trim()).filter(Boolean).join(' / ');

/* ---------- GPX / KML import ---------- */
function parseFile(text, Parser){
  Parser = Parser || (typeof DOMParser !== 'undefined' ? DOMParser : null);
  if(!Parser) throw new Error('No XML parser available');
  const doc = new Parser().parseFromString(text, 'application/xml');
  if(doc.getElementsByTagName('parsererror').length) throw new Error('This file is not valid GPX or KML.');
  const out = { waypoints:[], drawings:[], tracks:[] };
  const kids = (el, tag) => Array.from(el.getElementsByTagName(tag));
  const txt = (el, tag) => { const e = el.getElementsByTagName(tag)[0]; return e ? e.textContent.trim() : ''; };
  const num = v => { const x = parseFloat(v); return isFinite(x) ? x : null; };
  const ll = e => [num(e.getAttribute('lat')), num(e.getAttribute('lon'))];
  const ok = p => p[0] != null && p[1] != null && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
  const root = doc.documentElement.nodeName.toLowerCase();

  if(root === 'gpx'){
    const gpxFields = el => {
      const out = {}, ext = Array.from(el.childNodes).find(c => c.nodeName === 'extensions');
      if(ext) Array.from(ext.getElementsByTagName('*')).forEach(e => { if(!e.children.length) out[(e.localName || e.nodeName.split(':').pop()).toLowerCase()] = e.textContent.trim(); });
      const kv = kvLines(txt(el, 'desc')); if(kv) Object.assign(out, kv, kv.notes != null ? {} : { notes:'' });
      return out;
    };
    const fold = el => { const f = el.getElementsByTagName('lf:folder')[0] || (el.getElementsByTagNameNS ? el.getElementsByTagNameNS('https://maps.dibberlab.me/gpx/1', 'folder')[0] : null); return f ? folderName(folderPath(f.textContent)) : ''; };
    kids(doc, 'wpt').forEach(w => { const p = ll(w); if(ok(p)) out.waypoints.push(applyFields({ name:txt(w,'name') || 'Waypoint', notes:txt(w,'desc'), icon:txt(w,'sym').toLowerCase(), symName:txt(w,'sym'), lat:p[0], lng:p[1], folder:fold(w) }, gpxFields(w))); });
    kids(doc, 'rte').forEach(r => {
      const pts = kids(r, 'rtept').map(ll).filter(ok);
      const isArea = /^area$/i.test(txt(r, 'type'));   // Line Fence writes "area", onX "Area"
      const a = pts[0], z = pts[pts.length - 1];
      if(isArea && pts.length > 3 && a[0] === z[0] && a[1] === z[1]) pts.pop();
      if(pts.length >= 2) out.drawings.push(applyFields({ kind:isArea ? 'area' : 'line', name:txt(r,'name') || 'Route', notes:txt(r,'desc'), points:pts, folder:fold(r) }, gpxFields(r)));
    });
    kids(doc, 'trk').forEach(t => {
      const pts = kids(t, 'trkpt').map(e => { const p = ll(e), tm = Date.parse(txt(e,'time'));
        return [p[0], p[1], num(txt(e,'ele')), isFinite(tm) ? tm : null]; }).filter(ok);
      if(pts.length >= 2) out.tracks.push(applyFields({ name:txt(t,'name') || 'Track', notes:txt(t,'desc'), points:pts, folder:fold(t) }, gpxFields(t)));
    });
  } else if(root === 'kml'){
    const parseCoords = s => s.trim().split(/\s+/).map(c => { const a = c.split(',').map(num); return [a[1], a[0], a[2] != null ? a[2] : null]; }).filter(ok);
    // A placemark's folder is the path of <Folder> names around it (onX and Google Earth export this way).
    const ownName = el => { for(const c of Array.from(el.childNodes)) if(c.nodeName === 'name') return c.textContent.trim(); return ''; };
    const pathOf = pm => { const parts = []; for(let e = pm.parentNode; e && e.nodeName !== 'kml'; e = e.parentNode) if(e.nodeName === 'Folder') parts.unshift(ownName(e)); return folderName(parts); };
    const kmlFields = pm => {
      const out = {};
      Array.from(pm.getElementsByTagName('Data')).forEach(d => { const v = d.getElementsByTagName('value')[0]; out[(d.getAttribute('name') || '').toLowerCase()] = v ? v.textContent.trim() : ''; });
      Array.from(pm.getElementsByTagName('SimpleData')).forEach(d => { out[(d.getAttribute('name') || '').toLowerCase()] = d.textContent.trim(); });
      const kv = kvLines(txt(pm, 'description')); if(kv){ Object.assign(out, kv); if(kv.notes == null) out.notes = ''; }
      const ls = pm.getElementsByTagName('LineStyle')[0];   // inline style, when there's no colour/width field
      if(ls){ if(!out.color && txt(ls, 'color')) out.color = txt(ls, 'color'); if(!out.weight && txt(ls, 'width')) out.weight = txt(ls, 'width'); }
      delete out['']; return out;
    };
    kids(doc, 'Placemark').forEach(pm => {
      const name = txt(pm, 'name'), notes = txt(pm, 'description'), folder = pathOf(pm), f = kmlFields(pm);
      const before = { waypoints:out.waypoints.length, drawings:out.drawings.length };
      const pt = pm.getElementsByTagName('Point')[0], ls = pm.getElementsByTagName('LineString')[0], pg = pm.getElementsByTagName('Polygon')[0];
      if(pt){ const p = parseCoords(txt(pt,'coordinates'))[0]; if(p) out.waypoints.push({ name:name || 'Waypoint', notes, lat:p[0], lng:p[1], folder }); }
      else if(ls){ const p = parseCoords(txt(ls,'coordinates')); if(p.length >= 2) out.drawings.push({ kind:'line', name:name || 'Line', notes, points:p.map(q => [q[0], q[1]]), folder }); }
      else if(pg){ const ring = pg.getElementsByTagName('outerBoundaryIs')[0] || pg;
        const p = parseCoords(txt(ring,'coordinates')).map(q => [q[0], q[1]]);
        if(p.length > 3 && p[0][0] === p[p.length-1][0] && p[0][1] === p[p.length-1][1]) p.pop();
        if(p.length >= 3) out.drawings.push({ kind:'area', name:name || 'Area', notes, points:p, folder }); }
      if(out.waypoints.length > before.waypoints) applyFields(out.waypoints[out.waypoints.length - 1], f);
      if(out.drawings.length > before.drawings) applyFields(out.drawings[out.drawings.length - 1], f);
    });
  } else throw new Error('Only GPX and KML files can be imported.');
  return out;
}

const api = { parseColor, folderPath, folderName, dist, length, area, geojsonArea, pointIn, bearing, dest, circlePts, centroid, gain, shapePts,
  fmtDist, fmtArea, fmtTime, fmtPace, fmtFt, fmtBearing, fmtLL, toGPX, toKML, parseFile, M2_PER_AC };
if(typeof module !== 'undefined' && module.exports) module.exports = api;
else { root.LF = root.LF || {}; root.LF.geo = api; }
})(typeof window !== 'undefined' ? window : globalThis);
