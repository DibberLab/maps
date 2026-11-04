"""API tests: python -m pytest-free runner.  Run:  python server/test_app.py"""
import os, sys, tempfile, json
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
check(admin.get("/api/sync").json["items"] == [], "accounts don't see each other's items")

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
