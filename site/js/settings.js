/* Line Fence: your map settings follow your account.
   Every browser already keeps its own layer choices (LF.prefs). When you're
   signed in, the layers panel (base map, close-up imagery, every layer and
   label switch) is also saved to your account a moment after any change, and
   applied when you sign in or open the app on another device.
   A shared link that sets its own base map or layers wins for that visit. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const panel = document.getElementById('layersPanel');
const boxes = () => Array.from(panel.querySelectorAll('input[type=checkbox][id^="l-"]'));
let timer = null, applying = false, loadedFor = null, all = {};   // all: the account's whole settings object as last read
/* Each app keeps its own layer choices on the account: Line Fence at the top level (as always), the disc golf app under
   .dg. The lined-up photo (photoShift) is shared: the ground is the same in both. */
const mine = s => LF.isDG ? Object.assign({}, s && s.dg, { photoShift:s && s.photoShift }) : s;

function current(){
  const layers = {};
  boxes().forEach(b => { layers[b.id] = b.checked; });
  return { v:1, base:LF.getBase(), closeup:LF.getCloseup(), layers, photoShift:LF.photoShift ? LF.photoShift.get() : undefined };
}
function apply(s){
  if(!s || typeof s !== 'object') return;
  applying = true;
  try{
    if(s.base && s.base !== LF.getBase()) LF.setBase(s.base);
    if(s.closeup && s.closeup !== LF.getCloseup()){
      const r = panel.querySelector(`input[name=closeup][value="${s.closeup}"]`);
      if(r){ r.checked = true; r.dispatchEvent(new Event('change', { bubbles:true })); }
    }
    if(Array.isArray(s.photoShift) && LF.photoShift) LF.photoShift.set(s.photoShift);
    Object.entries(s.layers || {}).forEach(([id, want]) => {
      const b = document.getElementById(id);
      if(b && b.type === 'checkbox' && b.checked !== !!want){ b.checked = !!want; b.dispatchEvent(new Event('change', { bubbles:true })); }
    });
  }finally{ applying = false; }
}
async function save(){
  const u = LF.account && LF.account.user();
  if(!u) return;
  const cur = current();
  all = LF.isDG ? Object.assign({}, all, { dg:Object.assign({}, cur, { photoShift:undefined }), photoShift:cur.photoShift }) : Object.assign({}, cur, all.dg ? { dg:all.dg } : {});
  try{ await LF.api('POST', 'me/settings', { settings:all }); }catch(e){ /* offline: the next change or sign-in tries again */ }
}
function schedule(){ if(applying) return; clearTimeout(timer); timer = setTimeout(save, 1500); }
panel.addEventListener('change', schedule);
LF.listen('photoShift', schedule);   // the aerial photo lined up (photoshift.js) follows the account too

/* On sign-in (or opening the app signed in): the account's settings win; a new account starts from this device's.
   Opening a shared link that sets its own base map or layers keeps the link's choice for that visit. */
async function load(u, opening){
  if(!u || loadedFor === u.id) return;
  loadedFor = u.id;
  try{
    const j = await LF.api('GET', 'me/settings');
    const fromLink = opening && LF.fromLink && (LF.fromLink.base || LF.fromLink.layers);
    all = j.settings || {};
    const s = mine(j.settings);
    if(s && (s.base || s.layers) && !fromLink) apply(s);
    else if(s && s.photoShift && LF.photoShift) LF.photoShift.set(s.photoShift);
    if(!s || !(s.base || s.layers)) save();
  }catch(e){}
}
LF.listen('account', u => { if(!u) loadedFor = null; else load(u); });
if(LF.account && LF.account.user()) setTimeout(() => load(LF.account.user(), true), 0);

LF.settings = { current, apply, save };
})(window.LF);
