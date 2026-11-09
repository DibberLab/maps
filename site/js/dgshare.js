/* Line Fence: sharing out of the app (scorecards, courses) into a group chat or anywhere.
   LF.sendOut({ title, text, url, file }): the phone's share menu (Signal, Messages, …) with the picture when the phone
   can send files from a web page, else the text and link; on a computer, a pop-up with Copy and Save picture.
   LF.scorecard.share(r): a picture of the card (canvas, rows of 9, colours like the app) plus a one-line summary.
   LF.courseShare(c): the course's name, holes, par and weather now, with a link that opens it (#course=<name>). */
window.LF = window.LF || {};
(function(LF){
'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const vs = d => d === 0 ? 'E' : (d > 0 ? '+' : '−') + Math.abs(d);
const appName = () => (LF.APP && LF.APP.name) || 'Line Fence';

async function sendOut({ title, text, url, file }){
  const body = [text, url].filter(Boolean).join('\n');   // chat apps keep the text; some drop a separate url
  if(file && navigator.canShare && navigator.share){
    try{ if(navigator.canShare({ files:[file] })){ await navigator.share({ title, text:body, files:[file] }); return 'shared'; } }
    catch(e){ if(e && e.name === 'AbortError') return 'cancelled'; }
  }
  if(navigator.share){
    try{ await navigator.share({ title, text:body }); return 'shared'; }
    catch(e){ if(e && e.name === 'AbortError') return 'cancelled'; }
  }
  pop(title, body, file);
  return 'shown';
}
/* Where there's no share menu: the text to copy, and the picture to save. */
function pop(title, body, file){
  let el = document.getElementById('sendPop');
  if(!el){ el = document.createElement('div'); el.id = 'sendPop'; el.className = 'linkpop'; document.body.appendChild(el); }
  const imgUrl = file ? URL.createObjectURL(file) : null;
  el.innerHTML = `<div class="small">${esc(title)}</div>${imgUrl ? `<img class="sendimg" src="${imgUrl}" alt="">` : ''}<textarea readonly rows="4">${esc(body)}</textarea>
    <div class="btnrow"><button class="btn primary" data-p="copy">Copy text</button>${imgUrl ? '<button class="btn" data-p="save">Save picture</button>' : ''}<button class="btn" data-p="close">Done</button></div>`;
  el.hidden = false;
  el.onclick = async e => {
    const a = (e.target.closest('[data-p]') || {}).dataset; if(!a || !a.p) return;
    if(a.p === 'close'){ el.hidden = true; if(imgUrl) URL.revokeObjectURL(imgUrl); }
    if(a.p === 'copy'){ try{ await navigator.clipboard.writeText(body); LF.flash('Copied'); }catch(err){ el.querySelector('textarea').select(); } }
    if(a.p === 'save' && imgUrl){ const d = document.createElement('a'); d.href = imgUrl; d.download = file.name; document.body.appendChild(d); d.click(); d.remove(); }
  };
}

/* ---------- The scorecard as a picture ---------- */
const sideTotals = (r, id) => { let strokes = 0, par = 0, played = 0;
  (r.scores[id] || []).forEach((v, i) => { if(v != null){ strokes += v; par += r.holes[i].par; played++; } }); return { strokes, diff:strokes - par, played }; };
function cardBlob(r){
  const W = 1080, pad = 40, nameW = 230, rowH = 62, sides = r.sides.map(s => Object.assign({ s }, sideTotals(r, s.id)));
  const chunks = []; for(let i = 0; i < r.holes.length; i += 9) chunks.push([i, Math.min(i + 9, r.holes.length)]);
  const blockH = (2 + sides.length) * rowH + 30;
  const H = 230 + chunks.length * blockH + (chunks.length > 1 ? 80 + sides.length * 56 : 0) + 140;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), F = (w, s) => `${w} ${s}px "IBM Plex Sans", "Segoe UI", system-ui, sans-serif`;
  const dark = '#0b3d2e', gold = '#facc15', ink = '#1f2b24', line = '#d6dccf';
  x.fillStyle = '#f6f7f3'; x.fillRect(0, 0, W, H);
  x.fillStyle = dark; x.fillRect(0, 0, W, 190);
  x.fillStyle = gold; x.font = F('800', 30); x.fillText(appName().toUpperCase(), pad, 58);
  x.fillStyle = '#fff'; x.font = F('700', 46); x.fillText(r.name.length > 34 ? r.name.slice(0, 33) + '…' : r.name, pad, 118);
  x.fillStyle = '#d1fae5'; x.font = F('500', 28);
  const kind = r.format === 'solo' || r.sides.length === 1 ? 'Solo' : r.format === 'teams' ? 'Teams' : 'Singles';
  x.fillText(`${new Date(r.started).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' })} · ${kind} · ${r.holes.length} holes`, pad, 162);
  let y = 230;
  const colW = (W - pad * 2 - nameW - 110) / 9;
  const cellText = (t, cx, cy, w, opts) => { x.font = F(opts && opts.bold ? '700' : '500', opts && opts.size || 28); x.fillStyle = opts && opts.color || ink;
    x.textAlign = 'center'; x.fillText(String(t), cx + w / 2, cy + rowH / 2 + 10); x.textAlign = 'left'; };
  chunks.forEach(([a, b], k) => {
    const n = b - a, total = chunks.length === 1 ? 'Tot' : chunks.length === 2 ? (k ? 'In' : 'Out') : 'Sub';
    // header + par rows
    x.fillStyle = '#e9ece4'; x.fillRect(pad, y, W - pad * 2, rowH * 2);
    x.font = F('700', 26); x.fillStyle = '#5b665d'; x.fillText('Hole', pad + 14, y + rowH / 2 + 9); x.fillText('Par', pad + 14, y + rowH * 1.5 + 9);
    for(let i = 0; i < n; i++){ const cx = pad + nameW + i * colW;
      cellText(r.holes[a + i].n, cx, y, colW, { bold:true, color:'#5b665d', size:26 }); cellText(r.holes[a + i].par, cx, y + rowH, colW, { color:'#5b665d', size:26 }); }
    const tx = pad + nameW + 9 * colW;
    cellText(total, tx, y, 110, { bold:true, color:'#5b665d', size:26 }); cellText(r.holes.slice(a, b).reduce((s, h) => s + h.par, 0), tx, y + rowH, 110, { color:'#5b665d', size:26 });
    let ry = y + rowH * 2;
    sides.forEach(t => {
      x.strokeStyle = line; x.beginPath(); x.moveTo(pad, ry); x.lineTo(W - pad, ry); x.stroke();
      x.font = F('700', 28); x.fillStyle = ink; const nm = t.s.name.length > 12 ? t.s.name.slice(0, 11) + '…' : t.s.name; x.fillText(nm, pad + 14, ry + rowH / 2 + 10);
      let sub = 0;
      for(let i = 0; i < n; i++){ const v = r.scores[t.s.id][a + i], par = r.holes[a + i].par, cx = pad + nameW + i * colW; if(v == null) continue; sub += v;
        const fill = v === 1 ? gold : v < par ? 'rgba(15,118,110,.22)' : v > par ? 'rgba(180,83,9,.14)' : null;
        if(fill){ x.fillStyle = fill; x.beginPath(); x.arc(cx + colW / 2, ry + rowH / 2, 25, 0, Math.PI * 2); x.fill(); }
        cellText(v, cx, ry, colW, { bold:v < par, color:v > par ? '#b45309' : ink }); }
      cellText(sub || '', tx, ry, 110, { bold:true });
      ry += rowH;
    });
    y = ry + 30;
  });
  if(chunks.length > 1){
    x.font = F('700', 30); x.fillStyle = ink; x.fillText('Total', pad, y + 30); y += 56;
    sides.forEach(t => { x.font = F('600', 30); x.fillStyle = ink; x.fillText(t.s.name, pad + 14, y + 26);
      x.textAlign = 'right'; x.fillText(`${t.strokes}  (${t.played ? vs(t.diff) : '—'})`, W - pad - 14, y + 26); x.textAlign = 'left'; y += 56; });
  }
  // the result
  const done = sides.filter(t => t.played), best = done.length ? Math.min(...done.map(t => t.strokes)) : null, win = done.filter(t => t.strokes === best);
  x.fillStyle = dark; x.fillRect(0, H - 120, W, 120);
  x.font = F('800', 36); x.fillStyle = gold;
  const result = r.sides.length === 1 ? (done[0] ? `${done[0].strokes} (${vs(done[0].diff)})` : '') :
    win.length ? `🏆 ${win.map(t => t.s.name).join(' & ')} ${win.length > 1 ? 'tie' : 'wins'} with ${best}` : '';
  x.fillText(result, pad, H - 66);
  x.font = F('500', 24); x.fillStyle = '#d1fae5'; x.fillText(location.hostname, pad, H - 28);
  return new Promise(res => c.toBlob(b => res(b), 'image/png'));
}
async function shareCard(r){
  const sides = r.sides.map(s => Object.assign({ s }, sideTotals(r, s.id))).filter(t => t.played).sort((a, b) => a.strokes - b.strokes);
  const date = new Date(r.started).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const text = `🥏 ${r.name} · ${date}\n` + sides.map((t, i) => `${r.sides.length > 1 && i === 0 && (!sides[1] || sides[1].strokes > t.strokes) ? '🏆 ' : ''}${t.s.name} ${t.strokes} (${vs(t.diff)})${t.played < r.holes.length ? ` thru ${t.played}` : ''}`).join('\n');
  let file = null;
  try{ const blob = await cardBlob(r); if(blob) file = new File([blob], `${r.name.replace(/[^\w]+/g, '-').toLowerCase()}-${new Date(r.started).toISOString().slice(0, 10)}.png`, { type:'image/png' }); }catch(e){}
  const url = r.live ? await LF.shortLink(location.origin + location.pathname + '#round=' + r.live) : null;
  return sendOut({ title:`${r.name} scorecard`, text, url, file });
}

/* ---------- A course ---------- */
async function courseShare(c){
  const bits = [c.n ? c.n + ' holes' : '', c.par ? 'par ' + c.par : '', c.place || (c.info && c.info.address) || ''].filter(Boolean).join(' · ');
  let wx = '';
  try{ const w = LF.weather ? await Promise.race([LF.weather.get(c.c), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 2500))]) : null;
    if(w) wx = `\nNow: ${Math.round(w.current.temperature_2m)}°F, wind ${Math.round(w.current.wind_speed_10m)} mph from the ${LF.weather.from(w.current.wind_direction_10m)}`; }catch(e){}
  const link = location.origin + location.pathname + LF.share.build({ view:[c.c[0], c.c[1], 16], course:c.name });
  const url = await LF.shortLink(link);
  return sendOut({ title:c.name, text:`🥏 ${c.name}${bits ? '\n' + bits : ''}${wx}`, url });
}
/* A shared course link (#course=<name>&map=…) opens that course. */
async function openShared(l){
  if(!l || !l.course || !LF.discgolf) return;
  await LF.discgolf.load();
  const d = LF.discgolf.data(); if(!d) return;
  const at = l.view ? [l.view[0], l.view[1]] : null, name = l.course.toLowerCase();
  const hits = d.courses.filter(c => c.name.toLowerCase() === name).sort((a, b) => at ? LF.geo.dist(a.c, at) - LF.geo.dist(b.c, at) : 0);
  if(hits[0]) LF.discgolf.showCourse(hits[0]);
}
if(LF.fromLink && LF.fromLink.course) setTimeout(() => openShared(LF.fromLink), 500);
window.addEventListener('hashchange', () => { const l = LF.share.parse(location.hash); if(l.course) openShared(l); });

LF.sendOut = sendOut;
LF.scorecard = { share:shareCard, blob:cardBlob };
LF.courseShare = courseShare;
})(window.LF);
