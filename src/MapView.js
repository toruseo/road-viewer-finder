/**
 * MapView - deck.gl + MapLibre GL JS integration
 */
import maplibregl from 'maplibre-gl';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';

// Road styling based on fclass attribute
const ROAD_STYLES = {
  motorway:  { color: [220, 50, 50, 255],  width: 6 },  // Red, thickest
  trunk:     { color: [50, 100, 220, 255], width: 4 },  // Blue
  primary:   { color: [25, 90, 50, 255], width: 2 },  // Green
  secondary: { color: [25, 90, 50, 255], width: 1 },  // Green, thinnest
};
const DEFAULT_STYLE = { color: [128, 128, 128, 255], width: 1 };

/**
 * Calculate midpoint and angle for a LineString
 */
function getLineMidpoint(coordinates) {
  if (!coordinates || coordinates.length < 2) return null;

  // Find the midpoint along the line
  let totalLength = 0;
  const segments = [];

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    segments.push({ start: coordinates[i], end: coordinates[i + 1], length });
    totalLength += length;
  }

  // Find the segment containing the midpoint
  const halfLength = totalLength / 2;
  let accumulated = 0;

  for (const seg of segments) {
    if (accumulated + seg.length >= halfLength) {
      // Interpolate within this segment
      const ratio = (halfLength - accumulated) / seg.length;
      const x = seg.start[0] + (seg.end[0] - seg.start[0]) * ratio;
      const y = seg.start[1] + (seg.end[1] - seg.start[1]) * ratio;

      // Calculate angle in degrees (for text rotation)
      const dx = seg.end[0] - seg.start[0];
      const dy = seg.end[1] - seg.start[1];
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);

      // Keep text readable (not upside down)
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;

      return { position: [x, y], angle };
    }
    accumulated += seg.length;
  }

  return null;
}

// Label sampling interval (show 1 label per N features with same name)
const LABEL_SAMPLE_INTERVAL = 10;

/**
 * Generate label data from GeoJSON features
 * - Deduplicates labels with the same name
 * - Samples labels at regular intervals for repeated road segments
 */
function generateLabels(geojson) {
  if (!geojson?.features) return [];

  const labels = [];
  const nameCount = new Map(); // Track how many times each name has appeared
  const usedNames = new Set(); // Track which names have been added

  for (const feature of geojson.features) {
    const name = feature.properties?.name;
    if (!name) continue;

    const geometry = feature.geometry;
    if (!geometry) continue;

    // Count occurrences of this name
    const count = (nameCount.get(name) || 0) + 1;
    nameCount.set(name, count);

    // Only add label at first occurrence or at regular intervals
    // This ensures we get one label early, then additional ones spaced out
    const shouldAdd = count === 1 || (count % LABEL_SAMPLE_INTERVAL === 0);

    if (!shouldAdd) continue;

    let midpoint = null;

    if (geometry.type === 'LineString') {
      midpoint = getLineMidpoint(geometry.coordinates);
    } else if (geometry.type === 'MultiLineString') {
      // Use the longest segment for MultiLineString
      let longestCoords = geometry.coordinates[0];
      let maxLen = 0;
      for (const coords of geometry.coordinates) {
        if (coords.length > maxLen) {
          maxLen = coords.length;
          longestCoords = coords;
        }
      }
      midpoint = getLineMidpoint(longestCoords);
    }

    if (midpoint) {
      const fclass = feature.properties?.fclass || '';
      const ref = feature.properties?.ref || '';
      labels.push({
        name,
        position: midpoint.position,
        angle: midpoint.angle,
        fclass,
        ref,
        label: [name, fclass, ref].filter(Boolean).join(' ')
      });
    }
  }

  console.log(`Label stats: ${nameCount.size} unique names, ${labels.length} labels generated`);
  return labels;
}

export class MapView {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.deckOverlay = null;
    this.currentData = null;
    this.showLabels = false;
    this.labelsData = [];
    this.tooltip = null;
    this.highlightData = null;
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

    console.log('MapView initialized with deck.gl overlay');
  }

  /**
   * Update the displayed data
   * @param {Object} geojson - GeoJSON FeatureCollection
   */
  setData(geojson) {
    console.log('setData called with', geojson?.features?.length || 0, 'features');
    this.currentData = geojson;
    this.labelsData = []; // Clear cached labels
    this.updateLayers();

    // Fit bounds to data if available
    if (geojson && geojson.features && geojson.features.length > 0) {
      this.fitToData(geojson);
    }
  }

  /**
   * Update deck.gl layers
   */
  updateLayers() {
    if (!this.currentData) {
      this.deckOverlay.setProps({ layers: [] });
      return;
    }

    console.log('Creating GeoJsonLayer...');

    const geojsonLayer = new GeoJsonLayer({
      id: 'geojson-layer',
      data: this.currentData,
      // Line styling
      stroked: true,
      filled: true,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1,
      lineWidthMaxPixels: 20,
      getLineWidth: f => {
        const fclass = f.properties?.fclass;
        return (ROAD_STYLES[fclass] || DEFAULT_STYLE).width;
      },
      getLineColor: f => {
        const fclass = f.properties?.fclass;
        return (ROAD_STYLES[fclass] || DEFAULT_STYLE).color;
      },
      // Polygon styling
      getFillColor: [66, 133, 244, 50],
      // Point styling
      pointType: 'circle',
      getPointRadius: 5,
      pointRadiusUnits: 'pixels',
      // Interaction
      pickable: true,
      onHover: (info) => this.handleHover(info),
      updateTriggers: {
        getLineColor: [this.currentData],
        getLineWidth: [this.currentData]
      }
    });

    const layers = [geojsonLayer];

    // Add labels if enabled
    if (this.showLabels) {
      // Generate labels only if not cached
      if (this.labelsData.length === 0) {
        this.labelsData = generateLabels(this.currentData);
        console.log(`Generated ${this.labelsData.length} labels`);
      }

      const textLayer = new TextLayer({
        id: 'road-labels',
        data: this.labelsData,
        getPosition: d => d.position,
        getText: d => d.label,
        getAngle: d => d.angle,
        getSize: 12,
        getColor: [0, 0, 0, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif',
        fontWeight: 'bold',
        outlineWidth: 2,
        outlineColor: [255, 255, 255, 255],
        billboard: false,
        sizeUnits: 'pixels',
        sizeMinPixels: 10,
        sizeMaxPixels: 16,
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
    this.updateLayers();
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
        const fclass = props?.fclass || '';
        const ref = props?.ref || '';
        const label = [name, fclass, ref].filter(Boolean).join(' ');
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
        const refs = (props.ref || '').split(';').map(r => r.trim());
        if (!refs.includes(refTrim)) return false;
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
    } else {
      this.highlightData = {
        type: 'FeatureCollection',
        features: features
      };
      // Fit to highlighted features
      this.fitToData(this.highlightData);
    }
    this.updateLayers();
  }

  /**
   * Clear highlight
   */
  clearHighlight() {
    this.highlightData = null;
    this.updateLayers();
  }

  /**
   * Clear all data from the map
   */
  clearData() {
    this.currentData = [];
    this.deckOverlay.setProps({
      layers: []
    });
  }

  /**
   * Get the map instance
   * @returns {maplibregl.Map}
   */
  getMap() {
    return this.map;
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.deckOverlay) {
      this.map.removeControl(this.deckOverlay);
    }
    if (this.map) {
      this.map.remove();
    }
  }
}
