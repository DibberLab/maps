/* Line Fence: what's selected, and the shading switch.
   LF.select draws the selected thing prominently above everything but saved markers: a pulsing ring at a
   point, and a bold outline with a white casing for shapes. It's cleared whenever the info panel changes
   or closes. LF.shading hides map fills (public land, selection fills, saved areas) so trails and ground
   detail show through; outlines stay. The switch sits in every info panel; the choice is remembered. */
window.LF = window.LF || {};
(function(LF){
'use strict';
const { map } = LF;
map.createPane('selPane'); map.getPane('selPane').style.zIndex = 458;   // above highlights and drawings, below saved markers
map.getPane('selPane').style.pointerEvents = 'none';
const group = L.layerGroup().addTo(map);
const renderer = L.canvas({ pane:'selPane' });

let hidden = LF.prefs.get('noShade', false);
LF.fillOf = base => hidden ? 0 : base;
LF.shading = {
  hidden:() => hidden,
  set(v){
    hidden = !!v; LF.prefs.set('noShade', hidden);
    // Public land: vector fills go (outlines stay); the DNR layers come as pictures with fill baked in, so they hide.
    const L_ = LF.layers || {};
    if(L_.padus) L_.padus.setStyle(L_.padus.options.style);
    if(L_.mncov) L_.mncov.setStyle(L_.mncov.options.style);
    ['widnr', 'wiclosed'].forEach(k => { if(L_[k]) L_[k].setOpacity(hidden ? 0 : L_[k]._baseOpacity); });
    if(L_.mndnr) L_.mndnr.eachLayer(l => l.setOpacity && l.setOpacity(hidden ? 0 : l._baseOpacity));
    // Every path drawn with a baseFill option (selection, parcel highlight, saved areas) follows the switch.
    map.eachLayer(l => { if(l.setStyle && l.options && l.options.baseFill != null) l.setStyle({ fillOpacity:LF.fillOf(l.options.baseFill) }); });
    document.querySelectorAll('input[data-act=shade]').forEach(b => { b.checked = hidden; });
    LF.emit('shading', hidden);
  }
};
LF.shading.set(hidden);

LF.shadeSwitch = () => `<label class="switchrow compact"><span>Hide shading<span class="small">See trails and ground under public land and selection fills</span></span>` +
  `<span class="switch"><input type="checkbox" role="switch" data-act="shade"${hidden ? ' checked' : ''} aria-label="Hide map shading"><span class="knob"></span></span></label>`;

const pulse = color => L.divIcon({ className:'sel-pulse', iconSize:[56, 56], iconAnchor:[28, 28],
  html:`<i style="border-color:${color}"></i><i style="border-color:${color}"></i><b style="background:${color}"></b>` });
LF.select = {
  clear(){ group.clearLayers(); },
  /* A point: pulsing ring (and dot unless the thing has its own marker). */
  point(ll, o){ o = o || {}; L.marker(ll, { pane:'selPane', interactive:false, keyboard:false, icon:pulse(o.color || '#e8590c') }).addTo(group); },
  /* A GeoJSON shape or a list of [lat,lng] (o.closed for areas): white casing under a bold colored line. */
  shape(g, o){
    o = o || {}; const color = o.color || '#e8590c', closed = !!o.closed;
    const make = st => Array.isArray(g) ? (closed ? L.polygon(g, st) : L.polyline(g, st)) : L.geoJSON(g, { style:() => st, interactive:false });
    make({ pane:'selPane', renderer, interactive:false, color:'#ffffff', weight:(o.weight || 4) + 6, opacity:.95, fill:false, lineJoin:'round', lineCap:'round' }).addTo(group);
    make({ pane:'selPane', renderer, interactive:false, color, weight:(o.weight || 4) + 1, opacity:1, lineJoin:'round', lineCap:'round',
      fill:closed || !Array.isArray(g), fillColor:color, baseFill:o.fill != null ? o.fill : .12, fillOpacity:LF.fillOf(o.fill != null ? o.fill : .12),
      dashArray:o.dash || null }).addTo(group);
  }
};
})(window.LF);
