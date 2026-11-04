# Line Fence: handoff notes

Free, phone-friendly map of property lines, owners and public land for Wisconsin and Minnesota. Live at **https://maps.dibberlab.me**. Tap any spot to see the parcel owner, acres, values and taxes, plus any public land and its hunting, fishing and access rules. The GPS button finds the parcel you're standing on.

The map itself needs no server, build step or API key: the browser pulls all map data straight from state and federal ArcGIS services. Accounts and sync use a small API (`server/app.py`, Flask + SQLite) behind nginx at `/api/` on the same origin. Settings (base map, layers on or off, last view) are saved per browser in `localStorage` under `lf.*` keys.

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
  js/share.js         LF.share.parse/build for links: #map=z/lat/lng&pin=lat,lng&base=hyb&layers=a,b
  js/map.js           SRC block (every data service URL), base maps, layers, layers panel, LF.flash
  js/identify.js      tap-to-identify: parallel lookups (15 s timeout each) and the results sheet
  js/search.js        address/coordinate search (Nominatim) and the GPS button
  js/geo.js           distance, acres, bearing, climb, US-unit formatting, GPX/KML export and import (pure; runs in Node)
  js/gps.js           one shared GPS watch (LF.gps.start/stop by user name: 'button', 'track', 'goto'); emits 'gps'.
                      Only a permission denial stops it; signal dropouts just flash "Weak GPS signal".
  js/items.js         saved waypoints/drawings/tracks: map rendering, view and edit sheets, photos (1280 px JPEG data URLs),
                      Go to guide, the saved list, GPX/KML export and import
                      Folders: r.folder name ("A / B" nests); the list groups by folder (switch, rename, remove, delete), Select mode
                      for bulk delete / move / hide / show / export. Item details from imports: sourceId, color (+opacity), lineStyle
                      (solid|dash|dot), weight, iconName (the other app's icon name, mapped by iconFor/ICON_ALIASES), extra {}.
                      geo.js reads them from KML ExtendedData / GPX extensions / key=value descriptions and writes them back.
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
                      90 days), sync, admin endpoints. JSON-only writes + Origin check against CSRF; login rate limit.
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

Four sources in the original handoff were dead when checked live on 2026-11-04 (WI DNR lands, WI closed areas and WI MFL renamed or moved; MN DNR's `arcgis.dnr.state.mn.us/host` server returns 404). The rows above are their replacements. WI's real MFL polygon services exist but refuse public access (403), so the points stand in.

All lookups use plain CORS requests. Every server above sends `Access-Control-Allow-Origin`. Don't go back to `useCors:false`: Esri Leaflet's JSONP fallback never calls back when a server answers with an error page, which used to leave the sheet stuck on "Looking up…".

MN DNR's server (`enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr`) also has deer, bear and turkey permit areas, snowmobile/OHV/state trails, state forest roads, water access sites, walk-in trails and public waters. Phase 5 uses these. On the WI side, dnrmaps.wi.gov has `PR_TRAILS`, `FM_Trout`, `WM_DMAP` and `WM_SPECIES_MGMT_ZONES` folders.

Base maps: USGS National Map "Imagery Topo" (aerial + roads and labels; the default), imagery only, and topo (all public domain) up to zoom 16 (the USGS tile cache stops there). Past zoom 16 on the aerial bases, "close-up" layers (`LF.closeup` in map.js) draw sharper imagery from image services, 512 px tiles via `exportImage`: WI DNR leaf-off (`DW_Imagery/EN_Image_Basemap_Latest_Leaf_Off`, WROC 2020/2025, ~3-inch to 1-ft pixels, Wisconsin only, bounded) over USGS NAIP Plus (`imagery.nationalmap.gov/.../USGSNAIPPlus`, ~1 ft, nationwide). Setting: leaf-off / summer / off. They take seconds per tile, so the stretched zoom-16 tiles stay underneath. WI's fast cached tiles are in WTM (EPSG:3071), which Leaflet's Web Mercator map can't use; MnGeo's composite is EPSG:26915-only WMS; Esri and Google imagery need paid accounts. Offline areas can include close-up tiles to map zoom 18 (sw.js serves them from the area caches). and OpenStreetMap tiles (light use only under the OSM tile policy). Address search: Nominatim, max 1 request/second, only fires on Go.

Every lookup shows the "not a survey; signs on the ground override this map" warning. Keep it.

## Hosts the page contacts

Needed for any future CSP or firewall allowlist:

```
connect-src / img-src:
  services3.arcgis.com  services5.arcgis.com  services.arcgis.com  static.arcgis.com
  enterprise.gisdata.mn.gov  dnrmaps.wi.gov  basemap.nationalmap.gov
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
- To add another admin without the portal: add the email to `LF_ADMIN_EMAILS` in `/etc/linefence.env` and restart `linefence-api` before they sign up. In the portal, Make admin works for any approved account.
- One-time setup is `deploy/setup-from-mac.sh`, run on Andrew's Mac, the only machine with the droplet SSH key. Cloud sessions can't reach the droplet.
- Server-ops discipline: `nginx -t`, then reload, then commit and push `/etc/nginx` from the server. Stage files by name there, never `git add -A`.

## Testing

`tools/smoke.js` covers the main paths (see Running locally). The original post-deploy checklist for a phone is in the handoff doc: https://claude.ai/artifact/SgBNYv2mBfQW7nJyuqwJR8. When a layer fails, the sheet names it ("Did not load: …") and the browser console usually shows the URL.
