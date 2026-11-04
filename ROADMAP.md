# Roadmap: onX-style features for Line Fence

Picked 2026-11-04. Everything onX Hunt offers except 3D terrain. Phases run in order; each one ships on its own and is useful by itself.

Ground rules that carry through every phase:

- **No build step, no API keys.** Plain files in `site/`, free public services only.
- **Phone first.** Every feature must work one-handed on a phone in the field.
- **Data stays on the device** until Phase 6. Waypoints, tracks and drawings live in IndexedDB, with a backup/restore file like discform's.
- **Keep the "not a survey" warning** on every lookup.
- **Check each new service live** before shipping it. Service URLs below are starting points and still need checking.

## Phase 1: Foundation (done)

Everything later needs this. Also fixed: four dead data sources and lookups that could hang (see CLAUDE.md, Data sources).

- [x] Split `index.html`: Leaflet and Esri Leaflet into `site/vendor/`, app code into a few plain scripts (`map.js`, `identify.js`, `store.js`, …). Still no build step.
- [x] **Install as phone app:** `manifest.json`, icons, and a service worker so "Add to Home Screen" opens full screen.
- [x] **Share a spot by link:** map position, layers and the tapped point in the URL (`#map=17/45.78/-92.38&pin=…`), plus a Share button using the phone's share sheet.
- [x] **Hybrid base map:** USGS imagery with road and place labels on top, made the default.
- [x] Device storage module (IndexedDB) with backup/restore, for Phases 2 to 4.

## Phase 2: Field tools (done)

- [x] **Waypoints:** drop pins with icons (stand, blind, trail cam, scrape, rub, parking, gate, custom), name, notes and photos. List view; tap to fly there; navigate-to with distance and bearing.
- [x] **Measure and draw:** lines with distance; **area drawings** (polygons and circles) with acreage; colors and labels.
- [x] **Track recording:** record a walk with distance, time, pace and elevation gain; keeps recording with the screen locked where the browser allows it (Wake Lock); "Back to start" guide. Not yet: dragging the corners of a saved drawing to reshape it.
- [x] Export and import GPX/KML so waypoints and tracks move to and from other apps and GPS units.

## Phase 3: Offline maps

- [ ] Draw a box, pick zoom levels, see the estimated size, then download: base map tiles, property lines and public land for that area.
- [ ] Tap-to-identify works offline from the saved parcel data (owner, acres, public land type).
- [ ] Manage saved areas: list, size, delete, refresh.
- Limits: USGS tiles only, since the OpenStreetMap tile policy forbids bulk downloads. Browsers cap storage, so ask for persistent storage and show what's used.

## Phase 4: Conditions and terrain

- [ ] **Wind and weather:** hourly wind direction and speed, temperature, precipitation for any spot, from the National Weather Service (`api.weather.gov`). Wind arrow on the map.
- [ ] **Sun, moon, solunar:** sunrise, sunset, legal shooting hours for WI and MN (check each state's current rule), moon phase, solunar major/minor times. Calculated on the device.
- [ ] **Elevation and slope:** elevation at any tap (USGS EPQS), elevation profile along a drawn line or track, slope-shading layer (USGS 3DEP elevation service).

## Phase 5: Hunting and map layers

- [ ] **Seasons and regs:** WI deer management units and MN deer permit areas drawn on the map; tap shows the unit, this year's season dates and links to the DNR regulations. Season dates are yearly data that need updating every year.
- [ ] **Trails and roads:** WI and MN snowmobile, ATV and state trails; national forest roads open to vehicles (USFS motor vehicle use maps for Chequamegon-Nicolet, Superior and Chippewa).
- [ ] **Water and landings:** lakes, streams and wetlands (USGS hydrography, WI Wetland Inventory, MN NWI), boat landings, designated trout streams.
- [ ] **Crops and cover:** USDA Cropland Data Layer (corn, beans, hay) and land cover.

## Phase 6: Accounts and sync

The only phase that needs a server, so it needs its own design first.

- [ ] Small API and database on the droplet (like budget.dibberlab.me's app), with sign-in.
- [ ] Sync waypoints, tracks, drawings and offline-area lists between phone and desktop; offline edits merge when back online.
- [ ] Hunting groups: share waypoints and drawings with chosen people.
- Open questions: sign-in method, who can create accounts, backups, and privacy (waypoint locations are sensitive).

## Not planned

- 3D terrain (would mean replacing Leaflet with a heavier map library).
