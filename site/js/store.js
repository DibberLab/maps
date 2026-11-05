/* Line Fence: on-device storage.
   LF.prefs: small settings in localStorage (lf.* keys).
   LF.db:    saved items (waypoints, tracks, drawings, offline areas) in IndexedDB,
             plus a backup/restore file so they can move between devices. */
window.LF = window.LF || {};
(function(LF){
'use strict';

/* Tiny event bus shared by the app's scripts: LF.listen('pin', fn), LF.emit('pin'). */
const bus = {};
LF.listen = (name, fn) => { (bus[name] = bus[name] || []).push(fn); return () => { bus[name] = bus[name].filter(f => f !== fn); }; };   // returns an unsubscribe
LF.emit = (name, arg) => (bus[name] || []).forEach(fn => { try{ fn(arg); }catch(e){ console.error(e); } });

LF.prefs = {
  get(k, d){ try{ const v = localStorage.getItem('lf.'+k); return v===null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('lf.'+k, JSON.stringify(v)); }catch(e){} },
  all(){ const o = {}; try{ for(let i=0;i<localStorage.length;i++){ const k = localStorage.key(i);
    if(k && k.startsWith('lf.')) o[k.slice(3)] = JSON.parse(localStorage.getItem(k)); } }catch(e){} return o; }
};

const DB_NAME = 'linefence', DB_VERSION = 3;   // 3: disc golf rounds
/* Every record has a string `id`. `areas` (offline area summaries) and `areadata`
   (their parcels and public land) can be downloaded again, so backups leave them out. */
const STORES = ['waypoints', 'tracks', 'drawings', 'rounds', 'areas', 'areadata'];
const BACKUP = ['waypoints', 'tracks', 'drawings', 'rounds'];   // backed up and synced to the account
let opening = null;

function open(){
  if(opening) return opening;
  opening = new Promise((res, rej) => {
    if(!('indexedDB' in window)) return rej(new Error('IndexedDB is not available'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { const db = req.result;
      STORES.forEach(s => { if(!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath:'id' }); }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error('Could not open storage'));
    req.onblocked = () => rej(new Error('Storage is open in another tab'));
  });
  opening.catch(() => { opening = null; });
  return opening;
}
function tx(store, mode, fn){
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode), out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = t.onabort = () => rej(t.error || new Error('Storage error'));
  }));
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const listeners = new Set();
const changed = store => listeners.forEach(f => { try{ f(store); }catch(e){ console.error(e); } });

LF.db = {
  STORES, BACKUP,
  newId,
  ready(){ return open().then(() => true, () => false); },
  all(store){ return tx(store, 'readonly', s => s.getAll()).then(r => r || []); },
  get(store, id){ return tx(store, 'readonly', s => s.get(id)); },
  put(store, rec){
    const r = Object.assign({}, rec); if(!r.id) r.id = newId();
    r.updated = Date.now(); if(!r.created) r.created = r.updated;
    return tx(store, 'readwrite', s => { s.put(r); }).then(() => { changed(store); LF.emit('dbWrite', { store, id:r.id }); return r; });
  },
  del(store, id){ return tx(store, 'readwrite', s => { s.delete(id); }).then(() => { changed(store); LF.emit('dbWrite', { store, id, deleted:true }); }); },
  /* For sync: write what the server sent as-is (its own timestamps) without
     marking it as a local change to send back. */
  apply(store, rec){ return tx(store, 'readwrite', s => { s.put(rec); }).then(() => changed(store)); },
  remove(store, id){ return tx(store, 'readwrite', s => { s.delete(id); }).then(() => changed(store)); },
  clear(store){ return tx(store, 'readwrite', s => { s.clear(); }).then(() => changed(store)); },
  count(){ return Promise.all(BACKUP.map(s => tx(s, 'readonly', o => o.count()))).then(n => n.reduce((a, b) => a + b, 0)); },
  onChange(f){ listeners.add(f); return () => listeners.delete(f); },
  /* Ask the browser not to clear our data under storage pressure. */
  persist(){ try{ return navigator.storage && navigator.storage.persist ? navigator.storage.persist() : Promise.resolve(false); }catch(e){ return Promise.resolve(false); } },

  async exportAll(){
    const data = {};
    for(const s of BACKUP) data[s] = await this.all(s);
    // Sync bookkeeping and the signed-in account belong to this device, not the backup.
    const prefs = LF.prefs.all(); Object.keys(prefs).forEach(k => { if(/^(sync|account)/.test(k)) delete prefs[k]; });
    return { app:'linefence', format:1, exported:new Date().toISOString(), prefs, data };
  },
  /* Merges a backup in: records with the same id are replaced by the newer one. */
  async importAll(b){
    if(!b || b.app !== 'linefence' || !b.data) throw new Error('This is not a Line Fence backup file.');
    let n = 0;
    for(const s of BACKUP){
      for(const rec of (Array.isArray(b.data[s]) ? b.data[s] : [])){
        if(!rec || typeof rec.id !== 'string') continue;
        const cur = await this.get(s, rec.id);
        if(cur && (cur.updated || 0) > (rec.updated || 0)) continue;
        await tx(s, 'readwrite', o => { o.put(rec); }); n++;
        LF.emit('dbWrite', { store:s, id:rec.id });   // so a signed-in account syncs what was restored
      }
      changed(s);
    }
    if(b.prefs && typeof b.prefs === 'object') Object.entries(b.prefs).forEach(([k, v]) => { if(!/^(sync|account)/.test(k)) LF.prefs.set(k, v); });
    return n;
  }
};
})(window.LF);
