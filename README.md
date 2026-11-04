# Line Fence

Free, phone-friendly map of property lines, owners and public land in Wisconsin and Minnesota: https://maps.dibberlab.me

One static page (`site/index.html`), no server code or API keys. Map data comes straight from the WI State Cartographer's Office, MnGeo, USGS PAD-US, WI DNR and MN DNR.

For reference only, not a survey. Signs and posted boundaries on the ground override the map.

- Run locally: `cd site && python3 -m http.server 8765`
- Deploy: push to `main` (see `deploy/AUTODEPLOY.md`)
- Notes for contributors: `CLAUDE.md`
- Planned features: `ROADMAP.md`
