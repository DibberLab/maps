/* Line Fence: the crew leaderboard (Score a round > Leaderboard, Menu). GET /api/leaderboard: every finished, complete
   round from approved accounts (a live round once). Three views: the crew (rounds, average and best vs par, aces, rounds
   this week), a course's best rounds, and the latest rounds. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const vs = d => d === 0 ? 'E' : (d > 0 ? '+' : '−') + Math.abs(d);
const when = t => new Date(t).toLocaleDateString('en-US', { month:'short', day:'numeric' });
let tab = 'crew', course = null;

async function board(){
  if(!LF.account.require('the leaderboard')) return;
  LF.showSheet('<h2>Leaderboard</h2><div class="small">Loading…</div>', '<div class="loading">Loading the crew\'s rounds</div>');
  let d;
  try{ d = await LF.api('GET', 'leaderboard'); }
  catch(e){ LF.showSheet('<h2>Leaderboard</h2>', `<p class="note">${esc(e.message)}</p>`); return; }
  render(d);
}
function render(d){
  const names = Object.keys(d.courses).sort();
  if(!course || !d.courses[course]) course = names[0] || null;
  const tabs = ['crew', 'teams', 'course', 'recent'].map(t => `<button class="btn small-btn${tab === t ? ' on' : ''}" data-act="tab" data-t="${t}">${({ crew:'Crew', teams:'Teams', course:'By course', recent:'Latest' })[t]}</button>`).join('');
  let body = '';
  if(!d.rounds) body = '<p class="note">No finished rounds yet. Score a round with the crew and finish it: it shows up here.</p>';
  else if(tab === 'crew'){
    body = '<div class="sgrid-wrap"><table class="sgrid board"><tr><th></th><th>Player</th><th>Rounds</th><th>Avg</th><th>Best</th><th>Aces</th><th>Week</th></tr>' +
      d.players.map((p, i) => `<tr><td>${i + 1}</td><td><b>${esc(p.player)}</b></td><td>${p.rounds}</td><td>${p.avg > 0 ? '+' : ''}${p.avg}</td>` +
        `<td title="${esc(p.best.course)}">${vs(p.best.diff)}</td><td>${p.aces || ''}</td><td>${p.week || ''}</td></tr>`).join('') +
      '</table></div><p class="small">Avg and Best are strokes vs par per round. Week: rounds in the last 7 days.</p>';
  } else if(tab === 'teams'){
    body = (d.teams || []).length ? '<div class="sgrid-wrap"><table class="sgrid board"><tr><th></th><th>Team</th><th>Rounds</th><th>Avg</th><th>Best</th></tr>' +
      d.teams.map((t, i) => `<tr><td>${i + 1}</td><td><b>${esc(t.team)}</b></td><td>${t.rounds}</td><td>${t.avg > 0 ? '+' : ''}${t.avg}</td><td title="${esc(t.best.course)}">${vs(t.best.diff)}</td></tr>`).join('') +
      '</table></div><p class="small">Pairings from team rounds, best average first. A team is who was on it, whatever the team was called.</p>'
      : '<p class="note">No team rounds yet. Start a round with Teams and finish it.</p>';
  } else if(tab === 'course'){
    body = `<label class="lbl">Course<select id="lb-course">${names.map(n => `<option${n === course ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` +
      '<div class="sgrid-wrap"><table class="sgrid board"><tr><th></th><th>Player</th><th>Score</th><th></th><th>Date</th></tr>' +
      (d.courses[course] || []).map((x, i) => `<tr><td>${i === 0 ? '🏆' : i + 1}</td><td><b>${esc(x.player)}</b></td><td>${x.strokes}</td><td>${vs(x.diff)}</td><td>${when(x.date)}</td></tr>`).join('') +
      '</table></div>';
  } else {
    body = '<div class="rows">' + d.recent.map(x => `<div class="row"><span><b>${esc(x.player)}</b> · ${x.strokes} (${vs(x.diff)})<span class="small">${esc(x.course)} · ${({ solo:'solo', singles:'singles', team:'team' })[x.kind] || ''} · ${when(x.date)}${x.aces ? ' · ace!' : ''}</span></span></div>`).join('') + '</div>';
  }
  LF.showSheet(`<h2>Leaderboard</h2><div class="small">${d.rounds} round${d.rounds === 1 ? '' : 's'} by the crew</div>`,
    `<div class="btnrow">${tabs}<button class="btn small-btn" data-act="mine">My stats</button></div>${body}`,
    { back:LF.rounds ? { label:'Rounds', go:LF.rounds.start } : null, onAct:(act, b) => { if(act === 'tab'){ tab = b.dataset.t; render(d); } if(act === 'mine' && LF.rounds) LF.rounds.myStats(); } });
  const sel = document.getElementById('lb-course'); if(sel) sel.addEventListener('change', () => { course = sel.value; render(d); });
}
LF.leaderboard = board;
})(window.LF);
