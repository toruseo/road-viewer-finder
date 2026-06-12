/**
 * MapView - deck.gl + MapLibre GL JS integration
 *
 * 道路データはdataProcessorが生成したバイナリバンドル（Float32Arrayセグメント配列）
 * として受け取り、LineLayerのバイナリ属性で描画する。GeoJSONオブジェクトは保持せず、
 * テッセレーションも発生しないため、読み込み時のフリーズがない。
 *
 * 描画は3段階のLOD:
 * - zoom < 8:           粗い簡略化ジオメトリ（全国1レイヤー/種別）
 * - 8 <= zoom < 10.5:   細かい簡略化ジオメトリ（全国1レイヤー/種別）
 * - zoom >= 10.5:       フル詳細（ビューポート内のグリッドセルのみレイヤー生成）
 */
import maplibregl from 'maplibre-gl';
import { PathLayer, TextLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  COORD_QUANT,
  GRID_CELL_SIZE_LNG, GRID_CELL_SIZE_LAT,
  GRID_ORIGIN_LNG, GRID_ORIGIN_LAT, cellKey,
} from './dataProcessor.js';

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

// Road layer definitions: array order = draw order (first = bottom, last = top)
export const ROAD_LAYERS = [
  { id: 'road-secondary', fclass: 'secondary', ...ROAD_STYLES.secondary },
  { id: 'road-primary',   fclass: 'primary',   ...ROAD_STYLES.primary },
  { id: 'road-trunk',     fclass: 'trunk',     ...ROAD_STYLES.trunk },
  { id: 'road-motorway',  fclass: 'motorway',  ...ROAD_STYLES.motorway },
];

// ラベル優先順（重要な道路から先に配置）
const LABEL_TIER_ORDER = ['motorway', 'trunk', 'primary', 'secondary'];

// LOD切替ズーム
const LOD1_MIN_ZOOM = 8;     // これ未満はLOD0（粗）
const DETAIL_MIN_ZOOM = 10.5; // これ以上はフル詳細（セル単位カリング）

// Minimum spacing between labels in screen pixels
const LABEL_MIN_SPACING_PX = 150;

// ホバー・クリックの当たり判定半径（描画線幅からの余裕、ピクセル）
const PICKING_RADIUS_PX = 8;

// タッチ用の当たり判定半径（指はマウスより不正確なので大きめ）
const TOUCH_PICK_RADIUS_PX = 24;

// ダブルタップ判定: タップ間隔と位置ずれの許容値
const DOUBLE_TAP_MAX_DELAY_MS = 500;
const DOUBLE_TAP_MAX_DIST_PX = 40;

// シングルタップ判定: 押下中の移動量と押下時間の上限
const TAP_MAX_MOVE_PX = 10;
const TAP_MAX_DURATION_MS = 500;

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

export class MapView {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.deckOverlay = null;
    this.showLabels = true;
    this.labelsData = [];           // Currently visible labels (filtered by viewport)
    this.tooltip = null;
    this.tiers = new Map();         // fclass -> bundle (dataProcessor output)
    this._hiddenFclasses = new Set();
    this._lodLevel = 0;             // 0, 1 = LOD index / 2 = full detail
    this._visibleCellKeys = new Set();
    this._roadLayers = null;        // キャッシュされた道路レイヤー配列
    this._highlight = null;         // { segs, count, sets: Map<fclass, Set<featureIndex>> }
    this._moveThrottleTimer = null;
    this._onMoveEnd = null;
    this._pickMeta = new Map();     // layerId -> { tier, pathFeature }（ピッキング結果の解決用）
    this._lastTap = null;           // 直前のタップ { x, y, time, props }（ダブルタップ判定用）
    this._touchTapStart = null;     // 進行中タッチの開始情報
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
    // useDevicePixels上限2: 高DPI端末（DPR3のスマホ等）でのフラグメント負荷を抑える
    this.deckOverlay = new MapboxOverlay({
      interleaved: false,
      useDevicePixels: Math.min(window.devicePixelRatio || 1, 2),
      pickingRadius: PICKING_RADIUS_PX,
      layers: []
    });

    this.map.addControl(this.deckOverlay);

    // マウス: ブラウザネイティブのダブルクリック判定をそのまま使う。
    // 道路上なら標準ズームを抑止して検索コールバックを発火、
    // 道路がない場所では通常のダブルクリックズームをそのまま許す。
    this.map.on('dblclick', (e) => {
      const props = this._pickRoadFeatureAt(e.point);
      if (props) {
        e.preventDefault();
        if (this.onFeatureDoubleClick) this.onFeatureDoubleClick(props);
      }
    });

    // タッチ: ダブルタップズームは dblclick ではなく touchend ベースの
    // TapZoomHandler が処理するため、自前でダブルタップを検出する。
    // 「単指・移動なし・短時間」のタップが 500ms 以内・40px 以内に2回続けば成立。
    // feature の同一性は要求せず、どちらかのタップが道路に当たっていればよい。
    this.map.on('touchstart', (e) => {
      this._touchTapStart = e.points.length === 1
        ? { x: e.point.x, y: e.point.y, time: performance.now() }
        : null;
    });
    this.map.on('touchend', (e) => {
      const tapStart = this._touchTapStart;
      this._touchTapStart = null;
      if (!tapStart) {
        this._lastTap = null;  // ピンチ等の後はダブルタップ判定をリセット
        return;
      }
      const now = performance.now();
      const mx = e.point.x - tapStart.x;
      const my = e.point.y - tapStart.y;
      if (mx * mx + my * my > TAP_MAX_MOVE_PX ** 2 ||
          now - tapStart.time > TAP_MAX_DURATION_MS) {
        this._lastTap = null;  // パン等はタップとみなさない
        return;
      }

      const props = this._pickRoadFeatureAt(e.point, TOUCH_PICK_RADIUS_PX);
      // 道路上のタップはマップ標準処理（タップズーム）の対象にしない
      if (props) e.preventDefault();

      const prev = this._lastTap;
      const dx = prev ? e.point.x - prev.x : 0;
      const dy = prev ? e.point.y - prev.y : 0;
      if (prev && now - prev.time < DOUBLE_TAP_MAX_DELAY_MS &&
          dx * dx + dy * dy < DOUBLE_TAP_MAX_DIST_PX ** 2) {
        // ダブルタップ成立
        this._lastTap = null;
        const target = props || prev.props;
        if (target) {
          e.preventDefault();
          if (this.onFeatureDoubleClick) this.onFeatureDoubleClick(target);
        }
      } else {
        this._lastTap = { x: e.point.x, y: e.point.y, time: now, props };
      }
    });

    // Get tooltip element
    this.tooltip = document.getElementById('tooltip');

    // Update LOD level / cell visibility and labels on viewport change
    this._onMoveEnd = () => {
      let needUpdate = this._refreshViewportState();

      // Re-filter labels
      if (this.showLabels) {
        this.labelsData = this.filterLabelsForViewport();
        needUpdate = true;
      }

      if (needUpdate) {
        this.updateLayers();
      }
    };
    this.map.on('moveend', this._onMoveEnd);

    // Throttled visibility update during panning/zooming (prevents pop-in)
    this.map.on('move', () => {
      if (this._moveThrottleTimer) return;
      this._moveThrottleTimer = setTimeout(() => {
        this._moveThrottleTimer = null;
        if (this._refreshViewportState()) {
          this.updateLayers();
        }
      }, 100);
    });

    console.log('MapView initialized with deck.gl overlay');
  }

  /**
   * Set processed data bundle for a specific road fclass tier
   * @param {string} fclass - fclass value (e.g. 'motorway')
   * @param {Object} bundle - dataProcessor.processTier() の出力
   */
  setTierBundle(fclass, bundle) {
    this.tiers.set(fclass, bundle);
    const numRuns = bundle.cells.reduce((sum, c) => sum + c.numRuns, 0);
    console.log(`Tier ${fclass}: ${bundle.numFeatures} features, ` +
      `${bundle.cells.length} cells, ${numRuns} runs, ` +
      `${bundle.cand.count} label candidates`);

    this._refreshViewportState();
    this._roadLayers = null;
    this.labelsData = [];
    this.updateLayers();
  }

  /**
   * 現在のズーム・ビューポートからLODレベルと可視セル集合を再計算。
   * @returns {boolean} 描画レイヤーの再構築が必要なら true
   */
  _refreshViewportState() {
    if (!this.map) return false;
    const zoom = this.map.getZoom();
    const level = zoom < LOD1_MIN_ZOOM ? 0 : zoom < DETAIL_MIN_ZOOM ? 1 : 2;
    const cells = level === 2 ? this._getVisibleCells() : new Set();

    if (level !== this._lodLevel || !setsEqual(cells, this._visibleCellKeys)) {
      this._lodLevel = level;
      this._visibleCellKeys = cells;
      this._roadLayers = null;
      return true;
    }
    return false;
  }

  /**
   * Compute which grid cells intersect the current viewport (with padding).
   * @returns {Set<number>} visible cell keys
   */
  _getVisibleCells() {
    if (!this.map) return new Set();

    const bounds = this.map.getBounds();
    // セグメントは中点でセルに割り当てられるため、長いセグメントのはみ出し分を
    // 余裕を持ってカバーするパディング（片側~0.2° ≈ 20km超のセグメントまで対応）
    const padding = 0.2;
    const west = bounds.getWest() - padding;
    const east = bounds.getEast() + padding;
    const south = bounds.getSouth() - padding;
    const north = bounds.getNorth() + padding;

    const colMin = Math.floor((west - GRID_ORIGIN_LNG) / GRID_CELL_SIZE_LNG);
    const colMax = Math.floor((east - GRID_ORIGIN_LNG) / GRID_CELL_SIZE_LNG);
    const rowMin = Math.floor((south - GRID_ORIGIN_LAT) / GRID_CELL_SIZE_LAT);
    const rowMax = Math.floor((north - GRID_ORIGIN_LAT) / GRID_CELL_SIZE_LAT);

    const visible = new Set();
    for (let col = colMin; col <= colMax; col++) {
      for (let row = rowMin; row <= rowMax; row++) {
        visible.add(cellKey(col, row));
      }
    }
    return visible;
  }

  /**
   * バイナリパス配列（フラット座標 + startIndices）からPathLayerを生成。
   * ジョイント・キャップを丸めることで頂点密度の高いポリラインも連続した線に見える。
   * origin指定あり: セル相対Float32 + LNGLAT_OFFSETS（セルが小さいので投影誤差なし）
   * origin指定なし: 絶対経緯度 + 通常のLNGLAT（全国規模でも投影誤差なし）
   */
  _makePathLayer({ id, positions, startIndices, numPaths, pathFeature, origin = null, def, tier, visible }) {
    const coordProps = origin ? {
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT_OFFSETS,
      coordinateOrigin: [origin[0], origin[1], 0],
    } : {};
    this._pickMeta.set(id, { tier, pathFeature });
    return new PathLayer({
      id,
      data: {
        length: numPaths,
        startIndices,
        attributes: {
          getPath: { value: positions, size: 2 },
        },
      },
      _pathType: 'open', // 正規化をスキップ（バイナリ高速パス）
      positionFormat: 'XY',
      ...coordProps,
      visible,
      pickable: visible,
      jointRounded: true,
      capRounded: true,
      getColor: def.color,
      getWidth: def.width,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      widthMaxPixels: 20,
      onHover: (info) => this._handleSegHover(info, tier, pathFeature),
    });
  }

  /**
   * Build road layers.
   * 低・中ズーム: 種別毎に全国1枚のLODレイヤー。LOD0/LOD1は両方常駐させ
   * visibleフラグだけ切り替える（ズーム横断時の再テッセレーションを避ける）。
   * 高ズーム: ビューポート内セルのみフル詳細レイヤーを生成。
   */
  _buildRoadLayers() {
    this._roadLayers = [];
    this._pickMeta.clear();
    const level = this._lodLevel;

    for (const def of ROAD_LAYERS) {
      const tier = this.tiers.get(def.fclass);
      if (!tier) continue;
      const hidden = this._hiddenFclasses.has(def.fclass);

      for (let li = 0; li < tier.lods.length; li++) {
        const lod = tier.lods[li];
        this._roadLayers.push(this._makePathLayer({
          id: `${def.id}-lod${li}`,
          positions: lod.positions,
          startIndices: lod.startIndices,
          numPaths: lod.numPaths,
          pathFeature: lod.pathFeature,
          def, tier,
          visible: !hidden && level === li,
        }));
      }

      if (level === 2 && !hidden) {
        for (const cell of tier.cells) {
          if (!this._visibleCellKeys.has(cell.key)) continue;
          this._roadLayers.push(this._makePathLayer({
            id: `${def.id}-cell${cell.key}`,
            positions: cell.positions,
            startIndices: cell.startIndices,
            numPaths: cell.numRuns,
            pathFeature: cell.runFeature,
            origin: cell.origin,
            def, tier,
            visible: true,
          }));
        }
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
    if (this._highlight && this._highlight.numPaths > 0) {
      layers.push(new PathLayer({
        id: 'highlight-layer',
        data: {
          length: this._highlight.numPaths,
          startIndices: this._highlight.startIndices,
          attributes: {
            // 絶対経緯度Float64
            getPath: { value: this._highlight.positions, size: 2 },
          },
        },
        _pathType: 'open',
        positionFormat: 'XY',
        jointRounded: true,
        capRounded: true,
        getColor: [255, 255, 0, 255], // Yellow
        getWidth: 8,
        widthUnits: 'pixels',
        widthMinPixels: 4,
        widthMaxPixels: 30,
        pickable: false
      }));
    }

    this.deckOverlay.setProps({ layers });
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
   * @param {string|null} fclass - fclass value
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
   * ハイライト中の道路の候補を最優先で配置し、以降は道路種別の重要度順。
   */
  filterLabelsForViewport() {
    if (!this.map || this.tiers.size === 0) return [];

    const bounds = this.map.getBounds();
    const padding = 0.01;
    const west = bounds.getWest() - padding;
    const east = bounds.getEast() + padding;
    const south = bounds.getSouth() - padding;
    const north = bounds.getNorth() + padding;

    const cellSize = LABEL_MIN_SPACING_PX;
    const occupied = new Set();
    const labels = [];

    const tryCandidate = (tier, i) => {
      const lng = tier.cand.pos[i * 2];
      const lat = tier.cand.pos[i * 2 + 1];

      // Skip candidates outside the viewport
      if (lng < west || lng > east || lat < south || lat > north) return;

      // Project geographic coordinates to screen pixels
      const pixel = this.map.project([lng, lat]);
      const cellX = Math.floor(pixel.x / cellSize);
      const cellY = Math.floor(pixel.y / cellSize);

      // Check 3x3 neighborhood for already-placed labels
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (occupied.has(`${cellX + dx},${cellY + dy}`)) return;
        }
      }

      labels.push({
        position: [lng, lat],
        angle: tier.cand.angle[i],
        label: tier.props[tier.cand.feature[i]].name,
      });
      occupied.add(`${cellX},${cellY}`);
    };

    // Process highlighted roads' candidates first
    if (this._highlight) {
      for (const fclass of LABEL_TIER_ORDER) {
        const matched = this._highlight.sets.get(fclass);
        const tier = this.tiers.get(fclass);
        if (!matched || !tier || this._hiddenFclasses.has(fclass)) continue;
        for (let i = 0; i < tier.cand.count; i++) {
          if (matched.has(tier.cand.feature[i])) tryCandidate(tier, i);
        }
      }
    }

    // Then regular candidates in road-importance order
    for (const fclass of LABEL_TIER_ORDER) {
      const tier = this.tiers.get(fclass);
      if (!tier || this._hiddenFclasses.has(fclass)) continue;
      for (let i = 0; i < tier.cand.count; i++) {
        tryCandidate(tier, i);
      }
    }

    return labels;
  }

  /**
   * ピッキング結果からfeature情報を引く（info.index = パス/ラン番号）
   * @returns {{fi: number, properties: Object}|null}
   */
  _featureFromPick(info, tier, pathFeature) {
    if (info.index == null || info.index < 0) return null;
    const fi = pathFeature[info.index];
    return { fi, properties: tier.props[fi] };
  }

  /**
   * 指定スクリーン座標の道路をピッキングし、featureのプロパティを返す
   * （道路レイヤーのみpickableなので、当たれば必ず道路）
   * @param {{x: number, y: number}} point - スクリーン座標
   * @param {number} [radius] - 当たり判定半径（ピクセル）
   * @returns {Object|null} feature properties
   */
  _pickRoadFeatureAt(point, radius = PICKING_RADIUS_PX) {
    const info = this.deckOverlay.pickObject({
      x: point.x,
      y: point.y,
      radius
    });
    if (!info || !info.layer) return null;
    const meta = this._pickMeta.get(info.layer.id);
    if (!meta) return null;
    const hit = this._featureFromPick(info, meta.tier, meta.pathFeature);
    return hit ? hit.properties : null;
  }

  /**
   * Handle hover events on features
   */
  _handleSegHover(info, tier, pathFeature) {
    if (!this.tooltip) return;

    const hit = this._featureFromPick(info, tier, pathFeature);
    const name = hit?.properties?.name;
    if (name) {
      const props = hit.properties;
      const fclass = FCLASS_DISPLAY_NAMES[props.fclass] || props.fclass || '';
      const ref = props.ref || '';
      const extra = [fclass, ref].filter(Boolean).join(' ');
      const label = extra ? `${name} (${extra})` : name;
      this.tooltip.style.display = 'block';
      this.tooltip.style.left = `${info.x + 10}px`;
      this.tooltip.style.top = `${info.y + 10}px`;
      this.tooltip.textContent = label;
    } else {
      this.tooltip.style.display = 'none';
    }
  }

  /**
   * Search for features matching the query
   * @param {Object} query - Search query { name, fclass, ref }
   * @returns {Array} - Matching entries [{ tierFclass, index, properties }]
   */
  search({ name, fclass, ref }) {
    const nameTrim = name?.trim() || '';
    const fclassTrim = fclass?.trim() || '';
    const refTrim = ref?.trim() || '';

    // If all fields are empty, return empty
    if (!nameTrim && !fclassTrim && !refTrim) return [];

    const refLower = refTrim.toLowerCase();
    const results = [];

    for (const def of ROAD_LAYERS) {
      const tier = this.tiers.get(def.fclass);
      if (!tier) continue;

      for (let i = 0; i < tier.numFeatures; i++) {
        const props = tier.props[i] || {};
        if (nameTrim && !(props.name || '').includes(nameTrim)) continue;
        if (fclassTrim && props.fclass !== fclassTrim) continue;
        if (refTrim) {
          // ref may contain multiple values separated by ';'
          const refs = (props.ref || '').split(';').map(r => r.trim().toLowerCase());
          if (!refs.includes(refLower)) continue;
        }
        results.push({ tierFclass: def.fclass, index: i, properties: props });
      }
    }
    return results;
  }

  /**
   * Set highlighted features
   * @param {Array} matches - search()の結果 [{ tierFclass, index, properties }]
   */
  setHighlight(matches) {
    if (!matches || matches.length === 0) {
      this.clearHighlight();
      return;
    }

    // tierごとのマッチ集合
    const sets = new Map();
    for (const m of matches) {
      if (!sets.has(m.tierFclass)) sets.set(m.tierFclass, new Set());
      sets.get(m.tierFclass).add(m.index);
    }

    // パス数・頂点数カウント
    let numPaths = 0;
    let numVerts = 0;
    for (const [fclass, indices] of sets) {
      const tier = this.tiers.get(fclass);
      if (!tier) continue;
      for (const fi of indices) {
        for (let pi = tier.featurePartStart[fi]; pi < tier.featurePartStart[fi + 1]; pi++) {
          const n = tier.partStart[pi + 1] - tier.partStart[pi];
          if (n >= 2) {
            numPaths++;
            numVerts += n;
          }
        }
      }
    }

    // 量子化座標マスターからハイライト用パス配列（絶対経緯度）とbboxを構築
    const positions = new Float64Array(numVerts * 2);
    const startIndices = new Uint32Array(numPaths);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let path = 0;
    let v = 0;
    for (const [fclass, indices] of sets) {
      const tier = this.tiers.get(fclass);
      if (!tier) continue;
      const pos = tier.positions;
      for (const fi of indices) {
        for (let pi = tier.featurePartStart[fi]; pi < tier.featurePartStart[fi + 1]; pi++) {
          const start = tier.partStart[pi];
          const end = tier.partStart[pi + 1];
          if (end - start < 2) continue;
          startIndices[path] = v;
          path++;
          for (let p = start; p < end; p++) {
            const x = pos[p * 2] / COORD_QUANT;
            const y = pos[p * 2 + 1] / COORD_QUANT;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            positions[v * 2] = x;
            positions[v * 2 + 1] = y;
            v++;
          }
        }
      }
    }

    this._highlight = { positions, startIndices, numPaths, sets };
    this.labelsData = [];
    this.updateLayers();

    // Fit to highlighted features
    if (minX !== Infinity) {
      const lngPadding = (maxX - minX) * 0.1 || 0.01;
      const latPadding = (maxY - minY) * 0.1 || 0.01;
      this.map.fitBounds([
        [minX - lngPadding, minY - latPadding],
        [maxX + lngPadding, maxY + latPadding]
      ], {
        padding: 50,
        maxZoom: 18,
        duration: 1000
      });
    }
  }

  /**
   * Clear highlight
   */
  clearHighlight() {
    this._highlight = null;
    this.labelsData = [];
    this.updateLayers();
  }

}
