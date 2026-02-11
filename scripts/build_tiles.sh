#!/bin/bash
set -euo pipefail

# GeoJSON → PMTiles 変換スクリプト
# 前提: osm_motorway.geojson, osm_trunk.geojson, osm_primary.geojson, osm_secondary.geojson が
#        カレントディレクトリに存在すること
# 必要ツール: tippecanoe, pmtiles CLI

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== GeoJSON → PMTiles 変換 ==="

# 入力ファイルの存在確認
for fclass in motorway trunk primary secondary; do
  if [ ! -f "osm_${fclass}.geojson" ]; then
    echo "ERROR: osm_${fclass}.geojson が見つかりません"
    echo "カレントディレクトリにGeoJSONファイルを配置して実行してください"
    exit 1
  fi
done

# tippecanoe で4つのfclassを名前付きレイヤーとして1つのMBTilesに統合
echo "tippecanoe でMBTiles生成中..."
tippecanoe \
  -L motorway:osm_motorway.geojson \
  -L trunk:osm_trunk.geojson \
  -L primary:osm_primary.geojson \
  -L secondary:osm_secondary.geojson \
  -zg \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  -o roads.mbtiles

echo "MBTiles生成完了: roads.mbtiles"
ls -lh roads.mbtiles

# PMTilesに変換
echo "PMTilesに変換中..."
pmtiles convert roads.mbtiles "${PROJECT_DIR}/public/roads.pmtiles"

echo "=== 完了 ==="
echo "生成ファイル:"
ls -lh "${PROJECT_DIR}/public/roads.pmtiles"

# 中間ファイル削除
rm -f roads.mbtiles
echo "中間ファイル (roads.mbtiles) を削除しました"
