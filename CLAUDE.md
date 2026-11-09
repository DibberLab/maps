# Line Fence: handoff notes

Free, phone-friendly map of property lines, owners and public land for Wisconsin and Minnesota. Live at **https://maps.dibberlab.me**. Tap any spot to see the parcel owner, acres, values and taxes, plus any public land and its hunting, fishing and access rules. The GPS button finds the parcel you're standing on.

The map itself needs no server, build step or API key: the browser pulls all map data straight from state and federal ArcGIS services. Accounts and sync use a small API (`server/app.py`, Flask + SQLite) behind nginx at `/api/` on the same origin. Settings (base map, layers on or off, last view) are saved per browser in `localStorage` under `lf.*` keys.

## Two apps, one codebase

The same `site/` and API also serve a **disc golf app** at a discjerkers.com subdomain (name not settled yet; working
name "Disc Golf"). `site/js/flavor.js` (loaded first) picks the face from the address: `*.discjerkers.com` → disc golf
(`LF.isDG`, `LF.APP`), anything else → Line Fence; on test servers `?app=dg` / `?app=lf` (remembered). The disc golf face
renames the page (title, brand, manifest-dg.json, icons/dg-*), starts with courses, campgrounds, trout water and public
land on and property lines off (`APP.layers`, merged into map.js defaults), puts the disc golf tools ("Play") and the
Recreation/Fishing layers first, adds a Courses near me button (#nearBtn, js/dgnear.js), and skips owner lookups on a map
tap while Property lines is off. Same accounts, so courses, rounds and throws are in both; settings.js keeps the disc
golf app's layer choices under `settings.dg` (Line Fence's stay top level; photoShift is shared). The app's name is
`DG.name`/`DG.brand` in flavor.js plus manifest-dg.json. Hosting: deploy/discgolf.nginx.conf (SUBDOMAIN filled in by
deploy/setup-discgolf-from-mac.sh <subdomain>, run once on the Mac; same *.discjerkers.com origin cert as discform),
serving /var/www/maps/site, /api/ to the same linefence-api. Deploys of main update both. Tests: tools/smoke_dg.js.

## Working rules

- **Pushing to `main` deploys to production** (GitHub Actions → `/usr/local/bin/maps-deploy` on the droplet, about 15 s).
- Do all work on a branch. When a change is ready and tested (`tools/smoke.js` passes), **ask Andrew whether to deploy**. Only on a yes, fast-forward `main` to the branch and push.
- After the push, check the Deploy run passed (`https://api.github.com/repos/DibberLab/maps/actions/runs?per_page=1`), then rerun `node tools/smoke.js https://maps.dibberlab.me/`.
- A redeploy without new code: GitHub → Actions → Deploy → Run workflow, or `gh workflow run Deploy -R DibberLab/maps` on the Mac.
- Andrew isn't a developer; give him exact commands to paste when something must run on his Mac.

## Layout

```
site/                 the whole app: static files, no build step
  index.html          markup only: top bar, layers panel, results sheet, script tags
  app.css             app styles (color tokens on :root, dark mode)
  js/store.js         LF.prefs (localStorage lf.*), LF.db (IndexedDB: waypoints/tracks/drawings/areas,
                      backup/restore), LF.listen/LF.emit event bus. Loaded first.
  js/share.js         LF.share.parse/build for links: #map=z/lat/lng&pin=lat,lng&base=hyb&layers=a,b[&share=<id>&item=<id>&panel=min]
                      Share (app.js, LF.shareLink) = the current view + what the panel shows: a spot (pin), or whatever the sheet
                      put in LF.shareCtx via showSheet({share}): a folder list publishes/refreshes the folder then shows its link
                      sheet ({run}); a shared folder / its item card adds share/item ({params}). panel=min when tucked.
                      Shared folders (items.js shareFolder/openShared): POST /api/shares {folder, items} (approved; same folder =
                      same id, copy replaced), GET /api/shares/<id> (public, owner's display name only), DELETE to stop. Opened
                      links draw into a preview layer via drawRecords (holes too); Save to my map copies them with ids
                      sh-<share>-<id> and sharedFrom, so saving again updates. Photos dropped if the folder is over ~20 MB.
                      Short links (LF.shortLink): POST /api/links {hash} (anyone, 120/h per IP; same hash = same code) →
                      /api/s/<6 chars> redirects to /#hash. Under /api/ because nginx only proxies that path. Falls back to the long
                      link after 3 s. LF.linkPop shows the link with Copy / Send when the phone won't open its share menu.
  js/map.js           SRC block (every data service URL), base maps, layers, layers panel, LF.flash
  js/select.js        LF.select (the selected thing drawn bold on 'selPane': cased outline, pulsing ring; cleared when
                      the sheet changes) and LF.shading / LF.shadeSwitch() (Hide shading: public land and any path with a
                      baseFill option lose their fill; pref 'noShade'). Loads right after map.js.
  js/identify.js      tap-to-identify: parallel lookups (15 s timeout each) and the results sheet
                      LF.showSheet(head, body, {pin, onAct, onClose, back:{label, go}}): back draws "‹ Back to …" (items opened from the list).
                      Phones: dragging the grab bar / title down tucks the sheet to a title strip (LF.tuckSheet; .sheet.tucked), still open;
                      drag up or tap to restore. Any new panel opens untucked.
  js/hover.js         desktop hover preview of trails/roads/landings/trout water: glow + name tip = what a click opens
  js/search.js        address/coordinate search (Nominatim) and the GPS button
  js/geo.js           distance, acres, bearing, climb, US-unit formatting, GPX/KML export and import (pure; runs in Node)
  js/gps.js           one shared GPS watch (LF.gps.start/stop by user name: 'button', 'track', 'goto', 'mark'); emits 'gpsRaw'
                      (every reading) and 'gps' (smoothed). maximumAge 0. smooth(): Kalman-style, weight by reported accuracy,
                      process noise from speed (phone's, or 6 s drift of raw readings), skips a far-off reading unless 3 agree.
                      Only a permission denial stops it; signal dropouts just flash "Weak GPS signal".
                      Waypoint "Use my location (averaged)" (draw.js averageHere): weighted mean of raw readings, worst third
                      dropped, up to 30 s or ±2 m; saved as r.gpsAcc / r.gpsN and shown on the card. Tracks: readings needing
                      > 45 m/s are dropped; on stop, track.js tidy() removes out-and-back spikes and lightly smooths (LF.trackTidy).
                      LF.listen returns an unsubscribe.
  js/items.js         saved waypoints/drawings/tracks: map rendering, view and edit sheets, photos (1280 px JPEG data URLs),
                      Go to guide, the saved list, GPX/KML export and import
                      Folders: r.folder name ("A / B" nests); the list groups by folder (switch, rename, remove, delete), Select mode
                      for bulk delete / move / hide / show / export. Manual order: drag a row's ⠿ grip (dragSort) within its folder;
                      saved as r.order (0..n) on that folder's items, which then sort first (unplaced ones after, newest first).
                      Grips hide in Select mode and when a type filter is on. Opening the list fresh leaves Select mode. Item details from imports: sourceId, color (+opacity), lineStyle
                      (solid|dash|dot), weight, iconName (the other app's icon name, mapped by iconFor/ICON_ALIASES), extra {}.
                      geo.js reads them from KML ExtendedData / GPX extensions / key=value descriptions and writes them back.
                      Disc golf holes travel as dgHole / dgPar / dgFairway / dgAnchors (a KML line with them imports as a track).
                      Disc golf folders: everything lives under "Disc Golf" (LF.items.dgFolder(name)). tidyDiscGolf() runs on open
                      and after a sync pull: other spellings fold into "Disc Golf", and a top-level folder that holds dg holes or
                      dgtee/dgbasket waypoints, or has "disc golf" in its name, moves underneath it.
                      Edit mode (geoEditor): the item is hidden from the normal layer and drawn on 'editPane' (470, pointer-events none
                      so its canvas can't swallow taps): draggable waypoint; a vertex handle per corner + ✥ move-all for lines/areas;
                      centre + edge (radius) for circles. Applied on Save only; plain tracks aren't movable. redraw() is generation-guarded.
                      Disc golf holes: a track with r.dg = {hole, par, fairway (ft), anchors:[point indexes]}. Words: the hole is the
                      whole thing (tee pad + fairway + basket); start = tee pad (icon dgtee), end = basket (dgbasket; both also
                      waypoint icons). Drawn by drawHole: fairway band in real feet (restyled on zoom), arrows tee→basket, tee label
                      "Hole N · Par P · length". Edit (Type: Disc golf hole) uses dgEditor: drag tee/basket and the line bends back to
                      the nearest anchor (linear falloff by arc length); tap the line to add an anchor, tap one to remove it; with no
                      anchors the middle point is the built-in one. Folder ⋯ "Make its tracks disc golf holes" and Select-mode
                      "Make disc golf holes" set r.dg (hole # from the name: holeFromName). Track points are [lat,lng,alt,t]:
                      pass [p[0],p[1]] to Leaflet (it rejects 4-element arrays).
  js/dgcourse.js      disc golf part 1, Map a course (+ > Disc golf): course name → folder ("Disc Golf / <name>", or an existing course
                      folder, continuing from its next hole). A bottom bar per hole: Tee pad here (raw GPS averaged ≤12 s,
                      LF.gpsAverageOf from draw.js) → fairway recorded from 'gps' fixes → Basket here saves a dg track (Hole N,
                      par, color #0f766e; tidy()'d; 11-point straight line if nothing was walked). LF.mode='course': a map tap
                      sets the tee/basket instead. Par ±, Redo hole / Undo last, Done (opens the folder). State in pref 'dgCourse',
                      resumed after a reload. Part 2: dgscore.js, part 3: dgthrow.js.
  js/dgscore.js       disc golf part 2, Score a round: LF.db store 'rounds' (DB v3; synced + backed up; server STORES has it)
                      { name, folder, format singles|teams, holes:[{n,par,trackId}], sides:[{id,name,members}], scores:{side:[…]},
                      hole, started, finished, live?, liveVersion?, pending? }. Course = a folder of dg holes, or unmapped N holes.
                      Card: one hole at a time, −/+ (tap the number = par; untouched = par on Next), hole par ±, map fits the
                      hole once per hole. Summary: grid + winner, Edit scores, Delete. Live rounds: Invite (approved account)
                      POST /api/rounds → short link to /#round=<id>; anyone with it joins (copy lv-<id>), no account. Each score
                      is a cell op (POST /api/rounds/<id> {scores,pars,finished}) queued in r.pending and retried; poll every 3 s
                      with ?since=version; merge() = server copy + pending ops; own current hole per phone.
                      Each round records a GPS track from Start / joining (track.js start({round}); skipped if a track is already
                      recording; a round track reloaded within 30 min resumes unpaused). Finishing offers Save track with the round
                      (folder "Disc Golf / Rounds", r.trackId) or Discard (LF.track.endFor). The pill #roundChip under the search bar
                      shows the round in progress (updated in the last 12 h) or a finished one whose track awaits that choice.
  js/dgthrow.js       disc golf part 3, Measure a throw (+ > Disc golf; My throws lists them): LF.db store 'throws' (DB v4; synced
                      + backed up) { from, to, dist (m), acc (m), disc, kind, at, name, hole?, course? }. Each end: raw GPS averaged
                      (up to 20 s, early once 8+ readings agree to ±1.5 m), or a mapped tee pad within 12 m (its saved spot, ±1.5 m),
                      or a map tap (±0.5 m). acc = both ends' errors combined (sqrt of squares). Live distance while walking.
                      "Save & throw again from here" chains throws. List: best per disc, then all; a throw draws on the map.
                      LF.mode='throw'.
  js/dgadmin.js       public disc golf courses (Menu > Admin > Disc golf courses; admins only). Server table courses:
                      GET /api/courses (public) {courses:[{id, name, c, holes:[{n, par, ft, line, anchors}], address, notes, updated}]},
                      POST /api/courses {course[, id]} and DELETE /api/courses/<id> (admin). Add course: name, pars, distances
                      (or "Read pars & distances from a screenshot": POST /api/courses/read → Claude reads the hole table), a
                      layout picture → the picture lies over the map (pane dgPicPane, CSS transform from C/mpp/rot) → Claude
                      marks tee, bends, basket per hole (POST /api/courses/locate; picture sent at ≤1568 px, coordinates
                      scaled back; holes it misses stay empty) → check each, Redo hole and tap tee, bends, basket by hand
                      (kept in picture pixels) → Done sizes it from the listed distances
                      (median ratio) → drag / pinch-turn / ⟲⟳ −+ to line it up with the aerial → Publish. The picture never
                      leaves the phone. "Publish a course from my map" sends a folder of dg holes (updates the course with the
                      same name, or the one it was copied from: track.fromCourse). discgolf.js merges published courses into the
                      layer (replacing an OSM entry with the same name within 5 km, keeping its details); their sheet has Add to
                      my map (tracks pc-<course>-<hole> in "Disc Golf / <name>") and, for admins, Remove course. Score a round
                      lists them (holes carry their own line); Measure a throw checks their tee pads.
                      Edit course (admins, on any course sheet; LF.dgadmin.editCourse): drag the course pin, and for a published
                      layout each hole's tee, bends (anchors) and basket; holes are rebuilt with line() on Save. course.pin places
                      the pin by hand. An OSM course saves as a pin-only course (holes [] + pin) that the layer lays over it,
                      keeping the OSM holes (asCourse → pinOnly).
                      Your map is the course: a Disc Golf folder linked to a published course (tracks' fromCourse, set on publish /
                      Add to my map, or sameCourse by name) republishes ~3 s after an admin changes a hole (autoPublish; only real
                      changes; listed distances and pin kept). The layer draws no hole lines for courses in your own map (isMine),
                      and Edit course on one moves just its pin. sameCourse(): names equal or one extends the other once
                      "(…)" and words like "disc golf", "course" are dropped, within 3 km, so a course shows once.
  js/photoshift.js    Menu > Line up the aerial photo: averaged GPS on open ground → tap that spot on the photo → the photos shift
                      (Leaflet tilePane CSS translate, metres east/north → px per zoom; ↑↓←→ 1 ft). One shift per area
                      { at, e, n } used within 30 km; pref 'photoShift', also in account settings (settings.js). Then "Move what
                      you placed by eye": items in chosen top folders (Disc Golf ticked) and, for admins, public courses nearby
                      (pins and holes) move by the same change. Parcel lines and other data never move.
  js/flavor.js        which app this is (Line Fence or the disc golf app) and dressing the page for it; see "Two apps".
  js/dgnear.js        Courses near me: every course on the disc golf layer, nearest first from GPS (map centre until it
                      answers), search by name across all; a tap opens the course (LF.discgolf.showCourse).
  js/draw.js          tap-to-place waypoint, line, area, circle; sets LF.mode so taps don't trigger parcel lookups
  js/track.js         track recording: saves every 10 s with recording:true, Wake Lock, pause/resume,
                      an unfinished track comes back paused after a reload
  js/offline.js       offline areas: saves the framed box's USGS tiles to Cache Storage (lft-<id>) and every parcel and
                      public land record (with shapes) to LF.db 'areadata'; taps inside a saved area answer from it
                      (LF.offline.lookup, same shape as live results); parcel lines drawn from it; public land fills
                      only when navigator.onLine is false. Limit 6000 tiles per area. 'areas'/'areadata' are not backed up.
  js/labels.js        city/village limits + names (USGS govunits layer 24, from zoom 9), WI towns / MN townships
                      (layer 26, filtered to "Town of"/"Township of", zoom 11), unincorporated places (geonames layer 3),
                      drawn client-side (USGS's own images fill cities solid white); road names (transportation labels,
                      one dynamic image per view) over the close-up imagery at zoom 17+. Toggles under Labels.
                      onX-style tiers: cities by population (CITY_TIERS: 100k z6, 20k z8, 5k z9, 1k z10, rest z11; the query's
                      where clause follows the zoom), short name until z12 then the official one; lake names (USGS NHD
                      waterbody layer 12, GNIS_NAME + AREASQKM, LAKE_TIERS by area) and hamlets only where the base picture
                      has none (Aerial only, or z17+ close-up) so names aren't doubled; declutter() hides the lower-ranked
                      of two overlapping names (rank, then population/area).
      js/menu.js      the main menu from the logo: account, content by type, the folder tree (LF.items.tree(): ▸ opens subfolders,
                      the name opens LF.items.list({folder}) which includes subfolders, a switch hides/shows the whole branch via
                      LF.items.setFolderHidden; open branches in pref 'menuFoldersOpen'),
                      offline areas, layers, admin portal.
  js/route.js         directions from GPS to a waypoint, track start, course or parcel: OSRM on routing.openstreetmap.de
                      (FOSSGIS; car / bike / foot), one request per tap, credited; draws the route, the off-road last stretch
                      as a dashed straight line, turn-by-turn steps, link to the same route on openstreetmap.org.
                      Tests: cloud sandboxes can't reach the router from Chromium, so smoke_route.js fetches via curl.
  js/discgolf.js      disc golf layer: pins (zoom 7+), hole layouts (zoom 15+), course sheet, name search. Data in
                      data/discgolf.json, built by tools/fetch_discgolf.py (Overpass, MN + WI) in GitHub Actions monthly;
                      the build workspace can't reach Overpass. Test fixture: tools/fixtures/discgolf-elver.json.
  js/account.js       sign in/up, account sheet, LF.account.require(what): the gate on waypoints, tracks, saved drawings,
                      offline areas (measuring, lookups, search, GPS stay open to everyone)
  js/sync.js          approved accounts: local saves mark items pending (prefs 'syncPending'), pushed in ≤4 MB batches to
                      POST /api/sync; pulls GET /api/sync?since=<seq>. Newest `updated` wins. First sync on a device adds
                      its never-synced items to the account; sign-out clears the account's items from the device.
  js/settings.js      signed-in accounts: the layers panel (base, close-up, every l-* switch) saved to POST /api/me/settings
                      1.5 s after a change, applied on sign-in / app open (a shared link's own base/layers win at open).
                      Disc golf is off by default; only a tap saves it ('lf.discgolfOn'; the old 'lf.discgolf' is ignored).
  admin/              admin portal (index.html + admin.js): approve, move back to waiting, turn off, make/remove admin,
                      reset password (shows a one-time temporary password), delete
  js/app.js           address bar sync, Share button, install-as-app, backup/restore, service worker
  sw.js               service worker: app files network-first (4 s) with cache fallback, fonts cache-first.
                      Map data is NOT cached (offline areas are Phase 3). Bump VERSION when its file list changes.
  manifest.json, icons/   install-as-app (icons rendered from icons/icon.svg)
  vendor/             Leaflet 1.9.4 and Esri Leaflet 3.0.12, byte-identical to the official releases
server/app.py         the API: accounts (pending/approved/disabled, user/admin), sessions (HttpOnly cookie, hashed tokens,
                      90 days), sync, shared folders (table shares, UNIQUE user+folder), short links (table links), live disc golf rounds
                      (table live_rounds; cell-level score updates, version for polling), admin endpoints. JSON-only writes + Origin check against CSRF; login rate limit.
server/test_app.py    API tests (Flask test client)
tools/run_all.sh      every test suite against a local site + API on fresh databases: bash tools/run_all.sh <venv>
tools/smoke.js        end-to-end test in headless Chromium against the live services
deploy/               nginx site, server deploy script, one-time Mac setup
ROADMAP.md            the onX-style feature plan, by phase
```

All scripts share one global, `window.LF`. Script order in `index.html` matters.

## Running locally

```
cd site && python3 -m http.server 8765    # open http://localhost:8765/
```

GPS and the service worker need HTTPS or localhost.

The saving features need the API. To run the site and API together locally:

```
python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
cd server && LF_DB=/tmp/lf.db LF_ADMIN_EMAILS=you@example.com LF_COOKIE_SECURE=0 LF_STATIC=$PWD/../site \
  ../.venv/bin/gunicorn -b 127.0.0.1:8766 app:app        # open http://127.0.0.1:8766/
```

All tests: `bash tools/run_all.sh .venv` (each browser suite gets a fresh database). Individually
(Chromium and Playwright are preinstalled in cloud sessions):

```
node tools/smoke.js http://localhost:8765/ /tmp/out
node tools/smoke_tools.js http://localhost:8765/ /tmp/out   # Phase 2 tools, simulated GPS
node tools/smoke_offline.js http://localhost:8765/ /tmp/out # save an area, go offline, look up
node tools/test_geo.js                                       # math and formats
```

It opens a shared link to a Siren, WI parcel, checks the address bar, Share, backup/restore,
the service worker and offline start-up, renders desktop dark mode, and fails on any script error.
Cloud sessions can reach the data services directly. Don't point Playwright at the agent proxy,
because it breaks localhost.

## Data sources

All URLs are in the `SRC` block near the top of the app script. If an agency moves a service, only that layer breaks; fix its URL there.

| Key | Service | Notes |
|---|---|---|
| `wiParcels` | WI SCO `Wisconsin_Statewide_Parcels_DB` FeatureServer/0 | V12 (2026). New version each summer: check https://www.sco.wisc.edu/data/parcels each July |
| `mnParcels` | MnGeo `plan_parcels_open` layer 1 | Opted-in counties only. **Never** swap in MnGeo's all-county layer: it's state-agency internal use only |
| `mnCoverage` | MnGeo `plan_parcels_open` layer 0 | Shades counties not in the free data, links to county GIS |
| `padus` | USGS PAD-US `Public_Access` | Nationwide; open / restricted / closed. Data from 2024 |
| `wiDnr` | WI DNR `LF_DML/LF_DNR_MGD_PROP_WTM_Ext` | `EASE_USE_CODE` 4 digits = hiking/fishing/hunting/trapping (1 = yes); `PUBLIC_ACCESS` text |
| `wiClosed` | WI DNR `arcgis2/WM_PROP_MGMT/WM_CLOSED_RESTRICTED_AREAS_WTM_Ext` | Refuges and restrictions, with `RESTRICTIONS`/`EXCEPTIONS` text. Off by default |
| `wiMfl` | WI DNR tax-law points (`X13661_FR_GIS_TAXLAW_PT_SV`, services5.arcgis.com) | One point per 40-acre block; `AC_OP_PLS` = acres open to the public. Drawn as dots at zoom 11+, looked up within 300 m. Off by default |
| `mnDnr` | MN DNR `bdry_dnr_managed_areas` MapServer, layer 3 (`LF.MN_DNR_LAYER`) | WMAs, state forests, SNAs, AMAs; `ACCESS_WO_TRESPASS` |
| `mnWia` | MN DNR `bdry_dnr_walk_in_access_sites` | Walk-In Access; shares the "MN public hunting" toggle with `mnDnr` |
| `mnStateTrails`, `mnHunterTrails` | MN DNR `trans_state_trails_minnesota`, `trans_hunter_walking_trails` | Toggle `mntrails`. State trail uses are 0/1 `use_*` fields |
| `mnOhv`, `mnSnowmobile` | MN DNR `trans_ohv_trails_mn`, `trans_snowmobile_trails_mn` | Toggle `mnmotor`. OHV uses are "X"; snowmobile has the club and contact |
| `mnForestRoads` | MN DNR `trans_state_forest_roads` | Toggle `mnroads`. `road_class`: System Forest Road (solid) / Minimum Maintenance Road (dashed) |
| `mnAccess` | MN DNR `struc_water_access_sites` | Toggle `mnaccess`. Trailer launch (blue dot) / carry-in (teal); ramps, docks, parking, directions |
| `wiStateTrails`, `wiIceAge`, `wiNct` | WI DNR `LF_DML/LF_DNR_REC_OPPS_WTM_Ext` layers 1–3 | Toggle `mntrails`. State trail uses are Y/N fields; `FEE` = state trail pass |
| `wiRoadsCar`, `wiRoadsAtvSnow`, `wiRoadsAtv`, `wiRoadsSnow` | WI DNR `DW_Map_Dynamic/EN_DNR_Motorized_Access_Roads_Ext` layers 1–4 | Car roads → `mnroads` (dashed = open seasonally, `DATE_OPEN_FROM/TO` MMDD); ATV/snowmobile → `mnmotor`, merged per `ROAD_SEQ_NO` on tap |
| `wiBoat` | WI DNR `arcgis2/PR_Recreation/PR_Boat_Access_Shore_Fishing_WTM_Ext` layer 2 | Toggle `mnaccess`, `ABANDON_FLAG = 'No'` (`LF.REC_WHERE`). Layer 1 = shore fishing sites (not used) |

| `usfsCamps` | USFS `EDW/EDW_RecreationOpportunities_01` layer 0 (apps.fs.usda.gov) | Toggle `camp`. `markeractivity LIKE '%Camp%'` in the Chequamegon-Nicolet, Superior and Chippewa NFs (`LF.REC_WHERE`) |
| `mnForestCamps`, `mnParkCamps` | MN DNR `struc_state_forest_campgrounds` (1; day-use areas left out), `struc_parks_and_trails_campsites` (0, one point per site, zoom 14+) | Toggle `camp`. Tent badges (`campIcon`); WI state park and private/county campgrounds aren't in these (OpenStreetMap would cover them) |
| `mnTroutStreams`, `mnTroutLakes` | MN DNR `env_trout_stream_designations` (0), `env_trout_lake_designation` (layer 2, `trout_lake`='Y') | Toggle `trout`. Both `trout_flag` values (1, 2) are designated streams; meaning undocumented, not shown |
| `wiTroutStreams`, `wiTroutLakes` | WI DNR `FM_Trout/FM_TROUT_REGS_WTM_Ext` layers 0, 1 | Toggle `trout`. `SEASON_TXT`, `EARLY_SEASON_TXT`, `BAG_LMT`, gear ("N/A" hidden) |

Trout water (`trout`, Layers > Fishing, off by default, zoom 8+): one electric cyan `#00e5ff` line per creek on `troutPane` 427, no
casing or glow (a casing copied from the first, generalised load drifted from the line as you zoomed and read as a "ghost"). Streams
and lakes are fetched at full detail at every zoom (no simplifyFactor, precision 6), so the shape matches the zoomed-in one; one light
Chaikin pass (`SmoothLines`, `LF.smoothGeometry`) rounds corners. Lakes: cyan outline + fixed 0.25 fill, deliberately not
`baseFill`, so Hide shading leaves them shaded. Tap lookups fetch trout geometry unsimplified too (`fullDetail`).

Taps: rec/trout lookups reach `LF.REC_TAP` (22 px lines, 24 px dots), return geometry, and sort nearest first (`recList`). When one
is hit it becomes the panel title + tag and the only outline (`LF.select.shape(..., {casing:false})`); parcel / public land are
listed below without outlines. js/hover.js (mouse/trackpad only): within the same reach the nearest one glows on `hoverPane` 457
and a tip shows its name (`LF.REC_NAME` fields are loaded with the shapes; each feature layer carries `recKey`).

The four `mn*` switch keys now cover both states (labels say WI & MN; keys kept so saved settings carry over). WI has no
statewide snowmobile/ATV trail layer (county and club trails); only DNR roads open to those vehicles are shown.

The MN trail/road/access layers (off by default, zoom 10+) are feature layers on `recPane` (430) with white casings copied from the
same features onto `recCasePane` (429), so each service is queried once. Styles in `LF.REC`. A tap asks only the switched-on ones
within `LF.REC_TAP` px (`recLookup` in identify.js) and puts "Trails, roads & water access" at the top of the panel.

Four sources in the original handoff were dead when checked live on 2026-11-04 (WI DNR lands, WI closed areas and WI MFL renamed or moved; MN DNR's `arcgis.dnr.state.mn.us/host` server returns 404). The rows above are their replacements. WI's real MFL polygon services exist but refuse public access (403), so the points stand in.

All lookups use plain CORS requests. Every server above sends `Access-Control-Allow-Origin`. Don't go back to `useCors:false`: Esri Leaflet's JSONP fallback never calls back when a server answers with an error page, which used to leave the sheet stuck on "Looking up…".

MN DNR's server (`enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr`) also has deer, bear and turkey permit areas, walk-in trails, public waters, trout streams and state forest campgrounds (not used yet). On the WI side, dnrmaps.wi.gov has `PR_TRAILS`, `FM_Trout`, `WM_DMAP` and `WM_SPECIES_MGMT_ZONES` folders.

Base maps: USGS National Map "Imagery Topo" (aerial + roads and labels; the default), imagery only, and topo (all public domain) up to zoom 16 (the USGS tile cache stops there). Past zoom 16 on the aerial bases, "close-up" layers (`LF.closeup` in map.js) draw sharper imagery from image services, 512 px tiles via `exportImage`: WI DNR leaf-off (`DW_Imagery/EN_Image_Basemap_Latest_Leaf_Off`, WROC 2020/2025, ~3-inch to 1-ft pixels, Wisconsin only, bounded) over USGS NAIP Plus (`imagery.nationalmap.gov/.../USGSNAIPPlus`, ~1 ft, nationwide). Setting: leaf-off / summer / off. They take seconds per tile, so the stretched zoom-16 tiles stay underneath. WI's fast cached tiles are in WTM (EPSG:3071), which Leaflet's Web Mercator map can't use; MnGeo's composite is EPSG:26915-only WMS; Esri and Google imagery need paid accounts. Minnesota (leaf-off setting): MnGeo's "best available" composite (`imageserver.gisdata.mn.gov/cgi-bin/mncomp`, county spring/fall imagery, 3-inch in the metro), a JPEG-only WMS in EPSG:26915. `WarpTiles` in map.js asks for the UTM box around each 512 px tile and draws it in 8×8 affine pieces onto Web Mercator (sub-pixel), clipped to `LF.MN_OUTLINE` (js/mn-outline.js: Census TIGERweb, simplified ~250 m, pushed ~300 m outward). Order: NAIP 2, MN 3, WI 4. Map max zoom 22 (share links accept up to 22): WI/MN close-up native to zoom 21 then
enlarged, NAIP native to 20; ImageServer requests use bilinear interpolation (SMOOTH) and WarpTiles never asks finer than
0.075 m/px, so close zooms enlarge smoothly rather than in server blocks. MnGeo's MnDOT layers cover road corridors only. Terrain shading (`l-terrain`, off by default): USGS 3DEP `Hillshade Multidirectional` (flat = white) multiplied over the base, deepened 2.5× by a CSS filter on `terrainPane`; tiles take 3–9 s. Offline areas can include close-up tiles to map zoom 18 (sw.js serves them from the area caches). and OpenStreetMap tiles (light use only under the OSM tile policy). Address search: Nominatim, max 1 request/second, only fires on Go.

Every lookup shows the "not a survey; signs on the ground override this map" warning. Keep it.

## Hosts the page contacts

Needed for any future CSP or firewall allowlist:

```
connect-src / img-src:
  services3.arcgis.com  services5.arcgis.com  services.arcgis.com  static.arcgis.com
  enterprise.gisdata.mn.gov  dnrmaps.wi.gov  basemap.nationalmap.gov
  imageserver.gisdata.mn.gov  elevation.nationalmap.gov  imagery.nationalmap.gov  apps.fs.usda.gov
  tile.openstreetmap.org  nominatim.openstreetmap.org
style-src: fonts.googleapis.com   font-src: fonts.gstatic.com
script-src: 'self' (no inline scripts, no JSONP since Phase 1)
```

## Where it is hosted

- dibberlab droplet, nginx, behind Cloudflare (same as budget.dibberlab.me). Code is a git checkout of `main` at `/var/www/maps`; nginx serves `site/`. Config: `deploy/maps.nginx.conf`.
- TLS: Cloudflare origin cert at `/etc/ssl/cloudflare/maps.dibberlab.me.{pem,key}`.
- `Permissions-Policy` must keep `geolocation=(self)`, or the GPS button fails. (budget's config sets `geolocation=()`; don't copy it.)
- **Deploying is pushing to `main`.** GitHub Actions SSHes in with a key locked to `/usr/local/bin/maps-deploy`, which pulls, restarts `linefence-api` when `server/` changed (reinstalling packages if `server/requirements.txt` changed), and checks the page and `/api/health` answer. See `deploy/AUTODEPLOY.md`.
- **The API on the droplet:** systemd `linefence-api` (gunicorn, 127.0.0.1:8010, user `linefence`), venv `/var/www/maps/.venv`, settings `/etc/linefence.env` (`LF_DB`, `LF_ADMIN_EMAILS`; the admin email is kept there, never in this public repo), database `/var/lib/linefence/linefence.db`, nightly copies in `/var/backups/linefence` (14 days, `/etc/cron.daily/linefence-backup`). Logs: `journalctl -u linefence-api`.
- **Claude API** (Add course reads screenshots): `ANTHROPIC_API_KEY` in `/etc/linefence.env`, never in the repo. server/app.py
  `ask_claude` (anthropic SDK, claude-opus-5-5, effort low, JSON-schema output, server-side fallback, 45 s, no retries);
  gunicorn runs with `--timeout 60` (deploy/linefence-api.service) so a slow read isn't killed. Tests stub `srv.ask_claude`.
- To add another admin without the portal: add the email to `LF_ADMIN_EMAILS` in `/etc/linefence.env` and restart `linefence-api` before they sign up. In the portal, Make admin works for any approved account.
- One-time setup is `deploy/setup-from-mac.sh`, run on Andrew's Mac, the only machine with the droplet SSH key. Cloud sessions can't reach the droplet.
- Server-ops discipline: `nginx -t`, then reload, then commit and push `/etc/nginx` from the server. Stage files by name there, never `git add -A`.

## Testing

`tools/smoke.js` covers the main paths (see Running locally). The original post-deploy checklist for a phone is in the handoff doc: https://claude.ai/artifact/SgBNYv2mBfQW7nJyuqwJR8. When a layer fails, the sheet names it ("Did not load: …") and the browser console usually shows the URL.
