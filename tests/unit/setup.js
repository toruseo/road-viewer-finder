import { vi } from 'vitest';

// Mock maplibre-gl
vi.mock('maplibre-gl', () => {
  const Map = vi.fn(() => ({
    on: vi.fn(),
    addControl: vi.fn(),
    getBounds: vi.fn(),
    project: vi.fn(),
    fitBounds: vi.fn(),
  }));
  const NavigationControl = vi.fn();
  const ScaleControl = vi.fn();
  return { default: { Map, NavigationControl, ScaleControl } };
});

// Mock deck.gl layers
vi.mock('@deck.gl/layers', () => ({
  GeoJsonLayer: vi.fn(),
  TextLayer: vi.fn(),
}));

// Mock deck.gl mapbox overlay
vi.mock('@deck.gl/mapbox', () => ({
  MapboxOverlay: vi.fn(() => ({
    setProps: vi.fn(),
  })),
}));
