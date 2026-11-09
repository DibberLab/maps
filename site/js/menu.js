/* Line Fence: the main menu, opened from the Line·Fence logo. Your account at the top, then your
   content by type and by folder (opens the saved list filtered), offline areas, map layers, and the
   admin portal for admins. Saving features keep their usual account gate. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn = document.getElementById('menuBtn'), menu = document.getElementById('menu'), body = document.getElementById('menuBody'), scrim = document.getElementById('menuScrim');
const ICON = {
  all:'<path d="M4 6h16M4 12h16M4 18h16"/>', waypoints:'<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  tracks:'<path d="M5 19c3-1 3-5 6-6s4 2 8-1"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="12" r="1.5"/>', line:'<path d="M4 18 10 8l5 6 5-9"/>',
  area:'<path d="M5 6 18 4l2 13-12 3z"/>', folder:'<path d="M3 7h6l2 2h10v10H3z"/>', offline:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  layers:'<path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="m2 13 10 5 10-5"/>', admin:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  basket:'<path d="M12 3v18M6 6h12M7 6l1.5 6h7L17 6M8 12l1 3h6l1-3M8 21h8"/>',
  photo:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 9v6M9 12h6"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>' };
const svg = k => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const item = (act, icon, label, extra, data) => `<button class="mi" data-m="${act}"${data ? ` data-v="${esc(data)}"` : ''}>${svg(icon)}<span>${esc(label)}</span>${extra != null ? `<span class="n">${extra}</span>` : ''}</button>`;

/* Folders as a tree: ▸ opens the subfolders, the name opens the list, the switch shows or hides
   everything in the folder (subfolders too) without opening it. Open branches are remembered. */
const opened = new Set(LF.prefs.get('menuFoldersOpen', []));
const branch = d => f => {
  const kids = f.kids.length, isOpen = opened.has(f.path);
  return `<div class="mf${f.shown ? '' : ' off'}" style="--d:${d}">` +
    (kids ? `<button class="caret" data-m="fexp" data-v="${esc(f.path)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Close' : 'Open'} ${esc(f.name)}">${isOpen ? '▾' : '▸'}</button>` : '<span class="caret"></span>') +
    `<button class="mi" data-m="folder" data-v="${esc(f.path)}">${svg('folder')}<span>${esc(f.name)}</span><span class="n">${f.n}</span></button>` +
    `<span class="switch" title="Show on the map"><input type="checkbox" role="switch" data-fvis="${esc(f.path)}"${f.shown ? ' checked' : ''} aria-label="Show ${esc(f.path)} on map"><span class="knob"></span></span></div>` +
    (kids && isOpen ? f.kids.map(branch(d + 1)).join('') : '');
};
/* The two menus are swapped (Andrew's call): ☰ opens the actions (Play, add, measure, offline, saved: the old + panel,
   moved here as it is, with the account at the top); + opens your content, folders and map (this list, rendered into
   #toolsPanel each time it opens). */
const plus = document.getElementById('toolsPanel'), actions = document.createElement('div');
actions.id = 'menuActions';
while(plus.firstChild) actions.appendChild(plus.firstChild);
menu.insertBefore(actions, body); plus.appendChild(body);
btn.setAttribute('aria-label', 'Menu: play, add, measure and your account');
const tb = document.getElementById('toolsBtn'); tb.setAttribute('aria-label', 'Your content, folders and map'); tb.title = 'Your content, folders and map';

async function render(){
  const keep = plus.scrollTop;
  const u = LF.account.user(), ok = LF.account.approved();
  let c = null;
  let tree = [];
  try{ if(await LF.db.ready()){ c = await LF.items.counts(); tree = await LF.items.tree(); } }catch(e){}
  body.innerHTML =
    '<h3>My content</h3>' +
    item('list', 'all', 'Everything', c && c.all) + item('waypoints', 'waypoints', 'Waypoints', c && c.waypoints) + item('tracks', 'tracks', 'Tracks', c && c.tracks) +
    item('line', 'line', 'Lines', c && c.line) + item('area', 'area', 'Areas', c && c.area) +
    (tree.length ? '<h3>Folders</h3><div class="mtree">' + tree.map(branch(0)).join('') + '</div>' : '') +
    '<h3>Map</h3>' + item('offline', 'offline', 'Offline areas') + item('layers', 'layers', 'Layers & base map') + item('photo', 'photo', 'Line up the aerial photo') +
    (u && u.role === 'admin' && ok ? '<h3>Admin</h3>' + item('dgcourses', 'basket', 'Disc golf courses') + item('admin', 'admin', 'Admin portal') : '') +
    `<p class="small menu-foot">${LF.isDG ? esc(LF.APP.name) + ' · disc golf courses, rounds and throws.' : 'Line Fence · property lines, public land and your own marks.'} Not a survey.</p>`;
  plus.scrollTop = keep;
}
function open(){ LF.closePanel(); LF.closeTools(); menu.hidden = false; scrim.hidden = false; btn.setAttribute('aria-expanded', 'true'); menu.querySelector('.close').focus(); }
function close(){ menu.hidden = true; scrim.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
btn.addEventListener('click', () => menu.hidden ? open() : close());
scrim.addEventListener('click', close);
menu.querySelector('.close').addEventListener('click', close);
document.addEventListener('keydown', e => { if(e.key === 'Escape' && !menu.hidden) close(); });
body.addEventListener('change', async e => {
  const el = e.target; if(el.dataset.fvis == null) return;
  if(!LF.account.require('waypoints, tracks and drawings')){ el.checked = !el.checked; return; }
  el.disabled = true;
  await LF.items.setFolderHidden(el.dataset.fvis, !el.checked);
  LF.flash((el.checked ? 'Showing “' : 'Hid “') + el.dataset.fvis + '”');
  render();
});
body.addEventListener('click', e => {
  if(e.target.closest('.switch')) return;   // folder switches act on change, and keep the menu open
  const b = e.target.closest('[data-m]'); if(!b) return;
  const m = b.dataset.m;
  if(m === 'fexp'){ const v = b.dataset.v; opened.has(v) ? opened.delete(v) : opened.add(v); LF.prefs.set('menuFoldersOpen', Array.from(opened)); return render(); }
  LF.closeTools();
  if(m === 'account') return LF.account.sheet();
  if(m === 'admin'){ location.href = '/admin/'; return; }
  if(m === 'dgcourses') return LF.dgadmin.list();
  if(m === 'layers') return document.getElementById('layersBtn').click();
  if(m === 'photo') return LF.photoShift.start();
  if(m === 'offline') return LF.account.require('offline areas') && LF.offline.list();
  if(!LF.account.require('waypoints, tracks and drawings')) return;
  if(m === 'list') LF.items.list({});
  else if(m === 'folder') LF.items.list({ folder:b.dataset.v });
  else LF.items.list({ type:m });
});
LF.listen('account', () => { if(!plus.hidden) render(); });
LF.menu = { open, close, render };
})(window.LF);
