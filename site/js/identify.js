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
    q.returnGeometry(!opts.nearby && opts.geometry !== false);
    if(fields) q.fields(fields);
    q.run((err,fc)=> res(err || !fc ? { err: err || true, features:[] } : { features: fc.features||[] }));
  }), { features:[] });
}
function identify(url, latlng, layers, geom){
  return timed(new Promise(res=>{
    const t = L.esri.identifyFeatures({ url }).on(map).at(latlng).tolerance(2).layers(layers || 'visible').returnGeometry(!!geom);
    if(geom){ t.params.maxAllowableOffset = 0.0002; t.params.geometryPrecision = 5; }   // ~20 m: whole properties stay small
    t.run((err,fc,raw)=> res(err ? { err, results:[] } : { results:(raw && raw.results)||[] }));
  }), { results:[] });
}
const both = (a, b) => Promise.all([a, b]).then(([x, y]) => ({ err: x.err && y.err, results: x.results.concat(y.results) }));
const inWI = ll => ll.lat>42.4 && ll.lat<47.4 && ll.lng>-92.95 && ll.lng<-86.2;
const inMN = ll => ll.lat>43.4 && ll.lat<49.5 && ll.lng>-97.3 && ll.lng<-89.4;
/* ---------- MN DNR trails, forest roads and water accesses near the tap ----------
   Only the layers that are switched on are asked, within about 14 screen pixels (more for access dots). */
const REC_LAYERS = { mntrails:['mnStateTrails', 'mnHunterTrails', 'wiStateTrails', 'wiIceAge', 'wiNct'], mnmotor:['mnOhv', 'mnSnowmobile', 'wiRoadsAtvSnow', 'wiRoadsAtv', 'wiRoadsSnow'],
  mnroads:['mnForestRoads', 'wiRoadsCar'], mnaccess:['mnAccess', 'wiBoat'], trout:['mnTroutStreams', 'mnTroutLakes', 'wiTroutStreams', 'wiTroutLakes'] };
const REC_MINZ = { trout:8 };
const REC_FIELDS = {
  mnStateTrails:['trail_name','alt_name','use_hike','use_hiking','use_horse','use_bike','use_mntbik','use_inline','use_wntrhi','use_snosho','use_atvcl1','use_atvcl2','use_ohm','use_orv','use_wcftm','use_wcftnm','surfacetyp','width'],
  mnHunterTrails:['trail_name','unit_name','area_name','lmiles','phone','comments'],
  mnOhv:['trail_name','segment_name','surface_type','trail_width','atv_class_1','atv_class_2','off_highway_motorcycle','off_road_vehicle','road_class','miles','web_site'],
  mnSnowmobile:['trail_name','trail_num','owner_type','maint_by','public_poc','public_pho','pocwebsite','miles'],
  mnForestRoads:['road_name','road_num','road_class','forest_area','miles'],
  mnAccess:['access_name','lake_name','launch_type','ramp_surface','number_of_ramps','number_of_docks','trailer_parking_spaces_non_ada','car_parking_spaces_non_ada','number_of_toilets','administrator','directions','alerts','unique_swas_id'],
  wiStateTrails:['TRAIL_NAME','TRAIL_SEGMENT_NAME','SURFACE_TYPE','TRAIL_MANAGER','FEE','STATUS','HIKE_WALK','BIKE_TOUR','BIKE_OFFROAD','HORSE','INLINE_SKATE','SNOWSHOE',
    'XC_SKI_GROOMED_CLASSIC','XC_SKI_GROOMED_SKATE','XC_SKI_UNGROOMED','SNOWMOBILE','ATV_SUMMER','ATV_WINTER','UTV_SUMMER','UTV_WINTER','OHM'],
  wiIceAge:['OBJECTID'], wiNct:['OBJECTID'],
  wiRoadsCar:['LOCAL_NAME','ROAD_PUBLIC_USE','DATE_OPEN_FROM','DATE_OPEN_TO','NR44_ROAD_TYPE','MATERIAL_TYPE_NAME','ROAD_MAINTPROG_DESC_TEXT'],
  wiRoadsAtvSnow:['*'], wiRoadsAtv:['*'], wiRoadsSnow:['*'],
  mnTroutStreams:['kittle_name','kittle_nbr','label'], mnTroutLakes:['pw_basin_name','acres','cty_name','fsh_office','dowlknum'],
  wiTroutStreams:['STREAM','SEASON_TXT','EARLY_SEASON_TXT','BAG_LMT','REGCAT','GEAR_RESTRICTIONS','SPECIALREG1'],
  wiTroutLakes:['WATERBODY_','SEASON_TXT','EARLY_SEASON_TXT','BAG_LMT','REGCAT','GEAR_RESTR'],
  wiBoat:['LMS_BOAT_LANDING_NAME','WATERBODY_NAME_TEXT','LANDING_TYPE_CODE','RAMP_TYPE_CODE','ADA_ACCESSIBLE_FEATURE_CODE','OWNERSHIP_NAME_TEXT','OWNERSHIP_MANAGER_NAME_TEXT','OWNERSHIP_MANAGER_PHONE_TEXT','COUNTY_NAME_TEXT']
};
const REC_STATE = k => k.slice(0, 2);   // 'mn…' or 'wi…'
const mmdd = v => { const m = /^(\d\d)(\d\d)$/.exec(String(v || '')); return m ? new Date(2000, +m[1] - 1, +m[2]).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : null; };
function recLookup(ll){
  const mpp = 156543.03 * Math.cos(ll.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
  const states = (inMN(ll) ? ['mn'] : []).concat(inWI(ll) ? ['wi'] : []);
  const keys = Object.entries(REC_LAYERS).filter(([k]) => on[k] && map.getZoom() >= (REC_MINZ[k] || 10)).flatMap(([, v]) => v).filter(k => states.includes(REC_STATE(k)));
  if(!keys.length) return null;
  return Promise.all(keys.map(key => query(SRC[key], ll, REC_FIELDS[key], { where:LF.REC_WHERE[key],
      nearby:Math.min(400, Math.max(12, mpp * (/Access|Boat/.test(key) ? 22 : 14))) })
    .then(q => ({ err:q.err, results:q.features.slice(0, 3).map(f => ({ key, p:f.properties })) }))))
    .then(all => ({ err:all.every(a => a.err), results:[].concat(...all.map(a => a.results)) }));
}
const yes = v => v === 1 || v === '1' || /^(x|y|yes)$/i.test(String(v || '').trim());
function recBlock(x){
  const p = x.p, R = Object.assign({}, LF.REC[x.key], x.label ? { label:x.label } : {}), sw = `<span class="recsw" style="border-color:${R.color}${R.dash ? ';border-style:dashed' : ''}"></span>`;
  let name = '', rowsOut = [], uses = [], link = '';
  if(x.key === 'mnStateTrails'){
    name = p.trail_name; rowsOut = [['Also called', p.alt_name], ['Surface', p.surfacetyp], ['Width', p.width]];
    uses = [['Hiking', p.use_hike || p.use_hiking], ['Biking', p.use_bike], ['Mountain bike', p.use_mntbik], ['Horses', p.use_horse], ['Skating', p.use_inline],
      ['Ski', p.use_wntrhi], ['Snowshoe', p.use_snosho], ['Snowmobile', p.use_wcftm || p.use_wcftnm], ['ATV', p.use_atvcl1 || p.use_atvcl2], ['Off-road motorcycle', p.use_ohm], ['Off-road vehicle', p.use_orv]];
  } else if(x.key === 'mnHunterTrails'){
    name = p.trail_name; rowsOut = [['In', p.area_name || p.unit_name], ['Length', p.lmiles ? (+p.lmiles).toFixed(1) + ' mi' : null], ['Phone', p.phone], ['Notes', p.comments]];
    link = '<a href="https://www.dnr.state.mn.us/hunting/hwt/index.html" target="_blank" rel="noopener">Hunter walking trails (DNR)</a>';
  } else if(x.key === 'mnOhv'){
    name = p.trail_name; rowsOut = [['Segment', p.segment_name], ['Surface', p.surface_type], ['Width', p.trail_width], ['Road class', p.road_class]];
    uses = [['ATV class 1', p.atv_class_1], ['ATV class 2 (side-by-side)', p.atv_class_2], ['Off-highway motorcycle', p.off_highway_motorcycle], ['Off-road vehicle', p.off_road_vehicle]];
    if(/^https?:/i.test(p.web_site || '')) link = `<a href="${esc(p.web_site)}" target="_blank" rel="noopener">Trail page (DNR)</a>`;
  } else if(x.key === 'mnSnowmobile'){
    name = p.trail_name + (p.trail_num ? ' (#' + p.trail_num + ')' : ''); rowsOut = [['Maintained by', p.maint_by], ['Contact', [p.public_poc, p.public_pho].filter(Boolean).join(', ')]];
    link = /^https?:/i.test(p.pocwebsite || '') ? `<a href="${esc(p.pocwebsite)}" target="_blank" rel="noopener">Club website</a>`
      : '<a href="https://www.dnr.state.mn.us/snowmobiling/index.html" target="_blank" rel="noopener">Snowmobiling (DNR): trail conditions</a>';
  } else if(x.key === 'mnForestRoads'){
    const min = /minimum/i.test(p.road_class || '');
    const numOnly = !p.road_name || p.road_name === p.road_num;
    name = numOnly ? 'Forest Road ' + (p.road_num || '') : p.road_name;
    rowsOut = [['Road number', numOnly ? null : p.road_num], ['Class', p.road_class], ['State forest area', p.forest_area]];
    link = `<span class="small">${min ? 'Minimum maintenance: not maintained for regular cars; may be rough, wet or closed seasonally.' : 'Maintained state forest road.'} ATV rules depend on the forest's classification.</span>`;
  } else if(x.key === 'wiStateTrails'){
    name = p.TRAIL_NAME; rowsOut = [['Segment', p.TRAIL_SEGMENT_NAME], ['Surface', p.SURFACE_TYPE], ['Managed by', p.TRAIL_MANAGER],
      ['Trail pass', yes(p.FEE) ? 'Required (state trail pass)' : null], ['Status', /open/i.test(p.STATUS || '') ? null : p.STATUS]];
    uses = [['Hiking', p.HIKE_WALK], ['Biking', p.BIKE_TOUR], ['Mountain bike', p.BIKE_OFFROAD], ['Horses', p.HORSE], ['Skating', p.INLINE_SKATE], ['Snowshoe', p.SNOWSHOE],
      ['Ski (classic)', p.XC_SKI_GROOMED_CLASSIC], ['Ski (skate)', p.XC_SKI_GROOMED_SKATE], ['Ski (ungroomed)', p.XC_SKI_UNGROOMED], ['Snowmobile', p.SNOWMOBILE],
      ['ATV (summer)', p.ATV_SUMMER], ['ATV (winter)', p.ATV_WINTER], ['UTV (summer)', p.UTV_SUMMER], ['UTV (winter)', p.UTV_WINTER], ['Off-road motorcycle', p.OHM]];
    link = '<a href="https://dnr.wisconsin.gov/topic/parks/trails" target="_blank" rel="noopener">State trails (WI DNR)</a>';
  } else if(x.key === 'wiIceAge' || x.key === 'wiNct'){
    name = R.label;
    link = x.key === 'wiIceAge' ? '<a href="https://www.iceagetrail.org/" target="_blank" rel="noopener">Ice Age Trail Alliance</a>'
      : '<a href="https://northcountrytrail.org/" target="_blank" rel="noopener">North Country Trail Association</a>';
  } else if(/^wiRoads/.test(x.key)){
    name = p.LOCAL_NAME ? titleCase(p.LOCAL_NAME) + ' road' : R.label;
    const open = mmdd(p.DATE_OPEN_FROM) && mmdd(p.DATE_OPEN_TO) ? mmdd(p.DATE_OPEN_FROM) + ' to ' + mmdd(p.DATE_OPEN_TO) : null;
    rowsOut = [['Open', p.ROAD_PUBLIC_USE ? p.ROAD_PUBLIC_USE + (open ? ', ' + open : '') : open], ['Road type', p.NR44_ROAD_TYPE], ['Surface', p.MATERIAL_TYPE_NAME],
      ['Managed by', String(p.ROAD_MAINTPROG_DESC_TEXT || '').replace(/^\w+ = /, '') || null]];
    link = '<span class="small">Seasonal dates and closures can change; check signs at the gate.</span>';
  } else if(x.key === 'wiBoat'){
    name = p.LMS_BOAT_LANDING_NAME || 'Boat landing';
    rowsOut = [['Water', p.WATERBODY_NAME_TEXT], ['Launch', /ramp/i.test(p.LANDING_TYPE_CODE || '') ? 'Ramp' : titleCase(p.LANDING_TYPE_CODE)], ['Ramp', /other|unknown/i.test(p.RAMP_TYPE_CODE || '') ? null : p.RAMP_TYPE_CODE],
      ['Accessible (ADA)', p.ADA_ACCESSIBLE_FEATURE_CODE === 'Yes' ? 'Yes' : null], ['Run by', p.OWNERSHIP_MANAGER_NAME_TEXT || titleCase(p.OWNERSHIP_NAME_TEXT)], ['Phone', p.OWNERSHIP_MANAGER_PHONE_TEXT], ['County', p.COUNTY_NAME_TEXT]];
    link = '<a href="https://dnr.wisconsin.gov/topic/Boat" target="_blank" rel="noopener">Boating (WI DNR)</a>';
  } else if(x.key === 'mnTroutStreams'){
    name = p.kittle_name || 'Trout stream';
    rowsOut = [['Stream ID', p.kittle_nbr]];
    link = '<a href="https://www.dnr.state.mn.us/fishing/trout/index.html" target="_blank" rel="noopener">Trout fishing (MN DNR)</a> · ' +
      '<a href="https://www.dnr.state.mn.us/regulations/fishing/index.html" target="_blank" rel="noopener">Regulations</a>';
  } else if(x.key === 'mnTroutLakes'){
    name = (p.pw_basin_name || 'Trout') + ' Lake';
    rowsOut = [['Size', p.acres ? Math.round(p.acres) + ' acres' : null], ['County', p.cty_name], ['Fisheries office', p.fsh_office]];
    link = '<a href="https://www.dnr.state.mn.us/fishing/trout/index.html" target="_blank" rel="noopener">Trout fishing (MN DNR)</a> · ' +
      `<a href="https://www.dnr.state.mn.us/lakefind/lake.html?id=${encodeURIComponent(p.dowlknum || '')}" target="_blank" rel="noopener">LakeFinder</a>`;
  } else if(x.key === 'wiTroutStreams' || x.key === 'wiTroutLakes'){
    const na = v => v && !/^n\/?a$/i.test(String(v).trim()) ? v : null;
    name = (x.key === 'wiTroutStreams' ? p.STREAM : p.WATERBODY_) || R.label;
    rowsOut = [['Season', p.SEASON_TXT], ['Early season', na(p.EARLY_SEASON_TXT)], ['Bag limit', p.BAG_LMT || p.REGCAT],
      ['Gear', na(p.GEAR_RESTRICTIONS || p.GEAR_RESTR)], ['Special', na(p.SPECIALREG1)]];
    link = '<a href="https://dnr.wisconsin.gov/topic/Fishing/trout" target="_blank" rel="noopener">Trout fishing &amp; regulations (WI DNR)</a>';
  } else if(x.key === 'mnAccess'){
    name = p.access_name || 'Water access'; rowsOut = [['Water', p.lake_name], ['Launch', p.launch_type], ['Ramp', /unknown/i.test(p.ramp_surface || '') ? null : [p.number_of_ramps > 0 ? p.number_of_ramps + '×' : '', p.ramp_surface].filter(Boolean).join(' ')],
      ['Docks', p.number_of_docks], ['Trailer parking', p.trailer_parking_spaces_non_ada], ['Car parking', p.car_parking_spaces_non_ada], ['Toilets', p.number_of_toilets],
      ['Run by', p.administrator], ['Directions', p.directions], ['Alert', p.alerts]];
    link = '<a href="https://www.dnr.state.mn.us/water_access/index.html" target="_blank" rel="noopener">Water access (DNR)</a>';
  }
  const useHtml = uses.length && uses.some(u => yes(u[1])) ? '<div class="uses">' + uses.filter(u => yes(u[1])).map(u => `<span class="use y">${esc(u[0])}</span>`).join('') + '</div>' : '';
  return `<div style="margin:8px 0"><div class="small">${sw}${esc(R.label)}</div><div style="font-weight:600">${esc(name || R.label)}</div>${useHtml}${rows(rowsOut)}` +
    (link ? `<div style="margin-top:4px">${link}</div>` : '') + '</div>';
}

/* Shared with offline.js, which saves the same records for an area. */
LF.lookup = { WI_FIELDS, MN_FIELDS, MFL_FIELDS, mflResults, WI_BOX:[[42.4,-92.95],[47.4,-86.2]], MN_BOX:[[43.4,-97.3],[49.5,-89.4]] };

const WI_CLASS = { '1':'Residential','2':'Commercial','3':'Manufacturing','4':'Agricultural','5':'Undeveloped','5M':'Agricultural forest',
  '6':'Productive forest','7':'Other','X1':'Exempt: federal','X2':'Exempt: state','X3':'Exempt: county','X4':'Exempt: other' };
function wiClass(v){ if(!has(v)) return null;
  return String(v).split(/[,;]/).map(s=>s.trim()).filter(Boolean).map(c=> WI_CLASS[c] ? `${WI_CLASS[c]} (${c})` : /^W/.test(c) ? `Managed Forest / Forest Crop Law (${c})` : c).join(', '); }

/* ---------- Results sheet ---------- */
const sheet = document.getElementById('sheet'), head = document.getElementById('sheetHead'), body = document.getElementById('sheetBody');
let sheetHandler = null, sheetOnClose = null;
function closeSheet(){
  sheet.hidden = true; tuck(false); hi.clearLayers(); pin.remove(); LF.select.clear(); clickSeq++;
  const f = sheetOnClose; sheetHandler = sheetOnClose = null; if(f) f();
  LF.pinLL = null; LF.emit('pin');
}
document.getElementById('closeSheet').addEventListener('click', closeSheet);

/* Phones: drag the panel down by its grab bar or title to tuck it out of the way (it stays open, title showing);
   drag it up or tap the strip to bring it back. Opening something new shows the full panel again. */
const grab = document.getElementById('sheetGrab');
function tuck(on){
  sheet.classList.toggle('tucked', on); grab.setAttribute('aria-expanded', String(!on));
  grab.setAttribute('aria-label', on ? 'Show the whole panel' : 'Tuck the panel down');
  if(!on) sheet.scrollTop = 0;
}
LF.tuckSheet = tuck;
(function(){
  let y0 = null, dy = 0, moved = false, onGrab = false;
  const startOK = e => window.innerWidth < 820 && (e.target.closest('#sheetGrab') || (e.target.closest('header') && !e.target.closest('button,a,input')));
  sheet.addEventListener('pointerdown', e => {
    if(!startOK(e) || (!sheet.classList.contains('tucked') && sheet.scrollTop > 0 && !e.target.closest('#sheetGrab'))) return;
    y0 = e.clientY; dy = 0; moved = false; onGrab = !!e.target.closest('#sheetGrab'); sheet.classList.add('dragging');
    try{ sheet.setPointerCapture(e.pointerId); }catch(err){}
  });
  sheet.addEventListener('pointermove', e => {
    if(y0 == null) return;
    dy = e.clientY - y0; if(Math.abs(dy) > 6) moved = true;
    const tucked = sheet.classList.contains('tucked');
    sheet.style.transform = `translateY(${tucked ? Math.min(0, dy) * .3 : Math.max(0, dy)}px)`;
  });
  const end = e => {
    if(y0 == null) return;
    const tucked = sheet.classList.contains('tucked');
    sheet.classList.remove('dragging'); sheet.style.transform = ''; y0 = null;
    if(!moved){ if(tucked) tuck(false); else if(onGrab) tuck(true); return; }
    if(!tucked && dy > 50) tuck(true);
    else if(tucked && dy < -20) tuck(false);
  };
  sheet.addEventListener('pointerup', end);
  grab.addEventListener('click', e => e.preventDefault()); sheet.addEventListener('pointercancel', () => { y0 = null; sheet.classList.remove('dragging'); sheet.style.transform = ''; });
  grab.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); tuck(!sheet.classList.contains('tucked')); } });
})();
LF.closeSheet = closeSheet;
/* Buttons in the sheet carry data-act="…"; whoever filled the sheet handles them. */
body.addEventListener('click', e => { const el = e.target.closest('[data-act]');
  if(el && el.matches('input[type=checkbox], input[type=radio]')) return;   // switches and options act on 'change', once
  if(el && sheetHandler) sheetHandler(el.dataset.act, el, e); });
body.addEventListener('change', e => { const el = e.target.closest('[data-act]');
  if(el && el.dataset.act === 'shade'){ LF.shading.set(el.checked); return; }   // the same switch in every panel
  if(el && sheetHandler && el.matches('input,select')) sheetHandler(el.dataset.act, el, e); });
/* Other features (saved items, lists) show their own content in the same sheet.
   opts.pin: the spot the Share button should send (or none). */
LF.showSheet = function(headHTML, bodyHTML, opts){
  opts = opts || {};
  const prev = sheetOnClose; sheetOnClose = null; if(prev) prev();
  clickSeq++; hi.clearLayers(); pin.remove(); LF.select.clear();
  // opts.back {label, go}: a "‹ Back" link above the title, to the panel this one was opened from.
  tuck(false);
  head.innerHTML = (opts.back ? `<button class="backbtn" id="sheetBack">‹ ${esc(opts.back.label || 'Back')}</button>` : '') + headHTML; body.innerHTML = bodyHTML;
  if(opts.back) document.getElementById('sheetBack').addEventListener('click', () => opts.back.go());
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
async function inspect(ll, opts){
  const seq = ++clickSeq;
  const prev = sheetOnClose; sheetOnClose = null; if(prev) prev();
  sheetHandler = null;
  hi.clearLayers(); LF.select.clear(); LF.select.point([ll.lat, ll.lng]);
  LF.pinLL = ll; LF.emit('pin');
  document.getElementById('shareBtn').hidden = false;
  sheet.hidden = false; tuck(false);
  head.innerHTML = `<h2>Looking up…</h2><div class="small mono">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div>`;
  body.innerHTML = '<div class="loading">Checking parcel and public land records</div>';
  if(!(opts && opts.live) && await inspectSaved(ll, seq)) return;
  if(seq !== clickSeq) return;

  const jobs = {
    wi: inWI(ll) ? query(SRC.wiParcels, ll, WI_FIELDS) : null,
    mn: inMN(ll) ? query(SRC.mnParcels, ll, MN_FIELDS) : null,
    mncov: inMN(ll) ? query(SRC.mnCoverage, ll, ['countyname','gac_open_approval','viewer_url','data_url']) : null,
    padus: query(SRC.padus, ll, ['OBJECTID','Mang_Type','Mang_Name','Des_Tp','Unit_Nm','Pub_Access','SUM_GIS_Acres'], { geometry:false }),
    widnr: inWI(ll) ? identify(SRC.wiDnr, ll, 'visible', true) : null,
    wiclosed: inWI(ll) ? identify(SRC.wiClosed, ll) : null,
    wimfl: inWI(ll) && on.wimfl ? query(SRC.wiMfl, ll, MFL_FIELDS, { nearby:300, where:'AC_OP_PLS > 0' }).then(mflResults) : null,
    mndnr: inMN(ll) ? both(identify(SRC.mnDnr, ll, 'visible:' + LF.MN_DNR_LAYER, true), identify(SRC.mnWia, ll, 'visible', true)) : null,
    rec: inMN(ll) || inWI(ll) ? recLookup(ll) : null
  };
  const r = {}; await Promise.all(Object.entries(jobs).map(async([k,p])=>{ r[k] = p ? await p : null; }));
  if(seq !== clickSeq) return;
  render(ll, r);
}
/* Inside a saved offline area the saved copy answers at once, signal or not. */
async function inspectSaved(ll, seq){
  const got = LF.offline ? await LF.offline.lookup(ll) : null;
  if(!got || seq !== clickSeq) return false;
  render(ll, got.r, got.area);
  return true;
}

/* ---------- Public land: the whole unit the tap falls in ---------- */
const MANAGERS = { SDNR:'State DNR', SFW:'State fish & wildlife agency', SPR:'State parks', SLB:'State land board (BCPL)', SDOF:'State forestry',
  OTHS:'Other state agency', USFS:'US Forest Service', FWS:'US Fish & Wildlife Service', NPS:'National Park Service', BLM:'Bureau of Land Management',
  USACE:'US Army Corps of Engineers', BOR:'Bureau of Reclamation', DOD:'Dept. of Defense', OTHF:'Other federal agency',
  CNTY:'County', CITY:'City', RWD:'Regional water district', REG:'Regional agency', OTHR:'Other', UNK:'Unknown' };
const DESIG = { NF:'National Forest', NWR:'National Wildlife Refuge', NP:'National Park', NRA:'National Recreation Area', WA:'Wilderness Area',
  SCA:'State conservation area', SP:'State park', SREC:'State recreation area', SW:'State wilderness', SHCA:'State historic area',
  SOTH:'Other state land', LCA:'Local conservation area', LP:'Local park', LREC:'Local recreation area', LOTH:'Other local land',
  FOTH:'Other federal land', REC:'Recreation management area', ACEC:'Area of critical environmental concern', CONE:'Conservation easement',
  MIT:'Mitigation land', PROC:'Proclamation boundary', SDA:'Special designation area', RNA:'Research natural area', WSA:'Wilderness study area' };
const PUBLIC_MANG = /^(FED|STAT|LOC|DIST|JNT)$/;
const titleCase = s => String(s).toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Wma|Sna|Ama|Dnr|Us|Wia)\b/g, w => w.toUpperCase());
const toGeo = g => { try{ return !g ? null : g.type ? g : L.esri.Util.arcgisToGeoJSON(g); }catch(e){ return null; } };

/* State DNR boundaries are whole properties; PAD-US is the fallback (national
   and county forests, federal refuges, local parks). */
function publicUnit(r, pad){
  const wi = r.widnr && r.widnr.results.find(x => /DNR (Owned|Easement)|Leased Land/i.test(x.layerName) && x.geometry);
  if(wi){ const a = wi.attributes;
    return { src:wi, name:has(a.LOCAL_NAME_LABEL) ? a.LOCAL_NAME_LABEL : titleCase(a.PROP_NAME), acres:+a.ACRES, geo:toGeo(wi.geometry),
      manager:'Wisconsin DNR', kind:wi.layerName.replace(/\s*\(property\)/i, ''), access:a.PUBLIC_ACCESS, uses:a.EASE_USE_CODE, link:a.RE_INFO_URL }; }
  const mn = r.mndnr && r.mndnr.results.find(x => x.layerName === 'Dnr Management Units' && x.geometry);
  if(mn){ const a = mn.attributes;
    return { src:mn, name:a.UNIT_NAME, acres:+a.GIS_ACRES, geo:toGeo(mn.geometry), manager:'Minnesota DNR' + (has(a.ADMINISTRATOR) ? ' · ' + a.ADMINISTRATOR : ''),
      kind:a.UNIT_TYPE, access:a.ACCESS_WO_TRESPASS }; }
  const wia = r.mndnr && r.mndnr.results.find(x => /Walk In/i.test(x.layerName) && x.geometry);
  if(wia){ const a = wia.attributes;
    return { src:wia, name:a.map_title, acres:+a.acres, geo:toGeo(wia.geometry), manager:'Minnesota DNR Walk-In Access (private land)',
      kind:'Walk-In Access', access:'Walk-in hunting by permit; see MN DNR rules. Uses: ' + (a.uses || '').trim() }; }
  const p = pad.find(f => PUBLIC_MANG.test(f.properties.Mang_Type));
  if(p){ const a = p.properties, g = p.geometry ? p : null;   // saved areas keep the shape
    return { pad:p, name:a.Unit_Nm || MANAGERS[a.Mang_Name] || 'Public land', geo:g, acres:g ? LF.geo.geojsonArea(g) / LF.geo.M2_PER_AC : null,
      padId:g ? null : a.OBJECTID, padAcres:+a.SUM_GIS_Acres,
      manager:MANAGERS[a.Mang_Name] || a.Mang_Name, kind:DESIG[a.Des_Tp] || a.Des_Tp, accessCode:a.Pub_Access }; }
  return null;
}
/* PAD-US shapes can be huge (a national forest is 400 KB even simplified):
   fetch only the one unit, coarser the bigger it is. */
function padGeometry(id, acresHint){
  const off = acresHint > 500000 ? 0.003 : acresHint > 50000 ? 0.001 : 0.0002;
  return timed(new Promise(res => {
    const q = L.esri.query({ url:SRC.padus }).featureIds([id]).returnGeometry(true).fields(['OBJECTID']);
    q.params.maxAllowableOffset = off; q.params.geometryPrecision = 5;
    q.run((err, fc) => res(err || !fc || !fc.features[0] ? { err:err || true } : { geo:fc.features[0] }));
  }), {});
}
function unitBlock(u){
  const a = u.accessCode ? ACCESS[u.accessCode] || ACCESS.UK : null;
  let uses = '';
  if(u.uses && /^[12]{4}$/.test(String(u.uses))) uses = '<div class="uses">' + ['Hiking','Fishing','Hunting','Trapping'].map((n,i) =>
    `<span class="use ${String(u.uses)[i]==='1'?'y':'n'}">${n}</span>`).join('') + '</div>';
  return '<div class="block unit"><h3>Public land</h3>' + (a ? `<span class="tag ${a[0]}">${esc(a[1])}</span>` : '') + uses + rows([
      ['Name', u.name], ['Type', u.kind], ['Managed by', u.manager],
      ['Total area', u.acres ? acres(u.acres) : (u.padId ? 'measuring…' : null)], ['Access', u.access]
    ]).replace('<dd>measuring…</dd>', '<dd id="unitAcres">measuring…</dd>') +
    '<div class="btnrow acts"><button class="btn" data-act="unit-zoom">Zoom to whole area</button>' +
    (u.link ? `<a class="btn" href="${esc(u.link)}" target="_blank" rel="noopener">Property page</a>` : '') + '</div></div>';
}
// The unit's own layer is kept (invisible) for its bounds; LF.select draws the visible outline.
const unitStyle = () => ({ opacity:0, fillOpacity:0 });

function render(ll, r, savedArea){
  const mySeq = clickSeq;
  const parcel = (r.wi && r.wi.features[0] && { st:'WI', f:r.wi.features[0] }) || (r.mn && r.mn.features[0] && { st:'MN', f:r.mn.features[0] });
  const pad = (r.padus && r.padus.features || []).filter(f=>f.properties.Pub_Access!=='UK').concat((r.padus && r.padus.features || []).filter(f=>f.properties.Pub_Access==='UK'));
  const access = pad[0] && ACCESS[pad[0].properties.Pub_Access];
  let html = '', title = 'No record here', tags = '';

  const unit = publicUnit(r, pad);
  let unitLayer = null;
  const showUnit = g => { if(!g || mySeq !== clickSeq) return; unitLayer = L.geoJSON(g, { pane:'hiPane', interactive:false, style:unitStyle() }); hi.addLayer(unitLayer);
    LF.select.shape(g, { color:css('--open'), weight:3, fill:.14 }); };
  if(unit){
    html += unitBlock(unit);
    if(unit.geo) showUnit(unit.geo);
    else if(unit.padId) padGeometry(unit.padId, unit.padAcres).then(res => {
      if(mySeq !== clickSeq) return;
      showUnit(res.geo);
      const cell = document.getElementById('unitAcres');
      if(cell) cell.textContent = res.geo ? acres(LF.geo.geojsonArea(res.geo) / LF.geo.M2_PER_AC) : '—';
    });
  }

  if(parcel){
    LF.select.shape(parcel.f, { color:css('--blaze'), weight:unit ? 2.5 : 4, fill:unit ? 0 : .12 });
    const p = parcel.f.properties;
    if(parcel.st==='WI'){
      title = has(p.OWNERNME1) ? p.OWNERNME1 : 'Owner not listed';
      html += `<div class="block"><h3>${unit ? 'Parcel at this spot' : 'Parcel'} · Wisconsin</h3>` + rows([
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
      html += `<div class="block"><h3>${unit ? 'Parcel at this spot' : 'Parcel'} · Minnesota</h3>` + rows([
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

  const otherPad = pad.filter(f => f !== (unit && unit.pad) && !(unit && f.properties.Unit_Nm && f.properties.Unit_Nm === unit.name));
  if(otherPad.length){
    html += `<div class="block"><h3>${unit ? 'Also here' : 'Public land'} · PAD-US</h3>` + otherPad.slice(0,3).map(f=>{ const q=f.properties, a=ACCESS[q.Pub_Access]||ACCESS.UK;
      return `<div style="margin:6px 0"><span class="tag ${a[0]}">${esc(a[1])}</span>` + rows([
        ['Unit', q.Unit_Nm], ['Manager', MANAGERS[q.Mang_Name] || q.Mang_Name], ['Designation', DESIG[q.Des_Tp] || q.Des_Tp]]) + '</div>';
    }).join('') + '</div>';
  }

  const dnr = []
    .concat(r.widnr ? r.widnr.results.filter(x => !(unit && x === unit.src)).map(x=>['WI DNR land',x]) : [])
    .concat(r.wiclosed ? r.wiclosed.results.map(x=>['WI closed / restricted',x]) : [])
    .concat(r.wimfl ? r.wimfl.results.map(x=>['WI MFL/FCL open forest',x]) : [])
    .concat(r.mndnr ? r.mndnr.results.filter(x => !(unit && x === unit.src)).map(x=>['MN public land',x]) : []);
  /* The same property often comes back from several layers of one service. */
  const seen = new Set(), uniq = dnr.filter(([label,x]) => {
    const key = label + JSON.stringify(Object.entries(x.attributes || {}).filter(([k]) => !SKIP.test(k.replace(/\s/g,'_'))));
    if(seen.has(key)) return false; seen.add(key); return true; });
  let recHtml = '';   // shown first: a tap on a trail or access dot is about that
  if(r.rec && r.rec.results.length){
    // Access sites first (a tap on a dot), then trails and roads; one entry per name.
    // WI DNR lists a road once per kind of vehicle allowed on it: merge those into one entry naming them all.
    const motor = new Map(), merged = [];
    r.rec.results.forEach(x => {
      if(!/^wiRoads(AtvSnow|Atv|Snow)$/.test(x.key)){ merged.push(x); return; }
      const id = x.p.ROAD_SEQ_NO || x.p.LOCAL_NAME || Math.random();
      if(!motor.has(id)){ const m = { key:'wiRoadsAtvSnow', p:Object.assign({}, x.p), allow:new Set() }; motor.set(id, m); merged.push(m); }
      const a = motor.get(id).allow;
      if(x.key !== 'wiRoadsSnow'){ a.add('ATVs'); }
      if(x.key === 'wiRoadsAtvSnow'){ a.add('UTVs'); }
      if(x.key !== 'wiRoadsAtv'){ a.add('snowmobiles'); }
    });
    merged.forEach(m => { if(m.allow){ const l = ['ATVs', 'UTVs', 'snowmobiles'].filter(v => m.allow.has(v)); m.label = 'DNR road open to ' + (l.length > 1 ? l.slice(0, -1).join(', ') + ' & ' + l[l.length - 1] : l[0]); } });
    const seenRec = new Set(), recs = merged.sort((a, b) => /Access|Boat/.test(b.key) - /Access|Boat/.test(a.key))
      .filter(x => { const k = x.key + (x.p.trail_name || x.p.road_name || x.p.road_num || x.p.access_name || x.p.unique_swas_id || x.p.TRAIL_NAME || x.p.LOCAL_NAME || x.p.LMS_BOAT_LANDING_NAME || x.p.kittle_name || x.p.pw_basin_name || x.p.STREAM || x.p.WATERBODY_ || (/wiIceAge|wiNct/.test(x.key) ? '' : Math.random()));
        if(seenRec.has(k)) return false; seenRec.add(k); return true; });
    const allTrout = recs.every(x => /Trout/.test(x.key));
    recHtml = `<div class="block"><h3>${allTrout ? 'Trout water' : 'Trails, roads &amp; water access'}</h3>` + recs.slice(0, 5).map(recBlock).join('') + '</div>';
  }
  if(uniq.length){
    html += '<div class="block"><h3>State agency records</h3>' + uniq.slice(0,6).map(([label,x])=>dnrBlock(label,x)).join('') + '</div>';
  }
  const NAMES = { padus:'PAD-US public land', widnr:'WI DNR lands', wiclosed:'WI closed areas', wimfl:'WI MFL/FCL', mndnr:'MN DNR lands', mncov:'MN county coverage', rec:'Trails & accesses' };
  const failed = Object.keys(NAMES).filter(k => r[k] && r[k].err);
  if(failed.length) html += `<p class="note">Did not load: ${failed.map(k => NAMES[k]).join(', ')}. Tap again to retry.</p>`;

  if(unit){ title = unit.name; tags += '<span class="tag open">Public land</span>'; }
  else if(parcel) tags += '<span class="tag priv">Parcel</span>';
  if(access) tags += `<span class="tag ${access[0]}">${esc(access[1])}</span>`;
  if(!parcel && !unit && pad[0]) title = pad[0].properties.Unit_Nm || pad[0].properties.Mang_Name || 'Public land';
  head.innerHTML = `<h2>${esc(title)}</h2><div>${tags}</div><div class="small mono">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div>`;
  if(savedArea) html = `<p class="note saved-note">From your offline copy of “${esc(savedArea.name)}”, saved ${new Date(savedArea.updated || savedArea.created).toLocaleDateString('en-US')}.` +
    ' <button class="linkbtn" data-act="live">Check live data</button></p>' + html;
  html = LF.shadeSwitch() + recHtml + html;
  html = '<div class="btnrow acts"><button class="btn" data-act="save-wp">Save waypoint</button>' +
    '<button class="btn" data-act="measure">Measure from here</button><button class="btn" data-act="route">Directions</button></div>' + html;
  sheetHandler = act => {
    if(act === 'save-wp' && LF.account.require('waypoints')) LF.items.newWaypoint([ll.lat, ll.lng], { name: unit ? unit.name : '' });
    if(act === 'measure') LF.draw.start('line', [ll.lat, ll.lng]);
    if(act === 'live') inspect(ll, { live:true });
    if(act === 'route') LF.route.to(unit ? unit.name : parcel ? 'this parcel' : 'this spot', [ll.lat, ll.lng]);
    if(act === 'unit-zoom'){
      if(unitLayer) map.fitBounds(unitLayer.getBounds(), { padding:[30, 30] });
      else LF.flash('Still loading the boundary…', 2000);
    }
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
