/* Line Fence: tap-to-identify and the results sheet. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map, SRC, css, ACCESS, on } = LF;

/* ---------- Helpers ---------- */
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const has = v => v!==null && v!==undefined && String(v).trim()!=='' && String(v).trim()!=='0' && !/^not available$/i.test(String(v).trim());
const money = v => has(v) && !isNaN(+v) ? '$'+Math.round(+v).toLocaleString('en-US') : null;
const acres = v => has(v) && !isNaN(+v) ? (+v).toLocaleString('en-US',{maximumFractionDigits:2})+' ac' : null;
const date = v => { if(!has(v)) return null; const d = new Date(+v||v); return isNaN(d) ? String(v) : d.toLocaleDateString('en-US'); };
function rows(pairs){ const r = pairs.filter(p=>p[1]!=null && has(p[1]));
  return r.length ? '<dl>'+r.map(([k,v,m])=>`<dt>${esc(k)}</dt><dd${m?' class="mono"':''}>${esc(v)}</dd>`).join('')+'</dl>' : ''; }
const WI_FIELDS = ['OBJECTID','OWNERNME1','OWNERNME2','PSTLADRESS','SITEADRESS','PLACENAME','CONAME','PARCELID','TAXPARCELID',
  'GISACRES','DEEDACRES','ASSDACRES','CNTASSDVALUE','LNDVALUE','IMPVALUE','ESTFMKVALUE','NETPRPTA','PROPCLASS','AUXCLASS','TAXROLLYEAR','SCHOOLDIST'];
const MN_FIELDS = ['objectid','owner_name','owner_more','own_add_l1','own_add_l2','own_add_l3','anumber','st_pre_dir','st_name','st_pos_typ','st_pos_dir',
  'ctu_name','co_name','county_pin','state_pin','acres_poly','acres_deed','emv_land','emv_bldg','emv_total','total_tax','tax_year',
  'useclass1','homestead','sale_date','sale_value','year_built','abb_legal','section','township','range','green_acre','ag_preserv','school_dst','tax_exempt'];
const MFL_FIELDS = ['FID','TAX_TYPE','AC_OP_PLS','AC_CL_PLS','ORDER_EXP','DTRSLD_TXT','MCD_NAME','CNTY_NAME'];
/* Tax-law points (one per 40-acre block) shaped like identify results for dnrBlock. */
function mflResults(q){
  return { err:q.err, results:q.features.map(f => { const p = f.properties; return { layerName:'within 300 m, by 40-acre block', attributes:{
    'Name': (p.TAX_TYPE === 'FCL' ? 'Forest Crop Law' : 'Managed Forest Law') + ' land open to the public',
    'Acres open': p.AC_OP_PLS, 'Acres closed': p.AC_CL_PLS, 'Location': p.DTRSLD_TXT,
    'Town': p.MCD_NAME, 'County': p.CNTY_NAME, 'Enrolled until': p.ORDER_EXP } }; }) };
}

/* Every lookup gives up after LOOKUP_MS, so one slow or broken agency
   service can't leave the sheet stuck on "Looking up…". */
const LOOKUP_MS = 15000;
const timed = (p, empty) => Promise.race([p,
  new Promise(res => setTimeout(() => res(Object.assign({ err:'timeout' }, empty)), LOOKUP_MS))]);
function query(url, latlng, fields, opts){
  opts = opts || {};
  return timed(new Promise(res=>{
    const q = L.esri.query({ url });
    if(opts.nearby) q.nearby(latlng, opts.nearby); else q.intersects(latlng);
    if(opts.where) q.where(opts.where);
    q.returnGeometry(!opts.nearby);
    if(fields) q.fields(fields);
    q.run((err,fc)=> res(err || !fc ? { err: err || true, features:[] } : { features: fc.features||[] }));
  }), { features:[] });
}
function identify(url, latlng, layers){
  return timed(new Promise(res=>{
    L.esri.identifyFeatures({ url }).on(map).at(latlng).tolerance(2).layers(layers || 'visible').returnGeometry(false)
      .run((err,fc,raw)=> res(err ? { err, results:[] } : { results:(raw && raw.results)||[] }));
  }), { results:[] });
}
const both = (a, b) => Promise.all([a, b]).then(([x, y]) => ({ err: x.err && y.err, results: x.results.concat(y.results) }));
const inWI = ll => ll.lat>42.4 && ll.lat<47.4 && ll.lng>-92.95 && ll.lng<-86.2;
const inMN = ll => ll.lat>43.4 && ll.lat<49.5 && ll.lng>-97.3 && ll.lng<-89.4;

const WI_CLASS = { '1':'Residential','2':'Commercial','3':'Manufacturing','4':'Agricultural','5':'Undeveloped','5M':'Agricultural forest',
  '6':'Productive forest','7':'Other','X1':'Exempt: federal','X2':'Exempt: state','X3':'Exempt: county','X4':'Exempt: other' };
function wiClass(v){ if(!has(v)) return null;
  return String(v).split(/[,;]/).map(s=>s.trim()).filter(Boolean).map(c=> WI_CLASS[c] ? `${WI_CLASS[c]} (${c})` : /^W/.test(c) ? `Managed Forest / Forest Crop Law (${c})` : c).join(', '); }

/* ---------- Results sheet ---------- */
const sheet = document.getElementById('sheet'), head = document.getElementById('sheetHead'), body = document.getElementById('sheetBody');
let sheetHandler = null, sheetOnClose = null;
function closeSheet(){
  sheet.hidden = true; hi.clearLayers(); pin.remove(); clickSeq++;
  const f = sheetOnClose; sheetHandler = sheetOnClose = null; if(f) f();
  LF.pinLL = null; LF.emit('pin');
}
document.getElementById('closeSheet').addEventListener('click', closeSheet);
LF.closeSheet = closeSheet;
/* Buttons in the sheet carry data-act="…"; whoever filled the sheet handles them. */
body.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if(el && sheetHandler) sheetHandler(el.dataset.act, el, e); });
body.addEventListener('change', e => { const el = e.target.closest('[data-act]'); if(el && sheetHandler && el.matches('input,select')) sheetHandler(el.dataset.act, el, e); });
/* Other features (saved items, lists) show their own content in the same sheet.
   opts.pin: the spot the Share button should send (or none). */
LF.showSheet = function(headHTML, bodyHTML, opts){
  opts = opts || {};
  const prev = sheetOnClose; sheetOnClose = null; if(prev) prev();
  clickSeq++; hi.clearLayers(); pin.remove();
  head.innerHTML = headHTML; body.innerHTML = bodyHTML;
  sheetHandler = opts.onAct || null; sheetOnClose = opts.onClose || null;
  sheet.hidden = false; sheet.scrollTop = 0;
  document.getElementById('shareBtn').hidden = !opts.pin;
  LF.pinLL = opts.pin ? L.latLng(opts.pin[0], opts.pin[1]) : null; LF.emit('pin');
};
LF.sheetBody = body;
const hi = L.featureGroup().addTo(map);
const pin = L.circleMarker([0,0],{ pane:'hiPane', radius:6, color:'#fff', weight:2, fillColor:css('--blaze'), fillOpacity:1 });

let clickSeq = 0;
/* LF.mode is set while drawing or placing something; taps then belong to that tool. */
map.on('click', e => { if(!LF.mode) inspect(e.latlng); });

LF.inspect = inspect;
async function inspect(ll){
  const seq = ++clickSeq;
  const prev = sheetOnClose; sheetOnClose = null; if(prev) prev();
  sheetHandler = null;
  hi.clearLayers(); pin.setLatLng(ll).addTo(map);
  LF.pinLL = ll; LF.emit('pin');
  document.getElementById('shareBtn').hidden = false;
  sheet.hidden = false;
  head.innerHTML = `<h2>Looking up…</h2><div class="small mono">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div>`;
  body.innerHTML = '<div class="loading">Checking parcel and public land records</div>';

  const jobs = {
    wi: inWI(ll) ? query(SRC.wiParcels, ll, WI_FIELDS) : null,
    mn: inMN(ll) ? query(SRC.mnParcels, ll, MN_FIELDS) : null,
    mncov: inMN(ll) ? query(SRC.mnCoverage, ll, ['countyname','gac_open_approval','viewer_url','data_url']) : null,
    padus: query(SRC.padus, ll, ['Mang_Type','Mang_Name','Des_Tp','Unit_Nm','Pub_Access','DOCACRES']),
    widnr: inWI(ll) ? identify(SRC.wiDnr, ll) : null,
    wiclosed: inWI(ll) ? identify(SRC.wiClosed, ll) : null,
    wimfl: inWI(ll) && on.wimfl ? query(SRC.wiMfl, ll, MFL_FIELDS, { nearby:300, where:'AC_OP_PLS > 0' }).then(mflResults) : null,
    mndnr: inMN(ll) ? both(identify(SRC.mnDnr, ll, 'visible:' + LF.MN_DNR_LAYER), identify(SRC.mnWia, ll)) : null
  };
  const r = {}; await Promise.all(Object.entries(jobs).map(async([k,p])=>{ r[k] = p ? await p : null; }));
  if(seq !== clickSeq) return;
  render(ll, r);
}

function render(ll, r){
  const parcel = (r.wi && r.wi.features[0] && { st:'WI', f:r.wi.features[0] }) || (r.mn && r.mn.features[0] && { st:'MN', f:r.mn.features[0] });
  const pad = (r.padus && r.padus.features || []).filter(f=>f.properties.Pub_Access!=='UK').concat((r.padus && r.padus.features || []).filter(f=>f.properties.Pub_Access==='UK'));
  const access = pad[0] && ACCESS[pad[0].properties.Pub_Access];
  let html = '', title = 'No record here', tags = '';

  if(parcel){
    hi.addLayer(L.geoJSON(parcel.f, { pane:'hiPane', style:{ color:css('--blaze'), weight:3, fillColor:css('--blaze'), fillOpacity:.12 } }));
    const p = parcel.f.properties;
    if(parcel.st==='WI'){
      title = has(p.OWNERNME1) ? p.OWNERNME1 : 'Owner not listed';
      html += '<div class="block"><h3>Parcel · Wisconsin</h3>' + rows([
        ['Second owner', p.OWNERNME2], ['Mailing address', p.PSTLADRESS], ['Site address', p.SITEADRESS],
        ['Municipality', p.PLACENAME], ['County', p.CONAME],
        ['GIS acres', acres(p.GISACRES)], ['Deeded acres', acres(p.DEEDACRES)], ['Assessed acres', acres(p.ASSDACRES)],
        ['Property class', wiClass(p.PROPCLASS)], ['Other class', wiClass(p.AUXCLASS)],
        ['Assessed total', money(p.CNTASSDVALUE)], ['Land value', money(p.LNDVALUE)], ['Improvements', money(p.IMPVALUE)],
        ['Est. market value', money(p.ESTFMKVALUE)], ['Net property tax', money(p.NETPRPTA)], ['Tax roll year', p.TAXROLLYEAR],
        ['School district', p.SCHOOLDIST], ['Parcel ID', p.PARCELID, 1], ['Tax parcel ID', p.TAXPARCELID, 1]
      ]) + '</div>';
    } else {
      title = has(p.owner_name) ? p.owner_name : 'Owner not listed';
      const site = [p.anumber, p.st_pre_dir, p.st_name, p.st_pos_typ, p.st_pos_dir].filter(has).join(' ');
      const plss = has(p.section) && has(p.township) && has(p.range) ? `Sec ${p.section}, T${p.township}N, R${p.range}${+p.range_dir===1?'E':'W'}` : null;
      html += '<div class="block"><h3>Parcel · Minnesota</h3>' + rows([
        ['More owners', p.owner_more], ['Mailing address', [p.own_add_l1,p.own_add_l2,p.own_add_l3].filter(has).join(', ')],
        ['Site address', site], ['City / township', p.ctu_name], ['County', p.co_name],
        ['GIS acres', acres(p.acres_poly)], ['Deeded acres', acres(p.acres_deed)], ['Use class', p.useclass1],
        ['Homestead', p.homestead], ['Tax exempt', p.tax_exempt], ['Green Acres', p.green_acre], ['Ag preserve', p.ag_preserv],
        ['Market value', money(p.emv_total)], ['Land value', money(p.emv_land)], ['Building value', money(p.emv_bldg)],
        ['Total tax', money(p.total_tax)], ['Tax year', p.tax_year], ['Year built', p.year_built],
        ['Last sale', [date(p.sale_date), money(p.sale_value)].filter(Boolean).join(' · ')],
        ['Section / Twp / Range', plss], ['Legal (abbrev.)', p.abb_legal], ['School district', p.school_dst],
        ['County PIN', p.county_pin, 1]
      ]) + '</div>';
    }
  } else {
    const cov = r.mncov && r.mncov.features[0];
    if(cov && String(cov.properties.gac_open_approval).toLowerCase()!=='true'){
      const c = cov.properties, link = c.viewer_url || c.data_url;
      html += `<div class="block"><h3>Parcel</h3><p>${esc(c.countyname)} County, Minnesota does not share its parcels in the free statewide dataset.` +
        (link ? ` Try the county's own map: <a href="${esc(link)}" target="_blank" rel="noopener">${esc(c.countyname)} County GIS</a>.` : ' Check the county GIS or recorder website.') + '</p></div>';
    } else if(!inWI(ll) && !inMN(ll)){
      html += '<div class="block"><p>Property lines are only available in Wisconsin and Minnesota.</p></div>';
    } else if((r.wi && r.wi.err) || (r.mn && r.mn.err)){
      html += '<div class="block"><p>The parcel service did not respond. Check your connection and tap again.</p></div>';
    } else {
      html += '<div class="block"><p>No parcel at this spot. It may be a road, water, or an unmapped area.</p></div>';
    }
  }

  if(pad.length){
    html += '<div class="block"><h3>Public land · PAD-US</h3>' + pad.slice(0,3).map(f=>{ const q=f.properties, a=ACCESS[q.Pub_Access]||ACCESS.UK;
      return `<div style="margin:6px 0"><span class="tag ${a[0]}">${esc(a[1])}</span>` + rows([
        ['Unit', q.Unit_Nm], ['Manager', q.Mang_Name], ['Manager type', q.Mang_Type], ['Designation', q.Des_Tp], ['Acres', acres(q.DOCACRES)]]) + '</div>';
    }).join('') + '</div>';
  }

  const dnr = []
    .concat(r.widnr ? r.widnr.results.map(x=>['WI DNR land',x]) : [])
    .concat(r.wiclosed ? r.wiclosed.results.map(x=>['WI closed / restricted',x]) : [])
    .concat(r.wimfl ? r.wimfl.results.map(x=>['WI MFL/FCL open forest',x]) : [])
    .concat(r.mndnr ? r.mndnr.results.map(x=>['MN public land',x]) : []);
  /* The same property often comes back from several layers of one service. */
  const seen = new Set(), uniq = dnr.filter(([label,x]) => {
    const key = label + JSON.stringify(Object.entries(x.attributes || {}).filter(([k]) => !SKIP.test(k.replace(/\s/g,'_'))));
    if(seen.has(key)) return false; seen.add(key); return true; });
  if(uniq.length){
    html += '<div class="block"><h3>State agency records</h3>' + uniq.slice(0,6).map(([label,x])=>dnrBlock(label,x)).join('') + '</div>';
  }
  const NAMES = { padus:'PAD-US public land', widnr:'WI DNR lands', wiclosed:'WI closed areas', wimfl:'WI MFL/FCL', mndnr:'MN DNR lands', mncov:'MN county coverage' };
  const failed = Object.keys(NAMES).filter(k => r[k] && r[k].err);
  if(failed.length) html += `<p class="note">Did not load: ${failed.map(k => NAMES[k]).join(', ')}. Tap again to retry.</p>`;

  if(parcel) tags += '<span class="tag priv">Parcel</span>';
  if(access) tags += `<span class="tag ${access[0]}">${esc(access[1])}</span>`;
  if(!parcel && pad[0]) title = pad[0].properties.Unit_Nm || pad[0].properties.Mang_Name || 'Public land';
  head.innerHTML = `<h2>${esc(title)}</h2><div>${tags}</div><div class="small mono">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div>`;
  html = '<div class="btnrow acts"><button class="btn" data-act="save-wp">Save waypoint</button>' +
    '<button class="btn" data-act="measure">Measure from here</button></div>' + html;
  sheetHandler = act => {
    if(act === 'save-wp') LF.items.newWaypoint([ll.lat, ll.lng], { name: parcel || !pad[0] ? '' : title });
    if(act === 'measure') LF.draw.start('line', [ll.lat, ll.lng]);
  };
  html += '<p class="note">For reference only, not a survey. Boundaries can be off by many feet. Signs and posted boundaries on the ground override this map, and special hunting rules may apply. Confirm with the county or DNR before you go.</p>';
  body.innerHTML = html;
}

const SKIP = /^(objectid|fid|guid|shape|shape[._]*(area|length|len)|st_(area|length|perimeter)(\(shape\))?|globalid|gis_?acres_?calc|esri_oid|prop_code|prop_name_code|trans_type|ease_status|spatial_update_date|map_restrict_rule_id|pgrm_project|gpsmapid|wia_tile|wia_id|atlas_page|county_num|map_label_)$/i;
function dnrBlock(label, x){
  const a = x.attributes || {}, entries = Object.entries(a).filter(([k,v])=>!SKIP.test(k.replace(/\s/g,'_')) && has(v) && !/^null$/i.test(String(v)));
  const name = entries.find(([k])=>/prop.*name|unit.*name|^name$|area_?name|property$|site|title/i.test(k));
  let uses = '';
  const code = entries.find(([k])=>/ease_use/i.test(k));
  if(code && /^[12]{4}$/.test(String(code[1]))){
    uses = '<div class="uses">' + ['Hiking','Fishing','Hunting','Trapping'].map((n,i)=>
      `<span class="use ${String(code[1])[i]==='1'?'y':'n'}">${n}</span>`).join('') + '</div>';
  }
  const shown = entries.filter(e=>e!==name && e!==code).slice(0,8).map(([k,v])=>[k.replace(/_/g,' ').toLowerCase().replace(/^\w/,c=>c.toUpperCase()), /^https?:/i.test(String(v)) ? null : v]);
  const links = entries.filter(([,v])=>/^https?:\/\//i.test(String(v))).slice(0,2)
    .map(([k,v])=>`<a href="${esc(v)}" target="_blank" rel="noopener">${esc(/pdf/i.test(v)?'Property map (PDF)':'More info')}</a>`).join(' · ');
  return `<div style="margin:8px 0"><div class="small">${esc(label)} · ${esc(x.layerName||'')}</div>` +
    (name ? `<div style="font-weight:600">${esc(name[1])}</div>` : '') + uses + rows(shown) + (links?`<div style="margin-top:4px">${links}</div>`:'') + '</div>';
}
})(window.LF);
