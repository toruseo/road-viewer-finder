/**
 * Main Application Entry Point
 * Large-scale GeoJSON WebGL Rendering Application
 */
import { MapView, ROAD_STYLES, DEFAULT_ROAD_STYLE } from './MapView.js';
import pako from 'pako';
import { marked } from 'marked';
import helpMd from '../README.md?raw';

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
      item.style.opacity = visible ? '1' : '0.5';
      if (!visible) this.mapView.setFclassVisible(fclass, false);

      // Queue initial download for checked items
      if (visible) {
        initialLoads.push(this.loadAndShowFclass(fclass));
      }

      checkbox.addEventListener('change', (e) => {
        const checked = e.target.checked;
        item.style.opacity = checked ? '1' : '0.5';
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
      this.loadingPromises[fclass] = this._fetchFclassData(fclass);
      const geojson = await this.loadingPromises[fclass];
      delete this.loadingPromises[fclass];

      this.loadedData[fclass] = geojson;
      if (statusEl) statusEl.textContent = '';

      console.log(`Loaded ${fclass}: ${geojson?.features?.length || 0} features`);
      this.mapView.setTierData(fclass, geojson);
      this.mapView.setFclassVisible(fclass, true);
    } catch (error) {
      delete this.loadingPromises[fclass];
      console.error(`Error loading ${fclass}:`, error);
      if (statusEl) statusEl.textContent = 'エラー';
    }
  }

  /**
   * Fetch and decompress a per-fclass GeoJSON file
   * @param {string} fclass
   * @returns {Promise<Object>} parsed GeoJSON
   */
  async _fetchFclassData(fclass) {
    const url = import.meta.env.BASE_URL + 'osm_' + fclass + '.geojson.gz';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${fclass}`);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }

    // Combine chunks
    const combined = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Detect gzip and decompress if needed
    const isActuallyGzipped = combined[0] === 0x1f && combined[1] === 0x8b;
    if (isActuallyGzipped) {
      const decompressed = pako.ungzip(combined, { to: 'string' });
      return JSON.parse(decompressed);
    } else {
      const text = new TextDecoder().decode(combined);
      return JSON.parse(text);
    }
  }
}

// Start the application
const app = new App();
app.init().catch(console.error);
