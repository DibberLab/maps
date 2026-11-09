/* Line Fence: which app this is. One codebase, two faces, picked by the web address:
     maps.dibberlab.me         Line Fence: property lines, owners and public land
     <name>.discjerkers.com    the disc golf app: courses first; parcels off and tucked away
   Same server, same accounts, so courses, rounds and throws are in both. Elsewhere (a test server) ?app=dg or ?app=lf
   picks one and is remembered. Loaded before everything else: it sets LF.APP and dresses the page before the map starts.
   The disc golf app's name lives in DG.name (one place). */
window.LF = window.LF || {};
(function(LF){
'use strict';
const DG = {
  key:'dg', name:'Disc Golf', brand:['Disc', 'Golf'],   // working name; see DG.name
  description:'Disc golf courses, scorecards and throw distances, with public land and trout water. Wisconsin and Minnesota.',
  manifest:'manifest-dg.json', icon:'icons/dg-icon.svg', touchIcon:'icons/dg-apple-touch-icon.png', theme:'#0b3d2e',
  search:'Course, town or address',
  // Layer switches it starts with (people's own choices win once they flip one).
  layers:{ parcels:false, mncov:false, padus:true, widnr:true, mndnr:true, trout:true, camp:true },
  discgolfOn:true
};
const LFAPP = { key:'lf', name:'Line Fence', layers:{}, discgolfOn:false };

const host = location.hostname;
let key = /(^|\.)discjerkers\.com$/i.test(host) ? 'dg' : 'lf';
if(!/(^|\.)(discjerkers\.com|dibberlab\.me)$/i.test(host)){   // test servers: ?app=dg / ?app=lf, remembered
  try{
    const q = new URLSearchParams(location.search).get('app');
    if(q === 'dg' || q === 'lf') localStorage.setItem('lf.app', JSON.stringify(q));
    const s = JSON.parse(localStorage.getItem('lf.app') || 'null'); if(s) key = s;
  }catch(e){}
}
const APP = LF.APP = key === 'dg' ? DG : LFAPP;
LF.isDG = key === 'dg';
if(!LF.isDG) return;

/* ---------- Dress the page as the disc golf app ---------- */
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
document.documentElement.classList.add('app-dg');
document.title = APP.name;
const meta = (sel, attr, v) => { const m = $(sel); if(m) m.setAttribute(attr, v); };
meta('meta[name=description]', 'content', APP.description);
meta('meta[name=theme-color]', 'content', APP.theme);
meta('meta[name=apple-mobile-web-app-title]', 'content', APP.name);
meta('link[rel=manifest]', 'href', APP.manifest);
meta('link[rel=icon]', 'href', APP.icon);
meta('link[rel=apple-touch-icon]', 'href', APP.touchIcon);
const brand = `${APP.brand[0]}<span>·</span>${APP.brand[1]}`;
const mb = $('#menuBtn'); if(mb) mb.innerHTML = '<i class="burger" aria-hidden="true"></i>' + brand;
const bs = $('.menu-head .brand-sm'); if(bs) bs.innerHTML = brand;
const q = $('#q'); if(q) q.placeholder = APP.search;

// Tools: disc golf first.
const tp = $('#toolsPanel'), dgHead = tp && Array.from(tp.querySelectorAll('h3')).find(h => /disc golf/i.test(h.textContent));
if(dgHead){
  const group = [dgHead]; let n = dgHead.nextElementSibling;
  while(n && n.tagName !== 'H3'){ group.push(n); n = n.nextElementSibling; }
  const after = $('#accountEntry');
  group.reverse().forEach(el => after.after(el));
  dgHead.textContent = 'Play';
}
$$('#toolsPanel .tool[data-tool="offline-save"] .small').forEach(s => { s.textContent = 'map and public land, no signal needed'; });
$$('#toolsPanel > p.small').forEach(p => { p.textContent = p.textContent.replace(/Line Fence/g, APP.name); });

// Layers: courses, campgrounds and trout water up top; private land at the bottom.
const lp = $('#layersPanel');
if(lp){
  const section = re => { const h = Array.from(lp.querySelectorAll('h3')).find(x => re.test(x.textContent)); if(!h) return null;
    const g = [h]; let n = h.nextElementSibling; while(n && n.tagName !== 'H3' && n.id !== 'installBox'){ g.push(n); n = n.nextElementSibling; } return g; };
  const rec = section(/^Recreation/), fish = section(/^Fishing/), priv = section(/^Private land/);
  const first = lp.firstElementChild;
  [rec, fish].filter(Boolean).forEach(g => g.forEach(el => lp.insertBefore(el, first)));
  if(priv){ const anchor = $('#installBox'); priv.forEach(el => lp.insertBefore(el, anchor)); }
  const tapHint = Array.from(lp.querySelectorAll('p.small')).find(p => /who owns it/.test(p.textContent));
  if(tapHint) tapHint.textContent = 'Tap a course for its holes; tap anywhere else for public land and access.';
}
// Courses near me: a button of its own, above + and the layers.
const tb = $('#toolsBtn');
if(tb){ const b = document.createElement('button'); b.className = 'iconbtn fab fab3'; b.id = 'nearBtn'; b.title = b.ariaLabel = 'Courses near me';
  b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v18M6 6h12M7 6l1.5 6h7L17 6M8 12l1 3h6l1-3M8 21h8"/></svg>';
  b.addEventListener('click', () => LF.courses && LF.courses.near()); tb.after(b); }
const ib = $('#installBtn'); if(ib) ib.textContent = 'Install ' + APP.name + ' on this device';
})(window.LF);
