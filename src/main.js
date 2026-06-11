/**
 * Main Application Entry Point
 * Large-scale GeoJSON WebGL Rendering Application
 */
import { MapView, ROAD_STYLES, DEFAULT_ROAD_STYLE } from './MapView.js';
import { marked } from 'marked';
import helpMd from '../README.md?raw';
// Workerをバンドルにインライン化（blob URL経由で起動）。
// 別ファイル配信が不要になり、リリース版のJSインライン化（file://実行）でも壊れない。
import DataWorker from './dataWorker.js?worker&inline';

class App {
  constructor() {
    this.mapView = null;
    this.loadedData = {};       // fclass -> geojson (キャッシュ)
    this.loadingPromises = {};  // fclass -> Promise (重複ダウンロード防止)
  }

  /**
   * Initialize the application
   */
  async init() {
    console.log('Initializing GeoJSON Viewer...');

    // Initialize map
    this.mapView = new MapView('map');
    await this.mapView.init();
    console.log('Map initialized');

    // Setup label toggle
    const showLabelsCheckbox = document.getElementById('show-labels');
    showLabelsCheckbox.checked = localStorage.getItem('show-labels') !== 'false';
    this.mapView.setLabelsVisible(showLabelsCheckbox.checked);
    showLabelsCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('show-labels', e.target.checked);
      this.mapView.setLabelsVisible(e.target.checked);
    });

    // Setup search
    this.setupSearch();

    // Double-click on road: search by fclass + ref
    this.mapView.onFeatureDoubleClick = (props) => {
      const fclassInput = document.getElementById('search-fclass');
      const refInput = document.getElementById('search-ref');
      const nameInput = document.getElementById('search-name');
      nameInput.value = '';
      fclassInput.value = props?.fclass || '';
      refInput.value = props?.ref || '';
      document.getElementById('search-btn').click();
    };

    // Setup controls panel collapse toggle
    this.setupControlsToggle();

    // Setup help modal
    this.setupHelp();

    // Setup legend styles and start on-demand loading
    this.setupLegend();

    console.log('Application ready');
  }

  /**
   * Setup legend styles and visibility checkboxes, start on-demand loading
   */
  setupLegend() {
    const legendItems = document.querySelectorAll('#legend .legend-item');
    const initialLoads = [];

    legendItems.forEach(item => {
      const fclass = item.dataset.fclass;
      const style = ROAD_STYLES[fclass] || DEFAULT_ROAD_STYLE;
      const line = item.querySelector('.legend-line');
      if (line) {
        const [r, g, b] = style.color;
        line.style.height = `${style.width}px`;
        line.style.background = `rgb(${r}, ${g}, ${b})`;
      }

      const checkbox = item.querySelector('input[type="checkbox"]');
      if (!checkbox) return;

      const visible = checkbox.checked;
      if (!visible) this.mapView.setFclassVisible(fclass, false);

      // Queue initial download for checked items
      if (visible) {
        initialLoads.push(this.loadAndShowFclass(fclass));
      }

      checkbox.addEventListener('change', (e) => {
        const checked = e.target.checked;
        if (checked) {
          this.loadAndShowFclass(fclass);
        } else {
          this.mapView.setFclassVisible(fclass, false);
        }
      });
    });

    // Wait for all initial loads in parallel (non-blocking for UI)
    Promise.all(initialLoads).catch(console.error);
  }

  /**
   * 左上パネルの折り畳みトグル。
   * 状態はlocalStorageに保存。保存値がなければ小画面（スマホ）では初期折り畳み。
   */
  setupControlsToggle() {
    const controls = document.getElementById('controls');
    const header = document.getElementById('controls-header');
    const toggle = document.getElementById('controls-toggle');

    const apply = (collapsed) => {
      controls.classList.toggle('collapsed', collapsed);
      toggle.textContent = collapsed ? '[メニュー開く]' : '[閉]';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'パネルを展開' : 'パネルを折り畳む');
    };

    const saved = localStorage.getItem('controls-collapsed');
    const collapsed = saved !== null
      ? saved === 'true'
      : window.matchMedia('(max-width: 600px)').matches;
    apply(collapsed);

    header.addEventListener('click', () => {
      const next = !controls.classList.contains('collapsed');
      localStorage.setItem('controls-collapsed', String(next));
      apply(next);
    });
  }

  /**
   * Setup help modal functionality
   */
  setupHelp() {
    const helpBtn = document.getElementById('help-btn');
    const helpModal = document.getElementById('help-modal');
    const helpClose = document.getElementById('help-close');
    const helpBody = document.getElementById('help-body');

    // Render markdown content
    // Convert image paths: public/xxx.png -> BASE_URL/xxx.png for web display
    const processedMd = helpMd.replace(/\(public\//g, `(${import.meta.env.BASE_URL}`);
    helpBody.innerHTML = marked(processedMd);

    // Open modal
    helpBtn.addEventListener('click', () => {
      helpModal.classList.add('visible');
    });

    // Close modal
    helpClose.addEventListener('click', () => {
      helpModal.classList.remove('visible');
    });

    // Close on backdrop click
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) {
        helpModal.classList.remove('visible');
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpModal.classList.contains('visible')) {
        helpModal.classList.remove('visible');
      }
    });
  }

  /**
   * Setup search functionality
   */
  setupSearch() {
    const searchBtn = document.getElementById('search-btn');
    const clearBtn = document.getElementById('clear-btn');
    const searchResult = document.getElementById('search-result');
    const nameInput = document.getElementById('search-name');
    const fclassInput = document.getElementById('search-fclass');
    const refInput = document.getElementById('search-ref');

    searchBtn.addEventListener('click', () => {
      const results = this.mapView.search({
        name: nameInput.value,
        fclass: fclassInput.value,
        ref: refInput.value
      });

      if (results.length > 0) {
        this.mapView.setHighlight(results);
        searchResult.textContent = `検索結果: ${results.length}件`;
      } else {
        this.mapView.clearHighlight();
        searchResult.textContent = '該当なし';
      }
    });

    clearBtn.addEventListener('click', () => {
      nameInput.value = '';
      fclassInput.value = '';
      refInput.value = '';
      searchResult.textContent = '';
      this.mapView.clearHighlight();
    });

    // Enter key to search
    [nameInput, fclassInput, refInput].forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          searchBtn.click();
        }
      });
    });
  }

  /**
   * Load and show a specific fclass tier. Uses cache if already loaded.
   * @param {string} fclass - e.g. 'motorway', 'trunk', 'primary', 'secondary'
   */
  async loadAndShowFclass(fclass) {
    // Already cached → just show
    if (this.loadedData[fclass]) {
      this.mapView.setFclassVisible(fclass, true);
      return;
    }
    // Already downloading → wait for existing promise
    if (this.loadingPromises[fclass]) {
      await this.loadingPromises[fclass];
      this.mapView.setFclassVisible(fclass, true);
      return;
    }

    const statusEl = document.querySelector(`.legend-item[data-fclass="${fclass}"] .legend-status`);
    if (statusEl) statusEl.textContent = '読み込み中...';

    try {
      this.loadingPromises[fclass] = this._loadTier(fclass, statusEl);
      const bundle = await this.loadingPromises[fclass];
      delete this.loadingPromises[fclass];

      this.loadedData[fclass] = true;
      if (statusEl) statusEl.textContent = '';

      console.log(`Loaded ${fclass}: ${bundle.numFeatures} features`);
      this.mapView.setTierBundle(fclass, bundle);
      this.mapView.setFclassVisible(fclass, true);
    } catch (error) {
      delete this.loadingPromises[fclass];
      console.error(`Error loading ${fclass}:`, error);
      if (statusEl) statusEl.textContent = 'エラー';
    }
  }

  /**
   * ダウンロード（進捗表示付き）→ Worker処理 → 描画用バンドル
   */
  async _loadTier(fclass, statusEl) {
    const bytes = await this._fetchFclassBytes(fclass, (received, total) => {
      if (!statusEl) return;
      if (total > 0) {
        statusEl.textContent = `読み込み中 ${Math.min(99, Math.round(received / total * 100))}%`;
      } else {
        statusEl.textContent = `読み込み中 ${(received / 1048576).toFixed(1)}MB`;
      }
    });
    if (statusEl) statusEl.textContent = 'データ展開中...';
    return await this._processTier(bytes, fclass);
  }

  /**
   * Fetch a per-fclass gzipped GeoJSON file as raw bytes
   * @param {string} fclass
   * @param {Function} onProgress - (receivedBytes, totalBytes) コールバック
   * @returns {Promise<Uint8Array>}
   */
  async _fetchFclassBytes(fclass, onProgress) {
    // データ取得元のベースURL。VITE_DATA_BASE が空ならVite dev serverやリリース版のために
    // BASE_URL (= './' 相対) へフォールバックする。GitHub Pagesビルドでは deploy.yml が
    // 公開r2.dev URL(末尾スラッシュ付き)を注入する。
    // VITE_DATA_VERSIONはCDNキャッシュバスティング用のクエリ文字列(コミットSHA)。
    const DATA_BASE = import.meta.env.VITE_DATA_BASE || import.meta.env.BASE_URL;
    const DATA_VERSION = import.meta.env.VITE_DATA_VERSION || '';
    const VQ = DATA_VERSION ? `?v=${encodeURIComponent(DATA_VERSION)}` : '';

    try {
      const url = `${DATA_BASE}osm_${fclass}.geojson.gz${VQ}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${fclass}`);
      }

      // Content-Lengthは転送サイズなので、dev serverなどが透過解凍する場合は
      // 受信バイト数と一致しない（その場合は受信量のみ表示）。
      const total = Number(response.headers.get('Content-Length')) || 0;
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress) onProgress(received, total);
      }

      const combined = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      return combined;
    } catch (e) {
      // file:// fallback: load base64-encoded gz via script tag
      return await this._loadGzViaScript(fclass);
    }
  }

  /**
   * バイト列をWorkerで処理してバンドル化する。
   * Workerが使えない環境（blob worker禁止のfile://実行など）では
   * メインスレッドで同じ処理にフォールバックする。
   */
  async _processTier(bytes, fclass) {
    try {
      return await new Promise((resolve, reject) => {
        let worker;
        try {
          worker = new DataWorker();
        } catch (e) {
          reject(e);
          return;
        }
        worker.onmessage = (ev) => {
          worker.terminate();
          if (ev.data.ok) {
            resolve(ev.data.bundle);
          } else {
            reject(new Error(ev.data.error));
          }
        };
        worker.onerror = (ev) => {
          worker.terminate();
          reject(new Error(ev.message || 'Worker error'));
        };
        // bytesはコピー渡し（転送しない）: Worker起動失敗時もフォールバックで再利用できる
        worker.postMessage({ fclass, bytes });
      });
    } catch (e) {
      console.warn(`Worker処理に失敗、メインスレッドで処理します (${fclass}):`, e);
      const { processTier } = await import('./dataProcessor.js');
      const bundle = processTier(bytes, fclass);
      delete bundle.transfer;
      return bundle;
    }
  }

  /**
   * file://用フォールバック: scriptタグ経由でbase64エンコードされたgzデータを読み込む
   * リリースzip内の osm_[fclass].data.js を動的に読み込む
   */
  _loadGzViaScript(fclass) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = (import.meta.env.BASE_URL || './') + 'osm_' + fclass + '.data.js';
      script.onload = () => {
        const b64 = window.__roadGzB64?.[fclass];
        if (!b64) {
          reject(new Error(`No embedded data for ${fclass}`));
          return;
        }
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        resolve(bytes);
      };
      script.onerror = () => reject(new Error(`Failed to load data for ${fclass}`));
      document.head.appendChild(script);
    });
  }
}

// Start the application
const app = new App();
app.init().catch(console.error);
