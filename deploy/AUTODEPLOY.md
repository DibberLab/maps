# Automatic deploys

Every push to `main` deploys to maps.dibberlab.me through
`.github/workflows/deploy.yml`. GitHub SSHes into the droplet with its own key,
and that key can only run `/usr/local/bin/maps-deploy`: pull `main` into
`/var/www/maps`, then check nginx serves the page. It's a static site, so
that's the whole deploy. A failed deploy shows as a red X on the commit in
GitHub.

You can also redeploy by hand: GitHub → Actions → Deploy → Run workflow.

## One-time setup

On the Mac, from a clone of this repo, once this commit is on `main`:

    bash deploy/setup-from-mac.sh

It checks the connection, clones the repo to `/var/www/maps`, checks the
Cloudflare origin cert covers the subdomain (stops if not), installs the nginx
site (`nginx -t` gates the reload; a failing config is disabled again), commits
`/etc/nginx` by file name, installs the deploy script, creates and authorizes a
locked-down deploy key, sets the three repo secrets, and runs a test deploy.
Each step checks first, so it's safe to re-run after fixing whatever stopped it.

## Notes

- nginx config changes are not auto-deployed. If you edit
  `deploy/maps.nginx.conf`, copy it in and run `nginx -t` by hand; the
  deploy log warns when it changed.
- If you edit `deploy/maps-deploy.sh`, re-run its `install` line (step 6 of
  the setup script) so the server uses the new version.
- To turn auto-deploy off, delete that key's line from `/root/.ssh/authorized_keys`.
- Cloudflare caches static files at the edge. If a deploy doesn't show up,
  purge the cache for maps.dibberlab.me or bump a `?v=` on the changed
  script in `index.html`.
