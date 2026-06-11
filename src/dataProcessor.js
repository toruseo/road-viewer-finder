/**
 * dataProcessor - GeoJSONバイト列をdeck.glバイナリ属性へ変換する純粋関数群。
 * Web Worker (dataWorker.js) から呼ぶのが基本だが、Workerが使えない環境
 * （一部のfile://実行など）ではメインスレッドからフォールバックとして直接呼ぶ。
 *
 * 出力（タイルバンドル）の構成:
 * - props:            feature毎の属性オブジェクト {fclass, name, ref}（検索・ツールチップ用）
 * - positions:        全頂点の量子化座標 Int32Array（lng*1e7, lat*1e7。ハイライト再構築・bbox用）
 * - partStart / partFeature / featurePartStart: LineStringパートのインデックス
 * - lods[]:           簡略化ジオメトリのパス配列（低ズーム描画用、絶対経緯度）。
 *                     PathLayerバイナリ形式（フラット座標 + startIndices）
 * - cells[]:          フル詳細パスをグリッドセル毎に「ラン」（セル内連続区間）へ分割したもの。
 *                     高ズームでビューポート内セルのみ描画。座標はセル中心相対のFloat32
 * - cand:             ラベル候補（位置・角度・feature番号のパック配列）
 */
import pako from 'pako';

// LOD簡略化許容誤差（度）。index 0 = 低ズーム用（粗い）、index 1 = 中ズーム用
export const LOD_TOLERANCES = [2e-3, 4e-4];

// 空間グリッド（詳細表示時のビューポートカリング単位）。
// セル相対座標(LNGLAT_OFFSETS)のWebメルカトル線形化誤差は緯度差の3乗で増えるため、
// 緯度方向だけ細かく分割して全ズームでズレを1px未満に抑える（経度方向は線形で誤差なし）。
export const GRID_CELL_SIZE_LNG = 2;   // degrees per cell
export const GRID_CELL_SIZE_LAT = 0.5; // degrees per cell
export const GRID_ORIGIN_LNG = 122;
export const GRID_ORIGIN_LAT = 24;

// 座標量子化係数（経度180×1e7 < 2^31 なのでInt32に収まる）
export const COORD_QUANT = 1e7;

// Interval for placing label candidates along a line (in degrees, ~5km)
const LABEL_CANDIDATE_INTERVAL = 0.05;

// Minimum road length to generate labels (in meters, approximate)
const LABEL_MIN_ROAD_LENGTH_M = 100;

/**
 * グリッドセルの数値キー（文字列キーより高速）。col/rowは±512まで対応。
 */
export function cellKey(col, row) {
  return (col + 512) * 4096 + (row + 512);
}

export function cellKeyAt(lng, lat) {
  const col = Math.floor((lng - GRID_ORIGIN_LNG) / GRID_CELL_SIZE_LNG);
  const row = Math.floor((lat - GRID_ORIGIN_LAT) / GRID_CELL_SIZE_LAT);
  return cellKey(col, row);
}

// --- Douglas-Peucker simplification (simplify-js相当、反復実装) ---

function getSqSegDist(px, py, x1, y1, x2, y2) {
  let x = x1;
  let y = y1;
  let dx = x2 - x1;
  let dy = y2 - y1;

  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = x2;
      y = y2;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

function simplifyRadial(points, sqTolerance) {
  let prev = points[0];
  const out = [prev];

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const dx = pt[0] - prev[0];
    const dy = pt[1] - prev[1];
    if (dx * dx + dy * dy > sqTolerance) {
      out.push(pt);
      prev = pt;
    }
  }
  if (prev !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

function simplifyDouglasPeucker(points, sqTolerance) {
  const len = points.length;
  const markers = new Uint8Array(len);
  markers[0] = 1;
  markers[len - 1] = 1;
  const stack = [0, len - 1];

  while (stack.length) {
    const last = stack.pop();
    const first = stack.pop();
    let maxSqDist = 0;
    let index = -1;
    const x1 = points[first][0];
    const y1 = points[first][1];
    const x2 = points[last][0];
    const y2 = points[last][1];

    for (let i = first + 1; i < last; i++) {
      const sqDist = getSqSegDist(points[i][0], points[i][1], x1, y1, x2, y2);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTolerance && index !== -1) {
      markers[index] = 1;
      stack.push(first, index, index, last);
    }
  }

  const out = [];
  for (let i = 0; i < len; i++) {
    if (markers[i]) out.push(points[i]);
  }
  return out;
}

/**
 * 折れ線を許容誤差tol（度）で簡略化。元の座標ペア配列への参照を返す（コピーなし）。
 */
export function simplify(points, tol) {
  if (points.length <= 2) return points;
  const sq = tol * tol;
  return simplifyDouglasPeucker(simplifyRadial(points, sq), sq);
}

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

/**
 * gzip圧縮された（または生の）GeoJSONバイト列を描画用バンドルに変換する。
 * @param {Uint8Array} bytes
 * @param {string} fclass
 * @returns {Object} bundle（.transferに転送可能バッファの配列を含む）
 */
export function processTier(bytes, fclass) {
  const isGzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = isGzipped
    ? pako.ungzip(bytes, { to: 'string' })
    : new TextDecoder().decode(bytes);
  const geojson = JSON.parse(text);
  const features = geojson.features || [];
  const numFeatures = features.length;

  // --- パート（LineString単位）へ平坦化 ---
  const props = new Array(numFeatures);
  const partsCoords = [];
  const partFeatureTmp = [];
  const featurePartStart = new Uint32Array(numFeatures + 1);
  let totalPoints = 0;

  for (let fi = 0; fi < numFeatures; fi++) {
    const f = features[fi];
    props[fi] = f.properties || {};
    featurePartStart[fi] = partsCoords.length;
    const geom = f.geometry;
    if (geom && geom.coordinates) {
      const coordsList = geom.type === 'LineString' ? [geom.coordinates]
        : geom.type === 'MultiLineString' ? geom.coordinates : [];
      for (const c of coordsList) {
        if (!c || c.length < 2) continue;
        partsCoords.push(c);
        partFeatureTmp.push(fi);
        totalPoints += c.length;
      }
    }
  }
  featurePartStart[numFeatures] = partsCoords.length;
  const numParts = partsCoords.length;
  const partFeature = Uint32Array.from(partFeatureTmp);

  // --- 量子化座標マスター（ハイライト・bbox再構築用） ---
  const positions = new Int32Array(totalPoints * 2);
  const partStart = new Uint32Array(numParts + 1);
  {
    let pt = 0;
    for (let pi = 0; pi < numParts; pi++) {
      partStart[pi] = pt;
      const coords = partsCoords[pi];
      for (let i = 0; i < coords.length; i++) {
        positions[pt * 2] = Math.round(coords[i][0] * COORD_QUANT);
        positions[pt * 2 + 1] = Math.round(coords[i][1] * COORD_QUANT);
        pt++;
      }
    }
    partStart[numParts] = pt;
  }

  // --- LODパス配列（低・中ズーム用、PathLayerバイナリ形式） ---
  // 全国を1レイヤーで描くため絶対経緯度で持つ（頂点ごとに正確に投影され、
  // オフセット座標系の線形化誤差が出ない）。簡略化済みなのでサイズは小さい。
  // Float32の絶対経緯度の量子化誤差は約1m、LOD使用ズーム(z<10.5, >40m/px)では不可視。
  const lods = LOD_TOLERANCES.map((tol) => {
    const simplified = new Array(numParts);
    let numPaths = 0;
    let numVerts = 0;
    for (let pi = 0; pi < numParts; pi++) {
      const s = simplify(partsCoords[pi], tol);
      simplified[pi] = s;
      if (s.length >= 2) {
        numPaths++;
        numVerts += s.length;
      }
    }

    const positions = new Float32Array(numVerts * 2);
    const startIndices = new Uint32Array(numPaths);
    const pathFeature = new Uint32Array(numPaths);
    let path = 0;
    let v = 0;
    for (let pi = 0; pi < numParts; pi++) {
      const s = simplified[pi];
      if (s.length < 2) continue;
      startIndices[path] = v;
      pathFeature[path] = partFeature[pi];
      path++;
      for (let i = 0; i < s.length; i++) {
        positions[v * 2] = s[i][0];
        positions[v * 2 + 1] = s[i][1];
        v++;
      }
    }
    return { positions, startIndices, pathFeature, numPaths };
  });

  // --- フル詳細パスのセル分割（2パス: カウント→充填） ---
  // 各セグメントは中点が属するセルに割り当て、同一セル内の連続セグメント列を
  // 1本の「ラン」（サブパス）として格納する。セル境界を跨ぐ箇所では境界頂点を
  // 両側のランに複製する（PathLayerのジョイント処理が各ラン内で効く）。
  const cellStats = new Map(); // key -> { runs, verts }
  for (let pi = 0; pi < numParts; pi++) {
    const coords = partsCoords[pi];
    let prevKey = -1;
    for (let i = 0; i < coords.length - 1; i++) {
      const key = cellKeyAt(
        (coords[i][0] + coords[i + 1][0]) / 2,
        (coords[i][1] + coords[i + 1][1]) / 2
      );
      let st = cellStats.get(key);
      if (!st) { st = { runs: 0, verts: 0 }; cellStats.set(key, st); }
      if (key !== prevKey) {
        st.runs++;
        st.verts += 2;
      } else {
        st.verts += 1;
      }
      prevKey = key;
    }
  }

  const cells = [];
  const cellFill = new Map(); // key -> 充填用状態
  for (const key of [...cellStats.keys()].sort((a, b) => a - b)) {
    const st = cellStats.get(key);
    const col = Math.floor(key / 4096) - 512;
    const row = (key % 4096) - 512;
    const originLng = GRID_ORIGIN_LNG + (col + 0.5) * GRID_CELL_SIZE_LNG;
    const originLat = GRID_ORIGIN_LAT + (row + 0.5) * GRID_CELL_SIZE_LAT;
    const cell = {
      key,
      origin: [originLng, originLat],
      positions: new Float32Array(st.verts * 2),
      startIndices: new Uint32Array(st.runs),
      runFeature: new Uint32Array(st.runs),
      numRuns: st.runs,
    };
    cells.push(cell);
    cellFill.set(key, { cell, run: 0, v: 0 });
  }

  for (let pi = 0; pi < numParts; pi++) {
    const coords = partsCoords[pi];
    const fi = partFeature[pi];
    let prevKey = -1;
    for (let i = 0; i < coords.length - 1; i++) {
      const key = cellKeyAt(
        (coords[i][0] + coords[i + 1][0]) / 2,
        (coords[i][1] + coords[i + 1][1]) / 2
      );
      const fill = cellFill.get(key);
      const { cell } = fill;
      if (key !== prevKey) {
        // 新しいランを開始: セグメント始点も書き込む
        cell.startIndices[fill.run] = fill.v;
        cell.runFeature[fill.run] = fi;
        fill.run++;
        cell.positions[fill.v * 2] = coords[i][0] - cell.origin[0];
        cell.positions[fill.v * 2 + 1] = coords[i][1] - cell.origin[1];
        fill.v++;
      }
      cell.positions[fill.v * 2] = coords[i + 1][0] - cell.origin[0];
      cell.positions[fill.v * 2 + 1] = coords[i + 1][1] - cell.origin[1];
      fill.v++;
      prevKey = key;
    }
  }

  // --- ラベル候補（名前付き道路のみ） ---
  const candPos = [];
  const candAngle = [];
  const candFeature = [];
  for (let pi = 0; pi < numParts; pi++) {
    const fi = partFeature[pi];
    if (!props[fi].name) continue;
    for (const pt of getLinePoints(partsCoords[pi])) {
      candPos.push(pt.position[0], pt.position[1]);
      candAngle.push(pt.angle);
      candFeature.push(fi);
    }
  }
  const cand = {
    pos: Float64Array.from(candPos),
    angle: Float32Array.from(candAngle),
    feature: Uint32Array.from(candFeature),
    count: candFeature.length,
  };

  const bundle = {
    fclass,
    numFeatures,
    props,
    positions,
    partStart,
    partFeature,
    featurePartStart,
    lods,
    cells,
    cand,
  };
  bundle.transfer = [
    positions.buffer, partStart.buffer, partFeature.buffer, featurePartStart.buffer,
    cand.pos.buffer, cand.angle.buffer, cand.feature.buffer,
    ...lods.flatMap((l) => [l.positions.buffer, l.startIndices.buffer, l.pathFeature.buffer]),
    ...cells.flatMap((c) => [c.positions.buffer, c.startIndices.buffer, c.runFeature.buffer]),
  ];
  return bundle;
}
