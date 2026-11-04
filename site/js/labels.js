/* Line Fence: city, village, town and township limits and names, place names,
   and road names over the close-up imagery. All from USGS The National Map
   (carto.nationalmap.gov; boundaries are Census TIGER 2025, names GNIS).
   Boundaries and names are drawn here rather than as USGS's own images,
   which fill cities solid white and repeat road names many times over. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map } = LF;
const C = 'https://carto.nationalmap.gov/arcgis/rest/services';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
map.createPane('bdryPane'); map.getPane('bdryPane').style.zIndex = 430;            // above parcels, below saved items
map.createPane('placeLabels'); map.getPane('placeLabels').style.zIndex = 452;     // above highlights, below waypoints
map.getPane('placeLabels').style.pointerEvents = 'none';
const ATTR = 'Boundaries & names: USGS The National Map, US Census TIGER';

const labels = L.layerGroup();
const byFeature = new Map();   // feature id -> label marker
// w: a tie-breaker within the same rank (population, lake area): the bigger one wins a collision.
const label = (cls, html, ll, minZ, w) => { const m = L.marker(ll, { pane:'placeLabels', interactive:false, keyboard:false,
  icon:L.divIcon({ className:'place-label ' + cls, iconSize:null, html:`<span data-w="${+w || 0}">${html}</span>` }) }); m.minZ = minZ; return m; };
const centerOf = layer => { try{ return layer.getBounds().getCenter(); }catch(e){ return null; } };

/* Cities and villages, staggered by population the way onX does: the biggest first, smaller places
   as you zoom in. [min population, from zoom, label size class] */
const CITY_TIERS = [[100000, 6, 'metro'], [20000, 8, 'large'], [5000, 9, 'medium'], [1000, 10, 'small'], [0, 11, 'tiny']];
const tierOf = pop => CITY_TIERS.find(t => (pop || 0) >= t[0]);
const cityWhere = z => { const t = CITY_TIERS.filter(t => z >= t[1]); return t.length ? `population >= ${t[t.length - 1][0]}` : '1=0'; };
const cities = L.esri.featureLayer({ url:C + '/govunits/MapServer/24', pane:'bdryPane', minZoom:6, interactive:false, simplifyFactor:0.8, precision:5,
  fields:['objectid', 'gnis_name', 'place_name', 'population'], where:cityWhere(map.getZoom()),
  style:() => ({ color:'#ffffff', weight:2.2, dashArray:'7 5', opacity:map.getZoom() >= 10 ? .9 : 0, fill:false }),
  onEachFeature:(f, layer) => {
    const p = f.properties, ll = centerOf(layer); if(!ll) return;
    const t = tierOf(p.population);
    // Short names ("Siren") until you're close; the full official name ("Village of Siren") from zoom 12.
    const m = label('city ' + t[2], `<b class="short">${esc(p.place_name || p.gnis_name)}</b><b class="full">${esc(p.gnis_name || p.place_name)}</b>`, ll, t[1], p.population);
    m.name = (p.place_name || '').toLowerCase(); byFeature.set('c' + f.id, m); show(m);
  } });
let lastWhere = cities.getWhere();
map.on('zoomend', () => { const w = cityWhere(map.getZoom()); if(w !== lastWhere){ lastWhere = w; cities.setWhere(w); } cities.setStyle(cities.options.style); });

/* Towns (WI) and townships (MN): the land outside cities and villages. */
const towns = L.esri.featureLayer({ url:C + '/govunits/MapServer/26', pane:'bdryPane', minZoom:11, interactive:false, simplifyFactor:0.6, precision:5,
  where:"gnis_name LIKE 'Town of %' OR gnis_name LIKE 'Township of %' OR gnis_name LIKE 'Unorganized%'",
  fields:['objectid', 'gnis_name', 'minorcivildivision_name'],
  style:() => ({ color:'#ffffff', weight:1.4, dashArray:'2 6', opacity:.75, fill:false }),
  onEachFeature:(f, layer) => { const ll = centerOf(layer); if(!ll) return;
    const m = label('town', esc(f.properties.gnis_name || f.properties.minorcivildivision_name), ll, 12); byFeature.set('t' + f.id, m); show(m); } });

/* Unincorporated communities and other populated places (skip ones that are also a city label).
   The "Aerial + roads" picture already names these up to zoom 16, so they're added only where it doesn't. */
const places = L.esri.featureLayer({ url:C + '/geonames/MapServer/3', pane:'placeLabels', minZoom:12, interactive:false,
  fields:['objectid', 'gaz_name'],
  pointToLayer:(f, ll) => {
    const name = f.properties.gaz_name || '';
    const dup = Array.from(byFeature.values()).some(m => m.name === name.toLowerCase() && m.getLatLng().distanceTo(ll) < 5000);
    const m = label('hamlet' + (dup ? ' dup' : ''), `<i></i>${esc(name)}`, ll, 11);
    return m;
  } });

const isBare = () => LF.getBase() === 'img' || (map.getZoom() >= 17 && ['hyb', 'img'].includes(LF.getBase()) && LF.getCloseup() !== 'off');
function show(m, lake){ if(on && map.getZoom() >= m.minZ && (!lake || isBare())){ labels.addLayer(m); declutter(); } }
[cities, towns].forEach(fl => fl.on('removefeature', e => { const k = (fl === cities ? 'c' : 't') + e.feature.id; const m = byFeature.get(k); if(m){ labels.removeLayer(m); byFeature.delete(k); } }));
function relabel(){
  const z = map.getZoom(), bare = isBare();
  document.getElementById('map').classList.toggle('zoom-near', z >= 12);
  // Lake labels ('w…') follow the lake layer: only where the base picture has no names.
  byFeature.forEach((m, k) => { const want = on && z >= m.minZ && (k[0] !== 'w' || bare);
    if(want && !labels.hasLayer(m)) labels.addLayer(m); if(!want && labels.hasLayer(m)) labels.removeLayer(m); });
  declutter();
}
map.on('zoomend', relabel);

/* Declutter: when names overlap, the more important one stays (bigger city, bigger lake) and the
   other waits until you zoom in, as onX does. Runs after zooms and as new names arrive. */
const RANK = [['metro', 12], ['large', 11], ['medium', 10], ['xl', 9.5], ['small', 9], ['l', 8], ['tiny', 7], ['m', 6], ['town', 5], ['s', 4], ['hamlet', 3], ['xs', 2]];
const rankOf = el => { for(const [c, r] of RANK) if(el.classList.contains(c)) return r; return 1; };
let declutterTimer = null;
function declutter(){
  clearTimeout(declutterTimer);
  declutterTimer = setTimeout(() => {
    const els = Array.from(document.querySelectorAll('.place-label:not(.dup)'));
    els.forEach(el => el.classList.remove('clash'));
    const placed = [];
    els.map(el => ({ el, r:rankOf(el), w:+(el.firstElementChild && el.firstElementChild.dataset.w) || 0, b:el.firstElementChild && el.firstElementChild.getBoundingClientRect() }))
      .filter(x => x.b && x.b.width).sort((a, b) => b.r - a.r || b.w - a.w)
      .forEach(x => { const pad = 4, hit = placed.some(p => !(x.b.right + pad < p.left || x.b.left - pad > p.right || x.b.bottom + pad < p.top || x.b.top - pad > p.bottom));
        if(hit) x.el.classList.add('clash'); else placed.push(x.b); });
  }, 120);
}
map.on('zoomend moveend', declutter);
places.on('load', declutter);   // a plain layer group doesn't announce additions; show() and loads call it

/* Lake names, onX style: blue italics sized by the lake's area; bigger lakes first, smaller as you zoom in.
   USGS NHD waterbodies (name + area). Shown where the base picture has no names of its own. */
const LAKE_TIERS = [[20, 9], [5, 10], [1, 11], [0.25, 12], [0.05, 13], [0, 14]];   // [km², from zoom]
const lakeWhere = z => { const t = LAKE_TIERS.filter(t => z >= t[1]); return t.length ? `GNIS_NAME IS NOT NULL AND AREASQKM >= ${t[t.length - 1][0]}` : '1=0'; };
const lakeSize = a => a >= 20 ? 'xl' : a >= 5 ? 'l' : a >= 1 ? 'm' : a >= 0.25 ? 's' : 'xs';
const lakes = L.esri.featureLayer({ url:'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12', pane:'bdryPane', minZoom:9, interactive:false,
  simplifyFactor:1, precision:4, fields:['OBJECTID', 'GNIS_NAME', 'AREASQKM'], where:lakeWhere(map.getZoom()),
  style:() => ({ stroke:false, fill:false }),
  onEachFeature:(f, layer) => {
    const p = f.properties, ll = centerOf(layer); if(!ll) return;
    const m = label('lake ' + lakeSize(p.AREASQKM), esc(p.GNIS_NAME), ll, 0, p.AREASQKM); byFeature.set('w' + f.id, m); show(m, true);
  } });
lakes.on('removefeature', e => { const m = byFeature.get('w' + e.feature.id); if(m){ labels.removeLayer(m); byFeature.delete('w' + e.feature.id); } });
let lastLakeWhere = lakes.getWhere();
map.on('zoomend', () => { const w = lakeWhere(map.getZoom()); if(w !== lastLakeWhere){ lastLakeWhere = w; lakes.setWhere(w); } });

/* Road names drawn over the sharp close-up imagery (which covers the base map's own). One image per view, not tiles,
   so each name appears once. */
const roads = L.esri.dynamicMapLayer({ url:C + '/transportation/MapServer', layers:[16, 17, 18, 19, 20, 21, 24], pane:'placeLabels',
  minZoom:17, opacity:1, f:'image', format:'png32', transparent:true });

let on = LF.prefs.get('placeNames', true), roadsOn = LF.prefs.get('roadNames', true);
const boxP = document.getElementById('l-places'), boxR = document.getElementById('l-roadnames');
function sync(){
  const close = map.getZoom() >= 17 && ['hyb', 'img'].includes(LF.getBase()) && LF.getCloseup() !== 'off';
  // Lake and hamlet names only where the base picture has none: Aerial only, or past zoom 16 on the sharp imagery.
  const bare = LF.getBase() === 'img' || close;
  [[cities, on], [towns, on], [places, on && bare], [lakes, on && bare], [labels, on], [roads, roadsOn && close]].forEach(([l, want]) => {
    if(want && !map.hasLayer(l)) l.addTo(map); if(!want && map.hasLayer(l)) map.removeLayer(l); });
  if(on || roadsOn) map.attributionControl.addAttribution(ATTR); else map.attributionControl.removeAttribution(ATTR);
  relabel();
}
boxP.checked = on; boxR.checked = roadsOn;
boxP.addEventListener('change', () => { on = boxP.checked; LF.prefs.set('placeNames', on); sync(); });
boxR.addEventListener('change', () => { roadsOn = boxR.checked; LF.prefs.set('roadNames', roadsOn); sync(); });
document.querySelectorAll('input[name=base], input[name=closeup]').forEach(r => r.addEventListener('change', sync));
map.on('zoomend', sync);
sync();

LF.labels = { sync };
})(window.LF);
