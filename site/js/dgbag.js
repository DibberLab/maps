/* Line Fence: my bag (+ > Play > My bag). Discs live in LF.db 'discs' (DB v5; synced and backed up):
   { id, name, brand, plastic, speed, glide, turn, fade, weight, color, inBag, notes }. The list groups by type
   (putter / midrange / fairway / distance, from speed), shows flight numbers and a little flight path for a right-hand
   backhand, and each disc's best measured throw (dgthrow.js matches on the disc's name). The molds and their flight
   numbers come from the DiscJerkers Flight Guide (discjerkers.com/flightguide, passed through GET /api/flightguide):
   picking one fills in its brand, category and numbers; they stay editable (the stamp on your disc wins). */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { db, flash } = LF;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
/* The Flight Guide: { cats:[names], discs:[{ id, name, brand, cat, speed, glide, turn, fade }] }, loaded once. */
let FG = null, fgLoading = null;
function guide(){
  if(FG) return Promise.resolve(FG);
  if(fgLoading) return fgLoading;
  fgLoading = LF.api('GET', 'flightguide').then(d => {
    FG = { cats:d.cats || [], snapshot:d.snapshot,
      discs:(d.discs || []).map(r => ({ id:r[0], name:String(r[1]), brand:(d.brands[r[2]] || {}).n || '', cat:(d.cats || [])[r[3]] || '', speed:r[4], glide:r[5], turn:r[6], fade:r[7] })) };
    return FG;
  }).catch(e => { fgLoading = null; throw e; });
  return fgLoading;
}
const FG_ORDER = ['Distance Drivers', 'Hybrid Drivers', 'Control Drivers', 'Midrange Drivers', 'Approach Discs', 'Putters'];
const catOf = d => d.cat || (+d.speed >= 10 ? 'Distance Drivers' : +d.speed >= 6 ? 'Control Drivers' : +d.speed >= 4 ? 'Midrange Drivers' : 'Putters');
const key = c => `${c.name} — ${c.brand}`;
const COLORS = ['#e11d48', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899', '#f5f5f4', '#1f2937'];
const nums = d => [d.speed, d.glide, d.turn, d.fade].map(v => v == null || v === '' ? '?' : v).join(' · ');
/* A right-hand backhand's flight, drawn from the numbers: turn pushes it right mid-flight, fade pulls it left at the end. */
function path(d){
  const t = +d.turn || 0, f = +d.fade || 0, sp = Math.min(14, Math.max(1, +d.speed || 1));
  const top = 58 - 4 * sp, midX = 16 - t * 4, endX = midX - f * 3;
  return `<svg class="flight" viewBox="0 0 32 64" width="22" height="44" aria-hidden="true"><path d="M16 60 Q ${midX} ${(60 + top) / 2} ${Math.max(2, Math.min(30, endX))} ${top}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
}
const ft = m => Math.round(m * 3.28084);

async function list(){
  if(!LF.account.require('your bag')) return;
  const [discs, throws] = await Promise.all([db.all('discs'), db.all('throws')]);
  const best = new Map(); throws.forEach(t => { const k = (t.disc || '').toLowerCase(); if(k && (!best.has(k) || t.dist > best.get(k))) best.set(k, t.dist); });
  const row = d => `<button class="row disc" data-act="edit" data-id="${esc(d.id)}"><span class="dot" style="background:${esc(d.color || '#9ca3af')}"></span>${path(d)}` +
    `<span class="dgrow"><b>${esc(d.name)}</b><span class="small">${esc([d.brand, d.plastic, d.weight ? d.weight + ' g' : ''].filter(Boolean).join(' · '))}</span>` +
    `<span class="fnums">${esc(nums(d))}</span></span>${best.has((d.name || '').toLowerCase()) ? `<span class="dist">${ft(best.get(d.name.toLowerCase()))} ft</span>` : ''}</button>`;
  const inBag = discs.filter(d => d.inBag !== false), shelf = discs.filter(d => d.inBag === false);
  const cats = FG_ORDER.concat(inBag.map(catOf).filter(c => !FG_ORDER.includes(c)));
  const groups = cats.map(label => { const g = inBag.filter(d => catOf(d) === label).sort((a, b) => (+b.speed || 0) - (+a.speed || 0));
    return g.length ? `<div class="block"><h3>${esc(label)} <span class="small">${g.length}</span></h3><div class="rows">${g.map(row).join('')}</div></div>` : ''; }).join('');
  LF.showSheet(`<h2>My bag</h2><div class="small">${inBag.length} disc${inBag.length === 1 ? '' : 's'} in the bag${shelf.length ? ` · ${shelf.length} on the shelf` : ''}</div>`,
    '<div class="btnrow acts"><button class="btn primary" data-act="add">Add a disc</button></div>' + (groups || '<p class="note">Your bag is empty. Add the discs you carry: their flight numbers and best throws show here.</p>') +
    (shelf.length ? `<div class="block"><h3>On the shelf</h3><div class="rows">${shelf.map(row).join('')}</div></div>` : '') +
    '<p class="small">Flight numbers: speed · glide · turn · fade, from the <a href="https://discjerkers.com/flightguide" target="_blank" rel="noopener">DiscJerkers Flight Guide</a>. The little path is a right-hand backhand. Best throws come from Measure a throw.</p>',
    { onAct: async (act, el) => {
      if(act === 'add') edit({});
      if(act === 'edit'){ const d = await db.get('discs', el.dataset.id); if(d) edit(d); }
    } });
}
function edit(d){
  const isNew = !d.id;
  const f = (id, label, v, attrs) => `<label>${label}<input id="${id}" value="${esc(v == null ? '' : v)}" ${attrs || ''}></label>`;
  LF.showSheet(`<h2>${isNew ? 'Add a disc' : esc(d.name)}</h2><div class="small">My bag</div>`,
    `<form class="edit" onsubmit="return false">
      ${f('d-name', 'Disc (mold)', d.name, 'list="d-cat" maxlength="60" placeholder="Start typing: Destroyer, Buzzz…" autocomplete="off"')}
      <datalist id="d-cat"></datalist><p class="small" id="d-fg">Loading the Flight Guide…</p>
      <div class="row2">${f('d-brand', 'Brand', d.brand, 'maxlength="30"')}${f('d-plastic', 'Plastic', d.plastic, 'maxlength="30" placeholder="Star, ESP…"')}</div>
      <div class="lbl">Flight numbers</div>
      <div class="row4">${f('d-speed', 'Speed', d.speed, 'inputmode="decimal"')}${f('d-glide', 'Glide', d.glide, 'inputmode="decimal"')}${f('d-turn', 'Turn', d.turn, 'inputmode="decimal"')}${f('d-fade', 'Fade', d.fade, 'inputmode="decimal"')}</div>
      <div class="row2">${f('d-weight', 'Weight (g)', d.weight, 'inputmode="numeric"')}<label>In the bag<select id="d-in"><option value="1"${d.inBag !== false ? ' selected' : ''}>Yes</option><option value="0"${d.inBag === false ? ' selected' : ''}>On the shelf</option></select></label></div>
      <div class="lbl">Color</div><div class="swatches">${COLORS.map(c => `<button type="button" class="swatch${(d.color || COLORS[0]) === c ? ' on' : ''}" data-act="color" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}</div>
      <label>Notes<textarea id="d-notes" rows="2" maxlength="300">${esc(d.notes || '')}</textarea></label>
      <div class="btnrow acts"><button type="button" class="btn primary" data-act="save">Save</button>${isNew ? '' : '<button type="button" class="btn danger" data-act="del">Delete</button>'}</div>
    </form>`,
    { back:{ label:'My bag', go:list }, onAct: async (act, el) => {
      const $ = id => document.getElementById(id);
      if(act === 'color'){ d.color = el.dataset.c; document.querySelectorAll('#sheetBody .swatch').forEach(s => s.classList.toggle('on', s === el)); }
      if(act === 'del' && confirm(`Delete ${d.name}?`)){ await db.del('discs', d.id); flash('Deleted'); list(); }
      if(act === 'save'){
        const name = $('d-name').value.trim(); if(!name) return flash('Name the disc');
        const n = id => { const v = parseFloat($(id).value); return isFinite(v) ? v : null; };
        const rec = Object.assign({}, d, { name, brand:$('d-brand').value.trim(), plastic:$('d-plastic').value.trim(), speed:n('d-speed'), glide:n('d-glide'),
          turn:n('d-turn'), fade:n('d-fade'), weight:n('d-weight'), inBag:$('d-in').value === '1', color:d.color || COLORS[0], notes:$('d-notes').value.trim() });
        await db.put('discs', rec); db.persist(); flash(`Saved ${name}`); list();
      }
    } });
  // Picking a mold from the Flight Guide fills in its brand, category and numbers (change them to match your stamp).
  const nameBox = document.getElementById('d-name'), note = document.getElementById('d-fg');
  guide().then(g => {
    const dl = document.getElementById('d-cat'); if(!dl) return;
    dl.innerHTML = g.discs.map(c => `<option value="${esc(key(c))}">${esc(c.cat)} · ${c.speed} / ${c.glide} / ${c.turn} / ${c.fade}</option>`).join('');
    note.innerHTML = `${g.discs.length.toLocaleString('en-US')} molds from the <a href="https://discjerkers.com/flightguide" target="_blank" rel="noopener">DiscJerkers Flight Guide</a>: pick one and its numbers fill in.`;
  }).catch(() => { if(note) note.textContent = 'The Flight Guide didn\'t load; type the numbers from your disc.'; });
  nameBox.addEventListener('change', () => {
    if(!FG) return;
    const v = nameBox.value.trim().toLowerCase();
    const c = FG.discs.find(x => key(x).toLowerCase() === v) || FG.discs.find(x => x.name.toLowerCase() === v); if(!c) return;
    nameBox.value = c.name;
    [['d-brand', c.brand], ['d-speed', c.speed], ['d-glide', c.glide], ['d-turn', c.turn], ['d-fade', c.fade]].forEach(([id, val]) => { document.getElementById(id).value = val; });
    d.cat = c.cat; d.fg = c.id;
  });
}
/* Names for the disc box in Measure a throw (kept current as discs change). */
let cached = [];
const refresh = () => db.all('discs').then(a => { cached = a.filter(d => d.inBag !== false).map(d => d.name); }).catch(() => {});
LF.listen('dbWrite', e => { if(e.store === 'discs') refresh(); });
db.ready().then(ok => ok && refresh());
LF.bag = { list, edit, names:() => cached.slice(), guide };
})(window.LF);
