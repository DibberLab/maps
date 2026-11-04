/* Line Fence: address and coordinate search. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, flash } = LF;
const inspect = ll => LF.inspect(ll);

/* ---------- Search ---------- */
document.getElementById('searchForm').addEventListener('submit', async ev=>{
  ev.preventDefault();
  const q = document.getElementById('q').value.trim(); if(!q) return;
  // Course names match even with the disc golf layer off.
  if(!/\d/.test(q) && LF.discgolf){ await LF.discgolf.load(); if(LF.discgolf.find(q)) return; }
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

map.attributionControl.addAttribution('Parcels: WI State Cartographer\'s Office / WLIP, MnGeo · Public land: USGS PAD-US, WI DNR, MN DNR');
})(window.LF);
