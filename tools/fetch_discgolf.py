#!/usr/bin/env python3
"""Builds site/data/discgolf.json: every disc golf course in Minnesota and
Wisconsin mapped in OpenStreetMap, with tees, baskets and hole lines where
volunteers have mapped them.

    python3 tools/fetch_discgolf.py site/data/discgolf.json
    python3 tools/fetch_discgolf.py out.json --from saved-overpass.json   # rebuild from a saved response

Runs in GitHub Actions (.github/workflows/discgolf.yml) because the build
workspace can't reach Overpass. Standard library only.

Data (c) OpenStreetMap contributors, ODbL 1.0. The app credits it on the map.

How OSM maps disc golf (it varies):
- courses: leisure=disc_golf_course, or sport=disc_golf on a park, golf
  course, pitch or sports centre, or just "Disc Golf" in a leisure name;
- disc_golf=tee / basket nodes (baskets may carry colour= for pin positions);
- hole lines: golf=hole (or disc_golf=hole) ways with ref= (number) and par=,
  drawn tee -> basket, though some are drawn backwards.
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request

ENDPOINTS = ["https://overpass-api.de/api/interpreter",
             "https://overpass.private.coffee/api/interpreter",
             "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
QUERY = r"""
[out:json][timeout:600];
area["ISO3166-2"~"^US-(MN|WI)$"]["admin_level"="4"]->.s;
(
  nwr["leisure"="disc_golf_course"](area.s);
  nwr["sport"="disc_golf"]["leisure"](area.s);
  nwr["leisure"~"^(park|golf_course|pitch|sports_centre|recreation_ground)$"]["name"~"disc ?golf|frisbee ?golf|frolf",i](area.s);
)->.courses;
.courses out body geom qt;
node["disc_golf"](area.s)->.dgn;
.dgn out body qt;
(
  way["disc_golf"](area.s);
  way(bn.dgn)["golf"="hole"];
)->.holes;
.holes out body geom qt;
"""
UA = "LineFence/1.0 (+https://maps.dibberlab.me; disc golf layer, monthly)"
KEEP = ("operator", "website", "url", "contact:website", "fee", "charge", "access", "opening_hours",
        "description", "surface", "phone", "contact:phone", "dog", "lit")
R = 6371008.8


def overpass():
    last = None
    for url in ENDPOINTS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": QUERY}).encode(),
                                             headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=700) as r:
                    return json.load(r)
            except Exception as e:   # try again, then the next server
                last = e
                print(f"  {url} failed: {e}", file=sys.stderr)
                time.sleep(20)
    raise SystemExit(f"Overpass unavailable: {last}")


def dist(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1, math.sqrt(h)))


def in_ring(p, ring):
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        (yi, xi), (yj, xj) = ring[i], ring[j]
        if (yi > p[0]) != (yj > p[0]) and p[1] < (xj - xi) * (p[0] - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def rings_of(el):
    """Outer rings as [[lat, lng], ...] for a closed way or a multipolygon relation."""
    if el["type"] == "way" and el.get("geometry"):
        g = [(c["lat"], c["lon"]) for c in el["geometry"]]
        return [g] if len(g) > 3 and g[0] == g[-1] else []
    if el["type"] == "relation":
        out = []
        for m in el.get("members", []):
            if m.get("role") in ("outer", "") and m.get("geometry"):
                g = [(c["lat"], c["lon"]) for c in m["geometry"]]
                if len(g) > 3 and g[0] == g[-1]:
                    out.append(g)
        return out
    return []


def center_of(el):
    if el["type"] == "node":
        return (el["lat"], el["lon"])
    if "center" in el:
        return (el["center"]["lat"], el["center"]["lon"])
    b = el.get("bounds")
    if b:
        return ((b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2)
    pts = [(c["lat"], c["lon"]) for c in el.get("geometry", []) if c]
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) if pts else None


r6 = lambda p: [round(p[0], 6), round(p[1], 6)]
r5 = lambda p: [round(p[0], 5), round(p[1], 5)]


def simplify(ring, tol_m=4):
    """Drop points closer than tol_m to the last kept one (outlines don't need survey detail)."""
    out = [ring[0]]
    for p in ring[1:-1]:
        if dist(out[-1], p) >= tol_m:
            out.append(p)
    out.append(ring[-1])
    return out


def ref_num(s):
    try:
        return int(str(s).split(";")[0].strip().split()[0])
    except (ValueError, IndexError):
        return None


def build(data):
    els = data.get("elements", [])
    nodes = {e["id"]: e for e in els if e["type"] == "node"}
    # Courses
    courses, seen = [], set()
    for e in els:
        t = e.get("tags", {})
        is_course = (t.get("leisure") == "disc_golf_course" or t.get("sport") == "disc_golf" or
                     ("golf" in t.get("name", "").lower() and "disc" in t.get("name", "").lower()) or
                     any(w in t.get("name", "").lower() for w in ("frisbee golf", "frolf")))
        if not is_course or t.get("disc_golf") or t.get("golf") == "hole":
            continue
        key = (e["type"], e["id"])
        if key in seen:
            continue
        seen.add(key)
        c = center_of(e)
        if not c:
            continue
        courses.append({"el": e, "center": c, "rings": rings_of(e), "holes": [], "tees": [], "baskets": []})

    def owner(p, near=700):
        inside = [c for c in courses if any(in_ring(p, r) for r in c["rings"])]
        if inside:   # smallest outline wins (a course inside a bigger park)
            return min(inside, key=lambda c: sum(len(r) for r in c["rings"]))
        best = min(courses, key=lambda c: dist(p, c["center"]), default=None)
        return best if best and dist(p, best["center"]) <= near else None

    orphans = []
    # Hole lines
    hole_node_ids = set()
    for e in els:
        t = e.get("tags", {})
        if e["type"] != "way" or not (t.get("golf") == "hole" or t.get("disc_golf") == "hole") or not e.get("geometry"):
            continue
        line = [(c["lat"], c["lon"]) for c in e["geometry"]]
        ids = e.get("nodes", [])
        first = nodes.get(ids[0], {}).get("tags", {}).get("disc_golf") if ids else None
        last = nodes.get(ids[-1], {}).get("tags", {}).get("disc_golf") if ids else None
        if first == "basket" and last == "tee":
            line.reverse()
        hole_node_ids.update(ids)
        length = sum(dist(line[i - 1], line[i]) for i in range(1, len(line)))
        h = {"ref": ref_num(t.get("ref")), "par": ref_num(t.get("par")), "m": round(length), "line": [r6(p) for p in line]}
        if t.get("name"):
            h["name"] = t["name"]
        c = owner(line[0]) or owner(line[-1])
        (c["holes"] if c else orphans).append(("hole", h, line[0]))
    # Tees and baskets
    for n in nodes.values():
        kind = n.get("tags", {}).get("disc_golf")
        if kind not in ("tee", "basket", "pin", "target"):
            continue
        p = (n["lat"], n["lon"])
        item = r6(p)
        if kind == "tee" and n["tags"].get("ref"):
            item.append(str(n["tags"]["ref"]))
        if kind != "tee" and n["tags"].get("colour"):
            item.append(n["tags"]["colour"])
        c = owner(p)
        if c:
            (c["tees"] if kind == "tee" else c["baskets"]).append(item)
        else:
            orphans.append((kind, item, p))

    # Hole features with no course tag nearby: group them into a course of their own.
    while orphans:
        seed = orphans.pop(0)
        group = [seed]
        for o in orphans[:]:
            if any(dist(o[2], g[2]) < 400 for g in group):
                group.append(o); orphans.remove(o)
        if len(group) < 3:
            continue
        pts = [g[2] for g in group]
        c = {"el": {"type": "group", "id": 0, "tags": {}}, "center": (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)),
             "rings": [], "holes": [], "tees": [], "baskets": []}
        for kind, item, _ in group:
            {"hole": c["holes"], "tee": c["tees"]}.get(kind, c["baskets"]).append(item)
        courses.append(c)

    # Drop point courses duplicated by a mapped outline or another point nearby.
    out = []
    for c in sorted(courses, key=lambda c: (not c["rings"], -len(c["holes"]))):
        if c["el"]["type"] == "node" and any(dist(c["center"], o["center"]) < 250 or any(in_ring(c["center"], r) for r in o["rings"]) for o in out):
            dup = next(o for o in out if dist(c["center"], o["center"]) < 250 or any(in_ring(c["center"], r) for r in o["rings"]))
            for k in ("holes", "tees", "baskets"):
                dup[k] += c[k]
            continue
        out.append(c)

    result = []
    for c in out:
        e, t = c["el"], c["el"].get("tags", {})
        holes = sorted(c["holes"], key=lambda h: (h[1]["ref"] is None, h[1]["ref"] or 0))
        hs = [h[1] for h in holes]
        rec = {"id": (e["type"][0] + str(e["id"])) if e["type"] != "group" else None,
               "name": t.get("name") or "Disc golf course", "c": r6(c["center"])}
        n_tag = ref_num(t.get("holes"))
        if n_tag or hs:
            rec["n"] = n_tag or len({h["ref"] for h in hs if h["ref"]}) or len(hs)
        pars = [h["par"] for h in hs if h["par"]]
        if hs and len(pars) == len(hs):
            rec["par"] = sum(pars)
        info = {k.replace("contact:", ""): t[k] for k in KEEP if t.get(k)}
        if info:
            rec["info"] = info
        if c["rings"]:
            rec["outline"] = [[r5(p) for p in simplify(r)] for r in c["rings"]][:5]
        if hs:
            rec["holes"] = hs
        if c["tees"]:
            rec["tees"] = c["tees"]
        if c["baskets"]:
            rec["baskets"] = c["baskets"]
        result.append(rec)
    result.sort(key=lambda r: r["name"].lower())
    mapped = sum(1 for r in result if r.get("holes"))
    return {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "OpenStreetMap", "license": "ODbL 1.0",
            "attribution": "© OpenStreetMap contributors", "counts": {"courses": len(result), "with_holes": mapped,
            "holes": sum(len(r.get("holes", [])) for r in result)}, "courses": result}


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    out = args[0]
    if "--from" in args:
        with open(args[args.index("--from") + 1]) as f:
            data = json.load(f)
    else:
        print("Querying Overpass for MN and WI disc golf…", file=sys.stderr)
        data = overpass()
    ds = build(data)
    if ds["counts"]["courses"] < 50 and "--from" not in args:
        raise SystemExit(f"Only {ds['counts']['courses']} courses came back; refusing to overwrite the data file.")
    with open(out, "w") as f:
        json.dump(ds, f, separators=(",", ":"))
    print(json.dumps(ds["counts"]))


if __name__ == "__main__":
    main()
