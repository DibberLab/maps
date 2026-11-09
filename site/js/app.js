/* Line Fence: start-up glue. Keeps the address bar in step with the map,
   handles Share, install-as-app, backup/restore, and the offline service worker. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, share, flash } = LF;

/* ---------- Address bar always holds the current view ---------- */
const viewNow = () => { const c = map.getCenter(); return [c.lat, c.lng, map.getZoom()]; };
const pinNow = () => LF.pinLL ? [LF.pinLL.lat, LF.pinLL.lng] : null;
let lastHash = '';
function writeHash(){
  const h = share.build({ view:viewNow(), pin:pinNow() });
  if(h === lastHash) return;
  lastHash = h;
  try{ history.replaceState(null, '', location.pathname + location.search + h); }catch(e){}
}
map.on('moveend', writeHash);
LF.listen('pin', writeHash);

function applyLink(s){
  if(s.base) LF.setBase(s.base);
  if(s.layers) LF.setLayers(s.layers);
  if(s.view) map.setView([s.view[0], s.view[1]], s.view[2]);
  if(s.pin) LF.inspect(L.latLng(s.pin[0], s.pin[1]));
}
/* map.js already used the link's view, base and layers; open its pin (tucked if it was shared tucked). */
if(LF.fromLink.pin){ LF.inspect(L.latLng(LF.fromLink.pin[0], LF.fromLink.pin[1])); if(LF.fromLink.tucked) LF.tuckSheet(true); }
writeHash();
/* Someone pastes another link into this tab. */
window.addEventListener('hashchange', () => {
  if(location.hash === lastHash) return;
  const s = share.parse(location.hash);
  if(!s.pin && LF.pinLL) LF.closeSheet();
  applyLink(s); writeHash();
});

/* ---------- Share this spot ---------- */
/* What a link shares: the map exactly as you see it (centre, zoom, base, layers), plus what the panel shows — a spot,
   a folder (published or refreshed first), a shared folder or one of its items — and whether the panel was tucked. */
LF.shareLink = extra => location.origin + location.pathname + share.build(Object.assign({ view:viewNow(), base:LF.getBase(), layers:LF.onLayers(),
  tucked:document.getElementById('sheet').classList.contains('tucked') }, extra || {}));
/* Short links: the server keeps the long #hash under a 6-letter code (maps.dibberlab.me/api/s/aB3dE9 → the full view).
   Falls back to the long link if the server is slow or unreachable. */
LF.shortLink = async long => {
  const i = long.indexOf('#'); if(i < 0) return long;
  try{
    const r = await Promise.race([LF.api('POST', 'links', { hash:long.slice(i) }), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000))]);
    return location.origin + r.path;
  }catch(e){ return long; }
};
/* A small pop-up with the link, Copy and Send: used when the phone won't open its share menu after the short wait. */
LF.linkPop = (url, title) => {
  let pop = document.getElementById('linkPop');
  if(!pop){ pop = document.createElement('div'); pop.id = 'linkPop'; pop.className = 'linkpop'; document.body.appendChild(pop); }
  pop.innerHTML = `<div class="small">Link to share</div><input readonly value="${url.replace(/"/g, '&quot;')}">` +
    `<div class="btnrow">${navigator.share ? '<button class="btn primary" data-p="send">Send…</button>' : ''}<button class="btn${navigator.share ? '' : ' primary'}" data-p="copy">Copy</button><button class="btn" data-p="close">Done</button></div>`;
  pop.hidden = false;
  pop.onclick = async e => { const a = (e.target.closest('[data-p]') || {}).dataset; if(!a || !a.p) return;
    if(a.p === 'close') pop.hidden = true;
    if(a.p === 'copy'){ try{ await navigator.clipboard.writeText(url); flash('Link copied'); pop.hidden = true; }catch(err){ pop.querySelector('input').select(); } }
    if(a.p === 'send'){ try{ await navigator.share({ title, url }); pop.hidden = true; }catch(err){} } };
  pop.querySelector('input').select();
};
document.getElementById('shareBtn').addEventListener('click', async () => {
  const ctx = LF.shareCtx;
  if(ctx && ctx.run){ ctx.run(); return; }   // e.g. a folder: it publishes, then shows its own Send / Copy
  const url = await LF.shortLink(LF.shareLink(ctx && ctx.params ? ctx.params() : { pin:pinNow() }));
  const title = (document.querySelector('#sheetHead h2') || {}).textContent || 'Line Fence';
  if(navigator.share){
    try{ await navigator.share({ title:'Line Fence: ' + title, url }); return; }
    catch(e){ if(e && e.name === 'AbortError') return; }
  }
  try{ await navigator.clipboard.writeText(url); flash('Link copied'); }
  catch(e){ LF.linkPop(url, 'Line Fence: ' + title); }
});

/* ---------- Install as an app ---------- */
const box = document.getElementById('installBox'), btn = document.getElementById('installBtn'), ios = document.getElementById('iosHint');
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let deferred = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; box.hidden = false; btn.hidden = false; });
btn.addEventListener('click', async () => {
  if(!deferred) return;
  deferred.prompt();
  try{ await deferred.userChoice; }catch(e){}
  deferred = null; btn.hidden = true; box.hidden = ios.hidden;
});
window.addEventListener('appinstalled', () => { box.hidden = true; flash('Line Fence is installed'); });
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if(isIOS && !standalone){ box.hidden = false; ios.hidden = false; }

/* ---------- Your data: backup and restore ---------- */
const note = document.getElementById('dataNote');
async function updateNote(){
  if(!(await LF.db.ready())){ note.textContent = 'This browser is blocking on-device storage (private browsing?). Settings still work; saved items cannot be kept.'; return; }
  const n = await LF.db.count();
  note.textContent = n ? n + (n === 1 ? ' saved item' : ' saved items') + ' on this device. Back up to keep a copy or move them to another device.'
                       : 'Settings and saved items stay on this device. Back up to keep a copy or move them to another device.';
}
LF.db.onChange(updateNote); updateNote();

document.getElementById('backupBtn').addEventListener('click', async () => {
  try{
    const data = await LF.db.exportAll();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type:'application/json' }));
    a.download = 'linefence-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }catch(e){ flash('Backup failed: ' + (e.message || e)); }
});
const file = document.getElementById('restoreFile');
file.addEventListener('change', async () => {
  const f = file.files && file.files[0]; file.value = '';
  if(!f) return;
  try{
    const n = await LF.db.importAll(JSON.parse(await f.text()));
    LF.setBase(LF.prefs.get('base', 'hyb'));
    const on = LF.prefs.get('layers', null);
    if(on) LF.setLayers(Object.keys(on).filter(k => on[k]));
    flash('Restored ' + n + (n === 1 ? ' item' : ' items') + ' and your settings');
  }catch(e){ flash(e instanceof SyntaxError ? 'That file is not a Line Fence backup.' : (e.message || 'Restore failed'), 5000); }
});

/* ---------- + button: tools menu ---------- */
const tBtn = document.getElementById('toolsBtn'), tPanel = document.getElementById('toolsPanel');
function tools(open){ tPanel.hidden = !open; tBtn.classList.toggle('on', open); tBtn.setAttribute('aria-expanded', String(open)); if(open) LF.closePanel(); }
LF.closeTools = () => tools(false);
tBtn.addEventListener('click', () => { if(LF.draw.active()) LF.draw.stop(); tools(tPanel.hidden); });
document.getElementById('layersBtn').addEventListener('click', () => tools(false));
map.on('click', () => { if(!tPanel.hidden) tools(false); });
tPanel.addEventListener('click', e => {
  const b = e.target.closest('[data-tool]'); if(!b) return;
  const t = b.dataset.tool; tools(false);
  const NEED = { waypoint:'waypoints', track:'tracks', dgcourse:'disc golf courses', dgscore:'rounds', dgthrow:'throws', dgthrows:'throws', list:'waypoints, tracks and drawings', 'offline-save':'offline areas', 'offline-list':'offline areas' };
  if(NEED[t] && !LF.account.require(NEED[t])) return;
  if(t === 'track'){ if(LF.track.recording()) flash('Already recording. Use Stop at the top.'); else LF.track.start(); }
  else if(t === 'list') LF.items.list();
  else if(t === 'dgcourse') LF.course.start();
  else if(t === 'dgscore') LF.rounds.start();
  else if(t === 'dgthrow') LF.throws.start();
  else if(t === 'dgthrows') LF.throws.list();
  else if(t === 'dgnear') LF.courses.near();
  else if(t === 'offline-save') LF.offline.save();
  else if(t === 'offline-list') LF.offline.list();
  else LF.draw.start(t);
});

/* ---------- Offline app shell ---------- */
if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered', e)));
}
})(window.LF);
