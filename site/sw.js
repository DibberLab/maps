/* Line Fence service worker.
   Keeps the app's own files so it opens with no signal, and the fonts.
   Our files: network first (a deploy shows up on the next load), cache if
   the network is slow or gone. USGS base map tiles come from a saved
   offline area (caches named lft-<id>, filled by js/offline.js) when there
   is one, else the network. Offline parcel and public land records live in
   IndexedDB.
   Bump VERSION when the SHELL list changes. */
const VERSION = 'lf-shell-5';
const FONTS = 'lf-fonts-1';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.json',
  'vendor/leaflet-1.9.4.css', 'vendor/leaflet-1.9.4.js', 'vendor/esri-leaflet-3.0.12.js',
  'js/store.js', 'js/share.js', 'js/geo.js', 'js/map.js', 'js/identify.js', 'js/search.js',
  'js/gps.js', 'js/items.js', 'js/draw.js', 'js/track.js', 'js/offline.js', 'js/discgolf.js', 'js/account.js', 'js/sync.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('lf-') && k !== VERSION && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function networkFirst(req){
  return caches.open(VERSION).then(cache => new Promise(resolve => {
    let done = false;
    const fallback = () => cache.match(req, { ignoreSearch:true })
      .then(hit => hit || (req.mode === 'navigate' ? cache.match('index.html') : null))
      .then(hit => hit || Response.error());
    const timer = setTimeout(() => { fallback().then(r => { if(!done && r.type !== 'error'){ done = true; resolve(r); } }); }, NETWORK_WAIT_MS);
    fetch(req).then(res => {
      if(res && res.ok) cache.put(req, res.clone());
      if(!done){ done = true; clearTimeout(timer); resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      if(!done){ done = true; fallback().then(resolve); }
    });
  }));
}

function cacheFirst(req){
  return caches.open(FONTS).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
    if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  })));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;   // accounts and sync: always live, never cached
  if(url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if(url.hostname === 'basemap.nationalmap.gov') e.respondWith(caches.match(req.url).then(hit => hit || fetch(req)));
  else if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(cacheFirst(req));
});
