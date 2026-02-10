# テスト

## 構成

```
tests/
  unit/                          # ユニットテスト (Vitest)
    setup.js                     # モック共通セットアップ
    mapview-constants.test.js    # 定数の構造検証
    mapview-search.test.js       # search()のフィルタリングロジック
    mapview-handleclick.test.js  # ダブルクリック検出ロジック
    mapview-handlehover.test.js  # ツールチップ表示ロジック
  e2e/                           # E2Eテスト (Playwright)
    app-load.spec.js             # ページ読み込み・UI要素の存在確認
    help-modal.spec.js           # ヘルプモーダルの開閉
    search-panel.spec.js         # 検索パネル操作
    legend.spec.js               # 凡例チェックボックス操作
```

## 実行方法

### ユニットテスト

```bash
npm test           # 1回実行
npm run test:watch # ウォッチモード
```

### E2Eテスト

```bash
npm run build      # 先にビルドが必要
npm run test:e2e   # Playwright実行
```

### 全テスト

```bash
npm run test:all   # ユニット + E2E（ビルドは別途必要）
```

## ユニットテスト詳細

`maplibre-gl`, `@deck.gl/layers`, `@deck.gl/mapbox` を `setup.js` でモックし、`MapView` クラスの公開メソッドとエクスポート定数をテストする。`init()` を呼ばずに `MapView` をインスタンス化し、必要なプロパティを直接セットしてテストする。

| ファイル | テスト内容 |
|---|---|
| `mapview-constants.test.js` | `ROAD_STYLES`, `DEFAULT_ROAD_STYLE`, `ROAD_LAYERS` の構造・整合性 |
| `mapview-search.test.js` | `search()` の名前部分一致、fclass完全一致、ref大文字小文字無視・セミコロン区切り対応 |
| `mapview-handleclick.test.js` | `handleClick()` のダブルクリック検出（400ms閾値、同一feature判定、状態リセット） |
| `mapview-handlehover.test.js` | `handleHover()` のツールチップ表示（位置、テキスト、非表示条件） |

## E2Eテスト詳細

Playwright + Chromium を使用。`npm run preview`（port 4173）で配信されるビルド済みアプリに対してテストする。`public/osm_*.geojson.gz` の本番データをそのまま使用するため、データ読み込みに時間がかかるテストはタイムアウトを長めに設定している。

| ファイル | テスト内容 |
|---|---|
| `app-load.spec.js` | タイトル、主要UI要素、凡例、MapLibreキャンバス、データ読み込み完了 |
| `help-modal.spec.js` | モーダル開閉（ボタン、×、Escape、背景クリック） |
| `search-panel.spec.js` | 入力欄・ボタン存在、クリア、ドロップダウン選択肢、検索実行 |
| `legend.spec.js` | デフォルトチェック状態、凡例色、チェック切替によるデータ読み込み |

## CI

GitHub Actions (`.github/workflows/test.yml`) でpush/PR時に自動実行される。ユニットテストとE2Eテストは別ジョブとして並列実行。
