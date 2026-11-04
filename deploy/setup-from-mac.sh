#!/usr/bin/env bash
# One-time setup for maps.dibberlab.me. Run on Andrew's Mac (the only place
# with the droplet SSH key), from a clone of DibberLab/maps:
#
#   bash deploy/setup-from-mac.sh
#
# Safe to re-run: every step checks before it changes anything.
# Needs: ssh alias dibberlab-droplet, gh logged in with admin on DibberLab/maps.
set -euo pipefail

R=DibberLab/maps
NAME=maps.dibberlab.me
CERT=/etc/ssl/cloudflare/$NAME
H=$(ssh -G dibberlab-droplet | awk '/^hostname /{print $2}')   # never hard-code the IP: the site sits behind Cloudflare
KEY=~/.ssh/maps-gh-deploy
d() { ssh dibberlab-droplet "$@"; }

echo "== 1. connection"
d 'hostname && uptime'

echo "== 2. checkout at /var/www/maps"
d "test -d /var/www/maps/.git || git clone https://github.com/$R.git /var/www/maps"
d 'cd /var/www/maps && git pull --ff-only origin main && git log -1 --oneline'

echo "== 3. origin certificate for $NAME"
# Use $CERT.pem if it exists; otherwise link any existing Cloudflare cert that
# covers *.dibberlab.me. Stop before touching nginx if neither works.
d "set -e
   covers() { openssl x509 -in \"\$1\" -noout -ext subjectAltName 2>/dev/null | grep -Eq 'DNS:(\*\.dibberlab\.me|maps\.dibberlab\.me)'; }
   if [ -f $CERT.pem ] && covers $CERT.pem; then echo 'cert ok'; exit 0; fi
   for pem in /etc/ssl/cloudflare/*.pem; do
     [ -f \"\$pem\" ] && [ -f \"\${pem%.pem}.key\" ] && covers \"\$pem\" || continue
     ln -sfn \"\$pem\" $CERT.pem; ln -sfn \"\${pem%.pem}.key\" $CERT.key
     echo \"linked \$pem (covers *.dibberlab.me)\"; exit 0
   done
   echo '!!! No cert covers $NAME.'
   echo '    Cloudflare > dibberlab.me > SSL/TLS > Origin Server > Create Certificate'
   echo '    for maps.dibberlab.me (or *.dibberlab.me), then save it on the droplet as'
   echo '    $CERT.pem and $CERT.key (chmod 600 the key), and re-run this script.'
   exit 1"

echo "== 3b. accounts API (server/app.py) as the linefence service"
# The admin email is asked once and kept on the server in /etc/linefence.env,
# never in this (public) repo. Signing up with it makes that account an approved admin.
if ! d 'test -f /etc/linefence.env'; then
    read -rp "Your email for the Line Fence admin account: " ADMIN
    case "$ADMIN" in *@*.*) ;; *) echo "!!! That doesn't look like an email. Re-run to try again."; exit 1;; esac
fi
d "set -e
   id linefence >/dev/null 2>&1 || useradd --system --home /var/lib/linefence --shell /usr/sbin/nologin linefence
   install -d -o linefence -g linefence -m 750 /var/lib/linefence
   cd /var/www/maps
   [ -x .venv/bin/python ] || python3 -m venv .venv
   .venv/bin/pip install --quiet -r server/requirements.txt
   if [ ! -f /etc/linefence.env ]; then
     printf 'LF_DB=/var/lib/linefence/linefence.db\nLF_ADMIN_EMAILS=%s\n' '${ADMIN:-}' > /etc/linefence.env
     chgrp linefence /etc/linefence.env; chmod 640 /etc/linefence.env
   fi
   install -m 644 deploy/linefence-api.service /etc/systemd/system/linefence-api.service
   systemctl daemon-reload
   systemctl enable --quiet linefence-api
   systemctl restart linefence-api
   install -m 755 deploy/linefence-backup /etc/cron.daily/linefence-backup
   for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf http://127.0.0.1:8010/api/health >/dev/null && break; sleep 1; done
   curl -sf http://127.0.0.1:8010/api/health >/dev/null || { journalctl -u linefence-api -n 30 --no-pager; exit 1; }
   echo 'API is up on 127.0.0.1:8010'"

echo "== 4. nginx site (nginx -t gates the reload; a bad config is rolled back)"
d 'set -e
   cp /var/www/maps/deploy/maps.nginx.conf /etc/nginx/sites-available/maps
   ln -sfn /etc/nginx/sites-available/maps /etc/nginx/sites-enabled/maps
   if nginx -t; then systemctl reload nginx
   else rm -f /etc/nginx/sites-enabled/maps; echo "nginx -t failed; site disabled again"; exit 1; fi'

echo "== 5. commit /etc/nginx (files staged by name)"
d "cd /etc/nginx && git add sites-available/maps sites-enabled/maps &&
   { git diff --cached --quiet || git commit -m 'add $NAME'; } && git push origin main"

echo "== 6. install the deploy script outside the repo"
d 'install -m 755 /var/www/maps/deploy/maps-deploy.sh /usr/local/bin/maps-deploy && /usr/local/bin/maps-deploy'

echo "== 7. GitHub deploy key, locked to that script"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "github-actions-maps-deploy" -f "$KEY"
PUB=$(cat "$KEY.pub")
d "grep -qF '$PUB' /root/.ssh/authorized_keys || echo 'command=\"/usr/local/bin/maps-deploy\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $PUB' >> /root/.ssh/authorized_keys"

echo "== 8. repository secrets"
gh secret set DEPLOY_HOST -R "$R" -b "$H"
gh secret set DEPLOY_SSH_KEY -R "$R" < "$KEY"
ssh-keyscan -t ed25519 "$H" 2>/dev/null | gh secret set DEPLOY_KNOWN_HOSTS -R "$R"

echo "== 9. test run"
gh workflow run Deploy -R "$R"
sleep 5
gh run watch -R "$R" "$(gh run list -R "$R" -w Deploy -L 1 --json databaseId -q '.[0].databaseId')" --exit-status

echo "== 10. public check through Cloudflare"
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$NAME/" || true)
if [ "$code" = "200" ]; then
    echo "https://$NAME is live."
    echo "Next: open https://$NAME, tap + then Sign in, and create your account with the admin email."
    echo "Your admin portal is https://$NAME/admin/"
else
    echo "!!! https://$NAME answered HTTP ${code:-none} from outside."
    echo "    No DNS answer: add a proxied A record 'maps' -> $H in Cloudflare (dibberlab.me)."
    echo "    526: Cloudflare doesn't trust the origin cert; recheck step 3."
fi
echo "GitHub has its copy of the key; you can now: rm $KEY"
