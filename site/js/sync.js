/* Line Fence: sync for approved accounts.
   The device stays the working copy (everything works offline); this sends
   local changes to /api/sync and pulls changes made on other devices.
   - Every local save or delete of a waypoint/track/drawing marks it pending
     (LF.prefs 'syncPending'); pending changes go up in batches.
   - Pulls ask for everything after the last server seq this device has seen.
   - Newest `updated` wins, on the server and here.
   - The first time an account syncs on a device, items already on the device
     (saved before signing in) are added to that account. Signing out removes
     the account's items from the device; they stay on the server. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { db, prefs, flash } = LF;
const BACKUP = db.BACKUP;
const BATCH_BYTES = 4 * 1024 * 1024;
let pending = prefs.get('syncPending', {});    // "store:id" -> true
let busy = null, timer = null, lastOk = prefs.get('syncLast', 0), lastErr = '';

const save = () => prefs.set('syncPending', pending);
const user = () => LF.account && LF.account.user();
const on = () => LF.account && LF.account.approved();
const seqKey = () => 'syncSeq:' + (user() ? user().id : 0);

LF.listen('dbWrite', w => {
  if(!BACKUP.includes(w.store)) return;
  pending[w.store + ':' + w.id] = true; save();
  schedule(2000);
});
function schedule(ms){ clearTimeout(timer); timer = setTimeout(() => now(), ms); }

async function push(){
  const keys = Object.keys(pending);
  let batch = [], bytes = 0, sent = [];
  const flush = async () => {
    if(!batch.length) return;
    await LF.api('POST', 'sync', { changes:batch });
    // Only clear what didn't change again while it was in flight.
    sent.forEach(([k, upd]) => { if(pending[k] && upd === stamp[k]) delete pending[k]; });
    save(); batch = []; bytes = 0; sent = [];
  };
  const stamp = {};
  for(const k of keys){
    const i = k.indexOf(':'), store = k.slice(0, i), id = k.slice(i + 1);
    const rec = await db.get(store, id);
    const change = rec ? { store, id, updated:rec.updated || Date.now(), data:rec } : { store, id, updated:Date.now(), deleted:true };
    stamp[k] = rec ? rec.updated : undefined;
    const size = JSON.stringify(change).length;
    if(bytes + size > BATCH_BYTES) await flush();
    batch.push(change); bytes += size; sent.push([k, stamp[k]]);
  }
  await flush();
}

async function pull(){
  let since = prefs.get(seqKey(), 0), more = true, n = 0;
  while(more){
    const j = await LF.api('GET', 'sync?since=' + since);
    for(const it of j.items){
      if(!BACKUP.includes(it.store)) continue;
      if(pending[it.store + ':' + it.id]) continue;   // our newer local edit goes up next
      if(it.deleted){ await db.remove(it.store, it.id); n++; continue; }
      const cur = await db.get(it.store, it.id);
      if(!cur || (cur.updated || 0) <= it.updated){ await db.apply(it.store, it.data); n++; }
    }
    since = j.seq; more = j.more;
    prefs.set(seqKey(), since);
  }
  return n;
}

/* A device changing hands: someone else's synced items go; your local, never-synced ones join your account. */
async function adopt(){
  const u = user(); if(!u) return;
  const owner = prefs.get('syncOwner', null);
  if(owner === u.id) return;
  if(owner && owner !== u.id){ for(const s of BACKUP) await db.clear(s); pending = {}; save(); }
  else for(const s of BACKUP) for(const r of await db.all(s)) pending[s + ':' + r.id] = true;
  save(); prefs.set('syncOwner', u.id); prefs.set(seqKey(), 0);
}

async function now(loud){
  if(!on()) return false;
  if(busy) return busy;
  busy = (async () => {
    try{
      await adopt();
      await push();
      const n = await pull();
      lastOk = Date.now(); prefs.set('syncLast', lastOk); lastErr = '';
      if(loud) flash(n ? `Synced: ${n} update${n === 1 ? '' : 's'} from your other devices` : 'Everything is synced', 2500);
      return true;
    }catch(e){
      lastErr = e.message || String(e);
      if(e.status === 401 || e.status === 403) LF.account.refresh();
      if(loud) flash('Sync failed: ' + lastErr, 4000);
      return false;
    }finally{ busy = null; }
  })();
  return busy;
}

/* Signing out: this account's items leave the device. */
async function forget(){
  for(const s of BACKUP) await db.clear(s);
  pending = {}; save();
  prefs.set('syncOwner', null);
}

function status(){
  const n = Object.keys(pending).length;
  const when = lastOk ? new Date(lastOk).toLocaleString('en-US', { dateStyle:'short', timeStyle:'short' }) : 'never';
  return (n ? `${n} change${n === 1 ? '' : 's'} waiting to send · ` : 'Up to date · ') + 'last synced ' + when + (lastErr ? ' · last try failed: ' + lastErr : '');
}

LF.listen('account', u => { if(u && u.status === 'approved') now(); });
window.addEventListener('online', () => schedule(500));
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') schedule(500); });
setInterval(() => { if(document.visibilityState === 'visible') now(); }, 60000);
setTimeout(() => now(), 1500);

LF.sync = { now, forget, status, pendingCount:() => Object.keys(pending).length };
})(window.LF);
