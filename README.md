# 道路閲覧検索アプリ

日本の主要道路を簡単に閲覧・検索するためのWebアプリ．
特に，「あの道路どこだっけ？」みたいな疑問を検索で簡単に解消することを目的にしています．

公開ページ：https://toruseo.jp/road-viewer-finder/

![検索例](public/help_246.png)

OSMを独自軽量化したデータに基づいているので，正確性には限界があります．

## 操作方法

- **道路情報の確認**：道路にマウスを置くと，道路名がツールチップで表示されます

- **検索**：左上の検索パネルで道路を検索し，ハイライト表示できます．
  - **道路名**：東名高速道路を見つけたければ「東名」．表記ゆれが多いので注意してください．
  - **種別**：道路種別を選択．注意：OSMのクラスなので，実際の種類と微妙に違うおそれがあります．
  - **路線番号**：国道246号線を見つけたければ「246」
  - 道路区間をダブルクリックするとその道路と同じ種別と番号の道路を検索します．

- **道路名を表示**：チェックを入れると道路名ラベルが表示されます
- **道路種別**：描画する道路種別を選択できます．描画が重い場合はチェックを外してください．

## 道路の種類と色分け

| 種別 | 色 | [詳細](https://wiki.openstreetmap.org/wiki/Japan_tagging) |
|------|-----|----|
| 高速道路 | 赤 | 高速道路，自動車専用道路．OSMのmotorwayクラス
| 国道 | 青 | 一般国道（高速道路を除く）．OSMのtrunkクラス
| 主要地方道 | 緑 | 都道府県道のうちの主要地方道（1-2桁番号）．OSMのprimaryクラス
| 一般都道府県道 | 緑（細） |都道府県道のうちの主要地方道でないもの（3桁番号）．OSMのsecondaryクラス

## ローカル版

ローカルで動作する版も本リポジトリの[Releaseからダウンロード](https://github.com/toruseo/road-viewer-finder/releases/latest/download/road-viewer-finder-local.zip)できます．

## 開発者向け情報

詳細は[Github](https://github.com/toruseo/road-viewer-finder)の[CLAUDE.md](https://github.com/toruseo/road-viewer-finder/blob/main/CLAUDE.md)を参照してください．

このリポジトリは日本の道路を対象にしていますが，`public/osm_*.geojson.gz`を別の地域のOSMデータに変更すれば他の地域でも全く同様に使えるはずです．

## クレジット・ライセンス

- 開発者：[瀬尾亨（東京科学大学）](https://toruseo.jp/index_jp.html)
- コード：MIT License
- 本アプリ出力画像：[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- 地図データ（`public/osm_*.geojson.gz`）：
(c) OpenStreetMap contributors. 
Open Database License (ODbL) v1.0.
https://github.com/toruseo/osm-road-extractor-simplifier により生成
- 衛星画像データ：[地理院タイル（全国最新写真）](https://maps.gsi.go.jp/development/ichiran.html)
- 画像などを二次利用する場合の表記例：「出典：瀬尾亨，https://toruseo.jp/road-viewer-finder CC BY 4.0 / © OpenStreetMap contributors」
    - 衛星画像使用時は「地理院タイル（全国最新写真）」を追記して下さい
    - 詳細については各ライセンスをご確認ください