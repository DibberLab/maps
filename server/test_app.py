"""API tests: python -m pytest-free runner.  Run:  python server/test_app.py"""
import json
import os
import re, sys, tempfile, json
fd, path = tempfile.mkstemp(suffix=".db"); os.close(fd)
os.environ.update(LF_DB=path, LF_ADMIN_EMAILS="boss@example.com", LF_COOKIE_SECURE="0")
sys.path.insert(0, os.path.dirname(__file__))
import app as srv

bad = 0
def check(ok, msg):
    global bad
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok: bad += 1

def client():
    return srv.app.test_client()

J = lambda c, method, url, data=None: getattr(c, method)(url, json=data) if data is not None or method != "get" else c.get(url)

admin, user, stranger = client(), client(), client()
r = J(admin, "post", "/api/signup", {"email": "Boss@Example.com", "password": "correct horse", "name": "Boss"})
check(r.status_code == 200 and r.json["user"]["status"] == "approved" and r.json["user"]["role"] == "admin", "listed admin email signs up approved admin")
r = J(user, "post", "/api/signup", {"email": "hunter@example.com", "password": "deerseason", "name": "Hunter"})
check(r.json["user"]["status"] == "pending", "new account waits for approval")
check(J(user, "post", "/api/signup", {"email": "x@example.com", "password": "short"}).status_code == 400, "short password refused")
check(J(stranger, "post", "/api/signup", {"email": "HUNTER@example.com", "password": "deerseason"}).status_code == 409, "duplicate email refused, any case")
check(user.get("/api/sync").status_code == 403, "pending account cannot sync")
check(J(user, "post", "/api/sync", {"changes": []}).status_code == 403, "pending account cannot save")
check(user.get("/api/admin/users").status_code == 403, "non-admin blocked from admin API")
check(stranger.get("/api/sync").status_code == 401, "signed-out visitor cannot sync")
check(stranger.post("/api/login", data="email=a&password=b", content_type="application/x-www-form-urlencoded").status_code == 415, "form posts refused (CSRF)")
check(J(stranger, "post", "/api/login", {"email": "hunter@example.com", "password": "x"}) .status_code == 401, "wrong password")

users = admin.get("/api/admin/users").json["users"]
hid = next(u["id"] for u in users if u["email"] == "hunter@example.com")
check(users[0]["email"] == "hunter@example.com", "pending accounts listed first")
check(J(admin, "post", f"/api/admin/users/{hid}", {"status": "approved"}).json["user"]["status"] == "approved", "admin approves")
check(J(admin, "post", f"/api/admin/users/{users[1]['id']}", {"status": "disabled"}).status_code == 400, "admin cannot disable self")

wp = {"store": "waypoints", "id": "w1", "updated": 1000, "data": {"id": "w1", "name": "Stand", "lat": 45.8, "lng": -92.4, "updated": 1000}}
r = J(user, "post", "/api/sync", {"changes": [wp]})
check(r.status_code == 200 and r.json["accepted"] == 1, "approved account saves a waypoint")
old = dict(wp, updated=500, data=dict(wp["data"], name="Old"))
check(J(user, "post", "/api/sync", {"changes": [old]}).json["accepted"] == 0, "older change ignored (newest wins)")
pulled = user.get("/api/sync?since=0").json
check(len(pulled["items"]) == 1 and pulled["items"][0]["data"]["name"] == "Stand", "pull returns it")
seq = pulled["seq"]
J(user, "post", "/api/sync", {"changes": [{"store": "waypoints", "id": "w1", "updated": 2000, "deleted": True}]})
d = user.get(f"/api/sync?since={seq}").json
check(len(d["items"]) == 1 and d["items"][0]["deleted"], "deletes sync as tombstones")
check(J(user, "post", "/api/sync", {"changes": [dict(wp, store="secrets")]}).json["accepted"] == 0, "unknown store ignored")
check(J(user, "post", "/api/sync", {"changes": [{"store": "rounds", "id": "r1", "updated": 3000, "data": {"id": "r1", "name": "Fish Lake"}}]}).json["accepted"] == 1, "disc golf rounds sync")
check(admin.get("/api/sync").json["items"] == [], "accounts don't see each other's items")

check(user.get("/api/me/settings").json["settings"] is None, "no saved settings yet")
check(J(user, "post", "/api/me/settings", {"settings": {"base": "topo", "layers": {"l-discgolf": True}}}).status_code == 200, "save layer settings")
check(user.get("/api/me/settings").json["settings"]["layers"]["l-discgolf"] is True, "settings come back")
check(admin.get("/api/me/settings").json["settings"] is None, "settings are per account")
check(stranger.get("/api/me/settings").status_code == 401, "signed-out visitors have no account settings")
check(J(user, "post", "/api/me/settings", {"settings": {"x": "y" * 9000}}).status_code == 400, "oversized settings refused")
# Shared folders: publish, view without an account, republish keeps the link, only the owner can stop it.
fish = [{"store": "tracks", "data": {"id": "t1", "name": "Hole 1", "folder": "Fish Lake", "points": [[45.8, -92.4], [45.801, -92.399]], "dg": {"hole": "1"}}},
        {"store": "waypoints", "data": {"id": "w9", "name": "Parking", "lat": 45.8, "lng": -92.4}}]
check(J(stranger, "post", "/api/shares", {"folder": "Fish Lake", "items": fish}).status_code == 401, "sharing needs an account")
sh = J(user, "post", "/api/shares", {"folder": "Fish Lake", "items": fish})
check(sh.status_code == 200 and sh.json["count"] == 2, "approved account shares a folder")
sid = sh.json["id"]
v = stranger.get(f"/api/shares/{sid}")
check(v.status_code == 200 and v.json["folder"] == "Fish Lake" and len(v.json["items"]) == 2 and "email" not in json.dumps(v.json)
      and "hunter@example.com" not in json.dumps(v.json), "anyone with the link sees it, without the owner's email")
again = J(user, "post", "/api/shares", {"folder": "Fish Lake", "items": fish[:1]})
check(again.json["id"] == sid and stranger.get(f"/api/shares/{sid}").json["count"] == 1, "sharing the folder again updates the same link")
check(len(user.get("/api/shares").json["shares"]) == 1, "the owner can list their shared folders")
check(J(admin, "delete", f"/api/shares/{sid}", {}).status_code == 404, "someone else can't stop the share")
check(stranger.get("/api/shares/bad!id").status_code == 404, "malformed share ids are refused")
check(J(user, "delete", f"/api/shares/{sid}", {}).status_code == 200 and stranger.get(f"/api/shares/{sid}").status_code == 404, "stopping a share removes the link")
# Live rounds: one approved account starts it; anyone with the id sees and scores it; scores merge, never overwrite.
lr = {"name": "Fish Lake", "format": "singles", "holes": [{"n": 1, "par": 3}, {"n": 2, "par": 4}],
      "sides": [{"id": "a", "name": "Andy"}, {"id": "b", "name": "Ben"}], "scores": {"a": [None, None], "b": [None, None]}}
check(J(stranger, "post", "/api/rounds", {"round": lr}).status_code == 401, "starting a shared round needs an account")
lrid = J(user, "post", "/api/rounds", {"round": lr}).json["id"]
check(stranger.get(f"/api/rounds/{lrid}").json["round"]["name"] == "Fish Lake", "anyone with the link sees the round")
J(user, "post", f"/api/rounds/{lrid}", {"scores": [{"side": "a", "hole": 0, "value": 3}]})
after = J(stranger, "post", f"/api/rounds/{lrid}", {"scores": [{"side": "b", "hole": 0, "value": 4}]}).json
check(after["round"]["scores"] == {"a": [3, None], "b": [4, None]}, "two phones' scores merge instead of overwriting")
check(stranger.get(f"/api/rounds/{lrid}?since={after['version']}").json.get("same") is True, "polling an unchanged round sends nothing new")
check(J(stranger, "post", f"/api/rounds/{lrid}", {"scores": [{"side": "zz", "hole": 9, "value": 99}]}).json["round"]["scores"] == {"a": [3, None], "b": [4, None]}, "bad scores are ignored")
check(stranger.get("/api/rounds/nope!").status_code == 404, "malformed round ids are refused")
# Short links: anyone can make one; the same link gets the same code; following it redirects to the full view.
h = "#map=17/45.80050/-92.40050&base=hyb&layers=parcels&share=AbCdEfGh1234"
ln = J(stranger, "post", "/api/links", {"hash": h})
check(ln.status_code == 200 and re.match(r"^[A-Za-z0-9]{6}$", ln.json["code"]), "anyone can shorten a link")
check(J(user, "post", "/api/links", {"hash": h}).json["code"] == ln.json["code"], "the same link always gets the same code")
f = stranger.get("/api/s/" + ln.json["code"])
check(f.status_code == 302 and f.headers["Location"].endswith("/" + h), "a short link redirects to the full view")
check(stranger.get("/api/s/nope99").headers["Location"].endswith("/"), "an unknown code just opens the map")
check(J(stranger, "post", "/api/links", {"hash": "javascript:alert(1)"}).status_code == 400, "only app links can be shortened")
temp = J(admin, "post", f"/api/admin/users/{hid}/reset", {}).json["password"]
check(user.get("/api/me").json["user"] is None, "password reset signs the user out")
check(J(user, "post", "/api/login", {"email": "hunter@example.com", "password": temp}).status_code == 200, "temporary password works")
check(J(user, "post", "/api/me/password", {"current": temp, "new": "newpassword1"}).status_code == 200, "user changes password")
J(admin, "post", f"/api/admin/users/{hid}", {"status": "disabled"})
check(user.get("/api/me").json["user"] is None, "disabling an account signs it out")
check(J(user, "post", "/api/login", {"email": "hunter@example.com", "password": "newpassword1"}).status_code == 403, "disabled account can't sign in")
for _ in range(8): J(stranger, "post", "/api/login", {"email": "boss@example.com", "password": "nope"})
check(J(stranger, "post", "/api/login", {"email": "boss@example.com", "password": "correct horse"}).status_code == 429, "login rate limit after 8 failures")
check(J(admin, "delete", f"/api/admin/users/{hid}", {}).status_code == 200, "admin deletes an account")
os.remove(path)
print("\nall passed" if not bad else f"\n{bad} failed"); sys.exit(1 if bad else 0)
