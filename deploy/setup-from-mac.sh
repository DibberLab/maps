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
else
    echo "!!! https://$NAME answered HTTP ${code:-none} from outside."
    echo "    No DNS answer: add a proxied A record 'maps' -> $H in Cloudflare (dibberlab.me)."
    echo "    526: Cloudflare doesn't trust the origin cert; recheck step 3."
fi
echo "GitHub has its copy of the key; you can now: rm $KEY"
