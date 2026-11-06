"""Line Fence account and sync server.

A small JSON API behind nginx at /api/ (same origin as the static site):
accounts with email + password, admin approval, and sync of waypoints,
tracks and drawings for approved accounts. SQLite, no other services.

Environment:
  LF_DB             path to the SQLite file (default ./linefence.db)
  LF_ADMIN_EMAILS   comma-separated emails that become approved admins when they sign up
  LF_COOKIE_SECURE  "0" to allow the session cookie over plain http (local testing only)
  LF_STATIC         serve this folder at / too (local testing only; nginx does it in production)
"""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from functools import wraps

from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

DB_PATH = os.environ.get("LF_DB", "linefence.db")
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("LF_ADMIN_EMAILS", "").split(",") if e.strip()}
COOKIE_SECURE = os.environ.get("LF_COOKIE_SECURE", "1") != "0"
STATIC = os.environ.get("LF_STATIC")
COOKIE = "lf_session"
SESSION_DAYS = 90
STORES = ("waypoints", "tracks", "drawings", "rounds", "throws")   # rounds / throws: disc golf
LOGIN_FAILS, LOGIN_WINDOW = 8, 15 * 60
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024   # photos ride along inside waypoints
# nginx (deploy/maps.nginx.conf) passes the visitor's address (already Cloudflare-corrected) in
# X-Forwarded-For; trust exactly that one hop so the login rate limit sees real visitors.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  pw TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','disabled')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  updated INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, store, id)
);
CREATE INDEX IF NOT EXISTS items_seq ON items (user_id, seq);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder TEXT NOT NULL,
  data TEXT NOT NULL,
  count INTEGER NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  UNIQUE (user_id, folder)
);
CREATE TABLE IF NOT EXISTS links (
  code TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  ip TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS links_ip ON links (ip, created);
CREATE TABLE IF NOT EXISTS live_rounds (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  data TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_fails (key TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS login_fails_key ON login_fails (key, ts);
"""


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA journal_mode = WAL")
    return g.db


@app.teardown_appcontext
def _close(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


now = lambda: int(time.time())
hash_token = lambda t: hashlib.sha256(t.encode()).hexdigest()


def err(msg, code=400):
    return jsonify(error=msg), code


def public(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"], "status": u["status"], "role": u["role"]}


# ---------- Sessions ----------

def current_user():
    if "user" in g:
        return g.user
    g.user = None
    tok = request.cookies.get(COOKIE)
    if tok:
        row = db().execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?",
            (hash_token(tok), now())).fetchone()
        if row and row["status"] != "disabled":
            g.user = row
            if not row["last_seen"] or now() - row["last_seen"] > 300:
                db().execute("UPDATE users SET last_seen = ? WHERE id = ?", (now(), row["id"]))
                db().commit()
    return g.user


def start_session(resp, user_id):
    tok = secrets.token_urlsafe(32)
    db().execute("INSERT INTO sessions VALUES (?, ?, ?, ?)", (hash_token(tok), user_id, now(), now() + SESSION_DAYS * 86400))
    db().commit()
    resp.set_cookie(COOKIE, tok, max_age=SESSION_DAYS * 86400, httponly=True, secure=COOKIE_SECURE, samesite="Lax", path="/")
    return resp


def needs(level):
    """level: 'user' (any signed-in account), 'approved', or 'admin'."""
    def deco(view):
        @wraps(view)
        def wrapper(*a, **kw):
            u = current_user()
            if not u:
                return err("Sign in first.", 401)
            if level == "approved" and u["status"] != "approved":
                return err("Your account is waiting for approval.", 403)
            if level == "admin" and (u["role"] != "admin" or u["status"] != "approved"):
                return err("Admins only.", 403)
            return view(*a, **kw)
        return wrapper
    return deco


@app.before_request
def _csrf():
    # Writes must be JSON (a cross-site form can't send that without CORS) and,
    # when the browser says where it came from, from this site.
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.path.startswith("/api/"):
        if not request.is_json:
            return err("Expected JSON.", 415)
        origin = request.headers.get("Origin")
        if origin and origin.split("://", 1)[-1] != request.host:
            return err("Wrong origin.", 403)


@app.after_request
def _no_store(resp):
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------- Accounts ----------

def body():
    return request.get_json(silent=True) or {}


def check_password_rules(pw):
    if not isinstance(pw, str) or len(pw) < 8:
        return "Use a password of at least 8 characters."
    if len(pw) > 200:
        return "That password is too long."
    return None


def too_many_fails(*keys):
    cutoff = now() - LOGIN_WINDOW
    db().execute("DELETE FROM login_fails WHERE ts < ?", (cutoff,))
    for k in keys:
        n = db().execute("SELECT COUNT(*) FROM login_fails WHERE key = ? AND ts >= ?", (k, cutoff)).fetchone()[0]
        if n >= LOGIN_FAILS:
            return True
    return False


@app.get("/api/health")
def health():
    db().execute("SELECT 1")
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    u = current_user()
    return jsonify(user=public(u) if u else None)


@app.post("/api/signup")
def signup():
    b = body()
    email = str(b.get("email", "")).strip().lower()
    name = str(b.get("name", "")).strip()[:80]
    pw = b.get("password", "")
    if not EMAIL_RE.match(email):
        return err("Enter a valid email address.")
    problem = check_password_rules(pw)
    if problem:
        return err(problem)
    if too_many_fails("signup:" + (request.remote_addr or "")):
        return err("Too many tries. Wait a few minutes and try again.", 429)
    admin = email in ADMIN_EMAILS
    try:
        cur = db().execute(
            "INSERT INTO users (email, name, pw, status, role, created) VALUES (?, ?, ?, ?, ?, ?)",
            (email, name, generate_password_hash(pw), "approved" if admin else "pending", "admin" if admin else "user", now()))
    except sqlite3.IntegrityError:
        db().execute("INSERT INTO login_fails VALUES (?, ?)", ("signup:" + (request.remote_addr or ""), now()))
        db().commit()
        return err("An account with that email already exists. Sign in instead.", 409)
    db().commit()
    u = db().execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return start_session(jsonify(user=public(u)), u["id"])


@app.post("/api/login")
def login():
    b = body()
    email = str(b.get("email", "")).strip().lower()
    pw = str(b.get("password", ""))
    keys = ("ip:" + (request.remote_addr or ""), "email:" + email)
    if too_many_fails(*keys):
        return err("Too many tries. Wait 15 minutes and try again.", 429)
    u = db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not u or not check_password_hash(u["pw"], pw):
        for k in keys:
            db().execute("INSERT INTO login_fails VALUES (?, ?)", (k, now()))
        db().commit()
        return err("Wrong email or password.", 401)
    if u["status"] == "disabled":
        return err("This account has been turned off.", 403)
    db().execute("DELETE FROM login_fails WHERE key = ?", ("email:" + email,))
    return start_session(jsonify(user=public(u)), u["id"])


@app.post("/api/logout")
def logout():
    tok = request.cookies.get(COOKIE)
    if tok:
        db().execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(tok),))
        db().commit()
    resp = jsonify(ok=True)
    resp.delete_cookie(COOKIE, path="/")
    return resp


@app.post("/api/me/password")
@needs("user")
def change_password():
    b = body()
    u = current_user()
    if not check_password_hash(u["pw"], str(b.get("current", ""))):
        return err("Your current password is wrong.", 401)
    problem = check_password_rules(b.get("new", ""))
    if problem:
        return err(problem)
    db().execute("UPDATE users SET pw = ? WHERE id = ?", (generate_password_hash(b["new"]), u["id"]))
    db().execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", (u["id"], hash_token(request.cookies.get(COOKIE, ""))))
    db().commit()
    return jsonify(ok=True)


# ---------- Settings (map layers and base map, per account) ----------

@app.get("/api/me/settings")
@needs("user")
def get_settings():
    row = db().execute("SELECT data, updated FROM settings WHERE user_id = ?", (current_user()["id"],)).fetchone()
    return jsonify(settings=json.loads(row["data"]) if row else None, updated=row["updated"] if row else None)


@app.post("/api/me/settings")
@needs("user")
def put_settings():
    st = body().get("settings")
    if not isinstance(st, dict):
        return err("Send settings as an object.")
    data = json.dumps(st, separators=(",", ":"))
    if len(data) > 8192:
        return err("Settings are too large.")
    db().execute("INSERT INTO settings (user_id, data, updated) VALUES (?, ?, ?) "
                 "ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated",
                 (current_user()["id"], data, now()))
    db().commit()
    return jsonify(ok=True)


# ---------- Sync ----------

@app.get("/api/sync")
@needs("approved")
def pull():
    """Everything changed since `since` (a seq number this server handed out)."""
    u = current_user()
    since = request.args.get("since", default=0, type=int)
    rows = db().execute(
        "SELECT store, id, data, updated, deleted, seq FROM items WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 300",
        (u["id"], since)).fetchall()
    items = [{"store": r["store"], "id": r["id"], "updated": r["updated"], "deleted": bool(r["deleted"]),
              "data": None if r["deleted"] else json.loads(r["data"])} for r in rows]
    top = rows[-1]["seq"] if rows else since
    return jsonify(items=items, seq=top, more=len(rows) == 300)


@app.post("/api/sync")
@needs("approved")
def push():
    """Changes from a device. Newest `updated` wins; older changes are ignored."""
    u = current_user()
    changes = body().get("changes")
    if not isinstance(changes, list) or len(changes) > 500:
        return err("Send up to 500 changes at a time.")
    conn = db()
    conn.execute("BEGIN IMMEDIATE")
    seq = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM items").fetchone()[0]
    accepted = 0
    for c in changes:
        if not isinstance(c, dict):
            continue
        store, rid, updated = c.get("store"), c.get("id"), c.get("updated")
        if store not in STORES or not isinstance(rid, str) or not (0 < len(rid) <= 64) or not isinstance(updated, (int, float)):
            continue
        deleted = bool(c.get("deleted"))
        data = None if deleted else c.get("data")
        if not deleted and not isinstance(data, dict):
            continue
        cur = conn.execute("SELECT updated FROM items WHERE user_id = ? AND store = ? AND id = ?", (u["id"], store, rid)).fetchone()
        if cur and cur["updated"] > updated:
            continue
        seq += 1
        conn.execute(
            "INSERT INTO items (user_id, store, id, data, updated, deleted, seq) VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (user_id, store, id) DO UPDATE SET data = excluded.data, updated = excluded.updated, "
            "deleted = excluded.deleted, seq = excluded.seq",
            (u["id"], store, rid, None if deleted else json.dumps(data, separators=(",", ":")), int(updated), int(deleted), seq))
        accepted += 1
    conn.commit()
    return jsonify(accepted=accepted, seq=seq)


# ---------- Shared folders ----------
# An approved account publishes a copy of one folder's items; anyone with the link (/#share=<id>) can view it.
# Publishing the same folder again replaces the copy and keeps the link. Only the owner's display name is shown.
SHARE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,32}$")
MAX_SHARE_ITEMS = 2000


@app.post("/api/shares")
@needs("approved")
def share_folder():
    u = current_user()
    b = body()
    folder, items = b.get("folder"), b.get("items")
    if not isinstance(folder, str) or not (0 < len(folder.strip()) <= 200):
        return err("Name the folder to share.")
    if not isinstance(items, list) or not (0 < len(items) <= MAX_SHARE_ITEMS):
        return err(f"Share 1 to {MAX_SHARE_ITEMS} items.")
    clean = [{"store": i["store"], "data": i["data"]} for i in items
             if isinstance(i, dict) and i.get("store") in STORES and isinstance(i.get("data"), dict)]
    if not clean:
        return err("Nothing to share.")
    data = json.dumps(clean, separators=(",", ":"))
    folder = folder.strip()
    conn = db()
    row = conn.execute("SELECT id FROM shares WHERE user_id = ? AND folder = ?", (u["id"], folder)).fetchone()
    if row:
        sid = row["id"]
        conn.execute("UPDATE shares SET data = ?, count = ?, updated = ? WHERE id = ?", (data, len(clean), now(), sid))
    else:
        sid = secrets.token_urlsafe(9)
        conn.execute("INSERT INTO shares VALUES (?, ?, ?, ?, ?, ?, ?)", (sid, u["id"], folder, data, len(clean), now(), now()))
    conn.commit()
    return jsonify(id=sid, folder=folder, count=len(clean))


@app.get("/api/shares")
@needs("approved")
def my_shares():
    rows = db().execute("SELECT id, folder, count, updated FROM shares WHERE user_id = ? ORDER BY folder",
                        (current_user()["id"],)).fetchall()
    return jsonify(shares=[dict(r) for r in rows])


@app.get("/api/shares/<sid>")
def view_share(sid):
    if not SHARE_ID_RE.match(sid):
        return err("Not found.", 404)
    row = db().execute("SELECT s.folder, s.data, s.count, s.updated, u.name FROM shares s JOIN users u ON u.id = s.user_id "
                       "WHERE s.id = ? AND u.status != 'disabled'", (sid,)).fetchone()
    if not row:
        return err("This shared folder was removed or never existed.", 404)
    return jsonify(id=sid, folder=row["folder"], by=(row["name"] or "").strip() or "A Line Fence user",
                   count=row["count"], updated=row["updated"], items=json.loads(row["data"]))


@app.delete("/api/shares/<sid>")
@needs("approved")
def unshare(sid):
    cur = db().execute("DELETE FROM shares WHERE id = ? AND user_id = ?", (sid, current_user()["id"]))
    db().commit()
    if not cur.rowcount:
        return err("Not found.", 404)
    return jsonify(ok=True)


# ---------- Short links ----------
# The app's links carry everything in the #hash (view, layers, pin, share…), so they get long. A short link stores
# that hash under a 6-character code: /api/s/<code> redirects to /#<hash>. The same hash always gets the same code.
# Anyone may make one (spot sharing is open to all), up to LINKS_PER_HOUR per visitor.
LINK_HASH_RE = re.compile(r"^#[A-Za-z0-9=&%/.,_~+:-]{1,1500}$")
LINK_CODE_RE = re.compile(r"^[A-Za-z0-9]{4,12}$")
LINKS_PER_HOUR = 120
CODE_ABC = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O, 1/l/I


@app.post("/api/links")
def make_link():
    h = body().get("hash")
    if not isinstance(h, str) or not LINK_HASH_RE.match(h):
        return err("That link can't be shortened.")
    conn = db()
    row = conn.execute("SELECT code FROM links WHERE hash = ?", (h,)).fetchone()
    if row:
        return jsonify(code=row["code"], path="/api/s/" + row["code"])
    ip = request.remote_addr or ""
    if conn.execute("SELECT COUNT(*) FROM links WHERE ip = ? AND created > ?", (ip, now() - 3600)).fetchone()[0] >= LINKS_PER_HOUR:
        return err("Too many links for now; try again later.", 429)
    for _ in range(8):
        code = "".join(secrets.choice(CODE_ABC) for _ in range(6))
        try:
            conn.execute("INSERT INTO links VALUES (?, ?, ?, ?)", (code, h, ip, now()))
            conn.commit()
            return jsonify(code=code, path="/api/s/" + code)
        except sqlite3.IntegrityError:
            conn.rollback()
    return err("Could not make a short link; try again.", 500)


@app.get("/api/s/<code>")
def follow_link(code):
    row = db().execute("SELECT hash FROM links WHERE code = ?", (code,)).fetchone() if LINK_CODE_RE.match(code) else None
    resp = app.response_class(status=302)
    resp.headers["Location"] = "/" + (row["hash"] if row else "")   # an unknown code just opens the map
    return resp


# ---------- Live disc golf rounds ----------
# A round someone invites others to: everyone with the link (/#round=<id>) can see it and enter scores, no account
# needed (the link is the key). Each score is its own small update, so two phones scoring at once never overwrite
# each other; phones poll with ?since=<version> and get the round only when it changed.
ROUND_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,32}$")


def _round(rid):
    if not ROUND_ID_RE.match(rid):
        return None
    return db().execute("SELECT * FROM live_rounds WHERE id = ?", (rid,)).fetchone()


@app.post("/api/rounds")
@needs("approved")
def start_live_round():
    r = body().get("round")
    if not isinstance(r, dict) or not isinstance(r.get("holes"), list) or not isinstance(r.get("sides"), list) \
            or not (0 < len(r["holes"]) <= 54) or not (0 < len(r["sides"]) <= 24):
        return err("That isn't a round.")
    keep = {k: r.get(k) for k in ("name", "folder", "format", "holes", "sides", "scores", "started", "finished")}
    rid = secrets.token_urlsafe(9)
    db().execute("INSERT INTO live_rounds VALUES (?, ?, ?, 1, ?, ?)", (rid, current_user()["id"], json.dumps(keep), now(), now()))
    db().commit()
    return jsonify(id=rid, version=1)


@app.get("/api/rounds/<rid>")
def get_live_round(rid):
    row = _round(rid)
    if not row:
        return err("This round was removed or the link is wrong.", 404)
    since = request.args.get("since", default=0, type=int)
    if since and since == row["version"]:
        return jsonify(id=rid, version=row["version"], same=True)
    return jsonify(id=rid, version=row["version"], round=json.loads(row["data"]))


@app.post("/api/rounds/<rid>")
def change_live_round(rid):
    """Changes: [{side, hole, value}] scores (value null clears), [{hole, par}] pars, {finished: ms|null}."""
    b = body()
    conn = db()
    conn.execute("BEGIN IMMEDIATE")
    row = _round(rid)
    if not row:
        conn.rollback()
        return err("This round was removed or the link is wrong.", 404)
    r = json.loads(row["data"])
    nholes, sides = len(r["holes"]), {s.get("id") for s in r["sides"] if isinstance(s, dict)}
    for c in (b.get("scores") or [])[:500]:
        h, sid, v = c.get("hole"), c.get("side"), c.get("value")
        if sid in sides and isinstance(h, int) and 0 <= h < nholes and (v is None or (isinstance(v, int) and 1 <= v <= 20)):
            r.setdefault("scores", {}).setdefault(sid, [None] * nholes)[h] = v
    for c in (b.get("pars") or [])[:100]:
        h, p = c.get("hole"), c.get("par")
        if isinstance(h, int) and 0 <= h < nholes and isinstance(p, int) and 2 <= p <= 7:
            r["holes"][h]["par"] = p
    if "finished" in b and (b["finished"] is None or isinstance(b["finished"], (int, float))):
        r["finished"] = b["finished"]
    conn.execute("UPDATE live_rounds SET data = ?, version = version + 1, updated = ? WHERE id = ?", (json.dumps(r), now(), rid))
    conn.commit()
    v = conn.execute("SELECT version FROM live_rounds WHERE id = ?", (rid,)).fetchone()[0]
    return jsonify(id=rid, version=v, round=r)


# ---------- Admin ----------

# ---------- Public disc golf courses ----------
# Admins add a course's layout (Menu > Disc golf courses > Add course); everyone sees it on the disc golf layer.
COURSE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,32}$")


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


def _clean_course(c):
    """The course as stored, or None when it isn't one: {name, c:[lat,lng], holes:[{n, par, ft, line, anchors}], address, notes}.
    pin [lat,lng] places the course pin by hand (otherwise it's the middle of the holes). A course with a pin and no holes
    only moves an OpenStreetMap course's pin; the layer keeps that course's own holes."""
    if not isinstance(c, dict) or not isinstance(c.get("name"), str) or not c["name"].strip():
        return None
    pin = c.get("pin")
    pin = [round(pin[0], 7), round(pin[1], 7)] if isinstance(pin, list) and len(pin) == 2 and _num(pin[0], -90, 90) and _num(pin[1], -180, 180) else None
    holes = c.get("holes")
    if not isinstance(holes, list) or len(holes) > 54 or (not holes and not pin):
        return None
    out = []
    for h in holes:
        line = h.get("line") if isinstance(h, dict) else None
        if not isinstance(line, list) or not (2 <= len(line) <= 300) or not all(
                isinstance(p, list) and len(p) >= 2 and _num(p[0], -90, 90) and _num(p[1], -180, 180) for p in line):
            return None
        par = h.get("par") if _num(h.get("par"), 1, 9) else 3
        ft = h.get("ft") if _num(h.get("ft"), 1, 5000) else None
        anchors = [a for a in (h.get("anchors") or []) if isinstance(a, int) and 0 < a < len(line) - 1][:50]
        out.append({"n": str(h.get("n") or len(out) + 1)[:6], "par": int(par), "ft": ft and int(ft),
                    "line": [[round(p[0], 7), round(p[1], 7)] for p in line], "anchors": anchors})
    pts = [p for h in out for p in h["line"]]
    center = pin or [round(sum(p[0] for p in pts) / len(pts), 6), round(sum(p[1] for p in pts) / len(pts), 6)]
    text = lambda k, n: (c.get(k) or "").strip()[:n] if isinstance(c.get(k), str) else ""
    return {"name": c["name"].strip()[:80], "c": center, "pin": pin, "holes": out, "address": text("address", 120), "notes": text("notes", 1000)}


@app.get("/api/courses")
def list_courses():
    rows = db().execute("SELECT id, data, updated FROM courses ORDER BY created").fetchall()
    resp = jsonify(courses=[dict(json.loads(r["data"]), id=r["id"], updated=r["updated"]) for r in rows])
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.post("/api/courses")
@needs("admin")
def save_course():
    b = body()
    c = _clean_course(b.get("course"))
    if not c:
        return err("That isn't a course layout.")
    cid = b.get("id")
    if cid is not None:
        if not isinstance(cid, str) or not COURSE_ID_RE.match(cid) or \
                not db().execute("SELECT 1 FROM courses WHERE id = ?", (cid,)).fetchone():
            return err("No such course.", 404)
        db().execute("UPDATE courses SET data = ?, updated = ? WHERE id = ?", (json.dumps(c), now(), cid))
    else:
        cid = secrets.token_urlsafe(9)
        db().execute("INSERT INTO courses VALUES (?, ?, ?, ?, ?)", (cid, current_user()["id"], json.dumps(c), now(), now()))
    db().commit()
    return jsonify(id=cid, course=c)


# Reading a course's pars and distances from a screenshot (Add course > Read from a screenshot): the picture goes to
# Claude, which returns the holes as JSON. Needs ANTHROPIC_API_KEY in /etc/linefence.env (never in this repo).
TABLE_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean", "description": "False when the picture shows no hole list with pars"},
        "layout": {"type": "string", "description": "Layout or course name shown with the table, or empty"},
        "holes": {"type": "array", "items": {
            "type": "object",
            "properties": {"n": {"type": "string"}, "par": {"type": "integer"}, "ft": {"type": ["integer", "null"]}},
            "required": ["n", "par", "ft"], "additionalProperties": False}},
    },
    "required": ["found", "layout", "holes"],
    "additionalProperties": False,
}
TABLE_PROMPT = (
    "This is a screenshot of a disc golf course's hole list (for example from UDisc): rows of hole numbers, distances "
    "and pars, often split into several blocks of 9. List every hole in hole order with its number as shown, its par, "
    "and its distance in feet (null if no distance is shown; convert metres to feet if the table is in metres). "
    "Read the numbers exactly as printed; don't guess missing ones. Put the layout or course name in layout if one "
    "is shown above the table. If the picture doesn't show a hole list, set found to false and holes to an empty list."
)


def ask_claude(data, media_type, prompt, schema):
    """One picture and a question to Claude; the answer as JSON matching schema."""
    import anthropic
    # ANTHROPIC_API_KEY from the environment. One try, 45 s: inside nginx's 60 s and gunicorn's --timeout 60.
    client = anthropic.Anthropic(timeout=45.0, max_retries=0)
    resp = client.beta.messages.create(
        model="claude-opus-5-5",
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
            {"type": "text", "text": prompt},
        ]}],
    )
    if resp.stop_reason == "refusal":
        raise ValueError("Claude declined to read that picture.")
    if resp.stop_reason == "max_tokens":
        raise ValueError("That table was too long to read in one go.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text)


def _picture(b):
    """(data, media_type) from a request body, or None."""
    data, media_type = b.get("data"), b.get("media_type")
    if not isinstance(data, str) or media_type not in ("image/jpeg", "image/png", "image/webp", "image/gif") or not (100 < len(data) <= 7_000_000):
        return None
    return data, media_type


def _claude(fn):
    """Runs a Claude call and turns its failures into plain answers for the phone."""
    import anthropic
    try:
        return fn(), None
    except anthropic.AuthenticationError:
        return None, err("The server's Claude API key was refused. Check the key.", 502)
    except anthropic.RateLimitError:
        return None, err("Claude is busy right now. Try again in a minute.", 503)
    except anthropic.APITimeoutError:
        return None, err("Claude took too long. Try again, or crop the picture.", 504)
    except (anthropic.APIConnectionError, anthropic.InternalServerError):
        return None, err("Couldn't reach Claude. Try again.", 502)
    except anthropic.APIStatusError as e:
        return None, err(f"Claude couldn't read it ({e.status_code}).", 502)
    except ValueError as e:
        return None, err(str(e) or "Claude's answer wasn't readable. Try again.", 502)


@app.post("/api/courses/read")
@needs("admin")
def read_course_table():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return err("Reading screenshots needs a Claude API key on the server. See the setup steps.", 503)
    pic = _picture(body())
    if not pic:
        return err("Send the screenshot as a JPEG or PNG under 5 MB.")
    got, bad = _claude(lambda: ask_claude(*pic, TABLE_PROMPT, TABLE_SCHEMA))
    if bad:
        return bad
    holes = [{"n": str(h.get("n") or i + 1)[:6], "par": int(h["par"]), "ft": int(h["ft"]) if h.get("ft") else None}
             for i, h in enumerate(got.get("holes") or []) if isinstance(h, dict) and _num(h.get("par"), 1, 9)][:54]
    if not got.get("found") or not holes:
        return err("Couldn't find a list of holes with pars in that picture.", 422)
    return jsonify(holes=holes, layout=(got.get("layout") or "")[:80])


# Finding the holes on a layout picture (Add course): where each hole's tee pad, bends and basket are, in the
# picture's own pixels. The phone then lines the picture up with the aerial, so Claude never has to guess places.
PT = {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}}, "required": ["x", "y"], "additionalProperties": False}
LAYOUT_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"},
        "holes": {"type": "array", "items": {
            "type": "object",
            "properties": {"n": {"type": "string"}, "tee": PT, "bends": {"type": "array", "items": PT}, "basket": PT},
            "required": ["n", "tee", "bends", "basket"], "additionalProperties": False}},
    },
    "required": ["found", "holes"],
    "additionalProperties": False,
}


def layout_prompt(w, h, count):
    return (
        f"This is a disc golf course layout map (for example a UDisc screenshot), {w} by {h} pixels. Each hole is drawn as a "
        "line from a tee pad (usually a small rectangle, often where the hole number sits near the start) to a basket "
        "(a basket icon, often labelled Main, Long or Short). "
        + (f"The course has {count} holes. " if count else "")
        + "For every hole you can see, give its number and the pixel coordinates (x from the left edge, y from the top "
        "edge, in this image's pixels) of the centre of its tee pad, of the basket icon's base, and of any points where "
        "the hole's line bends, in order from tee to basket (an empty list if it's straight). When a hole has two "
        "baskets or tees, use the one labelled Main. Leave out holes you can't find rather than guessing. Set found to "
        "false if this isn't a course layout map."
    )


@app.post("/api/courses/locate")
@needs("admin")
def locate_course_holes():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return err("Finding holes needs a Claude API key on the server. See the setup steps.", 503)
    b = body()
    pic, w, h = _picture(b), b.get("width"), b.get("height")
    if not pic or not _num(w, 50, 4000) or not _num(h, 50, 4000):
        return err("Send the layout picture as a JPEG or PNG under 5 MB, with its size.")
    count = b.get("count") if _num(b.get("count"), 1, 54) else None
    got, bad = _claude(lambda: ask_claude(*pic, layout_prompt(int(w), int(h), count and int(count)), LAYOUT_SCHEMA))
    if bad:
        return bad
    inside = lambda p: isinstance(p, dict) and _num(p.get("x"), -5, w + 5) and _num(p.get("y"), -5, h + 5)
    pt = lambda p: [round(min(max(p["x"], 0), w), 1), round(min(max(p["y"], 0), h), 1)]
    holes = []
    for x in (got.get("holes") or [])[:60]:
        if not isinstance(x, dict) or not inside(x.get("tee")) or not inside(x.get("basket")):
            continue
        bends = [pt(p) for p in (x.get("bends") or [])[:20] if inside(p)]
        holes.append({"n": str(x.get("n") or "")[:6], "points": [pt(x["tee"])] + bends + [pt(x["basket"])]})
    if not got.get("found") or not holes:
        return err("Couldn't find the holes in that picture. Mark them by tapping instead.", 422)
    return jsonify(holes=holes)


@app.delete("/api/courses/<cid>")
@needs("admin")
def delete_course(cid):
    db().execute("DELETE FROM courses WHERE id = ?", (cid,))
    db().commit()
    return jsonify(ok=True)


@app.get("/api/admin/users")
@needs("admin")
def admin_users():
    rows = db().execute("""
      SELECT u.id, u.email, u.name, u.status, u.role, u.created, u.last_seen,
        (SELECT COUNT(*) FROM items i WHERE i.user_id = u.id AND i.deleted = 0 AND i.store = 'waypoints') AS waypoints,
        (SELECT COUNT(*) FROM items i WHERE i.user_id = u.id AND i.deleted = 0 AND i.store = 'tracks') AS tracks,
        (SELECT COUNT(*) FROM items i WHERE i.user_id = u.id AND i.deleted = 0 AND i.store = 'drawings') AS drawings,
        (SELECT COALESCE(SUM(LENGTH(i.data)), 0) FROM items i WHERE i.user_id = u.id AND i.deleted = 0) AS bytes
      FROM users u ORDER BY CASE u.status WHEN 'pending' THEN 0 ELSE 1 END, u.created DESC""").fetchall()
    return jsonify(users=[dict(r) for r in rows], me=current_user()["id"])


def target(uid):
    return db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()


@app.post("/api/admin/users/<int:uid>")
@needs("admin")
def admin_update(uid):
    u, b = target(uid), body()
    if not u:
        return err("No such account.", 404)
    if uid == current_user()["id"] and (b.get("status", "approved") != "approved" or b.get("role", "admin") != "admin"):
        return err("You can't turn off or demote your own account.")
    if "status" in b:
        if b["status"] not in ("pending", "approved", "disabled"):
            return err("Unknown status.")
        db().execute("UPDATE users SET status = ? WHERE id = ?", (b["status"], uid))
        if b["status"] == "disabled":
            db().execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    if "role" in b:
        if b["role"] not in ("user", "admin"):
            return err("Unknown role.")
        db().execute("UPDATE users SET role = ? WHERE id = ?", (b["role"], uid))
    db().commit()
    return jsonify(user=public(target(uid)))


@app.post("/api/admin/users/<int:uid>/reset")
@needs("admin")
def admin_reset(uid):
    u = target(uid)
    if not u:
        return err("No such account.", 404)
    temp = "-".join(secrets.token_hex(2) for _ in range(3))   # e.g. 3f9a-71c2-0bde
    db().execute("UPDATE users SET pw = ? WHERE id = ?", (generate_password_hash(temp), uid))
    db().execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    db().commit()
    return jsonify(password=temp)


@app.delete("/api/admin/users/<int:uid>")
@needs("admin")
def admin_delete(uid):
    if uid == current_user()["id"]:
        return err("You can't delete your own account.")
    db().execute("DELETE FROM users WHERE id = ?", (uid,))
    db().commit()
    return jsonify(ok=True)


# ---------- Local testing only ----------

if STATIC:
    @app.get("/")
    @app.get("/<path:path>")
    def static_files(path="index.html"):
        full = os.path.join(STATIC, path)
        if os.path.isdir(full):
            path = os.path.join(path, "index.html")
        return send_from_directory(STATIC, path)


init_db()
