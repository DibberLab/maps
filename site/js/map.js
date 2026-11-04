/* Line Fence: the map, base maps, data layers and the layers panel. */
window.LF = window.LF || {};
(function(LF){
'use strict';

/* ---------- Data sources (all free, public, no API keys) ---------- */
const SRC = LF.SRC = {
  wiParcels: 'https://services3.arcgis.com/n6uYoouQZW75n5WI/ArcGIS/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0',
  mnParcels: 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/1',
  mnCoverage:'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/0',
  padus:     'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Public_Access/FeatureServer/0',
  wiDnr:     'https://dnrmaps.wi.gov/arcgis/rest/services/LF_DML/LF_DNR_MGD_PROP_WTM_Ext/MapServer',
  wiClosed:  'https://dnrmaps.wi.gov/arcgis2/rest/services/WM_PROP_MGMT/WM_CLOSED_RESTRICTED_AREAS_WTM_Ext/MapServer',
  /* WI DNR tax-law enrollments: one point per 40-acre block, AC_OP_PLS = acres open to the public. */
  wiMfl:     'https://services5.arcgis.com/Ul9AyFFeFTjf08DW/arcgis/rest/services/X13661_FR_GIS_TAXLAW_PT_SV/FeatureServer/0',
  /* MN DNR management units (WMAs, state forests, SNAs, AMAs): layer 3 of this service. */
  mnDnr:     'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_dnr_managed_areas/MapServer',
  mnWia:     'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_dnr_walk_in_access_sites/MapServer',
  /* MN DNR trails, forest roads and water accesses (layer 0 of each). */
  mnStateTrails: 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/trans_state_trails_minnesota/MapServer/0',
  mnHunterTrails:'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/trans_hunter_walking_trails/MapServer/0',
  mnOhv:         'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/trans_ohv_trails_mn/MapServer/0',
  mnSnowmobile:  'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/trans_snowmobile_trails_mn/MapServer/0',
  mnForestRoads: 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/trans_state_forest_roads/MapServer/0',
  mnAccess:      'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/struc_water_access_sites/MapServer/0'
};
/* How each MN trail / road / access layer is drawn; identify.js shares these for tap details. */
const REC = LF.REC = {
  mnStateTrails: { color:'#2e7d32', dash:null, label:'State trail' },
  mnHunterTrails:{ color:'#e8590c', dash:'7 5', label:'Hunter walking trail' },
  mnOhv:         { color:'#c62828', dash:'9 5', label:'ATV / OHV trail' },
  mnSnowmobile:  { color:'#1565c0', dash:'2 6', label:'Snowmobile trail' },
  mnForestRoads: { color:'#795548', dash:null, label:'State forest road' },
  mnAccess:      { color:'#0277bd', label:'Water access' }
};
LF.MN_DNR_LAYER = 3;
const PARCEL_ZOOM = LF.PARCEL_ZOOM = 15;
const prefs = LF.prefs;

/* A link (#map=…) wins over the last view saved on this device. */
const fromLink = LF.share.parse(location.hash);
LF.fromLink = fromLink;
const saved = prefs.get('view', [45.6, -92.0, 7]);
const start = fromLink.view || saved;

/* ---------- Map ---------- */
const map = LF.map = L.map('map', { zoomControl:true, preferCanvas:true, maxZoom:20 })
  .setView([start[0], start[1]], start[2] || 7);
map.zoomControl.setPosition('bottomleft');

const usgs = s => 'https://basemap.nationalmap.gov/arcgis/rest/services/' + s + '/MapServer/tile/{z}/{y}/{x}';
const bases = LF.bases = {
  hyb:  L.tileLayer(usgs('USGSImageryTopo'), { maxNativeZoom:16, maxZoom:20, attribution:'Imagery and roads: USGS The National Map' }),
  img:  L.tileLayer(usgs('USGSImageryOnly'), { maxNativeZoom:16, maxZoom:20, attribution:'Imagery: USGS The National Map' }),
  topo: L.tileLayer(usgs('USGSTopo'),        { maxNativeZoom:16, maxZoom:20, attribution:'Topo: USGS The National Map' }),
  osm:  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxNativeZoom:19, maxZoom:20, attribution:'&copy; OpenStreetMap contributors' })
};
/* ---------- Sharp close-up imagery (zoom 17+) ----------
   The USGS tiles above stop at zoom 16. Past that, these image services draw
   sharper imagery on request: WI DNR leaf-off (WROC 2020/2025, down to ~3 in
   pixels, Wisconsin only) and USGS NAIP Plus (~1 ft, nationwide, summer).
   They're slow (seconds per tile), so they sit on top of the stretched zoom-16
   tiles, which show at once. 512 px tiles halve the number of requests. */
const MERC = 20037508.342789244;
const ExportTiles = L.TileLayer.extend({
  initialize(url, extra, opts){ this._svc = url; this._extra = extra || ''; L.TileLayer.prototype.initialize.call(this, '', opts); },
  /* z, x, y in the usual 256-px tile scheme: a 512-px tile at map zoom Z covers one zoom Z-1 tile. */
  urlFor(c){
    // Ask for one extra pixel on every side: image servers leave a light edge pixel, and the
    // tile is drawn shifted out by that pixel so the edges sit under the neighbours.
    const span = 2 * MERC / Math.pow(2, c.z), px = span / 512, x0 = -MERC + c.x * span, y1 = MERC - c.y * span;
    const b = [x0 - px, y1 - span - px, x0 + span + px, y1 + px].map(v => v.toFixed(2)).join(',');
    return `${this._svc}/exportImage?bbox=${b}&bboxSR=3857&imageSR=3857&size=514,514&format=jpgpng&f=image${this._extra}`;
  },
  getTileUrl(c){ return this.urlFor({ x:c.x, y:c.y, z:c.z + this.options.zoomOffset }); },
  /* Draw the 514 px image over its 512 px slot, one pixel out on each side, so neighbours overlap
     (hides edge pixels and the hairline gaps phones with fractional pixel ratios show). */
  _initTile(tile){ L.TileLayer.prototype._initTile.call(this, tile); const s = this.getTileSize();
    tile.style.width = (s.x + 2) + 'px'; tile.style.height = (s.y + 2) + 'px'; tile.style.marginLeft = tile.style.marginTop = '-1px'; }
});
const HD = { tileSize:512, zoomOffset:-1, minZoom:17, maxZoom:20, maxNativeZoom:20, keepBuffer:1, crossOrigin:true, className:'hd-tile' };

/* ---------- Minnesota leaf-off close-up (MnGeo composite) ----------
   MnGeo's "best available" composite (mostly spring leaf-off or late fall county imagery, down to 3 in
   in the metro) is a WMS that only speaks UTM zone 15 (EPSG:26915). Each 512 px map tile asks for the
   UTM box around it and draws the picture in 8 x 8 pieces, each with its own affine transform, which
   bends it onto Web Mercator to well under a pixel. Clipped to Minnesota's outline (mn-outline.js) so
   Wisconsin keeps its DNR imagery and other states keep NAIP. urlFor() matches ExportTiles, so offline
   areas save these tiles too. */
function toUTM15(lat, lng){
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9996, lon0 = -93 * Math.PI / 180;
  const phi = lat * Math.PI / 180, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = c * (lng * Math.PI / 180 - lon0);
  const M = a * ((1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * phi - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*phi)
    + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*phi) - (35*e2*e2*e2/3072) * Math.sin(6*phi));
  return [k0 * N * (A + (1 - T + C) * A*A*A/6 + (5 - 18*T + T*T + 72*C - 58*ep2) * Math.pow(A, 5)/120) + 500000,
          k0 * (M + N * t * (A*A/2 + (5 - T + 9*C + 4*C*C) * Math.pow(A, 4)/24 + (61 - 58*T + T*T + 600*C - 330*ep2) * Math.pow(A, 6)/720))];
}
const MN_BOUNDS = L.latLngBounds([43.45, -97.3], [49.42, -89.45]);
const CELLS = 8;
const WarpTiles = L.GridLayer.extend({
  initialize(url, opts){ this._svc = url; L.GridLayer.prototype.initialize.call(this, opts); },
  /* The UTM grid of one 512 px tile at map zoom c.z + 1 (c in the 256-px scheme, like ExportTiles.urlFor). */
  _grid(c){
    const z = c.z + 1, pts = [];
    for(let j = 0; j <= CELLS; j++) for(let i = 0; i <= CELLS; i++){
      const ll = L.CRS.EPSG3857.pointToLatLng(L.point((c.x + i / CELLS) * 512, (c.y + j / CELLS) * 512), z);
      pts.push(toUTM15(ll.lat, ll.lng));
    }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const m = (x1 - x0) * 0.01; x0 -= m; x1 += m; y0 -= m; y1 += m;
    const across = Math.hypot(pts[CELLS][0] - pts[0][0], pts[CELLS][1] - pts[0][1]);   // the tile's top edge, metres
    const w = Math.min(1024, Math.round(512 * (x1 - x0) / across)), h = Math.min(1024, Math.round(512 * (y1 - y0) / across));
    return { pts, x0, x1, y0, y1, w, h };
  },
  urlFor(c){ const g = this._grid(c); return this._url(g); },
  _url(g){ return `${this._svc}&BBOX=${g.x0.toFixed(1)},${g.y0.toFixed(1)},${g.x1.toFixed(1)},${g.y1.toFixed(1)}&WIDTH=${g.w}&HEIGHT=${g.h}`; },
  createTile(coords, done){
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const c = { x:coords.x, y:coords.y, z:coords.z - 1 }, g = this._grid(c);
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ctx = cv.getContext('2d'), sx = g.w / (g.x1 - g.x0), sy = g.h / (g.y1 - g.y0);
      const src = p => [(p[0] - g.x0) * sx, (g.y1 - p[1]) * sy];
      // Clip to Minnesota.
      const o = L.point(coords.x * 512, coords.y * 512);
      ctx.beginPath();
      (LF.MN_OUTLINE || []).forEach((q, i) => { const p = L.CRS.EPSG3857.latLngToPoint(L.latLng(q[0], q[1]), coords.z).subtract(o); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      if(LF.MN_OUTLINE) ctx.clip();
      const step = 512 / CELLS;
      for(let j = 0; j < CELLS; j++) for(let i = 0; i < CELLS; i++){
        const k = j * (CELLS + 1) + i, s0 = src(g.pts[k]), s1 = src(g.pts[k + 1]), s2 = src(g.pts[k + CELLS + 1]);
        // Affine map from picture pixels to this cell: D = M·S + t, from the cell's three corners.
        const ax = s1[0] - s0[0], ay = s1[1] - s0[1], bx = s2[0] - s0[0], by = s2[1] - s0[1], det = ax * by - ay * bx;
        if(!det) continue;
        const ia = by / det, ib = -ay / det, ic = -bx / det, id = ax / det;   // inverse of [[ax,bx],[ay,by]]
        const m11 = step * ia, m12 = step * ic, m21 = step * ib, m22 = step * id;
        const dx = i * step, dy = j * step;
        ctx.save(); ctx.beginPath(); ctx.rect(dx - .5, dy - .5, step + 1, step + 1); ctx.clip();
        ctx.setTransform(m11, m21, m12, m22, dx - m11 * s0[0] - m12 * s0[1], dy - m21 * s0[0] - m22 * s0[1]);
        ctx.drawImage(img, 0, 0); ctx.restore();
      }
      done(null, cv);
    };
    img.onerror = () => done(new Error('tile'), cv);
    img.src = this._url(g);
    return cv;
  }
});
const WI_BOUNDS = L.latLngBounds([42.4, -92.95], [47.4, -86.2]);
const closeup = LF.closeup = {
  naip: new ExportTiles('https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer', '&bandIds=0,1,2',
    Object.assign({ zIndex:2, attribution:'Close-up: USGS NAIP' }, HD)),
  wi: new ExportTiles('https://dnrmaps.wi.gov/arcgis_image/rest/services/DW_Imagery/EN_Image_Basemap_Latest_Leaf_Off/ImageServer', '',
    Object.assign({ zIndex:4, bounds:WI_BOUNDS, attribution:'Close-up: WI DNR / WROC leaf-off' }, HD)),
  mn: new WarpTiles('https://imageserver.gisdata.mn.gov/cgi-bin/mncomp?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=mncomp&STYLES=&CRS=EPSG:26915&FORMAT=image/jpeg',
    { tileSize:512, minZoom:17, maxZoom:20, keepBuffer:1, zIndex:3, bounds:MN_BOUNDS, className:'hd-tile', attribution:'Close-up: MnGeo composite (MN counties, MnDOT, USDA)' })
};
/* Which close-up layers a setting uses: leaf-off draws MN and WI on top of NAIP (NAIP fills gaps and other states). */
const CLOSEUP = { leafoff:['naip', 'mn', 'wi'], summer:['naip'], off:[] };
let closeKey = CLOSEUP[LF.prefs.get('closeup', 'leafoff')] ? LF.prefs.get('closeup', 'leafoff') : 'leafoff';
function syncCloseup(){
  const want = (baseKey === 'hyb' || baseKey === 'img') ? CLOSEUP[closeKey] : [];
  Object.entries(closeup).forEach(([k, l]) => { if(want.includes(k)){ if(!map.hasLayer(l)) l.addTo(map); } else if(map.hasLayer(l)) map.removeLayer(l); });
}
LF.closeupLayers = (key) => CLOSEUP[key || closeKey].map(k => closeup[k]);
LF.getCloseup = () => closeKey;

let baseKey = null;
function setBase(k){
  if(!bases[k]) k = 'hyb';
  if(k === baseKey) return;
  if(baseKey) map.removeLayer(bases[baseKey]);
  baseKey = k; bases[k].addTo(map).bringToBack();
  document.getElementById('b-'+k).checked = true;
  prefs.set('base', k);
  syncCloseup();
}
LF.setBase = setBase;
LF.getBase = () => baseKey;
setBase(fromLink.base || prefs.get('base', 'hyb'));
document.querySelectorAll('input[name=base]').forEach(r => r.addEventListener('change', () => setBase(r.value)));
document.querySelectorAll('input[name=closeup]').forEach(r => {
  r.checked = r.value === closeKey;
  r.addEventListener('change', () => { closeKey = r.value; prefs.set('closeup', closeKey); syncCloseup(); });
});

map.createPane('publicPane'); map.getPane('publicPane').style.zIndex = 350;
map.createPane('parcelPane'); map.getPane('parcelPane').style.zIndex = 420;
map.createPane('hiPane');     map.getPane('hiPane').style.zIndex = 450;

const ACCESS = LF.ACCESS = { OA:['open','Open access','--open'], RA:['restricted','Restricted (permit or seasonal)','--restricted'],
                 XA:['closed','Closed to public','--closed'], UK:['none','Access unknown',''] };
const css = LF.css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const hidden = () => LF.shading && LF.shading.hidden();   // "Hide shading" in the info panel (select.js)
/* Terrain: USGS 3DEP lidar hillshade (1 m where lidar exists, which is nearly all of WI and MN), multiplied
   over the base map so ridges, ravines, creek beds, old roads and trails show through the trees. */
map.createPane('terrainPane'); map.getPane('terrainPane').style.zIndex = 250; map.getPane('terrainPane').style.mixBlendMode = 'multiply';
map.getPane('terrainPane').style.pointerEvents = 'none';
// Flat ground is white (no change when multiplied); this deepens the slopes 2.5x so the shading reads on dark aerials.
map.getPane('terrainPane').style.filter = 'invert(1) brightness(2.5) invert(1)';
const terrain = new ExportTiles('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer',
  '&renderingRule=' + encodeURIComponent('{"rasterFunction":"Hillshade Multidirectional"}'),
  { tileSize:512, zoomOffset:-1, minZoom:10, maxZoom:20, maxNativeZoom:18, keepBuffer:1, crossOrigin:true, pane:'terrainPane', opacity:1, className:'hd-tile',
    attribution:'Terrain: USGS 3DEP lidar' });
/* MN DNR trails, forest roads and water accesses: drawn as lines and dots from zoom 10, cased in white so they
   read on aerial and topo alike. Taps are answered by identify.js (nearby lookup), so these aren't interactive. */
map.createPane('recCasePane'); map.getPane('recCasePane').style.zIndex = 429; map.getPane('recCasePane').style.pointerEvents = 'none';
map.createPane('recPane'); map.getPane('recPane').style.zIndex = 430; map.getPane('recPane').style.pointerEvents = 'none';
const recWidth = () => map.getZoom() >= 14 ? 3.2 : 2.2;
/* One request per layer: the white casing copies each feature the coloured layer loads (into a pane just below it). */
function cased(key, fields, style){
  const fl = L.esri.featureLayer({ url:SRC[key], pane:'recPane', minZoom:10, interactive:false, simplifyFactor:0.6, precision:5, fields, style });
  const cas = L.layerGroup(), byId = new Map();
  const caseStyle = () => ({ color:'#fff', weight:recWidth() + 3, opacity:map.getZoom() >= 10 ? .75 : 0, lineCap:'round', lineJoin:'round' });
  fl.on('createfeature addfeature', e => { if(byId.has(e.feature.id)) return;
    const c = L.geoJSON(e.feature, { pane:'recCasePane', interactive:false, style:caseStyle }); byId.set(e.feature.id, c); cas.addLayer(c); });
  fl.on('removefeature', e => { const c = byId.get(e.feature.id); if(c){ cas.removeLayer(c); byId.delete(e.feature.id); } });
  cas.restyle = () => cas.eachLayer(g => g.setStyle(caseStyle()));
  return [cas, fl];
}
const recLine = key => () => ({ color:REC[key].color, weight:recWidth(), dashArray:REC[key].dash, opacity:.95, lineCap:'round' });
const roadStyle = f => ({ color:REC.mnForestRoads.color, weight:recWidth(), dashArray:/minimum/i.test(f.properties.road_class || '') ? '10 6' : null, opacity:.95 });
const layers = LF.layers = {
  terrain,
  mntrails: L.layerGroup([...cased('mnStateTrails', ['objectid'], recLine('mnStateTrails')), ...cased('mnHunterTrails', ['objectid'], recLine('mnHunterTrails'))]),
  mnmotor: L.layerGroup([...cased('mnOhv', ['objectid'], recLine('mnOhv')), ...cased('mnSnowmobile', ['objectid'], recLine('mnSnowmobile'))]),
  mnroads: L.layerGroup(cased('mnForestRoads', ['objectid', 'road_class'], roadStyle)),
  mnaccess: L.esri.featureLayer({ url:SRC.mnAccess, pane:'recPane', minZoom:10, interactive:false, fields:['objectid', 'launch_type'],
    pointToLayer:(f, ll) => L.circleMarker(ll, { pane:'recPane', interactive:false, radius:/trailer/i.test(f.properties.launch_type || '') ? 6.5 : 5,
      color:'#fff', weight:2, fillColor:/trailer/i.test(f.properties.launch_type || '') ? REC.mnAccess.color : '#26a69a', fillOpacity:1 }) }),
  padus: L.esri.featureLayer({ url:SRC.padus, pane:'publicPane', minZoom:8, interactive:false, simplifyFactor:0.5, precision:5,
    fields:['OBJECTID','Pub_Access'],
    style: f => { const a = ACCESS[f.properties.Pub_Access]; const c = a && a[2] ? css(a[2]) : '#888';
      return { color:c, weight:hidden() ? 1.6 : 1, fillColor:c, fillOpacity:hidden() ? 0 : a && a[2] ? 0.32 : 0.08 }; } }),
  widnr: L.esri.dynamicMapLayer({ url:SRC.wiDnr, pane:'publicPane', opacity:0.6, f:'image' }),
  wiclosed: L.esri.dynamicMapLayer({ url:SRC.wiClosed, pane:'publicPane', opacity:0.75, f:'image' }),
  wimfl: L.esri.featureLayer({ url:SRC.wiMfl, pane:'publicPane', minZoom:11, interactive:false, where:'AC_OP_PLS > 0', fields:['FID','AC_OP_PLS'],
    pointToLayer:(f, ll) => L.circleMarker(ll, { radius:6, color:'#fff', weight:1.5, fillColor:'#6a8f2f', fillOpacity:.9 }) }),
  mndnr: L.layerGroup([
    L.esri.dynamicMapLayer({ url:SRC.mnDnr, layers:[LF.MN_DNR_LAYER], pane:'publicPane', opacity:0.6, f:'image' }),
    L.esri.dynamicMapLayer({ url:SRC.mnWia, pane:'publicPane', opacity:0.6, f:'image' })
  ]),
  mncov: L.esri.featureLayer({ url:SRC.mnCoverage, pane:'publicPane', interactive:false,
    fields:['objectid','countyname','gac_open_approval'],
    style: f => String(f.properties.gac_open_approval).toLowerCase()==='true'
      ? { stroke:false, fill:false }
      : { color:'#666', weight:1, dashArray:'4 4', fillColor:'#555', fillOpacity:hidden() ? 0 : 0.25 } }),
  parcels: L.layerGroup([
    L.esri.featureLayer({ url:SRC.wiParcels, pane:'parcelPane', minZoom:PARCEL_ZOOM, interactive:false, fields:['OBJECTID'], precision:6,
      style:()=>({ color:css('--parcel'), weight:1.4, fill:false, opacity:.9 }) }),
    L.esri.featureLayer({ url:SRC.mnParcels, pane:'parcelPane', minZoom:PARCEL_ZOOM, interactive:false, fields:['objectid'], precision:6,
      style:()=>({ color:css('--parcel'), weight:1.4, fill:false, opacity:.9 }) })
  ])
};
// Remember each picture layer's own opacity so Hide shading can put it back.
['widnr', 'wiclosed'].forEach(k => { layers[k]._baseOpacity = layers[k].options.opacity; });
layers.mndnr.eachLayer(l => { l._baseOpacity = l.options.opacity; });
const defaults = { terrain:false, mntrails:false, mnmotor:false, mnroads:false, mnaccess:false, parcels:true, mncov:true, padus:true, widnr:true, wiclosed:false, wimfl:false, mndnr:true };
const on = LF.on = Object.assign({}, defaults, prefs.get('layers', {}));
if(fromLink.layers) Object.keys(layers).forEach(k => { on[k] = fromLink.layers.includes(k); });

function setLayer(k, v){
  on[k] = !!v; document.getElementById('l-'+k).checked = on[k];
  if(on[k]) { if(!map.hasLayer(layers[k])) layers[k].addTo(map); }
  else map.removeLayer(layers[k]);
  prefs.set('layers', on); onView();
}
LF.setLayers = list => Object.keys(layers).forEach(k => setLayer(k, list.includes(k)));
LF.onLayers = () => Object.keys(layers).filter(k => on[k]);

const hint = LF.hint = document.getElementById('zoomHint');
function onView(){ hint.hidden = map.getZoom() >= PARCEL_ZOOM || !on.parcels;
  const c = map.getCenter(); prefs.set('view', [+c.lat.toFixed(5), +c.lng.toFixed(5), map.getZoom()]); }
LF.onView = onView;

Object.keys(layers).forEach(k => {
  const box = document.getElementById('l-'+k);
  box.checked = !!on[k];
  if(on[k]) layers[k].addTo(map);
  box.addEventListener('change', () => setLayer(k, box.checked));
});
if(fromLink.layers) prefs.set('layers', on);
map.on('moveend zoomend', onView); onView();
let recState = '';   // lines get bolder from zoom 14; casings hide below zoom 10 with their lines
map.on('zoomend', () => { const z = map.getZoom(), st = (z >= 14) + ',' + (z >= 10); if(st === recState) return; recState = st;
  ['mntrails', 'mnmotor', 'mnroads'].forEach(k => layers[k].eachLayer(l => l.restyle ? l.restyle() : l.setStyle && l.setStyle(l.options.style))); });

/* Fit bounds into the part of the map you can see: above the sheet on a phone,
   beside it on a desktop, below the top bar. */
LF.fitVisible = function(b, maxZoom){
  const sh = document.getElementById('sheet'), m = map.getContainer().getBoundingClientRect();
  let br = [30, 30], tl = [30, 80];
  if(sh && !sh.hidden){ const r = sh.getBoundingClientRect();
    if(r.left <= 1 && r.width >= m.width - 2) br = [30, Math.max(30, m.bottom - r.top + 20)]; else tl = [r.right - m.left + 20, 80]; }
  map.fitBounds(b, { maxZoom, paddingTopLeft:tl, paddingBottomRight:br });
};

/* Short message in the chip under the top bar. */
let flashTimer = null;
LF.flash = function(msg, ms){
  clearTimeout(flashTimer);
  hint.textContent = msg; hint.hidden = false;
  flashTimer = setTimeout(LF.unflash, ms || 3500);
};
/* End a message early (e.g. "Getting directions…" once they've arrived). */
LF.unflash = function(){ clearTimeout(flashTimer); hint.textContent = 'Zoom in to see property lines'; onView(); };

/* ---------- Layers panel ---------- */
const lBtn = document.getElementById('layersBtn'), lPanel = document.getElementById('layersPanel');
function panel(open){ lPanel.hidden = !open; lBtn.classList.toggle('on', open); lBtn.setAttribute('aria-expanded', String(open)); }
lBtn.addEventListener('click', () => panel(lPanel.hidden));
map.on('click', () => { if(!lPanel.hidden) panel(false); });
LF.closePanel = () => panel(false);
})(window.LF);
