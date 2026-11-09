#!/usr/bin/env bash
# One-time setup for the disc golf app at <subdomain>.discjerkers.com. Run on Andrew's Mac (the only place with the
# droplet SSH key), from a clone of DibberLab/maps, once the disc golf code is on main:
#
#   bash deploy/setup-discgolf-from-mac.sh <subdomain>        e.g.  bash deploy/setup-discgolf-from-mac.sh fairway
#
# It serves the same checkout (/var/www/maps/site) and the same API as maps.dibberlab.me under the new name, so
# deploys of main update both. Nothing new to install: no new key, no new GitHub secrets.
# Safe to re-run: every step checks before it changes anything.
set -euo pipefail

SUB=${1:-}
if ! [[ "$SUB" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]]; then
  echo "Usage: bash deploy/setup-discgolf-from-mac.sh <subdomain>   (lowercase letters, numbers, dashes)"; exit 1
fi
NAME=$SUB.discjerkers.com
d() { ssh dibberlab-droplet "$@"; }

echo "== 1. connection"
d 'hostname && uptime'

echo "== 2. the code is there and up to date"
d 'cd /var/www/maps && git pull --ff-only origin main && git log -1 --oneline && test -f deploy/discgolf.nginx.conf && test -f site/js/flavor.js'

echo "== 3. origin certificate covers $NAME?"
if ! d "openssl x509 -in /etc/ssl/cloudflare/discjerkers.com.pem -noout -ext subjectAltName" \
     | grep -Eq "DNS:(\*\.discjerkers\.com|$SUB\.discjerkers\.com)"; then
  echo "!!! /etc/ssl/cloudflare/discjerkers.com.pem does not cover $NAME."
  echo "    Make a Cloudflare origin cert for *.discjerkers.com (Cloudflare > SSL/TLS > Origin Server),"
  echo "    put it at that path (and the key at discjerkers.com.key), then re-run. Stopping before nginx is touched."
  exit 1
fi

echo "== 4. nginx site (nginx -t gates the reload; a bad config is rolled back)"
d "set -e
   sed 's/SUBDOMAIN/$SUB/g' /var/www/maps/deploy/discgolf.nginx.conf > /etc/nginx/sites-available/discgolf
   ln -sfn /etc/nginx/sites-available/discgolf /etc/nginx/sites-enabled/discgolf
   if nginx -t; then systemctl reload nginx
   else rm -f /etc/nginx/sites-enabled/discgolf; echo 'nginx -t failed; site disabled again'; exit 1; fi"

echo "== 5. commit /etc/nginx (files staged by name)"
d "cd /etc/nginx && git add sites-available/discgolf sites-enabled/discgolf &&
   { git diff --cached --quiet || git commit -m 'add $NAME (disc golf app)'; } && git push origin main"

echo "== 6. check it answers"
sleep 2
curl -fsS -o /dev/null -w "page: %{http_code}\n" "https://$NAME/" || echo "!!! the page didn't answer yet (Cloudflare can take a minute)"
curl -fsS "https://$NAME/api/health" && echo || echo "!!! the API didn't answer through $NAME"

echo
echo "Done. Open https://$NAME on your phone and sign in with your Line Fence account:"
echo "your courses, rounds and throws come along."
