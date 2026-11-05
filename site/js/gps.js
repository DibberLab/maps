/* Line Fence: one shared GPS feed. The GPS button, track recording and
   "Go to" each start it under their own name; it stops when none need it.
   Every reading is broadcast raw as 'gpsRaw'; the smoothed position as LF.emit('gps', { ll:[lat,lng], acc, alt, t, raw }). */
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
function clear(){ if(dot){ dot.remove(); ring.remove(); dot = ring = null; } est = null; hist = []; }

/* A small Kalman-style filter: each reading pulls the estimate in proportion to how sure the phone is about it
   (its accuracy), and the estimate loosens with time at about walking-to-driving speed, so standing still settles
   the dot and moving follows you. A reading far outside both is skipped as a glitch, unless three in a row agree
   (then you really moved, and the estimate jumps). The fix keeps the raw reading too. */
let est = null, skips = 0, hist = [];
const M_PER_DEG = 111320;
const meters = (a, b) => Math.hypot((a[0] - b[0]) * M_PER_DEG, (a[1] - b[1]) * M_PER_DEG * Math.cos(a[0] * Math.PI / 180));
function smooth(raw){
  const [la, ln] = raw.ll, acc = Math.max(1, raw.acc || 30);
  // How fast you're going: the phone's figure, or (when it gives none) the drift of its readings over the last ~6 s,
  // long enough that jitter while standing still reads as almost nothing.
  hist.push(raw); hist = hist.filter(h => raw.t - h.t <= 6000);
  const span = (raw.t - hist[0].t) / 1000, drift = span >= 2 ? meters(hist[0].ll, raw.ll) / span : 0;
  if(!est || raw.t - est.t > 60000){ est = { la, ln, v:acc * acc, t:raw.t }; skips = 0; }
  else {
    const dt = Math.max(0, (raw.t - est.t) / 1000), sp = Math.max(2, raw.speed || 0, drift) * 1.5;
    est.v += sp * sp * dt; est.t = raw.t;
    const k = Math.cos(la * Math.PI / 180), d = Math.hypot((la - est.la) * M_PER_DEG, (ln - est.ln) * M_PER_DEG * k);
    if(d > 3 * Math.sqrt(est.v + acc * acc) && acc > 1.5 * Math.sqrt(est.v) && ++skips < 3) return null;
    if(d > 3 * Math.sqrt(est.v + acc * acc) && skips >= 3){ est = { la, ln, v:acc * acc, t:raw.t }; }
    else { const g = est.v / (est.v + acc * acc); est.la += g * (la - est.la); est.ln += g * (ln - est.ln); est.v *= (1 - g); }
    skips = 0;
  }
  return { ll:[est.la, est.ln], acc:Math.min(acc, Math.sqrt(est.v)), alt:raw.alt, t:raw.t, raw };
}

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
      const c = pos.coords, t = pos.timestamp || Date.now();
      const raw = { ll:[c.latitude, c.longitude], acc:c.accuracy, alt:c.altitude, t, speed:c.speed };
      LF.emit('gpsRaw', raw);   // every reading as the phone gave it (averaging a spot uses these)
      const fix = smooth(raw); if(!fix) return;   // a sudden bad reading: keep showing the better estimate
      LF.gps.last = fix;
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
    }, { enableHighAccuracy:true, maximumAge:0, timeout:30000 });   // maximumAge 0: never a cached position
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
