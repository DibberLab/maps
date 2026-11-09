#!/usr/bin/env bash
# Runs every test against a local copy of the site and API, each browser suite
# on a fresh database.   bash tools/run_all.sh [path-to-venv]
# The venv needs server/requirements.txt installed (python3 -m venv v && v/bin/pip install -r server/requirements.txt).
set -u
cd "$(dirname "$0")/.."
VENV=${1:-.venv}
OUT=${OUT:-$(mktemp -d)}
PORT=8766 URL=http://127.0.0.1:8766/
fail=0
start(){
  pkill -f "gunicorn.*127.0.0.1:$PORT" 2>/dev/null; sleep 0.5   # a test server left from an earlier run
  rm -f "$OUT"/test.db*
  (cd server && LF_DB="$OUT/test.db" LF_ADMIN_EMAILS=boss@example.com,tester@example.com LF_COOKIE_SECURE=0 LF_STATIC="$PWD/../site" \
    "$OLDPWD/$VENV/bin/gunicorn" -w 2 -b 127.0.0.1:$PORT app:app >"$OUT/gunicorn.log" 2>&1 & echo $! >"$OUT/pid")
  for _ in $(seq 1 20); do curl -sf "${URL}api/health" >/dev/null && return; sleep 0.5; done
  echo "API did not start:"; cat "$OUT/gunicorn.log"; exit 1
}
stop(){ kill "$(cat "$OUT/pid")" 2>/dev/null; sleep 0.5; }
run(){ echo "== $*"; "$@" || fail=1; }
run node tools/test_geo.js
run "$VENV/bin/python" server/test_app.py
for t in smoke smoke_tools smoke_offline smoke_accounts smoke_discgolf smoke_route smoke_dg; do start; run node tools/$t.js "$URL" "$OUT"; stop; done
echo; [ $fail = 0 ] && echo "ALL SUITES PASSED" || echo "SOME SUITES FAILED (screenshots and logs in $OUT)"
exit $fail
