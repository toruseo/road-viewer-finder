import { vi } from 'vitest';
import { MapView } from '../../src/MapView.js';

/**
 * Create a MapView instance with mocked map and deckOverlay,
 * ready to call any public method without init().
 */
export function createMockedMapView() {
  const mv = new MapView('map');
  mv.deckOverlay = { setProps: vi.fn() };
  mv.map = {
    getBounds: vi.fn(() => ({
      getWest: () => 138.0,
      getEast: () => 141.0,
      getSouth: () => 34.0,
      getNorth: () => 37.0,
    })),
    project: vi.fn(([lng, lat]) => ({
      x: (lng - 138.0) * 500,
      y: (37.0 - lat) * 500,
    })),
    fitBounds: vi.fn(),
    on: vi.fn(),
  };
  mv.tooltip = { style: { display: 'none', left: '', top: '' }, textContent: '' };
  return mv;
}

/**
 * Create a GeoJSON FeatureCollection with LineString features.
 * Coordinates are spread enough to generate label candidates.
 */
export function createTestGeojson(features) {
  return { type: 'FeatureCollection', features };
}

export function createLineFeature(name, fclass, ref, coords) {
  return {
    type: 'Feature',
    properties: { name, fclass, ref },
    geometry: {
      type: 'LineString',
      coordinates: coords || [[139.0, 35.0], [139.1, 35.1]],
    },
  };
}

export function createMultiLineFeature(name, fclass, ref, coordsArray) {
  return {
    type: 'Feature',
    properties: { name, fclass, ref },
    geometry: {
      type: 'MultiLineString',
      coordinates: coordsArray || [
        [[139.0, 35.0], [139.05, 35.05]],
        [[139.1, 35.1], [139.15, 35.15]],
      ],
    },
  };
}
