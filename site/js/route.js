/* Line Fence: directions on OpenStreetMap roads and trails.
   Routes from your GPS position to a waypoint, course or parcel using OSRM on
   the FOSSGIS servers (routing.openstreetmap.de, the same service behind
   openstreetmap.org's Directions). One request per tap; credit shown with the
   route. A route ends where the road network does, so the last stretch to an
   off-road spot (a stand, a corner) is shown as a straight walk. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, geo, flash } = LF;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SERVER = 'https://routing.openstreetmap.de/routed-';
const MODES = { car:['Drive', 'by car'], bike:['Bike', 'by bike'], foot:['Walk', 'on foot'] };
const ATTR = 'Directions: OSRM / FOSSGIS, © OpenStreetMap contributors';
const chip = document.getElementById('routeChip');
const layer = L.layerGroup();
let current = null;   // { name, to, mode, from, route }

const mins = s => s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min' : Math.floor(s / 3600) + ' h ' + Math.round(s % 3600 / 60) + ' min';
const DIR = { left:'left', right:'right', 'slight left':'slightly left', 'slight right':'slightly right', 'sharp left':'sharp left', 'sharp right':'sharp right', straight:'straight', uturn:'around' };
function instruction(st, i, n){
  const m = st.maneuver, name = st.name || st.ref || '', onto = name ? ` onto ${name}` : '', on = name ? ` on ${name}` : '';
  const mod = DIR[m.modifier] || m.modifier || '';
  switch(m.type){
    case 'depart': return `Head ${geo.fmtBearing(m.bearing_after || 0).split(' ')[0]}${on}`;
    case 'arrive': return i === n - 1 ? 'End of the route' + (name ? ` on ${name}` : '') : `Reach the stop${on}`;
    case 'roundabout': case 'rotary': case 'roundabout turn': return `At the roundabout, take exit ${m.exit || ''}${onto}`.replace('exit  ', 'the exit ');
    case 'new name': case 'continue': return mod && mod !== 'straight' ? `Keep ${mod}${onto}` : `Continue${onto}`;
    case 'merge': return `Merge ${mod}${onto}`;
    case 'on ramp': return `Take the ramp ${mod}${onto}`;
    case 'off ramp': return `Take the exit ${mod}${onto}`;
    case 'fork': return `Keep ${mod} at the fork${onto}`;
    case 'end of road': return `At the end of the road, turn ${mod}${onto}`;
    default: return mod === 'straight' ? `Continue straight${onto}` : mod === 'around' ? `Make a U-turn${onto}` : `Turn ${mod}${onto}`;
  }
}

function here(){
  return new Promise(res => {
    const last = LF.gps.last;
    if(last && Date.now() - last.t < 120000) return res(last.ll);
    flash('Finding you…', 15000);
    let done = false;
    const t = setTimeout(() => { if(!done){ done = true; LF.gps.stop('route'); res(null); } }, 25000);
    LF.gps.start('route', fix => { if(done) return; done = true; clearTimeout(t); LF.unflash(); res(fix.ll); setTimeout(() => LF.gps.stop('route'), 0); });
  });
}

async function to(name, dest, mode){
  const from = await here();
  if(!from){ flash('Directions need your location. Allow location and try again outside.', 5000); return; }
  const straight = geo.dist(from, dest);
  mode = mode || (current && current.name === name && current.mode) || (straight < 1500 ? 'foot' : 'car');
  flash('Getting directions…', 15000);
  let j;
  try{
    const res = await fetch(`${SERVER}${mode}/route/v1/driving/${from[1]},${from[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson&steps=true`);
    j = await res.json();
    if(j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error(j.message || j.code || 'no route');
  }catch(e){
    flash(navigator.onLine === false ? 'Directions need a connection.' : 'No route found (' + (e.message || e) + '). Try another mode.', 5000);
    return;
  }
  LF.unflash();
  current = { name, to:dest, mode, from, route:j.routes[0], snapTo:j.waypoints[1] };
  draw(); show();
  LF.fitVisible(layer.getLayers()[0].getBounds().extend(dest).extend(from), 17);
}

function draw(){
  layer.clearLayers();
  const line = current.route.geometry.coordinates.map(c => [c[1], c[0]]);
  L.polyline(line, { pane:'hiPane', color:'#0b3d91', weight:9, opacity:.55, interactive:false }).addTo(layer);
  L.polyline(line, { pane:'hiPane', color:'#3b82f6', weight:5, interactive:false }).addTo(layer);
  const end = line[line.length - 1];
  if(geo.dist(end, current.to) > 20) L.polyline([end, current.to], { pane:'hiPane', color:'#3b82f6', weight:3, dashArray:'4 7', interactive:false }).addTo(layer);
  L.circleMarker(current.to, { pane:'hiPane', radius:7, color:'#fff', weight:2, fillColor:'#e8590c', fillOpacity:1, interactive:false }).addTo(layer);
  if(!map.hasLayer(layer)){ layer.addTo(map); map.attributionControl.addAttribution(ATTR); }
}
function tail(){
  const r = current.route, line = r.geometry.coordinates, end = [line[line.length - 1][1], line[line.length - 1][0]];
  const gap = geo.dist(end, current.to);
  return gap > 20 ? { m:gap, txt:`then walk ${geo.fmtDist(gap)} ${geo.fmtBearing(geo.bearing(end, current.to)).split(' ')[0]} from the end of the route` } : null;
}
function summary(){
  const r = current.route;
  return `${geo.fmtDist(r.distance)} · ${mins(r.duration)} ${MODES[current.mode][1]}`;
}
function show(){
  const r = current.route, steps = r.legs[0].steps, t = tail();
  chip.querySelector('.txt').textContent = `${summary()} → ${current.name}`;
  chip.hidden = false;
  const body = '<div class="btnrow acts modes">' + Object.entries(MODES).map(([k, v]) =>
      `<button class="btn${k === current.mode ? ' primary' : ''}" data-act="mode" data-m="${k}">${v[0]}</button>`).join('') + '</div>' +
    `<p class="estimate">${esc(summary())}${t ? `, ${esc(t.txt)}` : ''}.</p>` +
    '<ol class="steps">' + steps.map((st, i) => `<li><span>${esc(instruction(st, i, steps.length))}</span>${st.distance > 0 && i < steps.length - 1 ? `<span class="small">${geo.fmtDist(st.distance)}</span>` : ''}</li>`).join('') +
      (t ? `<li><span>Walk ${esc(geo.fmtDist(t.m))} ${esc(geo.fmtBearing(geo.bearing([r.geometry.coordinates.slice(-1)[0][1], r.geometry.coordinates.slice(-1)[0][0]], current.to)))} to ${esc(current.name)}</span><span class="small">off the road network</span></li>` : '') + '</ol>' +
    '<div class="btnrow acts">' +
      `<a class="btn" href="https://www.openstreetmap.org/directions?engine=fossgis_osrm_${current.mode}&route=${current.from[0].toFixed(5)}%2C${current.from[1].toFixed(5)}%3B${current.to[0].toFixed(5)}%2C${current.to[1].toFixed(5)}" target="_blank" rel="noopener">Open on OpenStreetMap</a>` +
      '<button class="btn" data-act="go">Guide me (straight line)</button><button class="btn danger" data-act="clear">Clear route</button></div>' +
    '<p class="note">Directions use OpenStreetMap roads and trails (OSRM on the FOSSGIS servers). Check gates, private roads and seasonal closures yourself. Off-road, the last stretch is a straight line, not a trail.</p>';
  LF.showSheet(`<h2>Directions to ${esc(current.name)}</h2><div class="small">From your location</div>`, body, { pin:null, onAct:(act, el) => {
    if(act === 'mode') to(current.name, current.to, el.dataset.m);
    if(act === 'clear'){ clear(); LF.closeSheet(); }
    if(act === 'go'){ LF.closeSheet(); LF.items.goto(current.name, current.to); }
  } });
}
function clear(){
  current = null; layer.clearLayers(); map.removeLayer(layer); chip.hidden = true;
  map.attributionControl.removeAttribution(ATTR);
}
chip.querySelector('.txt').addEventListener('click', () => { if(current) show(); });
chip.querySelector('button').addEventListener('click', clear);

LF.route = { to, clear };
})(window.LF);
