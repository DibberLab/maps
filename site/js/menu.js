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
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>' };
const svg = k => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const item = (act, icon, label, extra, data) => `<button class="mi" data-m="${act}"${data ? ` data-v="${esc(data)}"` : ''}>${svg(icon)}<span>${esc(label)}</span>${extra != null ? `<span class="n">${extra}</span>` : ''}</button>`;

async function render(){
  const u = LF.account.user(), ok = LF.account.approved();
  let c = null;
  try{ if(await LF.db.ready()) c = await LF.items.counts(); }catch(e){}
  body.innerHTML =
    `<button class="mi acct" data-m="account">${svg('user')}<span><b>${esc(u ? (u.name || u.email) : 'Sign in or create an account')}</b>` +
      `<span class="small">${u ? (u.status === 'approved' ? (u.role === 'admin' ? 'Admin · ' : '') + 'signed in' : 'waiting for approval') : 'to save waypoints, tracks and drawings'}</span></span></button>` +
    '<h3>My content</h3>' +
    item('list', 'all', 'Everything', c && c.all) + item('waypoints', 'waypoints', 'Waypoints', c && c.waypoints) + item('tracks', 'tracks', 'Tracks', c && c.tracks) +
    item('line', 'line', 'Lines', c && c.line) + item('area', 'area', 'Areas', c && c.area) +
    (c && c.folders.length ? '<h3>Folders</h3>' + c.folders.map(([f, n]) => item('folder', 'folder', f, n, f)).join('') : '') +
    '<h3>Map</h3>' + item('offline', 'offline', 'Offline areas') + item('layers', 'layers', 'Layers & base map') +
    (u && u.role === 'admin' && ok ? item('admin', 'admin', 'Admin portal') : '') +
    '<p class="small menu-foot">Line Fence · property lines, public land and your own marks. Not a survey.</p>';
}
function open(){ LF.closePanel(); LF.closeTools(); menu.hidden = false; scrim.hidden = false; btn.setAttribute('aria-expanded', 'true'); render(); menu.querySelector('.close').focus(); }
function close(){ menu.hidden = true; scrim.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
btn.addEventListener('click', () => menu.hidden ? open() : close());
scrim.addEventListener('click', close);
menu.querySelector('.close').addEventListener('click', close);
document.addEventListener('keydown', e => { if(e.key === 'Escape' && !menu.hidden) close(); });
body.addEventListener('click', e => {
  const b = e.target.closest('[data-m]'); if(!b) return;
  const m = b.dataset.m; close();
  if(m === 'account') return LF.account.sheet();
  if(m === 'admin'){ location.href = '/admin/'; return; }
  if(m === 'layers') return document.getElementById('layersBtn').click();
  if(m === 'offline') return LF.account.require('offline areas') && LF.offline.list();
  if(!LF.account.require('waypoints, tracks and drawings')) return;
  if(m === 'list') LF.items.list({});
  else if(m === 'folder') LF.items.list({ folder:b.dataset.v });
  else LF.items.list({ type:m });
});
LF.listen('account', () => { if(!menu.hidden) render(); });
LF.menu = { open, close };
})(window.LF);
