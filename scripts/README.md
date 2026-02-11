# データ準備手順

GeoJSONからPMTiles＋検索インデックスを生成する。

## 前提

- `osm_motorway.geojson`, `osm_trunk.geojson`, `osm_primary.geojson`, `osm_secondary.geojson` がカレントディレクトリにあること
- これらは `dist/split_geojson.py` で `osm.geojson` から分割生成できる

## 必要ツール

- **Python 3** （検索インデックス生成）
- **tippecanoe** （GeoJSON → MBTiles）
- **pmtiles CLI** （MBTiles → PMTiles）

```bash
# Ubuntu/WSL
sudo apt install tippecanoe

# pmtiles CLI: GitHub Releases からバイナリをダウンロード
# https://github.com/protomaps/go-pmtiles/releases
curl -L -o pmtiles.tar.gz https://github.com/protomaps/go-pmtiles/releases/download/v1.30.0/go-pmtiles_1.30.0_Linux_x86_64.tar.gz
tar xzf pmtiles.tar.gz && sudo mv pmtiles /usr/local/bin/
```

## 実行

GeoJSONファイルがあるディレクトリで：

```bash
# 検索インデックス生成 → public/search_index.json
python scripts/build_search_index.py

# PMTiles生成 → public/roads.pmtiles
bash scripts/build_tiles.sh
```

## 出力

| ファイル | 内容 |
|---------|------|
| `public/roads.pmtiles` | 全fclass統合のベクタータイル（~30-60MB） |
| `public/search_index.json` | 道路名・種別・路線番号・bboxの軽量インデックス |
