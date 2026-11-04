/* Line Fence admin portal: approve, turn off, promote and reset accounts.
   Talks to the admin API in server/app.py; the server checks you're an admin. */
(function(){
'use strict';
const main = document.getElementById('main'), meEl = document.getElementById('me');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = t => t ? new Date(t * 1000).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' }) : 'never';
const kb = b => b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
let tab = 'pending', users = [], myId = null, temp = {};

async function api(method, path, data){
  const res = await fetch('/api/' + path, { method, credentials:'same-origin',
    headers: data !== undefined ? { 'Content-Type':'application/json' } : {}, body: data !== undefined ? JSON.stringify(data) : undefined });
  let j = {}; try{ j = await res.json(); }catch(e){}
  if(!res.ok){ const e = new Error(j.error || 'Error ' + res.status); e.status = res.status; throw e; }
  return j;
}

function signIn(msg){
  meEl.textContent = '';
  main.innerHTML = `<form id="f"><p>${esc(msg || 'Sign in with an admin account.')}</p>
    <label>Email<input id="e" type="email" autocomplete="email" required></label>
    <label>Password<input id="p" type="password" autocomplete="current-password" required></label>
    <p class="err" id="x"></p><button class="btn primary" type="submit">Sign in</button></form>`;
  document.getElementById('f').addEventListener('submit', async ev => {
    ev.preventDefault();
    try{ await api('POST', 'login', { email:document.getElementById('e').value, password:document.getElementById('p').value }); load(); }
    catch(e){ document.getElementById('x').textContent = e.message; }
  });
}

async function load(){
  try{
    const j = await api('GET', 'admin/users');
    users = j.users; myId = j.me;
    const me = users.find(u => u.id === myId);
    meEl.textContent = me ? 'Signed in as ' + me.email : '';
    if(tab === 'pending' && !users.some(u => u.status === 'pending')) tab = 'approved';
    render();
  }catch(e){
    if(e.status === 401) signIn();
    else if(e.status === 403) signIn('That account is not an admin. Sign in with an admin account.');
    else main.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

function render(){
  const counts = { pending:0, approved:0, disabled:0 };
  users.forEach(u => counts[u.status]++);
  const tabs = [['pending', 'Waiting for approval'], ['approved', 'Approved'], ['disabled', 'Turned off'], ['all', 'All']];
  const list = users.filter(u => tab === 'all' || u.status === tab);
  main.innerHTML = '<div class="tabs">' + tabs.map(([k, v]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${v}<span class="n">${k === 'all' ? users.length : counts[k]}</span></button>`).join('') + '</div>' +
    (list.length ? list.map(card).join('') : `<p class="empty">${tab === 'pending' ? 'Nobody is waiting for approval.' : 'No accounts here.'}</p>`);
}

function card(u){
  const self = u.id === myId;
  const saved = u.waypoints + u.tracks + u.drawings;
  const acts = [];
  if(u.status !== 'approved') acts.push(`<button class="btn primary" data-a="approve" data-id="${u.id}">Approve</button>`);
  if(u.status === 'approved' && !self) acts.push(`<button class="btn" data-a="unapprove" data-id="${u.id}">Move back to waiting</button>`);
  if(u.status !== 'disabled' && !self) acts.push(`<button class="btn" data-a="disable" data-id="${u.id}">Turn off</button>`);
  if(!self) acts.push(u.role === 'admin' ? `<button class="btn" data-a="demote" data-id="${u.id}">Remove admin</button>` : (u.status === 'approved' ? `<button class="btn" data-a="promote" data-id="${u.id}">Make admin</button>` : ''));
  acts.push(`<button class="btn" data-a="reset" data-id="${u.id}">Reset password</button>`);
  if(!self) acts.push(`<button class="btn danger" data-a="delete" data-id="${u.id}">Delete</button>`);
  return `<div class="card"><div class="top"><div><b>${esc(u.name || u.email)}</b>${u.name ? `<div class="meta">${esc(u.email)}</div>` : ''}</div>
      <div><span class="tag ${u.status}">${u.status === 'pending' ? 'waiting' : u.status === 'disabled' ? 'off' : 'approved'}</span>${u.role === 'admin' ? ' <span class="tag admin">admin</span>' : ''}${self ? ' <span class="meta">(you)</span>' : ''}</div></div>
    <div class="meta">Signed up ${when(u.created)} · last active ${when(u.last_seen)}${saved ? ` · ${u.waypoints} waypoints, ${u.tracks} tracks, ${u.drawings} drawings (${kb(u.bytes)})` : ''}</div>
    <div class="acts">${acts.join('')}</div>
    ${temp[u.id] ? `<div class="temp">Temporary password: <code>${esc(temp[u.id])}</code><br>Give it to ${esc(u.name || u.email)}; they can change it under their account after signing in. It won't be shown again.</div>` : ''}
  </div>`;
}

main.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-tab]');
  if(t){ tab = t.dataset.tab; render(); return; }
  const b = ev.target.closest('[data-a]'); if(!b) return;
  const id = +b.dataset.id, u = users.find(x => x.id === id), a = b.dataset.a;
  try{
    b.disabled = true;
    if(a === 'approve') await api('POST', `admin/users/${id}`, { status:'approved' });
    if(a === 'unapprove') await api('POST', `admin/users/${id}`, { status:'pending' });
    if(a === 'disable'){ if(!confirm(`Turn off ${u.email}? They're signed out and can't sign in until you approve them again. Their saved items are kept.`)) return; await api('POST', `admin/users/${id}`, { status:'disabled' }); }
    if(a === 'promote'){ if(!confirm(`Make ${u.email} an admin? Admins can approve, turn off and delete accounts.`)) return; await api('POST', `admin/users/${id}`, { role:'admin' }); }
    if(a === 'demote') await api('POST', `admin/users/${id}`, { role:'user' });
    if(a === 'reset'){ if(!confirm(`Reset the password for ${u.email}? They'll be signed out everywhere.`)) return; temp[id] = (await api('POST', `admin/users/${id}/reset`, {})).password; }
    if(a === 'delete'){ if(prompt(`Delete ${u.email} and all their saved waypoints, tracks and drawings? This can't be undone. Type their email to confirm.`) !== u.email) return; await api('DELETE', `admin/users/${id}`, {}); }
    await load();
  }catch(e){ alert(e.message); }
  finally{ b.disabled = false; }
});

load();
})();
