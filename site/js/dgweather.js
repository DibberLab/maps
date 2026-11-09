/* Line Fence: weather and wind for disc golf (course panel and scorecard). Open-Meteo (api.open-meteo.com: free, no
   key, CORS): now + the next 6 hours, °F and mph, cached 10 minutes per spot (~1 km). LF.weather.block(ll) is the course
   panel's weather; LF.weather.vsHole(wx, bearing) puts the wind in a thrower's words: headwind, tailwind, or across
   (which way it pushes the disc). */
window.LF = window.LF || {};
(function(LF){
'use strict';
const cache = new Map();
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const from = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
// WMO weather codes, in a word or two.
const SKY = c => c === 0 ? 'Clear' : c <= 2 ? 'Partly cloudy' : c === 3 ? 'Cloudy' : c <= 48 ? 'Fog' : c <= 57 ? 'Drizzle' : c <= 67 ? 'Rain' :
  c <= 77 ? 'Snow' : c <= 82 ? 'Showers' : c <= 86 ? 'Snow showers' : 'Thunderstorms';

async function get(ll){
  const k = ll[0].toFixed(2) + ',' + ll[1].toFixed(2), hit = cache.get(k);
  if(hit && Date.now() - hit.at < 600000) return hit.p;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + ll[0].toFixed(4) + '&longitude=' + ll[1].toFixed(4) +
    '&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,precipitation' +
    '&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,weather_code&forecast_hours=7' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto';
  const p = fetch(url).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); });
  cache.set(k, { at:Date.now(), p });
  p.catch(() => cache.delete(k));
  return p;
}
const arrow = deg => `<span class="wxarrow" style="transform:rotate(${(deg + 180) % 360}deg)" aria-hidden="true">↑</span>`;   // points where the wind blows to
const hour = t => new Date(t).toLocaleTimeString('en-US', { hour:'numeric' }).replace(' ', '').toLowerCase();

/* The course panel's weather: fills el when Open-Meteo answers. */
async function block(el, ll){
  if(!el) return;
  el.innerHTML = '<div class="small">Checking the weather…</div>';
  try{
    const w = await get(ll), c = w.current, h = w.hourly;
    const next = h.time.slice(1, 7).map((t, i) => `<div class="wxh"><span class="small">${hour(t)}</span><b>${Math.round(h.temperature_2m[i + 1])}°</b>` +
      `<span class="small">${arrow(h.wind_direction_10m[i + 1])}${Math.round(h.wind_speed_10m[i + 1])}</span>` +
      `<span class="small">${h.precipitation_probability[i + 1] != null ? h.precipitation_probability[i + 1] + '%' : ''}</span></div>`).join('');
    el.innerHTML = `<h3>Weather now</h3><div class="wxnow"><b>${Math.round(c.temperature_2m)}°F</b> ${SKY(c.weather_code)}` +
      (Math.abs(c.apparent_temperature - c.temperature_2m) >= 3 ? ` · feels ${Math.round(c.apparent_temperature)}°` : '') + `</div>` +
      `<div class="wxwind">${arrow(c.wind_direction_10m)} Wind ${Math.round(c.wind_speed_10m)} mph from the ${from(c.wind_direction_10m)}` +
      (c.wind_gusts_10m > c.wind_speed_10m + 4 ? `, gusts ${Math.round(c.wind_gusts_10m)}` : '') + `</div>` +
      `<div class="wxhours">${next}</div><p class="small">Hours: temperature, wind (mph), chance of rain. <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a></p>`;
  }catch(e){ el.innerHTML = '<div class="small">Weather didn\'t load.</div>'; }
}

/* Wind on a hole: bearing = tee → basket, degrees. Wind "from" X blowing along the throw = tailwind. */
function vsHole(c, bearing){
  const mph = Math.round(c.wind_speed_10m);
  if(mph < 3) return { mph, text:'Calm' };
  const rel = ((c.wind_direction_10m - bearing + 540) % 360) - 180;   // 0: from straight ahead (headwind), ±180: from behind
  const a = Math.abs(rel), side = rel > 0 ? 'right' : 'left', other = rel > 0 ? 'left' : 'right';
  const text = a <= 30 ? 'Headwind' : a >= 150 ? 'Tailwind' : a < 70 ? `Quartering headwind from the ${side}` :
    a > 110 ? `Quartering tailwind from the ${side}` : `Crosswind, ${side} to ${other}`;
  return { mph, gust:Math.round(c.wind_gusts_10m), text, rel };
}

LF.weather = { get, block, vsHole, from, arrow };
})(window.LF);
