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
    showLabelsCheckbox.addEventListener('change', (e) => {
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

    // Setup legend styles
    this.setupLegend();

    // Load osm.geojson.gz from public folder (gzip compressed)
    await this.loadGeoJSON(import.meta.env.BASE_URL + 'osm.geojson.gz');

    console.log('Application ready');
  }

  /**
   * Setup legend styles from ROAD_STYLES
   */
  setupLegend() {
    const legendItems = document.querySelectorAll('#legend .legend-item');
    legendItems.forEach(item => {
      const fclass = item.dataset.fclass;
      const style = ROAD_STYLES[fclass] || DEFAULT_ROAD_STYLE;
      const line = item.querySelector('.legend-line');
      if (line) {
        const [r, g, b] = style.color;
        line.style.height = `${style.width}px`;
        line.style.background = `rgb(${r}, ${g}, ${b})`;
      }
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
   * Load GeoJSON from URL (supports .gz gzip-compressed files)
   */
  async loadGeoJSON(url) {
    const progressText = document.getElementById('progress-text');
    const progressContainer = document.getElementById('progress-container');
    const progressFill = document.getElementById('progress-fill');
    const isGzipped = url.endsWith('.gz');

    try {
      progressContainer.style.display = 'block';
      progressText.textContent = '読み込み中...';
      progressFill.style.width = '0%';

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      // Stream reading with progress
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        received += value.length;

        if (total > 0) {
          const progress = Math.round((received / total) * 100);
          progressFill.style.width = `${progress}%`;
        }
        progressText.textContent = `読み込み中... ${(received / 1024 / 1024).toFixed(1)}MB`;
      }

      // Combine chunks into single buffer
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      let geojson;
      // Check if data is actually gzipped (magic number: 0x1f 0x8b)
      // Note: Some servers (Vite dev, CDNs) auto-decompress gzip files
      const isActuallyGzipped = combined[0] === 0x1f && combined[1] === 0x8b;

      if (isActuallyGzipped) {
        progressText.textContent = '解凍中...';
        const decompressed = pako.ungzip(combined, { to: 'string' });
        progressText.textContent = 'パース中...';
        geojson = JSON.parse(decompressed);
      } else {
        progressText.textContent = 'パース中...';
        const text = new TextDecoder().decode(combined);
        geojson = JSON.parse(text);
      }

      progressContainer.style.display = 'none';
      document.getElementById('search-panel').style.display = 'block';
      document.getElementById('options').style.display = 'block';

      console.log(`Loaded ${geojson?.features?.length || 0} features`);
      this.mapView.setData(geojson);
    } catch (error) {
      console.error('Error loading GeoJSON:', error);
      progressText.textContent = `エラー: ${error.message}`;
    }
  }
}

// Start the application
const app = new App();
app.init().catch(console.error);
