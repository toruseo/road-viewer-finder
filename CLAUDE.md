# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

road-viewer-finder is a web app for viewing and searching Japanese OSM road data. It renders vector tiles from a PMTiles file using MapLibre GL JS natively. Deployed to GitHub Pages at https://toruseo.jp/road-viewer-finder/.

## Commands

- `npm install` - Install dependencies
- `npm run dev` - Start Vite dev server (http://localhost:5173, auto-opens browser)
- `npm run build` - Production build to `dist/`
- `npm run preview` - Preview production build

No test framework or linter is configured. ユーザが `npm run dev` を常時実行しているため、Claude側で `npm run build` による確認は不要。

### Data Pipeline (offline, run manually when OSM data is updated)

- `scripts/build_tiles.sh` - GeoJSON → MBTiles (tippecanoe) → PMTiles 変換。カレントディレクトリに `osm_*.geojson` が必要
- `scripts/build_search_index.py` - GeoJSONから検索インデックス (`public/search_index.json`) を生成

## Frameworks

- **Build**: Vite
- **Render**: MapLibre GL JS (native vector tile layers) + PMTiles

## Architecture

The app has two active source files with clear responsibilities:

- **`src/main.js`** - `App` class: UI wiring (search panel, label toggle, help modal, legend), search index loading, search logic. Imports README.md as raw text (`?raw`) and renders it as the help modal content via `marked`.
- **`src/MapView.js`** - `MapView` class: All map/rendering logic. Registers PMTiles protocol, manages MapLibre native `line` layers (roads), `symbol` layers (labels with built-in collision detection), highlight layers (search results in yellow). Handles hover tooltips and double-click detection via `queryRenderedFeatures`.

**`index.html`** contains all HTML structure, CSS styles, and UI elements (search panel, legend, tooltip, help modal). Styles are inline in `<style>`, not in separate CSS files.

## Key Data Flow

1. On map load, PMTiles vector source is registered. MapLibre fetches tiles on demand via HTTP range requests from `public/roads.pmtiles`.
2. Road layers (line), label layers (symbol), and highlight layers are added per fclass (secondary → primary → trunk → motorway draw order).
3. Labels use MapLibre's built-in `symbol-placement: line` with collision detection — no custom label filtering needed.
4. Search uses a pre-built lightweight index (`public/search_index.json`) loaded at startup. Matches are highlighted via MapLibre filter expressions, and the map fits to the merged bbox from the index.

## Road Styling

Road styles are defined in `ROAD_STYLES` and `ROAD_LAYER_CONFIGS` constants in MapView.js. The `fclass` property from OSM data (preserved in vector tiles) drives color/width. Draw order: secondary (bottom) → motorway (top). Legend items in index.html use `data-fclass` attributes and are styled programmatically from `ROAD_STYLES`.

## Data Files

- `public/roads.pmtiles` - All road data as a single PMTiles file with named layers (motorway, trunk, primary, secondary)
- `public/search_index.json` - Lightweight search index: `[{name, fclass, ref, bbox}, ...]`

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) auto-deploys to GitHub Pages on push to `main`. Vite is configured with `base: './'` for relative paths.

## Language

UI text and comments are in Japanese. The app targets Japanese road data. Labels use Noto Sans Regular glyphs from Protomaps CDN.
