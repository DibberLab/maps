/* Line Fence: hover preview (mouse and trackpad only). When the pointer is within tap reach of a trail, road,
   landing or trout water that's switched on, that feature glows and its name shows beside the cursor: exactly
   what a click there will open. Same reach and the same nearest-wins rule as a tap (identify.js recLookup).
   Phones have no hover; there the panel's title says what the tap picked. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map } = LF;
if(!matchMedia('(hover:hover) and (pointer:fine)').matches) return;

map.createPane('hoverPane'); map.getPane('hoverPane').style.zIndex = 457; map.getPane('hoverPane').style.pointerEvents = 'none';
const renderer = L.canvas({ pane:'hoverPane' });
const glow = L.layerGroup().addTo(map);
const tip = L.DomUtil.create('div', 'hover-tip', map.getContainer()); tip.hidden = true;
const SWITCHES = ['trout', 'mntrails', 'mnmotor', 'mnroads', 'mnaccess'];

/* Every feature layer (with a recKey) inside the switched-on groups. */
function sources(){
  const out = [];
  SWITCHES.forEach(k => { const g = LF.layers[k]; if(!g || !map.hasLayer(g)) return;
    g.eachLayer(l => { if(l.options && l.options.recKey && map.hasLayer(l)) out.push(l); }); });
  return out;
}
function nearest(e){
  const P = e.layerPoint, ll = e.latlng, reach = LF.REC_TAP;
  const box = L.latLngBounds(map.layerPointToLatLng(P.subtract([reach.dot, reach.dot])), map.layerPointToLatLng(P.add([reach.dot, reach.dot])));
  let best = null;
  sources().forEach(fl => fl.eachFeature(layer => {
    if(!map.hasLayer(layer)) return;
    const key = fl.options.recKey, f = layer.feature, g = f && f.geometry; if(!g) return;
    let d = Infinity;
    if(layer.getLatLng){ d = map.latLngToLayerPoint(layer.getLatLng()).distanceTo(P); if(d > reach.dot) return; }
    else {
      const b = layer.getBounds(); if(!b.intersects(box)) return;
      if(/Polygon/.test(g.type) && LF.geo.pointIn([ll.lat, ll.lng], g)) d = 0;
      else { const parts = layer.getLatLngs(); const lines = Array.isArray(parts[0]) ? (Array.isArray(parts[0][0]) ? parts.flat() : parts) : [parts];
        lines.forEach(line => { for(let i = 1; i < line.length; i++)
          d = Math.min(d, L.LineUtil.pointToSegmentDistance(P, map.latLngToLayerPoint(line[i - 1]), map.latLngToLayerPoint(line[i]))); });
      }
      if(d > reach.line) return;
    }
    if(!best || d < best.d) best = { d, key, layer, f };
  }));
  return best;
}
let shown = null, raf = 0, last = null;
function paint(){
  raf = 0; const e = last; if(!e) return;
  const hit = !LF.mode && map.getZoom() >= 8 ? nearest(e) : null;
  const id = hit ? hit.key + ':' + hit.f.id : null;
  if(id !== shown){
    shown = id; glow.clearLayers();
    if(hit){
      const R = LF.REC[hit.key] || {}, g = hit.f.geometry;
      if(g.type === 'Point') L.circleMarker([g.coordinates[1], g.coordinates[0]], { pane:'hoverPane', renderer, radius:13, color:R.color, weight:3, fillColor:R.color, fillOpacity:.25, interactive:false }).addTo(glow);
      else L.geoJSON(hit.f, { pane:'hoverPane', interactive:false, style:() => ({ renderer, color:R.color, weight:/Polygon/.test(g.type) ? 4 : 11, opacity:.55,
        fillColor:R.color, fillOpacity:/Polygon/.test(g.type) ? .25 : 0, lineCap:'round', lineJoin:'round' }) }).addTo(glow);
      const nameField = LF.REC_NAME[hit.key], n = nameField && hit.f.properties[nameField];
      tip.textContent = (n ? (hit.key === 'mnTroutLakes' ? n + ' Lake' : n) + ' · ' : '') + R.label;
    }
    map.getContainer().classList.toggle('hover-rec', !!hit);
  }
  tip.hidden = !hit;
  if(hit){ tip.style.left = (e.containerPoint.x + 16) + 'px'; tip.style.top = (e.containerPoint.y + 14) + 'px'; }
}
map.on('mousemove', e => { last = e; if(!raf) raf = requestAnimationFrame(paint); });
const clear = () => { last = null; shown = null; glow.clearLayers(); tip.hidden = true; map.getContainer().classList.remove('hover-rec'); };
map.on('mouseout zoomstart movestart', clear);
map.getContainer().addEventListener('mouseleave', clear);
})(window.LF);
