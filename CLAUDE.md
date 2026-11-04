# Line Fence: handoff notes

Free, phone-friendly map of property lines, owners and public land for Wisconsin and Minnesota. Live at **https://maps.dibberlab.me**. Tap any spot to see the parcel owner, acres, values and taxes, plus any public land and its hunting, fishing and access rules. The GPS button finds the parcel you're standing on.

There is no app server, database, build step or API key. The browser pulls all map data straight from state and federal ArcGIS services. Settings (base map, layers on or off, last view) are saved per browser in `localStorage` under `lf.*` keys.

## Layout

```
site/index.html   the whole app, one file (~260 KB)
                  lines ~12-674   Leaflet 1.9.4 CSS (inlined, BSD-2)
                  lines ~675-759  app CSS (color tokens on :root, dark mode)
                  lines ~760-806  markup: top bar, layers panel, results sheet
                  lines ~807-829  Leaflet 1.9.4 + Esri Leaflet 3.0.12 JS (inlined)
                  lines ~830-end  app code: SRC block, layers, tap-to-identify, search, GPS
deploy/           nginx site, server deploy script, one-time Mac setup
.github/workflows/deploy.yml   auto-deploy on push to main
```

Edit the app code at the bottom of `index.html`; don't touch the inlined libraries.

## Running locally

```
cd site && python3 -m http.server 8765    # open http://localhost:8765/
```

GPS needs HTTPS or localhost.

## Data sources

All URLs are in the `SRC` block near the top of the app script. If an agency moves a service, only that layer breaks; fix its URL there.

| Key | Service | Notes |
|---|---|---|
| `wiParcels` | WI SCO `Wisconsin_Statewide_Parcels_DB` FeatureServer/0 | V12 (2026). New version each summer: check https://www.sco.wisc.edu/data/parcels each July |
| `mnParcels` | MnGeo `plan_parcels_open` layer 1 | Opted-in counties only. **Never** swap in MnGeo's all-county layer: it's state-agency internal use only |
| `mnCoverage` | MnGeo `plan_parcels_open` layer 0 | Shades counties not in the free data, links to county GIS |
| `padus` | USGS PAD-US `Public_Access` | Nationwide; open / restricted / closed. Data from 2024 |
| `wiDnr` | WI DNR `LF_DNR_MGD_PROPERTY` | `EASE_USE` 4-digit code = hiking/fishing/hunting/trapping (1 = yes) |
| `wiClosed` | WI DNR `EN_Closed_Restricted_Areas` | Off by default |
| `wiMfl` | WI DNR `FR_OPFL_PUBLIC_Base` | Off by default. **Unverified**: layer list never checked live |
| `mnDnr` | MN DNR public access / open space units | WMAs, state forests, Walk-In Access |

Base maps: USGS National Map imagery and topo (default; public domain) and OpenStreetMap tiles (light use only under the OSM tile policy). Address search: Nominatim, max 1 request/second, only fires on Go.

Every lookup shows the "not a survey; signs on the ground override this map" warning. Keep it.

## Hosts the page contacts

Needed for any future CSP or firewall allowlist:

```
connect-src / img-src:
  services3.arcgis.com  services.arcgis.com  static.arcgis.com
  enterprise.gisdata.mn.gov  arcgis.dnr.state.mn.us
  dnrmaps.wi.gov  basemap.nationalmap.gov
  tile.openstreetmap.org  nominatim.openstreetmap.org
style-src: fonts.googleapis.com   font-src: fonts.gstatic.com
script-src: 'unsafe-inline' plus the ArcGIS hosts above (some services answer as JSONP)
```

## Where it is hosted

- dibberlab droplet, nginx, behind Cloudflare (same as budget.dibberlab.me). Code is a git checkout of `main` at `/var/www/maps`; nginx serves `site/`. Config: `deploy/maps.nginx.conf`.
- TLS: Cloudflare origin cert at `/etc/ssl/cloudflare/maps.dibberlab.me.{pem,key}`.
- `Permissions-Policy` must keep `geolocation=(self)`, or the GPS button fails. (budget's config sets `geolocation=()`; don't copy it.)
- **Deploying is pushing to `main`.** GitHub Actions SSHes in with a key locked to `/usr/local/bin/maps-deploy`, which pulls and checks the page answers. See `deploy/AUTODEPLOY.md`.
- One-time setup is `deploy/setup-from-mac.sh`, run on Andrew's Mac, the only machine with the droplet SSH key. Cloud sessions can't reach the droplet.
- Server-ops discipline: `nginx -t`, then reload, then commit and push `/etc/nginx` from the server. Stage files by name there, never `git add -A`.

## Testing

None of the data services were tested live before launch (the build workspace couldn't reach them). The post-deploy checklist is in the handoff doc: https://claude.ai/artifact/SgBNYv2mBfQW7nJyuqwJR8. When a layer fails, the browser console usually names the URL.
