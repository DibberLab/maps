/* Line Fence: track recording.
   Records GPS fixes into a track, saves it to the device every few seconds
   (so a reload or a crash doesn't lose it), keeps the screen awake while
   recording, and shows time, distance, pace and climb in a chip at the top. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, db, geo, flash } = LF;
const chip = document.getElementById('recChip'), stat = chip.querySelector('.txt'), pauseBtn = chip.querySelector('[data-a=pause]');
const MAX_ACC = 40;          // ignore fixes worse than this many meters
const SAVE_MS = 10000;
let rec = null, line = null, timer = null, lastSave = 0, dirty = false, pausedAt = null, lock = null;

const movingMs = () => rec ? Math.max(0, (pausedAt || Date.now()) - rec.started - (rec.pausedMs || 0)) : 0;
function show(){
  if(!rec) return;
  const m = geo.length(rec.points), ms = movingMs();
  const alts = rec.points.map(p => p[2]);
  stat.textContent = (pausedAt ? 'Paused · ' : '● ') + geo.fmtTime(ms) + ' · ' + geo.fmtDist(m) + ' · ' + geo.fmtPace(ms, m) +
    (alts.some(a => a != null) ? ' · +' + geo.fmtFt(geo.gain(alts)) : '');
  chip.classList.toggle('paused', !!pausedAt);
  pauseBtn.textContent = pausedAt ? 'Resume' : 'Pause';
}
async function save(force){
  if(!rec || (!dirty && !force)) return;
  dirty = false; lastSave = Date.now();
  try{ rec = await db.put('tracks', rec); }catch(e){ console.warn('track save failed', e); }
}

async function wake(on){
  try{
    if(on && !lock && navigator.wakeLock) lock = await navigator.wakeLock.request('screen');
    if(!on && lock){ await lock.release(); lock = null; }
  }catch(e){ lock = null; }
}
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && rec && !pausedAt){ lock = null; wake(true); } });

function onFix(fix){
  if(!rec || pausedAt) return;
  if(fix.acc > MAX_ACC) return;
  const last = rec.points[rec.points.length - 1];
  if(last && geo.dist(last, fix.ll) < Math.max(4, fix.acc / 3)) return;
  rec.points.push([+fix.ll[0].toFixed(6), +fix.ll[1].toFixed(6), fix.alt != null ? +fix.alt.toFixed(1) : null, fix.t]);
  line.addLatLng(fix.ll); dirty = true;
  if(Date.now() - lastSave > SAVE_MS) save();
  show();
}

function begin(r){
  rec = r; pausedAt = null;
  if(!line) line = L.polyline([], { pane:'hiPane', color:'#d62828', weight:4, interactive:false }).addTo(map);
  line.setLatLngs(rec.points.map(p => [p[0], p[1]]));
  if(!LF.gps.start('track')){ rec = null; return; }
  chip.hidden = false; show();
  timer = setInterval(show, 1000);
  wake(true);
}
async function startNew(){
  if(rec) return;
  if(!(await db.ready())){ flash('This browser is blocking on-device storage, so tracks cannot be saved.', 5000); return; }
  LF.closeTools();
  const now = Date.now();
  begin({ id:db.newId(), recording:true, started:now, pausedMs:0, points:[], color:'#d62828' });
  await save(true);
  db.persist();
  flash('Recording. Keep Line Fence open and the screen on.', 4000);
  if(LF.gps.last && Date.now() - LF.gps.last.t < 10000) onFix(LF.gps.last);
}
function pause(){
  if(!rec) return;
  if(pausedAt){ rec.pausedMs = (rec.pausedMs || 0) + Date.now() - pausedAt; pausedAt = null; wake(true); }
  else { pausedAt = Date.now(); wake(false); }
  dirty = true; save(); show();
}
async function finish(){
  if(!rec) return;
  if(pausedAt){ rec.pausedMs = (rec.pausedMs || 0) + Date.now() - pausedAt; pausedAt = null; }
  clearInterval(timer); timer = null; LF.gps.stop('track'); wake(false);
  chip.hidden = true;
  const r = rec; rec = null;
  if(line){ line.remove(); line = null; }
  if(r.points.length < 2){
    await db.del('tracks', r.id);
    flash('Track was too short to save', 3000); return;
  }
  r.recording = false; r.ended = r.points[r.points.length - 1][3] || Date.now();
  await db.put('tracks', r);
  LF.items.editTrack(r.id);
}

chip.addEventListener('click', e => {
  const a = e.target.closest('[data-a]'); if(!a) return;
  if(a.dataset.a === 'pause') pause();
  if(a.dataset.a === 'stop') finish();
});
LF.listen('gps', onFix);
/* Location permission was taken away mid-track: pause and keep what we have. */
LF.listen('gpsError', users => { if(rec && users.includes('track')){ pausedAt = pausedAt || Date.now(); dirty = true; save(); show();
  stat.textContent = 'Location blocked · ' + stat.textContent; } });
window.addEventListener('pagehide', () => save(true));

/* A track left recording (page closed or reloaded) picks up where it stopped. */
db.ready().then(ok => ok && db.all('tracks')).then(all => {
  const open = (all || []).find(t => t.recording);
  if(!open) return;
  begin(open);
  // Paused since its last save: the time the page was closed doesn't count as moving,
  // and the user decides whether to carry on (they may be home already).
  pausedAt = Math.min(Date.now(), open.updated || Date.now());
  show();
  flash('You have an unfinished track. Resume or Stop it at the top.', 6000);
});

LF.track = { start:startNew, recording:() => !!rec };
})(window.LF);
