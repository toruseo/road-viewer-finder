/**
 * Main Application Entry Point
 * PMTiles-based road viewer application
 */
import { MapView, ROAD_STYLES, DEFAULT_ROAD_STYLE } from './MapView.js';
import { marked } from 'marked';
import helpMd from '../README.md?raw';

/**
 * Merge multiple bboxes into one encompassing bbox
 * @param {Array} bboxes - Array of [minLng, minLat, maxLng, maxLat]
 * @returns {Array} merged bbox
 */
function mergeBBoxes(bboxes) {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  for (const bbox of bboxes) {
    if (bbox[0] < minLng) minLng = bbox[0];
    if (bbox[1] < minLat) minLat = bbox[1];
    if (bbox[2] > maxLng) maxLng = bbox[2];
    if (bbox[3] > maxLat) maxLat = bbox[3];
  }
  return [minLng, minLat, maxLng, maxLat];
}

class App {
  constructor() {
    this.mapView = null;
    this.searchIndex = [];  // [{name, fclass, ref, bbox}, ...]
  }

  /**
   * Initialize the application
   */
  async init() {
    console.log('Initializing Road Viewer...');

    // Initialize map
    this.mapView = new MapView('map');
    await this.mapView.init();
    console.log('Map initialized');

    // Load search index
    this._loadSearchIndex();

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

    // Setup legend styles and visibility
    this.setupLegend();

    console.log('Application ready');
  }

  /**
   * Load search index (non-blocking)
   */
  async _loadSearchIndex() {
    try {
      const url = import.meta.env.BASE_URL + 'search_index.json';
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Search index not found (HTTP ${response.status}), search will be unavailable`);
        return;
      }
      this.searchIndex = await response.json();
      console.log(`Search index loaded: ${this.searchIndex.length} entries`);
    } catch (error) {
      console.warn('Failed to load search index:', error);
    }
  }

  /**
   * Setup legend styles and visibility checkboxes
   */
  setupLegend() {
    const legendItems = document.querySelectorAll('#legend .legend-item');

    legendItems.forEach(item => {
      const fclass = item.dataset.fclass;
      const style = ROAD_STYLES[fclass] || DEFAULT_ROAD_STYLE;
      const line = item.querySelector('.legend-line');
      if (line) {
        line.style.height = `${style.width}px`;
        line.style.background = style.color;
      }

      const checkbox = item.querySelector('input[type="checkbox"]');
      if (!checkbox) return;

      // Apply initial visibility from checkbox state
      if (!checkbox.checked) {
        this.mapView.setFclassVisible(fclass, false);
      }

      // Remove loading status (no longer needed with PMTiles)
      const statusEl = item.querySelector('.legend-status');
      if (statusEl) statusEl.textContent = '';

      checkbox.addEventListener('change', (e) => {
        this.mapView.setFclassVisible(fclass, e.target.checked);
      });
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
    const processedMd = helpMd.replace(/\(public\//g, `(${import.meta.env.BASE_URL}`);
    helpBody.innerHTML = marked(processedMd);

    helpBtn.addEventListener('click', () => {
      helpModal.classList.add('visible');
    });

    helpClose.addEventListener('click', () => {
      helpModal.classList.remove('visible');
    });

    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) {
        helpModal.classList.remove('visible');
      }
    });

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
      const nameTrim = nameInput.value.trim();
      const fclassTrim = fclassInput.value.trim();
      const refTrim = refInput.value.trim();

      if (!nameTrim && !fclassTrim && !refTrim) return;

      // Search in the index
      const results = this.searchIndex.filter(item => {
        if (nameTrim && !item.name.includes(nameTrim)) return false;
        if (fclassTrim && item.fclass !== fclassTrim) return false;
        if (refTrim) {
          const refs = (item.ref || '').split(';').map(r => r.trim().toLowerCase());
          if (!refs.includes(refTrim.toLowerCase())) return false;
        }
        return true;
      });

      if (results.length > 0) {
        // Build highlight filter using expression syntax
        const names = [...new Set(results.map(r => r.name))];
        let highlightFilter = ['in', ['get', 'name'], ['literal', names]];

        // Add ref condition to avoid over-highlighting unrelated roads
        if (refTrim) {
          const refCondition = ['in',
            ';' + refTrim.toLowerCase() + ';',
            ['concat', ';', ['downcase', ['coalesce', ['get', 'ref'], '']], ';']
          ];
          highlightFilter = ['all', highlightFilter, refCondition];
        }

        this.mapView.setHighlight(highlightFilter);

        // Fit map to merged bbox of all results
        const bbox = mergeBBoxes(results.map(r => r.bbox));
        this.mapView.fitToBBox(bbox);

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
}

// Start the application
const app = new App();
app.init().catch(console.error);
