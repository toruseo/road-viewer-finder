/**
 * MapView - MapLibre GL JS + PMTiles integration
 */
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// Display names for fclass (user-facing)
const FCLASS_DISPLAY_NAMES = {
  motorway: '高速道路',
  trunk: '国道',
  primary: '主要地方道',
  secondary: '一般都道府県道',
};

// Road styling based on fclass attribute
export const ROAD_STYLES = {
  motorway:  { color: 'rgb(220, 50, 50)',  width: 6 },
  trunk:     { color: 'rgb(50, 100, 220)', width: 4 },
  primary:   { color: 'rgb(25, 90, 50)',   width: 3 },
  secondary: { color: 'rgb(25, 90, 50)',   width: 2 },
};
export const DEFAULT_ROAD_STYLE = { color: 'rgb(128, 128, 128)', width: 1 };

// Layer configs: draw order (first = bottom, last = top)
const ROAD_LAYER_CONFIGS = [
  { id: 'road-secondary', sourceLayer: 'secondary', ...ROAD_STYLES.secondary },
  { id: 'road-primary',   sourceLayer: 'primary',   ...ROAD_STYLES.primary },
  { id: 'road-trunk',     sourceLayer: 'trunk',      ...ROAD_STYLES.trunk },
  { id: 'road-motorway',  sourceLayer: 'motorway',   ...ROAD_STYLES.motorway },
];

export class MapView {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.tooltip = null;
    this.onFeatureDoubleClick = null;
    this._lastClickTime = 0;
    this._lastClickProps = null;
  }

  /**
   * Initialize the map
   * @returns {Promise<void>}
   */
  async init() {
    // Register PMTiles protocol
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    // Initialize MapLibre GL JS
    this.map = new maplibregl.Map({
      container: this.containerId,
      style: {
        version: 8,
        glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
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

    // Add PMTiles vector source
    const pmtilesUrl = new URL(import.meta.env.BASE_URL + 'roads.pmtiles', window.location.href).href;
    this.map.addSource('roads', {
      type: 'vector',
      url: 'pmtiles://' + pmtilesUrl,
    });

    // Add road layers (draw order: secondary → primary → trunk → motorway)
    for (const config of ROAD_LAYER_CONFIGS) {
      // Highlight layer (below the road, wider yellow line)
      this.map.addLayer({
        id: config.id + '-highlight',
        type: 'line',
        source: 'roads',
        'source-layer': config.sourceLayer,
        filter: ['==', 'name', ''],  // Nothing matches initially
        paint: {
          'line-color': 'rgb(255, 255, 0)',
          'line-width': 8,
        },
      });

      // Road layer
      this.map.addLayer({
        id: config.id,
        type: 'line',
        source: 'roads',
        'source-layer': config.sourceLayer,
        paint: {
          'line-color': config.color,
          'line-width': config.width,
        },
      });
    }

    // Label layers (MapLibre built-in collision detection)
    for (const config of ROAD_LAYER_CONFIGS) {
      this.map.addLayer({
        id: config.id + '-label',
        type: 'symbol',
        source: 'roads',
        'source-layer': config.sourceLayer,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-size': 14,
          'text-font': ['Noto Sans Regular'],
          'text-allow-overlap': false,
          'symbol-spacing': 250,
        },
        paint: {
          'text-color': '#000',
          'text-halo-color': '#fff',
          'text-halo-width': 1.5,
        },
      });
    }

    // Get tooltip element
    this.tooltip = document.getElementById('tooltip');

    // Hover tooltip
    const roadLayerIds = ROAD_LAYER_CONFIGS.map(c => c.id);
    this.map.on('mousemove', (e) => this._handleMouseMove(e, roadLayerIds));
    this.map.on('mouseleave', () => {
      if (this.tooltip) this.tooltip.style.display = 'none';
    });

    // Double-click detection on roads
    this.map.on('click', (e) => this._handleClick(e, roadLayerIds));

    // Disable default double-click zoom to avoid conflict
    this.map.doubleClickZoom.disable();

    console.log('MapView initialized with PMTiles');
  }

  /**
   * Set visibility for a road fclass
   * @param {string} fclass - fclass value
   * @param {boolean} visible
   */
  setFclassVisible(fclass, visible) {
    const visibility = visible ? 'visible' : 'none';
    const layerId = `road-${fclass}`;
    this.map.setLayoutProperty(layerId, 'visibility', visibility);
    this.map.setLayoutProperty(layerId + '-label', 'visibility', visibility);
    this.map.setLayoutProperty(layerId + '-highlight', 'visibility', visibility);
  }

  /**
   * Toggle label visibility
   * @param {boolean} visible
   */
  setLabelsVisible(visible) {
    const visibility = visible ? 'visible' : 'none';
    for (const config of ROAD_LAYER_CONFIGS) {
      this.map.setLayoutProperty(config.id + '-label', 'visibility', visibility);
    }
  }

  /**
   * Set highlight filter to show matching roads in yellow
   * @param {Array} matchFilter - MapLibre filter expression, e.g. ['in', 'name', 'name1', 'name2']
   */
  setHighlight(matchFilter) {
    for (const config of ROAD_LAYER_CONFIGS) {
      this.map.setFilter(config.id + '-highlight', matchFilter);
    }
  }

  /**
   * Clear highlight
   */
  clearHighlight() {
    for (const config of ROAD_LAYER_CONFIGS) {
      this.map.setFilter(config.id + '-highlight', ['==', 'name', '']);
    }
  }

  /**
   * Fit map to given bounds
   * @param {Array} bbox - [minLng, minLat, maxLng, maxLat]
   */
  fitToBBox(bbox) {
    this.map.fitBounds(
      [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
      { padding: 50, maxZoom: 18, duration: 1000 }
    );
  }

  /**
   * Handle mousemove for tooltip
   */
  _handleMouseMove(e, layerIds) {
    if (!this.tooltip) return;

    const features = this.map.queryRenderedFeatures(e.point, { layers: layerIds });

    if (features.length > 0) {
      const props = features[0].properties;
      const name = props?.name;
      if (name) {
        const fclass = FCLASS_DISPLAY_NAMES[props?.fclass] || props?.fclass || '';
        const ref = props?.ref || '';
        const extra = [fclass, ref].filter(Boolean).join(' ');
        const label = extra ? `${name} (${extra})` : name;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = `${e.point.x + 10}px`;
        this.tooltip.style.top = `${e.point.y + 10}px`;
        this.tooltip.textContent = label;
        this.map.getCanvas().style.cursor = 'pointer';
      } else {
        this.tooltip.style.display = 'none';
        this.map.getCanvas().style.cursor = '';
      }
    } else {
      this.tooltip.style.display = 'none';
      this.map.getCanvas().style.cursor = '';
    }
  }

  /**
   * Handle click for double-click detection on roads
   */
  _handleClick(e, layerIds) {
    const features = this.map.queryRenderedFeatures(e.point, { layers: layerIds });
    if (features.length === 0) return;

    const props = features[0].properties;
    const now = Date.now();

    if (now - this._lastClickTime < 400 && this._lastClickProps?.name === props?.name) {
      // Double click detected
      if (this.onFeatureDoubleClick) {
        this.onFeatureDoubleClick(props);
      }
      this._lastClickTime = 0;
      this._lastClickProps = null;
    } else {
      this._lastClickTime = now;
      this._lastClickProps = props;
    }
  }
}
