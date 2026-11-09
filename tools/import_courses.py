#!/usr/bin/env python3
"""Course directory (the disc golf layer's pins nationwide) from the PDGA course directory (CSV Andrew supplied).
   python3 tools/import_courses.py [tools/data/courses.csv] [site/data/courses-us.json]
CSV columns: id, name, city, state, zip, holeCount, rating, latitude, longitude. Output (compact, one row per course):
{generated, source, count, fields, courses:[[id, name, lat, lng, holes, city, state, rating], ...]}
The page (discgolf.js) lays these under the OpenStreetMap courses: a course already there keeps its entry and gains the
hole count and town; the rest become pins of their own."""
import csv, json, sys, datetime

src = sys.argv[1] if len(sys.argv) > 1 else 'tools/data/courses.csv'
out = sys.argv[2] if len(sys.argv) > 2 else 'site/data/courses-us.json'
rows = []
for r in csv.DictReader(open(src, encoding='utf-8-sig')):
    try:
        lat, lng = round(float(r['latitude']), 6), round(float(r['longitude']), 6)
    except (TypeError, ValueError):
        continue
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or not r['name'].strip():
        continue
    holes = int(r['holeCount']) if (r.get('holeCount') or '').strip().isdigit() else None
    rating = float(r['rating']) if (r.get('rating') or '').strip() else None
    rows.append([r['id'].strip(), ' '.join(r['name'].split()), lat, lng, holes, (r.get('city') or '').strip(), (r.get('state') or '').strip(), rating])
rows.sort(key=lambda x: (x[6], x[1]))
json.dump({'generated': datetime.date.today().isoformat(), 'source': 'PDGA course directory', 'count': len(rows),
           'fields': ['id', 'name', 'lat', 'lng', 'holes', 'city', 'state', 'rating'], 'courses': rows},
          open(out, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f'{len(rows)} courses -> {out}')
