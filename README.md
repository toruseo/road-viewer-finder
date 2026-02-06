# OSM-road-viewer

公開ページ：https://toruseo.jp/OSM-road-viewer/

日本の主要道路を簡単に閲覧，検索するためのWebアプリ

特に，「あの道路どこだっけ？」みたいな疑問を検索で簡単に解消することを目的にしています：
![検索例](public/help_246.png)

OSMを独自加工したデータに基づいているので，正確性には限界があります．

## 操作方法

- **道路情報の確認**：道路にマウスを置くと，道路名がツールチップで表示されます

- **検索**：左上の検索パネルで道路を検索できます．
  - **道路名**：東名高速道路を見つけたければ「東名」．表記ゆれが多いので注意してください．
  - **種別**：道路種別を選択．OSMのカテゴリなので，実際の種類と微妙に違います．
  - **路線番号**：国道246号線を見つけたければ「246」
  - 道路区間をダブルクリックするとその道路と同じ種別と番号の道路を検索します．

- **道路名を表示**：チェックを入れると道路名ラベルが表示されます

## 道路の種類と色分け

| 種別 | 色 |
|------|-----|
| 高速道路等 (motorway) | 赤 |
| 国道等 (trunk) | 青 |
| 主要地方道等 (primary) | 緑 |
| 一般県道等 (secondary) | 緑（細） |

## 開発者向け情報

詳細は[Github](https://github.com/toruseo/OSM-road-viewer)の[CLAUDE.md](https://github.com/toruseo/OSM-road-viewer/blob/main/CLAUDE.md)を参照してください．

## クレジット・ライセンス

開発者：[瀬尾亨（東京科学大学）](https://toruseo.jp/index_jp.html)＋Claude Code等

コード：MIT License

地図データ（`public/osm.geojson.gz`）：
(c) OpenStreetMap contributors. 
Open Database License (ODbL) v1.0.
https://github.com/toruseo/osm-road-extractor-simplifier により生成