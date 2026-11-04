#!/usr/bin/env bash
# Server-side deploy for maps.dibberlab.me.
#
# GitHub Actions runs this over SSH after every push to main. The deploy key in
# /root/.ssh/authorized_keys is locked to this one script, so the key can't be
# used for anything else.
#
# Install (once, on the droplet):
#   install -m 755 /var/www/maps/deploy/maps-deploy.sh /usr/local/bin/maps-deploy
#
# The installed copy lives outside the repo on purpose: a push to main can't
# change what root runs here. Re-run the install line if you edit this file.
#
# Static site: nginx serves site/ straight from the checkout, so a pull is the
# whole deploy. No restart, no nginx reload. nginx config changes are NOT
# deployed by this script; those go through nginx -t by hand.
set -euo pipefail

APP_DIR=/var/www/maps
cd "$APP_DIR"

before=$(git rev-parse HEAD)
git pull --ff-only origin main
after=$(git rev-parse HEAD)
echo ">>> $before -> $after"

if ! git diff --quiet "$before" "$after" -- deploy/maps.nginx.conf; then
    echo "!!! deploy/maps.nginx.conf changed. Install it by hand (nginx -t first)."
fi

# The API (server/): reinstall packages if they changed, restart if any of it changed.
if [ -d .venv ]; then
    if ! git diff --quiet "$before" "$after" -- server/requirements.txt; then
        echo ">>> server/requirements.txt changed, installing packages"
        .venv/bin/pip install --quiet -r server/requirements.txt
    fi
    if ! git diff --quiet "$before" "$after" -- server/; then
        systemctl restart linefence-api
        echo ">>> restarted linefence-api"
    fi
    for _ in $(seq 1 10); do
        api=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8010/api/health || true)
        [ "$api" = "200" ] && break
        sleep 1
    done
    if [ "$api" != "200" ]; then
        echo "!!! linefence-api is not answering. Recent logs:"
        journalctl -u linefence-api --since "-2min" --no-pager | tail -30
        exit 1
    fi
    echo ">>> API is up"
fi

# Check nginx serves the page locally, bypassing Cloudflare.
code=$(curl -sk -o /dev/null -w '%{http_code}' \
    --resolve maps.dibberlab.me:443:127.0.0.1 \
    https://maps.dibberlab.me/ || true)
if [ "$code" = "200" ]; then
    echo ">>> maps is up (HTTP $code) at $(git log -1 --format='%h %s')"
    exit 0
fi
echo "!!! maps answered HTTP ${code:-none} locally"
exit 1
