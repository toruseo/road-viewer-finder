# OSM-road-viewer

**WIP**

日本の主要道路を簡単に閲覧，検索するためのビューア

公開ページ：https://toruseo.jp/OSM-road-viewer/

## 操作方法

### 道路情報の確認
- 道路にマウスを置くと、道路名がツールチップで表示されます

### 検索
左上の検索パネルで道路を検索できます。

- **道路名**: 東名高速道路を見つけたければ「東名」
- **種別**: OSMのカテゴリを選択
- **路線番号**: 国道246号線を見つけたければ「246」

複数の条件を指定するとAND検索になります。

### 表示オプション

- **道路名を表示**: チェックを入れると道路名ラベルが表示されます．調整中につき非推奨

### 道路の色分け

| 種別 | 色 |
|------|-----|
| 高速道路等 (motorway) | 赤 |
| 国道等 (trunk) | 青 |
| 主要地方道等 (primary) | 緑 |
| 一般県道等 (secondary) | 緑（細） |

## 開発者向け情報

### 技術スタック
- **描画**: deck.gl (GeoJsonLayer, TextLayer) + MapLibre GL JS
- **ビルド**: Vite

### セットアップ
```bash
npm install
```

### 開発
```bash
npm run dev
```

### ビルド
```bash
npm run build
```

## クレジット・ライセンス

開発者：[瀬尾亨（東京科学大学）](https://toruseo.jp/index_jp.html)＋Claude Code等

コード：MIT License

地図データ（`public/osm.geojson.gz`）：
(c) OpenStreetMap contributors. 
Open Database License (ODbL) v1.0.
https://github.com/toruseo/osm-road-extractor-simplifier により生成