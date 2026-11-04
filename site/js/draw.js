/* Line Fence: tap-to-place and drawing tools.
   LF.draw.start('waypoint' | 'line' | 'area' | 'circle', [optional first point]).
   While a tool is active LF.mode is set, so map taps add points instead of
   looking up parcels. The strip at the bottom shows live measurements. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, geo, flash } = LF;
const strip = document.getElementById('strip'), txt = document.getElementById('stripText'), btns = document.getElementById('stripBtns');
let kind = null, pts = [], center = null, radius = 0, temp = null;

const HELP = {
  waypoint: 'Tap the map where the waypoint goes',
  line: 'Tap to add points along the line',
  area: 'Tap the corners of the area',
  circle: 'Tap the center, then tap the edge'
};

function start(k, first){
  stop(true);
  LF.closePanel(); LF.closeTools();
  kind = k; LF.mode = 'draw:' + k; pts = []; center = null; radius = 0;
  map.doubleClickZoom.disable();
  document.getElementById('map').classList.add('drawing');
  temp = L.layerGroup().addTo(map);
  LF.closeSheet();
  if(first) add(first);
  strip.hidden = false; render();
}
function stop(silent){
  if(!kind) return;
  kind = null; LF.mode = null; pts = []; center = null;
  map.doubleClickZoom.enable();
  document.getElementById('map').classList.remove('drawing');
  if(temp){ temp.remove(); temp = null; }
  strip.hidden = true;
  if(!silent) flash('Cancelled', 1500);
}
const ready = () => kind === 'line' ? pts.length >= 2 : kind === 'area' ? pts.length >= 3 : kind === 'circle' ? radius > 0 : false;

function add(p){
  if(kind === 'waypoint'){ const ll = p; stop(true); LF.items.newWaypoint(ll); return; }
  if(kind === 'circle'){ if(!center) center = p; else radius = geo.dist(center, p); }
  else pts.push(p);
  render();
}
function render(){
  if(!kind) return;
  temp.clearLayers();
  const c = '#e8590c', o = { pane:'hiPane', color:c, weight:3, interactive:false };
  let line = HELP[kind];
  if(kind === 'line' || kind === 'area'){
    if(pts.length > 1) (kind === 'area' && pts.length > 2 ? L.polygon(pts, Object.assign({ fillOpacity:.15 }, o)) : L.polyline(pts, o)).addTo(temp);
    pts.forEach((p, i) => L.circleMarker(p, { pane:'hiPane', radius:i ? 5 : 6, color:'#fff', weight:2, fillColor:c, fillOpacity:1, interactive:false }).addTo(temp));
    if(kind === 'line' && pts.length > 1) line = geo.fmtDist(geo.length(pts)) + (pts.length > 2 ? ' · last leg ' + geo.fmtDist(geo.dist(pts[pts.length - 2], pts[pts.length - 1])) : '');
    if(kind === 'area' && pts.length > 2) line = geo.fmtArea(geo.area(pts)) + ' · perimeter ' + geo.fmtDist(geo.length(pts, true));
  }
  if(kind === 'circle' && center){
    L.circleMarker(center, { pane:'hiPane', radius:5, color:'#fff', weight:2, fillColor:c, fillOpacity:1, interactive:false }).addTo(temp);
    if(radius){ L.circle(center, Object.assign({ radius, fillOpacity:.15 }, o)).addTo(temp);
      line = geo.fmtArea(Math.PI * radius * radius) + ' · radius ' + geo.fmtDist(radius) + ' · tap again to resize'; }
    else line = 'Now tap the edge of the circle';
  }
  txt.textContent = line;
  btns.innerHTML = (kind === 'waypoint' ? '<button class="btn" data-a="here">Use my location</button>' : '') +
    (pts.length || center ? '<button class="btn" data-a="undo">Undo</button>' : '') +
    '<button class="btn" data-a="cancel">Cancel</button>' +
    (kind !== 'waypoint' ? `<button class="btn primary" data-a="save"${ready() ? '' : ' disabled'}>Save</button>` : '');
}
btns.addEventListener('click', e => {
  const a = (e.target.closest('[data-a]') || {}).dataset; if(!a || !a.a) return;
  if(a.a === 'cancel') stop();
  if(a.a === 'undo'){ if(kind === 'circle'){ if(radius) radius = 0; else center = null; } else pts.pop(); render(); }
  if(a.a === 'here'){
    const use = fix => { if(kind === 'waypoint') add(fix.ll); };
    if(LF.gps.last && Date.now() - LF.gps.last.t < 30000) use(LF.gps.last);
    else { flash('Finding you…', 8000); LF.gps.start('button', use); }
  }
  if(a.a === 'save' && ready()){
    if(!LF.account.require('drawings')) return;   // measuring is open to all; keeping it needs an account
    const d = kind === 'circle' ? { kind, center, radius } : { kind, points:pts.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]) };
    stop(true);
    LF.items.newDrawing(d);
  }
});
map.on('click', e => { if(kind) add([e.latlng.lat, e.latlng.lng]); });
document.addEventListener('keydown', e => { if(e.key === 'Escape' && kind) stop(); });

LF.draw = { start, stop, active:() => kind, add:p => { if(kind) add(p); } };
})(window.LF);
