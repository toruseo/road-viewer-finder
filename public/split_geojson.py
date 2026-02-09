import json
"""
2026-02-09
  ┌──────────────────────────┬──────────┬─────────┐
  │         ファイル         │ 元サイズ │ 圧縮後  │
  ├──────────────────────────┼──────────┼─────────┤
  │ osm_motorway.geojson.gz  │ 20.6 MB  │ 4.2 MB  │
  ├──────────────────────────┼──────────┼─────────┤
  │ osm_trunk.geojson.gz     │ 46.0 MB  │ 10.6 MB │
  ├──────────────────────────┼──────────┼─────────┤
  │ osm_primary.geojson.gz   │ 57.4 MB  │ 13.2 MB │
  ├──────────────────────────┼──────────┼─────────┤
  │ osm_secondary.geojson.gz │ 78.0 MB  │ 17.5 MB │
  └──────────────────────────┴──────────┴─────────┘
"""
with open("osm.geojson", "r", encoding="utf-8") as f:
    data = json.load(f)

base = {k: v for k, v in data.items() if k != "features"}

categories = ["motorway", "trunk", "primary", "secondary"]
buckets = {c: [] for c in categories}
buckets["others"] = []

for feat in data["features"]:
    fclass = feat["properties"].get("fclass", "")
    # motorway_link -> motorway, trunk_link -> trunk, etc.
    matched = False
    for c in categories:
        if fclass == c or fclass.startswith(c + "_"):
            buckets[c].append(feat)
            matched = True
            break
    if not matched:
        buckets["others"].append(feat)

for name, features in buckets.items():
    with open(f"osm_{name}.geojson", "w", encoding="utf-8") as f:
        json.dump({**base, "features": features}, f, ensure_ascii=False)
    print(f"{name:12s}: {len(features):6d} features")

print(f"{'total':12s}: {len(data['features']):6d} features")
