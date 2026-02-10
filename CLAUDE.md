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

The app has two active source files with clear responsibilities:

- **`src/main.js`** - `App` class: UI wiring (search panel, label toggle, help modal, legend), per-fclass GeoJSON loading with gzip decompression (pako). Imports README.md as raw text (`?raw`) and renders it as the help modal content via `marked`.
- **`src/MapView.js`** - `MapView` class: All map/rendering logic. Manages deck.gl `MapboxOverlay` with per-tier `GeoJsonLayer`s (roads), a `TextLayer` (labels), and a highlight `GeoJsonLayer` (search results in yellow). Handles viewport-based label filtering with pixel-space deduplication, hover tooltips, double-click detection, and search.

**`index.html`** contains all HTML structure, CSS styles, and UI elements (search panel, legend, tooltip, help modal, progress bar). Styles are inline in `<style>`, not in separate CSS files.

**Unused files**: `src/FileLoader.js` and `src/worker/parser.worker.js` exist but are not integrated into the app.

## Key Data Flow

1. `App.loadAndShowFclass(fclass)` fetches and decompresses per-fclass files from `public/osm_[fclass].geojson.gz` (four files: motorway, trunk, primary, secondary). Detects gzip magic bytes since dev server may auto-decompress.
2. `MapView.setTierData(fclass, geojson)` receives data per tier, sorts features by z-order (motorway on top), and renders via deck.gl layers.
3. Labels are generated as point candidates along LineStrings at ~0.05 degree intervals, then filtered per viewport using screen-pixel grid spacing (150px minimum).
4. Search filters features in-memory and highlights matches with a separate yellow GeoJsonLayer.

## Road Styling

Road styles are defined in `ROAD_STYLES`, `Z_ORDER`, and `ROAD_LAYERS` constants in MapView.js. The `fclass` property from OSM data drives both color/width and draw order. `ROAD_LAYERS` defines the per-tier layer array (draw order: secondary → primary → trunk → motorway). Legend items in index.html use `data-fclass` attributes and are styled programmatically from `ROAD_STYLES`.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) auto-deploys to GitHub Pages on push to `main`. Vite is configured with `base: './'` for relative paths. The GeoJSON data files live in `public/` as gzip-compressed `osm_[fclass].geojson.gz` (one file per road type).

## Language

UI text and comments are in Japanese. The app targets Japanese road data and uses Japanese font stacks for labels.
