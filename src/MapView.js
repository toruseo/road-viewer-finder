/**
 * MapView - deck.gl + MapLibre GL JS integration
 */
import maplibregl from 'maplibre-gl';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';

// Display names for fclass (user-facing)
const FCLASS_DISPLAY_NAMES = {
  motorway: '高速道路',
  trunk: '国道',
  primary: '主要地方道',
  secondary: '一般都道府県道',
};

// Road styling based on fclass attribute
export const ROAD_STYLES = {
  motorway:  { color: [220, 50, 50, 255],  width: 6 },  // Red, thickest
  trunk:     { color: [50, 100, 220, 255], width: 4 },  // Blue
  primary:   { color: [25, 90, 50, 255], width: 3 },  // Green
  secondary: { color: [25, 90, 50, 255], width: 2 },  // Green, thinnest
};
export const DEFAULT_ROAD_STYLE = { color: [128, 128, 128, 255], width: 1 };

// Z-order priority: higher number = drawn later (on top)
const Z_ORDER = {
  secondary: 1,
  primary: 2,
  trunk: 3,
  motorway: 4,
};
const DEFAULT_Z_ORDER = 0;

// Road layer definitions: array order = draw order (first = bottom, last = top)
export const ROAD_LAYERS = [
  { id: 'road-secondary', fclass: 'secondary', ...ROAD_STYLES.secondary },
  { id: 'road-primary',   fclass: 'primary',   ...ROAD_STYLES.primary },
  { id: 'road-trunk',     fclass: 'trunk',     ...ROAD_STYLES.trunk },
  { id: 'road-motorway',  fclass: 'motorway',  ...ROAD_STYLES.motorway },
];

/**
 * Sort features by z-order (lower z-order drawn first, higher on top)
 */
function sortByZOrder(geojson) {
  if (!geojson?.features) return geojson;

  const sortedFeatures = [...geojson.features].sort((a, b) => {
    const zA = Z_ORDER[a.properties?.fclass] ?? DEFAULT_Z_ORDER;
    const zB = Z_ORDER[b.properties?.fclass] ?? DEFAULT_Z_ORDER;
    return zA - zB;
  });

  return {
    ...geojson,
    features: sortedFeatures
  };
}

// --- Spatial grid partitioning for viewport culling ---
const GRID_CELL_SIZE = 2; // degrees per cell (~150-220km at Japan's latitude)
const GRID_ORIGIN_LNG = 122;
const GRID_ORIGIN_LAT = 24;

/**
 * Compute bounding box [minLng, minLat, maxLng, maxLat] for a GeoJSON feature.
 */
function getFeatureBBox(feature) {
  const geom = feature.geometry;
  if (!geom || !geom.coordinates) return null;

  let minLng = Infinity, minLat = Infinity;
  let maxLng = -Infinity, maxLat = -Infinity;

  const scan = (coords) => {
    if (typeof coords[0] === 'number') {
      if (coords[0] < minLng) minLng = coords[0];
      if (coords[0] > maxLng) maxLng = coords[0];
      if (coords[1] < minLat) minLat = coords[1];
      if (coords[1] > maxLat) maxLat = coords[1];
    } else {
      for (const c of coords) scan(c);
    }
  };

  scan(geom.coordinates);
  if (minLng === Infinity) return null;
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Partition a FeatureCollection into spatial grid cells.
 * Features spanning cell boundaries are included in all overlapping cells.
 * @returns {Map<string, Feature[]>} cellKey -> features array
 */
function partitionFeaturesByGrid(geojson) {
  const cellMap = new Map();

  for (const feature of geojson.features) {
    const bbox = getFeatureBBox(feature);
    if (!bbox) continue;

    const [minLng, minLat, maxLng, maxLat] = bbox;
    const colMin = Math.floor((minLng - GRID_ORIGIN_LNG) / GRID_CELL_SIZE);
    const colMax = Math.floor((maxLng - GRID_ORIGIN_LNG) / GRID_CELL_SIZE);
    const rowMin = Math.floor((minLat - GRID_ORIGIN_LAT) / GRID_CELL_SIZE);
    const rowMax = Math.floor((maxLat - GRID_ORIGIN_LAT) / GRID_CELL_SIZE);

    for (let col = colMin; col <= colMax; col++) {
      for (let row = rowMin; row <= rowMax; row++) {
        const key = `${col}_${row}`;
        if (!cellMap.has(key)) cellMap.set(key, []);
        cellMap.get(key).push(feature);
      }
    }
  }

  return cellMap;
}

/**
 * Check if two Sets contain the same elements.
 */
function setsEqual(a, b) {
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

// Interval for placing label candidates along a line (in degrees, ~5km)
const LABEL_CANDIDATE_INTERVAL = 0.05;

// Minimum road length to generate labels (in meters, approximate)
const LABEL_MIN_ROAD_LENGTH_M = 100;

/**
 * Generate evenly-spaced label points along a LineString.
 * Short lines get one point at the midpoint.
 * Long lines get multiple points at regular intervals.
 * Returns an array of { position, angle }.
 */
function getLinePoints(coordinates) {
  if (!coordinates || coordinates.length < 2) return [];

  let totalLength = 0;
  const segments = [];

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    segments.push({ start: coordinates[i], end: coordinates[i + 1], length });
    totalLength += length;
  }

  if (totalLength === 0) return [];

  // 短い道路のラベルをスキップ（度→メートルの近似変換: 日本緯度帯で1°≈100km）
  if (totalLength * 100_000 < LABEL_MIN_ROAD_LENGTH_M) return [];

  // Determine how many points to place
  const numPoints = Math.max(1, Math.round(totalLength / LABEL_CANDIDATE_INTERVAL));
  const spacing = totalLength / (numPoints + 1);

  const points = [];

  for (let p = 1; p <= numPoints; p++) {
    const targetDist = spacing * p;
    let accumulated = 0;

    for (const seg of segments) {
      if (accumulated + seg.length >= targetDist) {
        const ratio = (targetDist - accumulated) / seg.length;
        const x = seg.start[0] + (seg.end[0] - seg.start[0]) * ratio;
        const y = seg.start[1] + (seg.end[1] - seg.start[1]) * ratio;

        const dx = seg.end[0] - seg.start[0];
        const dy = seg.end[1] - seg.start[1];
        let angle = Math.atan2(dy, dx) * (180 / Math.PI);

        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;

        points.push({ position: [x, y], angle });
        break;
      }
      accumulated += seg.length;
    }
  }

  return points;
}

// Road importance for label priority (higher = more important, labeled first)
const LABEL_PRIORITY = {
  motorway: 5,
  trunk: 4,
  primary: 3,
  secondary: 2,
};
const DEFAULT_LABEL_PRIORITY = 1;

// Minimum spacing between labels in screen pixels
const LABEL_MIN_SPACING_PX = 150;

/**
 * Generate all label candidates from GeoJSON features (no spatial filtering).
 * Sorted by road importance so higher-priority roads get labels first.
 */
function generateCandidates(geojson) {
  if (!geojson?.features) return [];

  const candidates = [];

  for (const feature of geojson.features) {
    const name = feature.properties?.name;
    if (!name) continue;

    const geometry = feature.geometry;
    if (!geometry) continue;

    let points = [];

    if (geometry.type === 'LineString') {
      points = getLinePoints(geometry.coordinates);
    } else if (geometry.type === 'MultiLineString') {
      for (const coords of geometry.coordinates) {
        points.push(...getLinePoints(coords));
      }
    }

    const fclass = feature.properties?.fclass || '';
    const ref = feature.properties?.ref || '';
    const priority = LABEL_PRIORITY[fclass] || DEFAULT_LABEL_PRIORITY;

    for (const pt of points) {
      candidates.push({
        name,
        position: pt.position,
        angle: pt.angle,
        fclass,
        ref,
        label: name,
        priority
      });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  console.log(`Label candidates: ${candidates.length}`);
  return candidates;
}

export class MapView {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.deckOverlay = null;
    this.currentData = { type: 'FeatureCollection', features: [] };
    this.showLabels = true;
    this.labelCandidates = [];      // All label candidates (pre-computed)
    this.highlightCandidates = [];  // Label candidates for highlighted roads (priority)
    this.labelsData = [];           // Currently visible labels (filtered by viewport)
    this.tooltip = null;
    this.highlightData = null;
    this.tierDataMap = ROAD_LAYERS.map(layer => ({
      id: layer.id,
      fclass: layer.fclass,
      color: layer.color,
      width: layer.width,
      geojson: { type: 'FeatureCollection', features: [] },
      cellMap: new Map(),   // cellKey -> FeatureCollection (for grid-based rendering)
      cellKeys: [],         // sorted array of cell keys with data
    }));
    this._hiddenFclasses = new Set();  // Set of fclass values (null for 'other') currently hidden
    this._knownFclasses = new Set(ROAD_LAYERS.filter(l => l.fclass).map(l => l.fclass));
    this._visibleCells = new Set();    // cell keys currently intersecting viewport
    this._roadLayers = null;  // キャッシュされた道路レイヤー配列
    this._moveThrottleTimer = null;
    this._handleHover = (info) => this.handleHover(info);
    this._handleClick = (info) => this.handleClick(info);
    this._fillColor = [66, 133, 244, 50];
    this._onMoveEnd = null;
    this._lastClickTime = 0;
    this._lastClickFeature = null;
    this.onFeatureDoubleClick = null;  // callback(properties)
  }

  /**
   * Initialize the map
   * @returns {Promise<void>}
   */
  async init() {
    // Initialize MapLibre GL JS
    this.map = new maplibregl.Map({
      container: this.containerId,
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: [
              'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }
        },
        layers: [
          {
            id: 'osm-tiles-layer',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19
          }
        ]
      },
      center: [139.7, 35.7], // Tokyo
      zoom: 5,
      antialias: true,
      dragRotate: false
    });

    // Add navigation control
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add scale bar (metric)
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    // Wait for map to load
    await new Promise((resolve) => {
      this.map.on('load', resolve);
    });

    // Initialize deck.gl overlay
    this.deckOverlay = new MapboxOverlay({
      interleaved: false,
      layers: []
    });

    this.map.addControl(this.deckOverlay);

    // Get tooltip element
    this.tooltip = document.getElementById('tooltip');

    // Update cell visibility and labels on viewport change
    this._onMoveEnd = () => {
      let needUpdate = false;

      // Update visible grid cells
      const newVisibleCells = this._getVisibleCells();
      if (!setsEqual(this._visibleCells, newVisibleCells)) {
        this._visibleCells = newVisibleCells;
        this._roadLayers = null;
        needUpdate = true;
      }

      // Re-filter labels
      if (this.showLabels && this.labelCandidates.length > 0) {
        this.labelsData = this.filterLabelsForViewport();
        needUpdate = true;
      }

      if (needUpdate) {
        this.updateLayers();
      }
    };
    this.map.on('moveend', this._onMoveEnd);

    // Throttled cell visibility update during panning (prevents pop-in)
    this.map.on('move', () => {
      if (this._moveThrottleTimer) return;
      this._moveThrottleTimer = setTimeout(() => {
        this._moveThrottleTimer = null;
        const newVisibleCells = this._getVisibleCells();
        if (!setsEqual(this._visibleCells, newVisibleCells)) {
          this._visibleCells = newVisibleCells;
          this._roadLayers = null;
          this.updateLayers();
        }
      }, 100);
    });

    console.log('MapView initialized with deck.gl overlay');
  }

  /**
   * Set data for a specific road fclass tier
   * @param {string} fclass - fclass value (e.g. 'motorway')
   * @param {Object} geojson - GeoJSON FeatureCollection for this fclass
   */
  setTierData(fclass, geojson) {
    const tier = this.tierDataMap.find(t => t.fclass === fclass);
    if (tier) {
      tier.geojson = geojson;

      // Partition features into spatial grid cells
      const rawCellMap = partitionFeaturesByGrid(geojson);
      tier.cellMap = new Map();
      tier.cellKeys = [];
      for (const [key, features] of rawCellMap) {
        tier.cellMap.set(key, { type: 'FeatureCollection', features });
        tier.cellKeys.push(key);
      }
      tier.cellKeys.sort();
      console.log(`Grid partitioned ${fclass}: ${tier.cellKeys.length} cells, ${geojson.features.length} features`);
    }

    this._rebuildCurrentData();
    this.labelCandidates = this.showLabels ? generateCandidates(this.currentData) : [];
    this.labelsData = [];
    this._visibleCells = this._getVisibleCells();
    this._roadLayers = null;
    this.updateLayers();
  }

  /**
   * Rebuild currentData from all tier data (for search, labels, etc.)
   */
  _rebuildCurrentData() {
    const allFeatures = this.tierDataMap.flatMap(t => t.geojson.features);
    this.currentData = { type: 'FeatureCollection', features: allFeatures };
  }

  /**
   * Compute which grid cells intersect the current viewport (with padding).
   * @returns {Set<string>} visible cell keys
   */
  _getVisibleCells() {
    if (!this.map) return new Set();

    const bounds = this.map.getBounds();
    const padding = GRID_CELL_SIZE * 0.1;
    const west = bounds.getWest() - padding;
    const east = bounds.getEast() + padding;
    const south = bounds.getSouth() - padding;
    const north = bounds.getNorth() + padding;

    const colMin = Math.floor((west - GRID_ORIGIN_LNG) / GRID_CELL_SIZE);
    const colMax = Math.floor((east - GRID_ORIGIN_LNG) / GRID_CELL_SIZE);
    const rowMin = Math.floor((south - GRID_ORIGIN_LAT) / GRID_CELL_SIZE);
    const rowMax = Math.floor((north - GRID_ORIGIN_LAT) / GRID_CELL_SIZE);

    const visible = new Set();
    for (let col = colMin; col <= colMax; col++) {
      for (let row = rowMin; row <= rowMax; row++) {
        visible.add(`${col}_${row}`);
      }
    }
    return visible;
  }

  /**
   * Build road layers: one GeoJsonLayer per tier per grid cell.
   * Visibility is toggled per cell based on viewport intersection.
   * Data references are preserved to avoid deck.gl re-tessellation.
   */
  _buildRoadLayers() {
    this._roadLayers = [];

    for (const tier of this.tierDataMap) {
      const tierHidden = this._hiddenFclasses.has(tier.fclass);

      for (const cellKey of tier.cellKeys) {
        const cellVisible = this._visibleCells.has(cellKey);
        const visible = !tierHidden && cellVisible;

        this._roadLayers.push(new GeoJsonLayer({
          id: `${tier.id}__${cellKey}`,
          data: tier.cellMap.get(cellKey), // same object reference for diff optimization
          visible,
          stroked: true,
          filled: true,
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 1,
          lineWidthMaxPixels: 20,
          getLineWidth: tier.width,
          getLineColor: tier.color,
          getFillColor: this._fillColor,
          pointType: 'circle',
          getPointRadius: 5,
          pointRadiusUnits: 'pixels',
          pickable: visible,
          onHover: this._handleHover,
          onClick: this._handleClick,
        }));
      }
    }
  }

  /**
   * Update deck.gl layers
   */
  updateLayers() {
    if (!this._roadLayers) {
      this._buildRoadLayers();
    }

    const layers = [...this._roadLayers];

    // Add labels if enabled
    if (this.showLabels) {
      // Generate candidates only if not cached
      if (this.labelCandidates.length === 0) {
        this.labelCandidates = generateCandidates(this.currentData);
      }
      if (this.highlightData?.features?.length > 0 && this.highlightCandidates.length === 0) {
        this.highlightCandidates = generateCandidates(this.highlightData);
      }
      // Filter by viewport pixels if not already done
      if (this.labelsData.length === 0) {
        this.labelsData = this.filterLabelsForViewport();
      }

      const labelSize = 14;
      const textLayer = new TextLayer({
        id: 'road-labels',
        data: this.labelsData,
        getPosition: d => d.position,
        getText: d => d.label,
        getAngle: d => d.angle,
        getSize: labelSize,
        getColor: [0, 0, 0, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        getPixelOffset: d => {
          const rad = d.angle * Math.PI / 180;
          return [-labelSize*0.9 * Math.sin(rad), -labelSize*0.9 * Math.cos(rad)];
        },
        fontFamily: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif',
        fontWeight: 'bold',
        outlineWidth: 0,
        billboard: false,
        sizeUnits: 'pixels',
        sizeMinPixels: 12,
        sizeMaxPixels: 18,
        pickable: false,
        characterSet: 'auto'
      });

      layers.push(textLayer);
    }

    // Add highlight layer if there are highlighted features
    if (this.highlightData && this.highlightData.features.length > 0) {
      const highlightLayer = new GeoJsonLayer({
        id: 'highlight-layer',
        data: this.highlightData,
        stroked: true,
        filled: false,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 4,
        lineWidthMaxPixels: 30,
        getLineWidth: 8,
        getLineColor: [255, 255, 0, 255], // Yellow
        pickable: false
      });
      layers.push(highlightLayer);
    }

    this.deckOverlay.setProps({ layers });

    console.log('Layers set');
  }

  /**
   * Toggle label visibility
   * @param {boolean} visible - Whether to show labels
   */
  setLabelsVisible(visible) {
    this.showLabels = visible;
    this.labelsData = []; // Reset filtered labels so they get recalculated
    this.updateLayers();
  }

  /**
   * Set visibility for a road fclass
   * @param {string|null} fclass - fclass value (null for 'other')
   * @param {boolean} visible
   */
  setFclassVisible(fclass, visible) {
    if (visible) {
      this._hiddenFclasses.delete(fclass);
    } else {
      this._hiddenFclasses.add(fclass);
    }
    this.labelsData = [];
    this._roadLayers = null;
    this.updateLayers();
  }

  /**
   * Filter label candidates by screen-pixel spacing.
   * Projects each candidate to screen coordinates and uses a grid to ensure
   * no two labels are closer than LABEL_MIN_SPACING_PX pixels.
   */
  filterLabelsForViewport() {
    if (!this.labelCandidates.length || !this.map) return [];

    const bounds = this.map.getBounds();
    const padding = 0.01;
    const west = bounds.getWest() - padding;
    const east = bounds.getEast() + padding;
    const south = bounds.getSouth() - padding;
    const north = bounds.getNorth() + padding;

    const cellSize = LABEL_MIN_SPACING_PX;
    const occupied = new Map();
    const labels = [];

    // Process highlight candidates first, then regular candidates
    const allCandidates = this.highlightCandidates.length > 0
      ? [...this.highlightCandidates, ...this.labelCandidates]
      : this.labelCandidates;

    for (const candidate of allCandidates) {
      // Skip labels for hidden road types
      const tierFclass = this._knownFclasses.has(candidate.fclass) ? candidate.fclass : null;
      if (this._hiddenFclasses.has(tierFclass)) continue;

      const [lng, lat] = candidate.position;

      // Skip candidates outside the viewport
      if (lng < west || lng > east || lat < south || lat > north) continue;

      // Project geographic coordinates to screen pixels
      const pixel = this.map.project([lng, lat]);
      const cellX = Math.floor(pixel.x / cellSize);
      const cellY = Math.floor(pixel.y / cellSize);

      // Check 3x3 neighborhood for already-placed labels
      let tooClose = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (occupied.has(`${cellX + dx},${cellY + dy}`)) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) break;
      }

      if (!tooClose) {
        labels.push(candidate);
        occupied.set(`${cellX},${cellY}`, true);
      }
    }

    return labels;
  }

  /**
   * Handle click events for double-click detection
   */
  handleClick(info) {
    if (!info.object) return;

    const now = Date.now();
    if (now - this._lastClickTime < 400 && this._lastClickFeature === info.object) {
      // Double click detected
      if (this.onFeatureDoubleClick) {
        this.onFeatureDoubleClick(info.object.properties);
      }
      this._lastClickTime = 0;
      this._lastClickFeature = null;
    } else {
      this._lastClickTime = now;
      this._lastClickFeature = info.object;
    }
  }

  /**
   * Handle hover events on features
   * @param {Object} info - Picking info from deck.gl
   */
  handleHover(info) {
    if (!this.tooltip) return;

    if (info.object) {
      const props = info.object.properties;
      const name = props?.name;
      if (name) {
        const fclass = FCLASS_DISPLAY_NAMES[props?.fclass] || props?.fclass || '';
        const ref = props?.ref || '';
        const extra = [fclass, ref].filter(Boolean).join(' ');
        const label = extra ? `${name} (${extra})` : name;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = `${info.x + 10}px`;
        this.tooltip.style.top = `${info.y + 10}px`;
        this.tooltip.textContent = label;
      } else {
        this.tooltip.style.display = 'none';
      }
    } else {
      this.tooltip.style.display = 'none';
    }
  }

  /**
   * Fit map bounds to the data
   * @param {Object} geojson - GeoJSON FeatureCollection
   */
  fitToData(geojson) {
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    const features = geojson.features || [];

    // Sample features for bounds calculation (for performance)
    const sampleSize = Math.min(features.length, 10000);
    const step = Math.max(1, Math.floor(features.length / sampleSize));

    const processCoords = (coords) => {
      if (typeof coords[0] === 'number') {
        // Single coordinate [lng, lat]
        const lng = coords[0];
        const lat = coords[1];
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      } else {
        // Array of coordinates
        for (const c of coords) {
          processCoords(c);
        }
      }
    };

    for (let i = 0; i < features.length; i += step) {
      const geometry = features[i].geometry;
      if (geometry && geometry.coordinates) {
        processCoords(geometry.coordinates);
      }
    }

    // Validate bounds
    if (minLng !== Infinity && maxLng !== -Infinity &&
        minLat !== Infinity && maxLat !== -Infinity) {
      console.log('Fitting bounds:', [minLng, minLat], [maxLng, maxLat]);

      // Add some padding
      const lngPadding = (maxLng - minLng) * 0.1 || 0.01;
      const latPadding = (maxLat - minLat) * 0.1 || 0.01;

      this.map.fitBounds([
        [minLng - lngPadding, minLat - latPadding],
        [maxLng + lngPadding, maxLat + latPadding]
      ], {
        padding: 50,
        maxZoom: 18,
        duration: 1000
      });
    }
  }

  /**
   * Search for features matching the query
   * @param {Object} query - Search query { name, fclass, ref }
   * @returns {Array} - Matching features
   */
  search({ name, fclass, ref }) {
    if (!this.currentData?.features) return [];

    const nameTrim = name?.trim() || '';
    const fclassTrim = fclass?.trim() || '';
    const refTrim = ref?.trim() || '';

    // If all fields are empty, return empty
    if (!nameTrim && !fclassTrim && !refTrim) return [];

    return this.currentData.features.filter(f => {
      const props = f.properties || {};
      if (nameTrim && !(props.name || '').includes(nameTrim)) return false;
      if (fclassTrim && props.fclass !== fclassTrim) return false;
      if (refTrim) {
        // ref may contain multiple values separated by ';'
        const refLower = refTrim.toLowerCase();
        const refs = (props.ref || '').split(';').map(r => r.trim().toLowerCase());
        if (!refs.includes(refLower)) return false;
      }
      return true;
    });
  }

  /**
   * Set highlighted features
   * @param {Array} features - Features to highlight
   */
  setHighlight(features) {
    if (!features || features.length === 0) {
      this.highlightData = null;
      this.highlightCandidates = [];
    } else {
      this.highlightData = {
        type: 'FeatureCollection',
        features: features
      };
      this.highlightCandidates = this.showLabels ? generateCandidates(this.highlightData) : [];
      // Fit to highlighted features
      this.fitToData(this.highlightData);
    }
    this.labelsData = [];
    this.updateLayers();
  }

  /**
   * Clear highlight
   */
  clearHighlight() {
    this.highlightData = null;
    this.highlightCandidates = [];
    this.labelsData = [];
    this.updateLayers();
  }

}
