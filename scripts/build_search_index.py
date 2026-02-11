"""
検索インデックス生成スクリプト

GeoJSONファイルからユニークな道路名ごとにbboxを集約した
軽量な検索インデックス (search_index.json) を生成する。

使い方:
  python scripts/build_search_index.py

前提: osm_motorway.geojson, osm_trunk.geojson, osm_primary.geojson,
      osm_secondary.geojson がカレントディレクトリに存在すること
"""
import json
import os
import sys


def flatten_coords(coordinates):
    """座標配列を再帰的にフラットな [lng, lat] のリストに展開する"""
    if not coordinates:
        return
    if isinstance(coordinates[0], (int, float)):
        yield coordinates
    else:
        for item in coordinates:
            yield from flatten_coords(item)


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    output_path = os.path.join(project_dir, "public", "search_index.json")

    fclasses = ["motorway", "trunk", "primary", "secondary"]

    # (name, fclass, ref) -> {name, fclass, ref, bbox}
    index = {}

    for fclass in fclasses:
        filename = f"osm_{fclass}.geojson"
        if not os.path.exists(filename):
            print(f"WARNING: {filename} が見つかりません、スキップします")
            continue

        print(f"処理中: {filename}")
        with open(filename, "r", encoding="utf-8") as f:
            data = json.load(f)

        count = 0
        for feat in data["features"]:
            props = feat.get("properties", {})
            name = props.get("name", "")
            if not name:
                continue

            ref = props.get("ref", "")
            key = (name, fclass, ref)

            if key not in index:
                index[key] = {
                    "name": name,
                    "fclass": fclass,
                    "ref": ref,
                    "bbox": [180, 90, -180, -90],
                }

            bbox = index[key]["bbox"]
            for coord in flatten_coords(feat["geometry"]["coordinates"]):
                lng, lat = coord[0], coord[1]
                if lng < bbox[0]:
                    bbox[0] = lng
                if lat < bbox[1]:
                    bbox[1] = lat
                if lng > bbox[2]:
                    bbox[2] = lng
                if lat > bbox[3]:
                    bbox[3] = lat

            count += 1

        print(f"  {fclass}: {count} features with name")

    result = list(index.values())

    # bboxを小数点以下5桁に丸める（ファイルサイズ削減）
    for item in result:
        item["bbox"] = [round(v, 5) for v in item["bbox"]]

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(output_path) / 1024
    print(f"\n生成完了: {output_path}")
    print(f"エントリ数: {len(result)}")
    print(f"ファイルサイズ: {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
