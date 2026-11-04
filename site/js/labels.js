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
const label = (cls, html, ll, minZ) => { const m = L.marker(ll, { pane:'placeLabels', interactive:false, keyboard:false,
  icon:L.divIcon({ className:'place-label ' + cls, iconSize:null, html:`<span>${html}</span>` }) }); m.minZ = minZ; return m; };
const centerOf = layer => { try{ return layer.getBounds().getCenter(); }catch(e){ return null; } };

/* Cities and villages. */
const cities = L.esri.featureLayer({ url:C + '/govunits/MapServer/24', pane:'bdryPane', minZoom:9, interactive:false, simplifyFactor:0.6, precision:5,
  fields:['objectid', 'gnis_name', 'place_name', 'population'],
  style:() => ({ color:'#ffffff', weight:2.2, dashArray:'7 5', opacity:.9, fill:false }),
  onEachFeature:(f, layer) => {
    const p = f.properties, ll = centerOf(layer); if(!ll) return;
    const big = (p.population || 0) >= 5000;
    const m = label(big ? 'city big' : 'city', esc(p.gnis_name || p.place_name), ll, big ? 9 : 11);
    m.name = (p.place_name || '').toLowerCase(); byFeature.set('c' + f.id, m); show(m);
  } });

/* Towns (WI) and townships (MN): the land outside cities and villages. */
const towns = L.esri.featureLayer({ url:C + '/govunits/MapServer/26', pane:'bdryPane', minZoom:11, interactive:false, simplifyFactor:0.6, precision:5,
  where:"gnis_name LIKE 'Town of %' OR gnis_name LIKE 'Township of %' OR gnis_name LIKE 'Unorganized%'",
  fields:['objectid', 'gnis_name', 'minorcivildivision_name'],
  style:() => ({ color:'#ffffff', weight:1.4, dashArray:'2 6', opacity:.75, fill:false }),
  onEachFeature:(f, layer) => { const ll = centerOf(layer); if(!ll) return;
    const m = label('town', esc(f.properties.gnis_name || f.properties.minorcivildivision_name), ll, 12); byFeature.set('t' + f.id, m); show(m); } });

/* Unincorporated communities and other populated places (skip ones that are also a city label). */
const places = L.esri.featureLayer({ url:C + '/geonames/MapServer/3', pane:'placeLabels', minZoom:10, interactive:false,
  fields:['objectid', 'gaz_name'],
  pointToLayer:(f, ll) => {
    const name = f.properties.gaz_name || '';
    const dup = Array.from(byFeature.values()).some(m => m.name === name.toLowerCase() && m.getLatLng().distanceTo(ll) < 5000);
    const m = label('hamlet' + (dup ? ' dup' : ''), `<i></i>${esc(name)}`, ll, 11);
    return m;
  } });

function show(m){ if(on && map.getZoom() >= m.minZ) labels.addLayer(m); }
[cities, towns].forEach(fl => fl.on('removefeature', e => { const k = (fl === cities ? 'c' : 't') + e.feature.id; const m = byFeature.get(k); if(m){ labels.removeLayer(m); byFeature.delete(k); } }));
function relabel(){
  const z = map.getZoom();
  byFeature.forEach(m => { const want = on && z >= m.minZ; if(want && !labels.hasLayer(m)) labels.addLayer(m); if(!want && labels.hasLayer(m)) labels.removeLayer(m); });
}
map.on('zoomend', relabel);

/* Road names drawn over the sharp close-up imagery (which covers the base map's own). One image per view, not tiles,
   so each name appears once. */
const roads = L.esri.dynamicMapLayer({ url:C + '/transportation/MapServer', layers:[16, 17, 18, 19, 20, 21, 24], pane:'placeLabels',
  minZoom:17, opacity:1, f:'image', format:'png32', transparent:true });

let on = LF.prefs.get('placeNames', true), roadsOn = LF.prefs.get('roadNames', true);
const boxP = document.getElementById('l-places'), boxR = document.getElementById('l-roadnames');
function sync(){
  const close = map.getZoom() >= 17 && ['hyb', 'img'].includes(LF.getBase()) && LF.getCloseup() !== 'off';
  [[cities, on], [towns, on], [places, on], [labels, on], [roads, roadsOn && close]].forEach(([l, want]) => {
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
