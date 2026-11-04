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
    '<gpx version="1.1" creator="Line Fence (maps.dibberlab.me)" xmlns="http://www.topografix.com/GPX/1/1">'];
  (items.waypoints || []).forEach(w => o.push(`<wpt lat="${w.lat}" lon="${w.lng}"><name>${xml(w.name)}</name>` +
    (w.notes ? `<desc>${xml(w.notes)}</desc>` : '') + `<sym>${xml(w.icon || 'pin')}</sym></wpt>`));
  (items.drawings || []).forEach(d => {
    const pts = shapePts(d); if(d.kind !== 'line') pts.push(pts[0]);
    o.push(`<rte><name>${xml(d.name)}</name>` + (d.notes ? `<desc>${xml(d.notes)}</desc>` : '') +
      `<type>${d.kind === 'line' ? 'line' : 'area'}</type>` + pts.map(p => `<rtept lat="${p[0]}" lon="${p[1]}"/>`).join('') + '</rte>');
  });
  (items.tracks || []).forEach(t => o.push(`<trk><name>${xml(t.name)}</name>` + (t.notes ? `<desc>${xml(t.notes)}</desc>` : '') + '<trkseg>' +
    t.points.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}">` + (p[2] != null ? `<ele>${p[2].toFixed(1)}</ele>` : '') +
      (p[3] ? `<time>${iso(p[3])}</time>` : '') + '</trkpt>').join('') + '</trkseg></trk>'));
  o.push('</gpx>');
  return o.join('\n');
}

const kmlColor = (hex, alpha) => { const h = (hex || '#e8590c').replace('#',''); return (alpha || 'ff') + h.slice(4,6) + h.slice(2,4) + h.slice(0,2); };
function toKML(items){
  const coords = pts => pts.map(p => p[1] + ',' + p[0] + (p[2] != null ? ',' + p[2].toFixed(1) : '')).join(' ');
  const pm = (name, notes, style, geom) => `<Placemark><name>${xml(name)}</name>` + (notes ? `<description>${xml(notes)}</description>` : '') + style + geom + '</Placemark>';
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Line Fence</name>'];
  (items.waypoints || []).forEach(w => o.push(pm(w.name, w.notes, `<Style><IconStyle><color>${kmlColor(w.color)}</color></IconStyle></Style>`, `<Point><coordinates>${w.lng},${w.lat}</coordinates></Point>`)));
  (items.drawings || []).forEach(d => {
    const st = `<Style><LineStyle><color>${kmlColor(d.color)}</color><width>3</width></LineStyle><PolyStyle><color>${kmlColor(d.color,'44')}</color></PolyStyle></Style>`;
    const pts = shapePts(d);
    o.push(pm(d.name, d.notes, st, d.kind === 'line' ? `<LineString><coordinates>${coords(pts)}</coordinates></LineString>`
      : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(pts.concat([pts[0]]))}</coordinates></LinearRing></outerBoundaryIs></Polygon>`));
  });
  (items.tracks || []).forEach(t => o.push(pm(t.name, t.notes, `<Style><LineStyle><color>${kmlColor(t.color)}</color><width>3</width></LineStyle></Style>`,
    `<LineString><coordinates>${coords(t.points)}</coordinates></LineString>`)));
  o.push('</Document></kml>');
  return o.join('\n');
}

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
    kids(doc, 'wpt').forEach(w => { const p = ll(w); if(ok(p)) out.waypoints.push({ name:txt(w,'name') || 'Waypoint', notes:txt(w,'desc'), icon:txt(w,'sym').toLowerCase(), lat:p[0], lng:p[1] }); });
    kids(doc, 'rte').forEach(r => {
      const pts = kids(r, 'rtept').map(ll).filter(ok);
      const isArea = txt(r, 'type') === 'area';
      if(isArea && pts.length > 3) pts.pop();
      if(pts.length >= 2) out.drawings.push({ kind:isArea ? 'area' : 'line', name:txt(r,'name') || 'Route', notes:txt(r,'desc'), points:pts });
    });
    kids(doc, 'trk').forEach(t => {
      const pts = kids(t, 'trkpt').map(e => { const p = ll(e), tm = Date.parse(txt(e,'time'));
        return [p[0], p[1], num(txt(e,'ele')), isFinite(tm) ? tm : null]; }).filter(ok);
      if(pts.length >= 2) out.tracks.push({ name:txt(t,'name') || 'Track', notes:txt(t,'desc'), points:pts });
    });
  } else if(root === 'kml'){
    const parseCoords = s => s.trim().split(/\s+/).map(c => { const a = c.split(',').map(num); return [a[1], a[0], a[2] != null ? a[2] : null]; }).filter(ok);
    kids(doc, 'Placemark').forEach(pm => {
      const name = txt(pm, 'name'), notes = txt(pm, 'description');
      const pt = pm.getElementsByTagName('Point')[0], ls = pm.getElementsByTagName('LineString')[0], pg = pm.getElementsByTagName('Polygon')[0];
      if(pt){ const p = parseCoords(txt(pt,'coordinates'))[0]; if(p) out.waypoints.push({ name:name || 'Waypoint', notes, lat:p[0], lng:p[1] }); }
      else if(ls){ const p = parseCoords(txt(ls,'coordinates')); if(p.length >= 2) out.drawings.push({ kind:'line', name:name || 'Line', notes, points:p.map(q => [q[0], q[1]]) }); }
      else if(pg){ const ring = pg.getElementsByTagName('outerBoundaryIs')[0] || pg;
        const p = parseCoords(txt(ring,'coordinates')).map(q => [q[0], q[1]]);
        if(p.length > 3 && p[0][0] === p[p.length-1][0] && p[0][1] === p[p.length-1][1]) p.pop();
        if(p.length >= 3) out.drawings.push({ kind:'area', name:name || 'Area', notes, points:p }); }
    });
  } else throw new Error('Only GPX and KML files can be imported.');
  return out;
}

const api = { dist, length, area, bearing, dest, circlePts, centroid, gain, shapePts,
  fmtDist, fmtArea, fmtTime, fmtPace, fmtFt, fmtBearing, fmtLL, toGPX, toKML, parseFile, M2_PER_AC };
if(typeof module !== 'undefined' && module.exports) module.exports = api;
else { root.LF = root.LF || {}; root.LF.geo = api; }
})(typeof window !== 'undefined' ? window : globalThis);
