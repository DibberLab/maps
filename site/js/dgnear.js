/* Line Fence: Courses near me (the disc golf app's front door; also + > Play). Every course on the disc golf layer
   (OpenStreetMap plus the ones admins published), nearest first from where you are (or the middle of the map until GPS
   answers), with a search box that looks through all of them. A tap opens the course and shows it on the map. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, geo, flash } = LF;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const mi = m => m < 1609 ? Math.round(m / 0.3048).toLocaleString('en-US') + ' ft' : (m / 1609.344).toFixed(m < 16093 ? 1 : 0) + ' mi';
let from = null, fromGps = false, query = '', off = null;

async function near(){
  LF.closeTools && LF.closeTools();
  const g = LF.gps.last;
  if(g && Date.now() - g.t < 120000){ from = g.ll; fromGps = true; }
  else { const c = map.getCenter(); from = [c.lat, c.lng]; fromGps = false;
    // Ask for a position once; the list re-sorts when it comes.
    LF.gps.start('near', fix => { LF.gps.stop('near'); from = fix.ll; fromGps = true; if(open()) render(); }); }
  LF.showSheet('<h2>Courses near me</h2><div class="small">Loading courses…</div>', '<div class="loading">Loading courses</div>', { onClose:() => LF.gps.stop('near') });
  await LF.discgolf.load();
  render();
}
const open = () => !!document.querySelector('#sheetBody [data-near]');
function render(){
  const d = LF.discgolf.data();
  if(!d){ LF.showSheet('<h2>Courses near me</h2>', '<p class="note">The course list didn\'t load. Check your connection and try again.</p>'); return; }
  const q = query.trim().toLowerCase();
  const all = d.courses.map(c => ({ c, d:geo.dist(from, c.c) }));
  const list = (q ? all.filter(x => x.c.name.toLowerCase().includes(q)) : all).sort((a, b) => a.d - b.d).slice(0, q ? 60 : 40);
  const row = x => `<button class="row" data-act="course" data-i="${all.indexOf(x)}"><span class="dgrow"><b>${esc(x.c.name)}</b>` +
    `<span class="small">${[x.c.n ? x.c.n + ' holes' : '', x.c.par ? 'par ' + x.c.par : '', x.c.rating ? '★ ' + x.c.rating : '', x.c.place && !x.c.pub ? x.c.place : '', x.c.pub ? 'mapped hole by hole' : (x.c.holes && x.c.holes.length ? 'holes mapped' : '')].filter(Boolean).join(' · ')}</span></span>` +
    `<span class="dist">${mi(x.d)}</span></button>`;
  const head = `<h2>Courses near me</h2><div class="small">${fromGps ? 'From where you are' : 'From the middle of the map'} · ${d.courses.length.toLocaleString('en-US')} courses</div>`;
  const body = `<div data-near><input id="near-q" type="search" placeholder="Search all courses by name" value="${esc(query)}" autocomplete="off"></div>` +
    (list.length ? '<div class="rows">' + list.map(row).join('') + '</div>' : '<p class="note">No course by that name.</p>');
  const had = document.activeElement && document.activeElement.id === 'near-q';
  LF.showSheet(head, body, { onClose:() => LF.gps.stop('near'), onAct:(act, el) => {
    if(act !== 'course') return;
    const c = all[+el.dataset.i].c;
    LF.discgolf.showCourse(c);
  } });
  const box = document.getElementById('near-q');
  box.addEventListener('input', () => { query = box.value; const pos = box.selectionStart; render(); const b = document.getElementById('near-q'); b.focus(); b.setSelectionRange(pos, pos); });
  if(had){ box.focus(); }
}
LF.courses = { near };
})(window.LF);
