/* Unit checks for site/js/geo.js:  node tools/test_geo.js
   (GPX/KML import needs DOMParser, so tools/smoke.js covers that in a browser.) */
const g = require('../site/js/geo.js');
let bad = 0;
const near = (got, want, tol, msg) => { const ok = Math.abs(got - want) <= tol; console.log((ok ? 'ok   ' : 'FAIL ') + msg + ': ' + got.toFixed(3) + ' (want ' + want + ' ± ' + tol + ')'); if(!ok) bad++; };
const eq = (got, want, msg) => { const ok = got === want; console.log((ok ? 'ok   ' : 'FAIL ') + msg + ': ' + JSON.stringify(got) + (ok ? '' : ' (want ' + JSON.stringify(want) + ')')); if(!ok) bad++; };

// One degree of latitude on the WGS84-radius sphere web maps use: 2πR/360.
near(g.dist([45, -92], [46, -92]), 111319.49, 1, '1° latitude in meters');
// A 40-acre quarter-quarter is a quarter mile square: 402.336 m a side.
const a = [45.5, -92.5], b = g.dest(a, 90, 402.336), c = g.dest(b, 0, 402.336), d = g.dest(a, 0, 402.336);
near(g.area([a, b, c, d]) / g.M2_PER_AC, 40, 0.05, 'quarter-quarter section in acres');
near(g.length([a, b, c, d], true), 4 * 402.336, 0.5, 'its perimeter in meters');
near(g.bearing([45, -92], [46, -92]), 0, 0.01, 'bearing due north');
near(g.bearing([45, -92], [45, -91]), 89.65, 0.05, 'bearing nearly due east');
near(g.area(g.circlePts([45, -92], 100, 256)), Math.PI * 100 * 100, 30, '100 m circle area in m²');
near(g.gain([300, 301, 299, 305, 310, 306, 304, 312]), 16, 0.001, 'climb ignores GPS jitter under 4 m (300→310, then 306→312)');
// GeoJSON is [lng, lat]: a 40-acre square with a 10-acre square hole.
const sq = (c, side) => { const a0 = c, b0 = g.dest(a0, 90, side), c0 = g.dest(b0, 0, side), d0 = g.dest(a0, 0, side); return [a0, b0, c0, d0, a0].map(p => [p[1], p[0]]); };
const outer = sq([45.5, -92.5], 402.336), hole = sq(g.dest(g.dest([45.5, -92.5], 90, 100), 0, 100), 201.168);
near(g.geojsonArea({ type:'Polygon', coordinates:[outer, hole] }) / g.M2_PER_AC, 30, 0.05, 'GeoJSON polygon with a hole, in acres');
near(g.geojsonArea({ type:'MultiPolygon', coordinates:[[outer], [sq([46, -92], 402.336)]] }) / g.M2_PER_AC, 80, 0.1, 'GeoJSON multipolygon, in acres');
const donut = { type:'Polygon', coordinates:[outer, hole] };
eq(g.pointIn(g.dest(g.dest([45.5, -92.5], 90, 50), 0, 50), donut), true, 'point in polygon');
eq(g.pointIn(g.dest(g.dest([45.5, -92.5], 90, 200), 0, 200), donut), false, 'point in the hole is outside');
eq(g.pointIn([45.4, -92.5], donut), false, 'point outside polygon');
eq(g.fmtDist(100), '328 ft', 'short distance in feet');
eq(g.fmtDist(1609.344), '1.00 mi', 'one mile');
eq(g.fmtArea(40 * g.M2_PER_AC), '40.00 ac', 'forty acres');
eq(g.fmtArea(100), '1,076 sq ft', 'small area in sq ft');
eq(g.fmtTime(3725000), '1:02:05', 'hours:minutes:seconds');
eq(g.fmtPace(20 * 60000, 1609.344), '20:00 /mi', 'pace');
eq(g.fmtBearing(47), 'NE 47°', 'compass direction');
const gpx = g.toGPX({ waypoints:[{ name:'Stand <1> & "co"', lat:45.1, lng:-92.2, icon:'stand' }], drawings:[{ kind:'circle', name:'c', center:[45,-92], radius:50 }],
  tracks:[{ name:'walk', points:[[45,-92,300,0],[45.001,-92,null,1000]] }] });
eq(/<name>Stand &lt;1&gt; &amp; &quot;co&quot;<\/name>/.test(gpx), true, 'GPX escapes names');
eq((gpx.match(/<rtept /g) || []).length, 65, 'circle exports as a closed 64-point area');
eq(/<kml/.test(g.toKML({ waypoints:[{ name:'x', lat:1, lng:2 }] })), true, 'KML builds');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
