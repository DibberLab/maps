/* Line Fence: accounts.
   Anyone can use the map, lookups, search, GPS and measuring. Saving
   waypoints, tracks, drawings and offline areas needs an account that the
   admin has approved (LF.account.require). The server is /api/ on this same
   site; see server/app.py. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { flash } = LF;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user = LF.prefs.get('account', null);    // last known, so the app knows who you are offline
let checked = false;

async function api(method, path, data){
  const res = await fetch('/api/' + path, { method, credentials:'same-origin',
    headers: data !== undefined ? { 'Content-Type':'application/json' } : {}, body: data !== undefined ? JSON.stringify(data) : undefined });
  let j = {}; try{ j = await res.json(); }catch(e){}
  if(!res.ok){ const e = new Error(j.error || (res.status === 404 ? 'Accounts are not set up on this server yet.' : 'Something went wrong (' + res.status + ').')); e.status = res.status; throw e; }
  return j;
}
LF.api = api;

function setUser(u){
  const was = user;
  user = u; LF.prefs.set('account', u);
  updateEntry();
  if(JSON.stringify(was) !== JSON.stringify(u)) LF.emit('account', u);
}
async function refresh(){
  try{ const j = await api('GET', 'me'); checked = true; setUser(j.user); }
  catch(e){ /* offline or no server: keep the last known account */ }
  return user;
}
const approved = () => !!(user && user.status === 'approved');

/* Call before any saving feature. Returns true if allowed; otherwise explains and offers sign-in. */
function require(what){
  if(approved()) return true;
  if(user && user.status === 'pending') sheet(`Saving ${what} unlocks once your account is approved. You'll be able to use it as soon as the admin approves you.`);
  else sheet(`Saving ${what} needs a Line Fence account. Sign in, or create one and the admin will approve it.`);
  return false;
}

/* ---------- The entry in the + menu ---------- */
const entry = document.getElementById('accountEntry');
function updateEntry(){
  if(!entry) return;
  const t = entry.querySelector('.who'), s = entry.querySelector('.small');
  if(!user){ t.textContent = 'Sign in or create an account'; s.textContent = 'to save waypoints, tracks, drawings and offline areas'; }
  else { t.textContent = user.name || user.email; s.textContent = user.status === 'approved' ? (user.role === 'admin' ? 'Admin · ' : '') + 'signed in' : 'waiting for approval'; }
  document.querySelectorAll('[data-gated]').forEach(el => el.classList.toggle('locked', !approved()));
}

/* ---------- Account sheet ---------- */
function sheet(reason, mode){
  if(user) return signedIn(reason);
  mode = mode || 'signin';
  const signup = mode === 'signup';
  const html = (reason ? `<p class="saved-note">${esc(reason)}</p>` : '') + `<form class="edit" id="acct" onsubmit="return false">
      ${signup ? '<label>Your name<input id="a-name" autocomplete="name" maxlength="80"></label>' : ''}
      <label>Email<input id="a-email" type="email" autocomplete="email" inputmode="email" required></label>
      <label>Password<input id="a-pw" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8"></label>
      ${signup ? '<p class="small">At least 8 characters. New accounts can use the map right away; saving unlocks when the admin approves you.</p>' : ''}
      <p class="form-err" id="a-err" role="alert"></p>
      <div class="btnrow acts"><button type="submit" class="btn primary" data-act="${signup ? 'signup' : 'signin'}">${signup ? 'Create account' : 'Sign in'}</button>
        <button type="button" class="btn" data-act="${signup ? 'to-signin' : 'to-signup'}">${signup ? 'I have an account' : 'Create an account'}</button></div>
      ${signup ? '' : '<p class="small">Forgot your password? Ask the admin to reset it.</p>'}
    </form>`;
  LF.showSheet(`<h2>${signup ? 'Create an account' : 'Sign in'}</h2>`, html, { onAct: async act => {
    if(act === 'to-signup') return sheet(reason, 'signup');
    if(act === 'to-signin') return sheet(reason, 'signin');
    if(act !== 'signin' && act !== 'signup') return;
    const $ = id => document.getElementById(id), errEl = $('a-err');
    const btn = document.querySelector('#acct .btn.primary'); btn.disabled = true; errEl.textContent = '';
    try{
      const j = await api('POST', act === 'signup' ? 'signup' : 'login',
        { email:$('a-email').value, password:$('a-pw').value, name:$('a-name') ? $('a-name').value : undefined });
      setUser(j.user);
      if(j.user.status === 'approved') { LF.closeSheet(); flash('Signed in as ' + (j.user.name || j.user.email)); }
      else signedIn();
    }catch(e){ errEl.textContent = e.message; btn.disabled = false; }
  } });
  // Enter key submits; the sheet's handler only sees clicks.
  document.getElementById('acct').addEventListener('submit', () => document.querySelector('#acct .btn.primary').click());
}

function signedIn(reason){
  const pending = user.status !== 'approved';
  const st = LF.sync ? LF.sync.status() : '';
  const html = (reason ? `<p class="saved-note">${esc(reason)}</p>` : '') +
    `<dl><dt>Name</dt><dd>${esc(user.name || '—')}</dd><dt>Email</dt><dd>${esc(user.email)}</dd>
      <dt>Status</dt><dd>${pending ? 'Waiting for approval' : 'Approved' + (user.role === 'admin' ? ' · admin' : '')}</dd>
      ${pending ? '' : `<dt>Sync</dt><dd id="a-sync">${esc(st)}</dd>`}</dl>` +
    (pending ? '<p class="small">The admin has been asked to approve you. Until then you can use the map, parcel and public land lookups, search, GPS and measuring.</p>' : '') +
    '<div class="btnrow acts">' + (pending ? '<button class="btn" data-act="recheck">Check again</button>' : '<button class="btn" data-act="sync">Sync now</button>') +
    (user.role === 'admin' ? '<a class="btn" href="/admin/">Admin portal</a>' : '') +
    '<button class="btn" data-act="pw">Change password</button><button class="btn danger" data-act="signout">Sign out</button></div>' +
    '<div id="a-pwbox"></div>';
  LF.showSheet(`<h2>Your account</h2>`, html, { onAct: async (act) => {
    if(act === 'recheck'){ await refresh(); if(approved()){ LF.closeSheet(); flash('You are approved. Saving is unlocked.'); } else flash('Still waiting for approval'); }
    if(act === 'sync' && LF.sync){ await LF.sync.now(true); const el = document.getElementById('a-sync'); if(el) el.textContent = LF.sync.status(); }
    if(act === 'pw'){
      document.getElementById('a-pwbox').innerHTML = `<form class="edit" onsubmit="return false"><label>Current password<input id="p-cur" type="password" autocomplete="current-password"></label>
        <label>New password<input id="p-new" type="password" autocomplete="new-password" minlength="8"></label><p class="form-err" id="p-err"></p>
        <div class="btnrow acts"><button type="button" class="btn primary" data-act="pw-save">Save password</button></div></form>`;
    }
    if(act === 'pw-save'){
      const e = document.getElementById('p-err');
      try{ await api('POST', 'me/password', { current:document.getElementById('p-cur').value, new:document.getElementById('p-new').value });
        document.getElementById('a-pwbox').innerHTML = ''; flash('Password changed'); }
      catch(x){ e.textContent = x.message; }
    }
    if(act === 'signout') signOut();
  } });
}

async function signOut(){
  if(LF.sync){
    await LF.sync.now(true);
    const left = LF.sync.pendingCount();
    if(left && !confirm(`${left} change${left === 1 ? ' has' : 's have'} not reached the server yet (no connection?). Sign out anyway and lose ${left === 1 ? 'it' : 'them'}?`)) return;
  }
  try{ await api('POST', 'logout', {}); }catch(e){}
  if(LF.sync) await LF.sync.forget();   // your items stay in your account, not on this device
  setUser(null);
  LF.closeSheet(); flash('Signed out');
}

if(entry) entry.addEventListener('click', () => { LF.closeTools(); if(LF.menu) LF.menu.close(); sheet(); });
updateEntry();
refresh();
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && user && user.status === 'pending') refresh(); });

LF.account = { user:() => user, approved, require, refresh, sheet, checked:() => checked };
})(window.LF);
