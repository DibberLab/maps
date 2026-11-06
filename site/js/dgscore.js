/* Line Fence: disc golf, part 2 — score a round.
   + > Disc golf > Score a round. Pick a mapped course (a folder of disc golf holes: its holes and pars come along)
   or another course with a hole count; Singles or Teams; add players or teams (recent names one tap away).
   The scorecard shows one hole at a time: each side's strokes with − / + (tap the number for par), running totals
   against par, and the map moves to the hole. Finish shows the full card and the winner. Rounds live in LF.db
   'rounds' (synced and backed up like the rest): { id, name, folder, format, holes:[{n, par, trackId}],
   sides:[{id, name, members}], scores:{sideId:[strokes|null…]}, hole (index), started, finished }. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, db, geo, flash, prefs } = LF;
const DG = '#0f766e';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const vsPar = d => d === 0 ? 'E' : (d > 0 ? '+' : '−') + Math.abs(d);
const when = t => new Date(t).toLocaleDateString('en-US', { month:'short', day:'numeric' });

/* Courses you've mapped: folders holding disc golf holes, with their holes in order. */
async function courses(){
  const m = new Map();
  (await db.all('tracks')).filter(t => t.dg && t.folder).forEach(t => { if(!m.has(t.folder)) m.set(t.folder, []); m.get(t.folder).push(t); });
  m.forEach(arr => arr.sort((a, b) => (+a.dg.hole || 999) - (+b.dg.hole || 999)));
  return m;
}
function totals(r, sideId){
  let strokes = 0, par = 0, played = 0;
  (r.scores[sideId] || []).forEach((v, i) => { if(v != null){ strokes += v; par += r.holes[i].par; played++; } });
  return { strokes, diff:strokes - par, played };
}

/* ---------- Start ---------- */
async function start(){
  const [cs, rounds, pubAll] = await Promise.all([courses(), db.all('rounds'), LF.discgolf ? LF.discgolf.pub() : []]);
  const pubs = pubAll.filter(p => p.holes.length && !cs.has(LF.items.dgFolder(p.name)));   // public courses you haven't added to your map
  const open = rounds.filter(r => !r.finished).sort((a, b) => b.updated - a.updated);
  const past = rounds.filter(r => r.finished).sort((a, b) => b.finished - a.finished).slice(0, 12);
  const me = (LF.account.user() && LF.account.user().name) || 'Me';
  const recent = prefs.get('dgPlayers', []).filter(n => n !== me).slice(0, 10);
  let sides = [{ id:'s1', name:me, members:[] }], format = 'singles';
  const sideList = () => sides.map((s, i) => `<span class="pchip">${esc(s.name)}${s.members.length ? ` <span class="small">(${esc(s.members.join(', '))})</span>` : ''}<button type="button" data-act="rm" data-i="${i}" aria-label="Remove ${esc(s.name)}">✕</button></span>`).join('') || '<span class="small">Add at least one</span>';
  const recentList = () => recent.filter(n => !sides.some(s => s.name === n)).map(n => `<button type="button" class="btn small-btn" data-act="quick" data-n="${esc(n)}">+ ${esc(n)}</button>`).join('');
  const roundRow = r => `<button class="row" data-act="open-round" data-id="${esc(r.id)}"><span><b>${esc(r.name)}</b><span class="small">${when(r.started)} · ` +
    (r.finished ? r.sides.map(s => esc(s.name) + ' ' + totals(r, s.id).strokes).join(' · ') : `on hole ${r.holes[r.hole].n} of ${r.holes.length}`) + '</span></span></button>';
  LF.showSheet('<h2>Score a round</h2><div class="small">Disc golf</div>',
    (open.length ? '<div class="block"><h3>In progress</h3><div class="rows">' + open.map(roundRow).join('') + '</div></div>' : '') +
    `<form class="edit" onsubmit="return false"><h3>New round</h3>
      <label>Course<select id="r-course">${Array.from(cs.keys()).sort().map(f => `<option value="${esc(f)}">${esc(LF.geo.folderPath(f).pop())} · ${cs.get(f).length} holes</option>`).join('')}
        ${pubs.map(p => `<option value="pub:${esc(p.id)}">${esc(p.name)} · ${p.holes.length} holes</option>`).join('')}
        <option value="">Another course (not mapped)</option></select></label>
      <div id="r-other"${cs.size || pubs.length ? ' hidden' : ''}><div class="row2"><label>Course name<input id="r-name" maxlength="60" placeholder="Course"></label>
        <label>Holes<select id="r-holes">${[9, 18, 27].map(n => `<option${n === 18 ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div></div>
      <div class="lbl">Format</div>
      <div class="seg"><label><input type="radio" name="r-format" value="singles" checked> Singles</label><label><input type="radio" name="r-format" value="teams"> Teams</label></div>
      <div class="lbl" id="r-who">Players</div>
      <div class="pchips" id="r-sides">${sideList()}</div>
      <div class="row2"><input id="r-add" maxlength="40" placeholder="Name"><input id="r-members" maxlength="80" placeholder="Team members (Ben, Sam)" hidden></div>
      <div class="btnrow"><button type="button" class="btn" data-act="add">Add</button><span id="r-recent">${recentList()}</span></div>
      <div class="btnrow acts"><button type="button" class="btn primary" data-act="go">Start round</button></div>
    </form>` +
    (past.length ? '<div class="block"><h3>Past rounds</h3><div class="rows">' + past.map(roundRow).join('') + '</div></div>' : ''),
    { onAct: async (act, el) => {
      const $ = id => document.getElementById(id), redraw = () => { $('r-sides').innerHTML = sideList(); $('r-recent').innerHTML = recentList(); };
      if(act === 'open-round'){ const r = await db.get('rounds', el.dataset.id); if(r) (r.finished ? summary(r) : card(r)); }
      if(act === 'rm'){ sides.splice(+el.dataset.i, 1); redraw(); }
      if(act === 'quick'){ sides.push({ id:'s' + Date.now().toString(36) + sides.length, name:el.dataset.n, members:[] }); redraw(); }
      if(act === 'add'){
        const n = $('r-add').value.trim(); if(!n) return;
        const members = format === 'teams' ? $('r-members').value.split(',').map(x => x.trim()).filter(Boolean) : [];
        sides.push({ id:'s' + Date.now().toString(36) + sides.length, name:n, members }); $('r-add').value = ''; $('r-members').value = ''; redraw(); $('r-add').focus();
      }
      if(act === 'go'){
        if(!sides.length){ flash('Add a player or team'); return; }
        const folder = $('r-course').value;
        let holes, name;
        const pc = folder.startsWith('pub:') && pubs.find(p => 'pub:' + p.id === folder);
        if(pc){ name = pc.name; holes = pc.holes.map((h, i) => ({ n:+h.n || i + 1, par:+h.par || 3, line:h.line })); }
        else if(folder){ name = LF.geo.folderPath(folder).pop(); holes = cs.get(folder).map((t, i) => ({ n:+t.dg.hole || i + 1, par:+t.dg.par || 3, trackId:t.id })); }
        else { name = $('r-name').value.trim() || 'Disc golf'; holes = Array.from({ length:+$('r-holes').value }, (_, i) => ({ n:i + 1, par:3 })); }
        const r = { name, folder:pc ? null : folder || null, format, holes, sides, scores:Object.fromEntries(sides.map(s => [s.id, holes.map(() => null)])), hole:0, started:Date.now(), finished:null };
        prefs.set('dgPlayers', Array.from(new Set(sides.map(s => s.name).concat(prefs.get('dgPlayers', [])))).slice(0, 30));
        const saved = await db.put('rounds', r);
        card(saved); trackRound(saved);
      }
    } });
  const sel = document.getElementById('r-course');
  sel.addEventListener('change', () => { document.getElementById('r-other').hidden = !!sel.value; });
  document.querySelectorAll('input[name=r-format]').forEach(x => x.addEventListener('change', () => {
    format = x.value; const teams = format === 'teams';
    document.getElementById('r-who').textContent = teams ? 'Teams' : 'Players';
    document.getElementById('r-members').hidden = !teams;
    document.getElementById('r-add').placeholder = teams ? 'Team name' : 'Name';
  }));
  document.getElementById('r-add').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); document.querySelector('#sheetBody [data-act=add]').click(); } });
}

/* ---------- The scorecard, one hole at a time ---------- */
let shown = null;   // the round + hole the map was last moved to (so a score tap doesn't move it again)
async function showHole(r){
  const h = r.holes[r.hole], t = h.trackId && await db.get('tracks', h.trackId);
  const ll = t ? t.points.map(p => [p[0], p[1]]) : h.line;   // a public course's hole carries its own line
  if(!ll || ll.length < 2) return null;
  const key = r.id + ':' + r.hole;
  if(shown !== key){ shown = key; LF.fitVisible ? LF.fitVisible(L.latLngBounds(ll), 19) : map.fitBounds(L.latLngBounds(ll)); }
  LF.select.shape(ll, { color:DG, weight:5 });
  return geo.length(ll);
}
async function card(r){
  const h = r.holes[r.hole];
  const row = s => { const v = r.scores[s.id][r.hole], tot = totals(r, s.id);
    return `<div class="srow"><span class="sname"><b>${esc(s.name)}</b>${s.members.length ? `<span class="small">${esc(s.members.join(', '))}</span>` : ''}` +
      `<span class="small">${tot.played ? `${tot.strokes} · ${vsPar(tot.diff)}` : '—'}</span></span>` +
      `<button class="sbtn" data-act="dec" data-s="${s.id}" aria-label="One fewer for ${esc(s.name)}">−</button>` +
      `<button class="sval${v == null ? ' empty' : v < h.par ? ' under' : v > h.par ? ' over' : ''}" data-act="par" data-s="${s.id}" aria-label="${esc(s.name)} strokes">${v == null ? h.par : v}</button>` +
      `<button class="sbtn" data-act="inc" data-s="${s.id}" aria-label="One more for ${esc(s.name)}">+</button></div>`; };
  LF.showSheet(`<h2>Hole ${h.n} · Par ${h.par}</h2><div class="small">${esc(r.name)} · hole ${r.hole + 1} of ${r.holes.length}<span id="r-len"></span>` +
      (r.live ? ` · <span class="tag live-tag">Live</span>` : '') + '</div>',
    `<div data-round="${esc(r.id)}"></div><div class="scard">${r.sides.map(row).join('')}</div>
     <div class="btnrow"><button class="btn" data-act="hpar-">Par −</button><button class="btn" data-act="hpar+">Par +</button><span class="small" style="align-self:center">Tap a number for par</span></div>
     <div class="btnrow acts"><button class="btn" data-act="prev"${r.hole ? '' : ' disabled'}>‹ Hole ${r.hole ? r.holes[r.hole - 1].n : ''}</button>
       ${r.hole < r.holes.length - 1 ? `<button class="btn primary" data-act="next">Hole ${r.holes[r.hole + 1].n} ›</button>` : '<button class="btn primary" data-act="finish">Finish round</button>'}
       <button class="btn" data-act="full">Scorecard</button>${r.hole < r.holes.length - 1 ? '<button class="btn" data-act="finish">Finish</button>' : ''}
       ${LF.account.approved() || r.live ? `<button class="btn" data-act="invite">${r.live ? 'Invite link' : 'Invite'}</button>` : ''}</div>
     ${r.live ? '<p class="note">Live: everyone with the link sees this round and can enter any score; changes show up within a few seconds.</p>' : ''}`,
    { back:{ label:'Rounds', go:start }, onClose:() => leaving(r.id), onAct: async (act, b) => {
      const sid = b.dataset.s, cur = sid ? r.scores[sid][r.hole] : null, ops = [];
      const score = (side, v) => { r.scores[side][r.hole] = v; ops.push({ side, hole:r.hole, value:v }); };
      touched = Date.now();
      if(act === 'inc') score(sid, Math.min(20, (cur == null ? h.par : cur) + 1));
      else if(act === 'dec') score(sid, Math.max(1, (cur == null ? h.par : cur) - 1));
      else if(act === 'par') score(sid, cur == null ? h.par : cur);   // first tap: par
      else if(act === 'hpar-' || act === 'hpar+'){ h.par = Math.max(2, Math.min(7, h.par + (act === 'hpar+' ? 1 : -1))); ops.push({ hole:r.hole, par:h.par }); }
      else if(act === 'prev') r.hole = Math.max(0, r.hole - 1);
      else if(act === 'next'){ r.sides.forEach(x => { if(r.scores[x.id][r.hole] == null) score(x.id, h.par); }); r.hole += 1; }   // untouched = par
      else if(act === 'full') return summary(r);
      else if(act === 'invite') return invite(r);
      else if(act === 'finish'){
        r.sides.forEach(x => { if(r.scores[x.id][r.hole] == null) score(x.id, h.par); });
        const missing = r.holes.filter((_, i) => r.sides.some(x => r.scores[x.id][i] == null)).length;
        if(missing && !confirm(`${missing} hole${missing === 1 ? '' : 's'} still blank. Finish anyway?`)) return;
        r.finished = Date.now(); ops.push({ finished:r.finished }); r = await commit(r, ops); flash('Round saved'); return summary(r);
      }
      else return;
      card(await commit(r, ops));
    } });
  poll(r);
  const len = await showHole(r);
  const el = document.getElementById('r-len'); if(el && len) el.textContent = ' · ' + Math.round(len * 3.28084) + ' ft';
}

/* ---------- Full card and result ---------- */
function summary(r){
  const t = r.sides.map(s => Object.assign({ s }, totals(r, s.id)));
  const best = Math.min(...t.filter(x => x.played).map(x => x.strokes));
  const winners = t.filter(x => x.played && x.strokes === best).map(x => x.s.name);
  const head = '<tr><th>Hole</th>' + r.holes.map(h => `<th>${h.n}</th>`).join('') + '<th>Tot</th><th>±</th></tr>' +
    '<tr class="par"><td>Par</td>' + r.holes.map(h => `<td>${h.par}</td>`).join('') + `<td>${r.holes.reduce((a, h) => a + h.par, 0)}</td><td></td></tr>`;
  const rows = t.map(x => `<tr><td>${esc(x.s.name)}</td>` + r.scores[x.s.id].map((v, i) => `<td class="${v == null ? '' : v < r.holes[i].par ? 'under' : v > r.holes[i].par ? 'over' : ''}">${v == null ? '' : v}</td>`).join('') +
    `<td><b>${x.strokes}</b></td><td>${x.played ? vsPar(x.diff) : ''}</td></tr>`).join('');
  LF.showSheet(`<h2>${esc(r.name)}</h2><div class="small">${when(r.started)} · ${r.format === 'teams' ? 'Teams' : 'Singles'}${r.finished ? '' : ' · in progress'}</div>`,
    `<div data-round="${esc(r.id)}"></div>` + (winners.length && r.finished ? `<div class="block"><p class="winner">🏆 ${esc(winners.join(' & '))}${winners.length > 1 ? ' tie' : ' wins'} with ${best}</p></div>` : '') +
    `<div class="sgrid-wrap"><table class="sgrid">${head}${rows}</table></div>${trackBlock(r)}
     <div class="btnrow acts">${r.finished ? '<button class="btn" data-act="reopen">Edit scores</button>' : '<button class="btn primary" data-act="reopen">Back to the hole</button>'}
       <button class="btn danger" data-act="del">Delete round</button></div>`,
    { back:{ label:'Rounds', go:start }, onClose:() => leaving(r.id), onAct: async act => {
      if(act === 'reopen'){ if(r.finished){ r.finished = null; r.hole = 0; r = await commit(r, [{ finished:null }]); } card(r); }
      if(act === 'del' && confirm(r.live ? 'Delete this round from this phone? Others who joined keep their copy.' : 'Delete this round?')){
        await LF.track.endFor(r.id, false); await db.del('rounds', r.id); flash('Round deleted'); start(); }
      if(act === 'track-save'){
        const t = await LF.track.endFor(r.id, true, { name:`${r.name} round · ${when(r.started)}`, folder:LF.items.dgFolder('Rounds'), color:DG });
        if(t){ r.trackId = t.id; r = await db.put('rounds', r); flash('Track saved with the round', 3000); }
        summary(r);
      }
      if(act === 'track-drop' && confirm('Throw away the track of this round?')){ await LF.track.endFor(r.id, false); summary(r); }
      if(act === 'track-show'){ const t = await db.get('tracks', r.trackId); if(t) LF.items.open('tracks', t.id); else flash('That track was deleted'); }
    } });
  poll(r);
}

/* ---------- Live rounds: invite, join, keep in step ----------
   Invite publishes the round (POST /api/rounds) and hands out a short link to /#round=<id>. Anyone who opens it
   joins (a copy in their own 'rounds', id lv-<id>), with no account needed. Every score is sent on its own
   (POST /api/rounds/<id>), unsent ones wait in r.pending and retry; every 3 s the phone asks for changes
   (?since=<version>) and redraws the card if someone else scored. Each phone keeps its own current hole. */
let timer = null, polling = null, touched = 0, warned = 0;
async function invite(r){
  if(!r.live){
    if(!LF.account.require('inviting players')) return;
    try{ const res = await LF.api('POST', 'rounds', { round:r }); r.live = res.id; r.liveVersion = res.version; r = await db.put('rounds', r); }
    catch(e){ flash('Could not start a live round: ' + e.message, 5000); return; }
    card(r);
  }
  const url = await LF.shortLink(location.origin + location.pathname + '#round=' + r.live);
  LF.linkPop(url, 'Disc golf round at ' + r.name);
}
async function commit(r, ops){
  if(r.live && ops.length) r.pending = (r.pending || []).concat(ops);
  r = await db.put('rounds', r);
  if(r.live && ops.length) send(r.id);
  return r;
}
/* Server copy wins, then our unsent changes on top; the hole each phone is looking at stays its own. */
function merge(r, server, version){
  const tracks = r.holes.map(h => h.trackId);
  r.holes = server.holes.map((h, i) => Object.assign({}, h, tracks[i] ? { trackId:tracks[i] } : {}));
  r.sides = server.sides; r.scores = server.scores; r.finished = server.finished || null; r.liveVersion = version;
  (r.pending || []).forEach(o => { if(o.side) r.scores[o.side][o.hole] = o.value; else if(o.par) r.holes[o.hole].par = o.par; else if('finished' in o) r.finished = o.finished; });
  return r;
}
let sending = false;
async function send(id){
  if(sending) return; sending = true;
  try{
    let r = await db.get('rounds', id); if(!r || !r.live || !(r.pending || []).length) return;
    const ops = r.pending.slice(), body = { scores:ops.filter(o => o.side), pars:ops.filter(o => o.par) };
    const fin = ops.filter(o => 'finished' in o).pop(); if(fin) body.finished = fin.finished;
    const res = await LF.api('POST', 'rounds/' + r.live, body);
    r = await db.get('rounds', id); r.pending = (r.pending || []).slice(ops.length);
    await db.put('rounds', merge(r, res.round, res.version));
  }catch(e){ if(Date.now() - warned > 30000){ warned = Date.now(); flash('No signal for the live round; scores are kept and will send.', 4000); } }
  finally{ sending = false; }
}
function poll(r){
  if(!r.live){ return; }
  polling = r.id;
  clearInterval(timer);
  timer = setInterval(async () => {
    if(!document.querySelector(`#sheetBody [data-round="${CSS.escape(polling)}"]`)){ clearInterval(timer); timer = null; return; }
    let cur = await db.get('rounds', polling); if(!cur) return;
    if((cur.pending || []).length) await send(cur.id);
    try{
      const res = await LF.api('GET', 'rounds/' + cur.live + '?since=' + (cur.liveVersion || 0));
      if(res.same) return;
      cur = merge(await db.get('rounds', polling), res.round, res.version);
      cur = await db.put('rounds', cur);
      if(Date.now() - touched < 800) return;   // don't redraw under a finger mid-tap
      if(!document.querySelector(`#sheetBody [data-round="${CSS.escape(cur.id)}"]`)) return;
      document.querySelector('#sheetBody .winner') || cur.finished ? summary(cur) : card(cur);
    }catch(e){}
  }, 3000);
}
function leaving(id){ setTimeout(() => { if(!document.querySelector(`#sheetBody [data-round="${CSS.escape(id)}"]`)){ clearInterval(timer); timer = null; } }, 0); }
async function join(liveId){
  let res;
  try{ res = await LF.api('GET', 'rounds/' + encodeURIComponent(liveId)); }catch(e){ flash(e.status === 404 ? 'That round was removed or the link is wrong.' : 'Could not open the round: ' + e.message, 5000); return; }
  const id = 'lv-' + liveId;
  let r = await db.get('rounds', id);
  if(!r){
    // Joined from a link: match its holes to our own copy of the course if we have it (for the map).
    const cs = await courses(), mine = res.round.folder && cs.get(res.round.folder);
    r = Object.assign({ id, live:liveId, hole:0, pending:[] }, res.round, { holes:res.round.holes.map((h, i) => Object.assign({}, h, mine && mine[i] ? { trackId:mine[i].id } : {})) });
  }
  const fresh = !(await db.get('rounds', id));
  r = await db.put('rounds', merge(r, res.round, res.version));
  flash('Joined the round at ' + r.name, 3000);
  r.finished ? summary(r) : card(r);
  if(fresh) trackRound(r);
}
const openLink = l => { if(l.round) join(l.round); };
if(LF.fromLink && LF.fromLink.round) setTimeout(() => openLink(LF.fromLink), 400);
window.addEventListener('hashchange', () => openLink(LF.share.parse(location.hash)));

/* ---------- The round's track and the pill under the search bar ----------
   Every round played on this phone records a GPS track from the start (unless a track is already recording).
   When the round is finished you choose: save the track with the round (folder "Disc Golf / Rounds",
   r.trackId) or throw it away. The pill shows the round in progress (or a finished one whose track still
   waits for that choice) and opens it with one tap. */
async function trackRound(r){
  if(r.finished || LF.track.recording()) return;
  await LF.track.start({ round:r.id, name:`${r.name} round` });
}
function trackBlock(r){
  const cur = LF.track.current();
  if(cur && cur.round === r.id){
    return `<div class="block"><h3>Track of this round</h3><p class="small">${geo.fmtDist(cur.m)} · ${geo.fmtTime(cur.ms)}${r.finished ? '' : ' · still recording'}</p>` +
      (r.finished ? '<div class="btnrow"><button class="btn primary" data-act="track-save">Save track with the round</button><button class="btn" data-act="track-drop">Discard track</button></div>' : '') + '</div>';
  }
  return r.trackId ? '<div class="btnrow"><button class="btn" data-act="track-show">Show the track of this round</button></div>' : '';
}
const pill = document.getElementById('roundChip');
async function pillRefresh(){
  if(!pill) return;
  const all = await db.all('rounds').catch(() => []), cur = LF.track.current();
  const waiting = cur && cur.round && all.find(r => r.id === cur.round && r.finished);
  const r = waiting || all.filter(x => !x.finished && Date.now() - (x.updated || x.started) < 12 * 3600e3).sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  pill.hidden = !r;
  if(!r) return;
  pill.dataset.id = r.id;
  pill.querySelector('.txt').textContent = waiting ? `⛳ ${r.name} · round over · save the track?` :
    `⛳ ${r.live ? 'Live round' : 'Round'} · ${r.name} · Hole ${r.holes[r.hole].n}`;
}
if(pill){
  pill.addEventListener('click', async () => { const r = await db.get('rounds', pill.dataset.id); if(r) (r.finished ? summary(r) : card(r)); });
  LF.listen('dbWrite', e => { if(e.store === 'rounds' || (e.store === 'tracks' && e.deleted)) pillRefresh(); });
  db.ready().then(ok => ok && setTimeout(pillRefresh, 500));
}

LF.rounds = { start, card, summary, join };
})(window.LF);
