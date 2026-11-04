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
  mnWia:     'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_dnr_walk_in_access_sites/MapServer'
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
let baseKey = null;
function setBase(k){
  if(!bases[k]) k = 'hyb';
  if(k === baseKey) return;
  if(baseKey) map.removeLayer(bases[baseKey]);
  baseKey = k; bases[k].addTo(map).bringToBack();
  document.getElementById('b-'+k).checked = true;
  prefs.set('base', k);
}
LF.setBase = setBase;
LF.getBase = () => baseKey;
setBase(fromLink.base || prefs.get('base', 'hyb'));
document.querySelectorAll('input[name=base]').forEach(r => r.addEventListener('change', () => setBase(r.value)));

map.createPane('publicPane'); map.getPane('publicPane').style.zIndex = 350;
map.createPane('parcelPane'); map.getPane('parcelPane').style.zIndex = 420;
map.createPane('hiPane');     map.getPane('hiPane').style.zIndex = 450;

const ACCESS = LF.ACCESS = { OA:['open','Open access','--open'], RA:['restricted','Restricted (permit or seasonal)','--restricted'],
                 XA:['closed','Closed to public','--closed'], UK:['none','Access unknown',''] };
const css = LF.css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const layers = LF.layers = {
  padus: L.esri.featureLayer({ url:SRC.padus, pane:'publicPane', minZoom:8, interactive:false, simplifyFactor:0.5, precision:5,
    fields:['OBJECTID','Pub_Access'],
    style: f => { const a = ACCESS[f.properties.Pub_Access]; const c = a && a[2] ? css(a[2]) : '#888';
      return { color:c, weight:1, fillColor:c, fillOpacity: a && a[2] ? 0.32 : 0.08 }; } }),
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
      : { color:'#666', weight:1, dashArray:'4 4', fillColor:'#555', fillOpacity:0.25 } }),
  parcels: L.layerGroup([
    L.esri.featureLayer({ url:SRC.wiParcels, pane:'parcelPane', minZoom:PARCEL_ZOOM, interactive:false, fields:['OBJECTID'], precision:6,
      style:()=>({ color:css('--parcel'), weight:1.4, fill:false, opacity:.9 }) }),
    L.esri.featureLayer({ url:SRC.mnParcels, pane:'parcelPane', minZoom:PARCEL_ZOOM, interactive:false, fields:['objectid'], precision:6,
      style:()=>({ color:css('--parcel'), weight:1.4, fill:false, opacity:.9 }) })
  ])
};
const defaults = { parcels:true, mncov:true, padus:true, widnr:true, wiclosed:false, wimfl:false, mndnr:true };
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

/* Short message in the chip under the top bar. */
let flashTimer = null;
LF.flash = function(msg, ms){
  clearTimeout(flashTimer);
  hint.textContent = msg; hint.hidden = false;
  flashTimer = setTimeout(() => { hint.textContent = 'Zoom in to see property lines'; onView(); }, ms || 3500);
};

/* ---------- Layers panel ---------- */
const lBtn = document.getElementById('layersBtn'), lPanel = document.getElementById('layersPanel');
function panel(open){ lPanel.hidden = !open; lBtn.classList.toggle('on', open); lBtn.setAttribute('aria-expanded', String(open)); }
lBtn.addEventListener('click', () => panel(lPanel.hidden));
map.on('click', () => { if(!lPanel.hidden) panel(false); });
LF.closePanel = () => panel(false);
})(window.LF);
