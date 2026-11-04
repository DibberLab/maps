/* Line Fence: one shared GPS feed. The GPS button, track recording and
   "Go to" each start it under their own name; it stops when none need it.
   Every fix is broadcast as LF.emit('gps', { ll:[lat,lng], acc, alt, t }). */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, flash } = LF;
const btn = document.getElementById('locate');
const users = new Set();
let watchId = null, dot = null, ring = null, firstFixFor = null, lastWeak = 0;

function draw(fix){
  const ll = fix.ll;
  if(!dot){
    ring = L.circle(ll, { pane:'hiPane', radius:fix.acc, color:'#3b82f6', weight:1, fillOpacity:.12, interactive:false }).addTo(map);
    dot = L.circleMarker(ll, { pane:'hiPane', radius:8, color:'#fff', weight:3, fillColor:'#3b82f6', fillOpacity:1, interactive:false }).addTo(map);
  } else { dot.setLatLng(ll); ring.setLatLng(ll).setRadius(fix.acc); }
}
function clear(){ if(dot){ dot.remove(); ring.remove(); dot = ring = null; } }

function stopAll(){
  if(watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; users.clear(); LF.gps.active = false; btn.classList.remove('on'); clear();
}

LF.gps = {
  last: null, active: false,
  has(user){ return users.has(user); },
  /* Returns false if this browser can't share location. */
  start(user, onFirstFix){
    if(!('geolocation' in navigator)){ flash('This browser cannot share your location.'); return false; }
    users.add(user);
    if(onFirstFix) firstFixFor = onFirstFix;
    if(user === 'button') btn.classList.add('on');
    if(watchId !== null){ if(onFirstFix && LF.gps.last){ firstFixFor = null; onFirstFix(LF.gps.last); } return true; }
    LF.gps.active = true;
    watchId = navigator.geolocation.watchPosition(pos => {
      const c = pos.coords;
      const fix = LF.gps.last = { ll:[c.latitude, c.longitude], acc:c.accuracy, alt:c.altitude, t:pos.timestamp || Date.now() };
      draw(fix);
      if(firstFixFor){ const f = firstFixFor; firstFixFor = null; f(fix); }
      LF.emit('gps', fix);
    }, err => {
      if(err.code === 1){   // permission denied: nothing more will come
        flash('Location is blocked. Allow location for this site in your browser settings.', 5000);
        const had = Array.from(users); stopAll(); LF.emit('gpsError', had); return;
      }
      // Signal lost or slow (under trees, in a valley). The watch keeps going
      // and fixes resume on their own, so say so and carry on.
      const now = Date.now();
      if(now - lastWeak > 60000){ lastWeak = now; flash(LF.gps.last ? 'Weak GPS signal. Still trying.' : 'Looking for GPS. Works best outside.', 4000); }
      LF.emit('gpsWeak', err.code);
    }, { enableHighAccuracy:true, maximumAge:5000, timeout:30000 });
    return true;
  },
  stop(user){
    users.delete(user);
    if(user === 'button') btn.classList.remove('on');
    if(!users.size) stopAll();
  }
};

btn.addEventListener('click', () => {
  if(LF.gps.has('button')){ LF.gps.stop('button'); return; }
  LF.gps.start('button', fix => { map.setView(fix.ll, Math.max(map.getZoom(), 17)); LF.inspect(L.latLng(fix.ll[0], fix.ll[1])); });
});
})(window.LF);
