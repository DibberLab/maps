/* Line Fence: links to a spot.
   The address bar always holds the current view, e.g.
     #map=17/45.78012/-92.38011&pin=45.78012,-92.38011
   A shared link also carries the base map and layers:
     ...&base=hyb&layers=parcels,padus,widnr
   and, when the panel showed a shared folder or one of its items, &share=<id>&item=<id>; &panel=min if it was tucked.
   Pure parsing lives here; app.js wires it to the map. */
window.LF = window.LF || {};
(function(LF){
'use strict';

const num = (s, lo, hi) => { const v = parseFloat(s); return isFinite(v) && v >= lo && v <= hi ? v : null; };

function parse(hash){
  const out = {};
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const m = (q.get('map') || '').split('/');
  if(m.length === 3){
    const z = num(m[0], 1, 22), lat = num(m[1], -90, 90), lng = num(m[2], -180, 180);
    if(z !== null && lat !== null && lng !== null) out.view = [lat, lng, Math.round(z)];
  }
  const p = (q.get('pin') || '').split(',');
  if(p.length === 2){
    const lat = num(p[0], -90, 90), lng = num(p[1], -180, 180);
    if(lat !== null && lng !== null) out.pin = [lat, lng];
  }
  if(q.has('base')) out.base = q.get('base');
  if(q.has('layers')) out.layers = q.get('layers').split(',').map(s => s.trim()).filter(Boolean);
  const id = v => v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
  if(id(q.get('share'))) out.share = q.get('share');   // a shared folder (server copy)
  if(id(q.get('item'))) out.item = q.get('item');       // …open on one of its items
  if(q.get('panel') === 'min') out.tucked = true;       // the info panel was tucked down
  return out;
}

function build(s){
  const parts = [];
  if(s.view) parts.push('map=' + s.view[2] + '/' + s.view[0].toFixed(5) + '/' + s.view[1].toFixed(5));
  if(s.pin) parts.push('pin=' + s.pin[0].toFixed(5) + ',' + s.pin[1].toFixed(5));
  if(s.base) parts.push('base=' + encodeURIComponent(s.base));
  if(s.layers) parts.push('layers=' + s.layers.map(encodeURIComponent).join(','));
  if(s.share) parts.push('share=' + encodeURIComponent(s.share));
  if(s.item) parts.push('item=' + encodeURIComponent(s.item));
  if(s.tucked) parts.push('panel=min');
  return parts.length ? '#' + parts.join('&') : '';
}

LF.share = { parse, build };
})(window.LF);
