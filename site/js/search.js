/* Line Fence: address and coordinate search, and the GPS button. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, flash } = LF;
const inspect = ll => LF.inspect(ll);

/* ---------- Search ---------- */
document.getElementById('searchForm').addEventListener('submit', async ev=>{
  ev.preventDefault();
  const q = document.getElementById('q').value.trim(); if(!q) return;
  const m = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if(m){ const ll = L.latLng(+m[1], +m[2]); map.setView(ll, 16); inspect(ll); return; }
  try{
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&viewbox=-97.3,49.4,-86.2,42.4&bounded=1&q='+encodeURIComponent(q);
    const res = await fetch(url, { headers:{ 'Accept':'application/json' } });
    const j = await res.json();
    if(!j.length){ flash('No match in Wisconsin or Minnesota. Try adding the town or county.'); return; }
    const ll = L.latLng(+j[0].lat, +j[0].lon);
    map.setView(ll, j[0].addresstype==='house' || j[0].type==='house' ? 18 : 15);
    if(map.getZoom()>=17) inspect(ll);
  }catch(e){ flash('Search is not responding. Check your connection and try again.'); }
});

/* ---------- GPS ---------- */
const locBtn = document.getElementById('locate');
let watchId = null, me = null, meAcc = null, firstFix = false;
locBtn.addEventListener('click',()=>{
  if(watchId!==null){ navigator.geolocation.clearWatch(watchId); watchId=null; locBtn.classList.remove('on'); me&&me.remove(); meAcc&&meAcc.remove(); me=meAcc=null; return; }
  if(!('geolocation' in navigator)){ flash('This browser cannot share your location.'); return; }
  locBtn.classList.add('on'); firstFix = false;
  watchId = navigator.geolocation.watchPosition(pos=>{
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
    if(!me){ meAcc = L.circle(ll,{ pane:'hiPane', radius:pos.coords.accuracy, color:'#3b82f6', weight:1, fillOpacity:.12, interactive:false }).addTo(map);
             me = L.circleMarker(ll,{ pane:'hiPane', radius:8, color:'#fff', weight:3, fillColor:'#3b82f6', fillOpacity:1, interactive:false }).addTo(map); }
    else { me.setLatLng(ll); meAcc.setLatLng(ll).setRadius(pos.coords.accuracy); }
    if(!firstFix){ firstFix = true; map.setView(ll, Math.max(map.getZoom(), 17)); inspect(ll); }
  }, err=>{
    flash(err.code===1 ? 'Location is blocked. Allow location for this site in your browser settings.' : 'Could not get a GPS fix. Try again outside.');
    navigator.geolocation.clearWatch(watchId); watchId=null; locBtn.classList.remove('on');
  }, { enableHighAccuracy:true, maximumAge:5000, timeout:20000 });
});

map.attributionControl.addAttribution('Parcels: WI State Cartographer\'s Office / WLIP, MnGeo · Public land: USGS PAD-US, WI DNR, MN DNR');
})(window.LF);
