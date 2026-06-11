# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

road-viewer-finder is a web app for viewing and searching Japanese OSM road data. It renders large GeoJSON (~200MB total) via WebGL using deck.gl on top of MapLibre GL JS. Deployed to GitHub Pages at https://toruseo.jp/road-viewer-finder/.

## Commands

- `npm install` - Install dependencies
- `npm run dev` - Start Vite dev server (http://localhost:5173, auto-opens browser)
- `npm run build` - Production build to `dist/`
- `npm run preview` - Preview production build

No test framework or linter is configured. ユーザが `npm run dev` を常時実行しているため、Claude側で `npm run build` による確認は不要。

## Frameworks

- **Build**: Vite
- **Render**: deck.gl (GeoJsonLayer, TextLayer) + MapLibre GL JS

## Architecture

The app has four active source files with clear responsibilities:

- **`src/main.js`** - `App` class: UI wiring (search panel, label toggle, help modal, legend), per-fclass data loading (fetch with progress display → Web Worker processing). Imports README.md as raw text (`?raw`) and renders it as the help modal content via `marked`.
- **`src/dataProcessor.js`** - Pure functions: gzip decompression (pako), GeoJSON parse, and conversion to binary bundles (Float32Array segment arrays, quantized Int32 master coordinates, LOD simplification via Douglas-Peucker, grid-cell partitioning, label candidates). Used by the worker, and as a main-thread fallback when Workers are unavailable.
- **`src/dataWorker.js`** - Web Worker entry: runs `processTier` off the main thread and transfers the resulting TypedArrays back (zero-copy). Imported via `?worker&inline` so the release zip's single-file HTML keeps working.
- **`src/MapView.js`** - `MapView` class: All map/rendering logic. Manages deck.gl `MapboxOverlay` with binary-mode `PathLayer`s (roads + yellow search highlight; rounded joints/caps for continuous-looking polylines) and a `TextLayer` (labels). Handles LOD switching, viewport cell culling, label filtering with pixel-space deduplication, hover tooltips, double-click detection, and search.

**`index.html`** contains all HTML structure, CSS styles, and UI elements (search panel, legend, tooltip, help modal). Styles are inline in `<style>`, not in separate CSS files.

## Key Data Flow

1. `App.loadAndShowFclass(fclass)` fetches per-fclass files from `public/osm_[fclass].geojson.gz` (four files: motorway, trunk, primary, secondary) as raw bytes with download progress, then hands them to `dataWorker.js`. The worker (or main-thread fallback) detects gzip magic bytes, decompresses, parses, and builds a binary bundle. The main thread never parses GeoJSON.
2. `MapView.setTierBundle(fclass, bundle)` stores the bundle and renders via deck.gl `PathLayer`s in binary mode (flat coordinate array + `startIndices`, `_pathType: 'open'`, `positionFormat: 'XY'`). `PathLayer` (not `LineLayer`) is required for joint/cap rendering — independent per-segment quads look like fuzzy "caterpillars" on dense polylines; `jointRounded`/`capRounded` make them continuous. Three LOD stages: zoom < 8 uses coarse simplified geometry (~97% segment reduction), zoom 8–10.5 uses fine simplified geometry, zoom ≥ 10.5 renders full detail but only for grid cells intersecting the viewport. Both LOD layers stay resident with `visible` flags (avoids re-tessellation when crossing zoom thresholds); cell layers are created on demand. Within a cell, roads are stored as "runs" (maximal in-cell consecutive vertex sequences; a road crossing a cell boundary is split, duplicating the boundary vertex). LOD layers use absolute lng/lat (plain LNGLAT) — nationwide `LNGLAT_OFFSETS` is NOT usable here because the Web Mercator linearization error grows cubically with latitude distance from the origin (km-scale shifts in Hokkaido). Cell layers use cell-relative Float32 + `LNGLAT_OFFSETS`; cells are 2° lng × 0.5° lat (latitude kept small for the same reason — error at ±0.25° is ~0.2 m, sub-pixel at all zooms).
3. Labels are precomputed in the worker as point candidates along LineStrings at ~0.05 degree intervals (packed arrays), then filtered per viewport using screen-pixel grid spacing (150px minimum), highlighted roads first, then by road importance.
4. Search scans per-feature property arrays in-memory; highlight geometry is reconstructed from the quantized coordinate master into a yellow binary `LineLayer` (full 41k-feature highlight builds in ~200ms). Picking maps segment index → feature index → properties for tooltips and double-click search.

## Road Styling

Road styles are defined in `ROAD_STYLES`, `Z_ORDER`, and `ROAD_LAYERS` constants in MapView.js. The `fclass` property from OSM data drives both color/width and draw order. `ROAD_LAYERS` defines the per-tier layer array (draw order: secondary → primary → trunk → motorway). Legend items in index.html use `data-fclass` attributes and are styled programmatically from `ROAD_STYLES`.

## Deployment (GitHub Pages shell + Cloudflare R2 data)

`main` への push で 2 つのワークフローが並列に走る:

- `.github/workflows/deploy.yml` — `dist/` をビルドして Pages にデプロイ。**`npm run build` の前に `public/osm_*.geojson.gz` を削除**するので、Pages アーティファクトは JS/HTML/CSS シェルだけになる。`VITE_DATA_BASE` (公開 r2.dev URL、末尾スラッシュ付き) と `VITE_DATA_VERSION` (`${{ github.sha }}` をクエリに付けてキャッシュバスティング) を環境変数として注入する。
- `.github/workflows/r2-sync.yml` — `public/osm_*.geojson.gz` の変更時に `wrangler r2 object put --remote` で Cloudflare R2 バケットへ全ファイルをアップロードする。

**なぜ分割するか:** Pages の帯域は従量制 (月100 GB ソフト上限)。R2 は egress 無料。重い GeoJSON (~200 MB) は R2 側で持つ。

**`VITE_DATA_BASE` / `VITE_DATA_VERSION`** は `src/main.js` の `_fetchFclassBytes` を駆動する。空 (= ローカル dev / リリース zip) の場合は `BASE_URL` (相対) にフォールバックするので `npm run dev` ではネット往復なしでローカルの `public/osm_*.geojson.gz` が使われる。元データは引き続き `public/` にコミットしておく。

**必要な GitHub Secrets** (`r2-sync.yml` 用): `CLOUDFLARE_API_TOKEN` (R2 Edit スコープ), `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET` (内部バケット名、`pub-…` ではない)。

**公開 r2.dev URL のセットアップ:** R2 バケット作成後、ダッシュボードの "Public Access" (R2.dev subdomain) を有効化し、表示される `https://pub-<hash>.r2.dev/` を `deploy.yml` の `VITE_DATA_BASE` に書き込む (現在はプレースホルダ)。

**CORS は CI が適用する** — 手動ではなく。`.github/r2-cors.json` がポリシー本体で、`r2-sync.yml` が毎トリガで `wrangler r2 bucket cors set` を流す (冪等)。`.github/r2-cors.json` 自体も `paths:` フィルタに入っているので、編集すれば自動再適用される。新しいオリジンから動作確認したいときは、ローカルで `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` を export してから `npx wrangler r2 bucket cors set <bucket> --file .github/r2-cors.json` を実行する。CORS が無いとブラウザの fetch は不透明な CORS エラーで黙って失敗する。

**race window:** `deploy.yml` と `r2-sync.yml` は並列実行される。データ変更時、Pages ビルドが新しい `?v=<sha>` を参照しているのに R2/Cloudflare CDN がまだ古いオブジェクトを返す数分の窓が開く。許容範囲。アトミック性が必要なら `workflow_run` でチェーンする。

Vite は `base: './'` 設定で相対パス。`public/osm_[fclass].geojson.gz` は 4 ファイル (motorway, trunk, primary, secondary)。

## Release (ローカル版配布)

GitHub Actions (`.github/workflows/release.yml`) がリリース公開時に自動実行され、`file://` で直接開けるzipをリリースに添付する。ポストビルド処理で以下を行う:

1. **JSインライン化**: ビルド出力のJSをHTMLに埋め込み（`<script type="module">` インライン、src属性なし → `file://` でCORSに引っかからない）
2. **データ変換**: `.geojson.gz` → `.data.js`（base64エンコード、`<script>` タグで読み込み可能）

`src/main.js` の `_fetchFclassBytes` は `fetch()` 失敗時に `_loadGzViaScript` へフォールバックする。このフォールバックは `.data.js` を動的 `<script>` タグで読み込み、base64デコードしたバイト列を返す（解凍はdataProcessorが行う）。通常のHTTP環境（GitHub Pages）では `fetch()` が成功するため影響なし。Workerは `?worker&inline` でメインバンドルに埋め込まれるため追加アセットは無いが、blob Workerが起動できない環境では `_processTier` がメインスレッド処理へフォールバックする。

## Language

UI text and comments are in Japanese. The app targets Japanese road data and uses Japanese font stacks for labels.
