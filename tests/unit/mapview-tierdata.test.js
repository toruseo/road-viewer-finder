import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import { createMockedMapView, createTestGeojson, createLineFeature, createMultiLineFeature } from './helpers.js';

describe('MapView.setTierData()', () => {
  let mv;

  beforeEach(() => {
    mv = createMockedMapView();
  });

  it('updates currentData with features from all tiers', () => {
    const geojson = createTestGeojson([
      createLineFeature('東名高速道路', 'motorway', 'E1'),
      createLineFeature('新東名高速道路', 'motorway', 'E1A'),
    ]);

    mv.setTierData('motorway', geojson);

    expect(mv.currentData.features).toHaveLength(2);
    expect(mv.currentData.features[0].properties.name).toBe('東名高速道路');
  });

  it('accumulates features from multiple tiers', () => {
    mv.setTierData('motorway', createTestGeojson([
      createLineFeature('東名高速道路', 'motorway', 'E1'),
    ]));
    mv.setTierData('trunk', createTestGeojson([
      createLineFeature('国道1号', 'trunk', '1'),
      createLineFeature('国道246号', 'trunk', '246'),
    ]));

    expect(mv.currentData.features).toHaveLength(3);
  });

  it('generates label candidates for named features', () => {
    const geojson = createTestGeojson([
      createLineFeature('東名高速道路', 'motorway', 'E1'),
    ]);

    mv.setTierData('motorway', geojson);

    expect(mv.labelCandidates.length).toBeGreaterThan(0);
    expect(mv.labelCandidates[0].name).toBe('東名高速道路');
  });

  it('does not generate label candidates for features without name', () => {
    const geojson = createTestGeojson([
      createLineFeature(null, 'motorway', 'E1'),
    ]);

    mv.setTierData('motorway', geojson);

    expect(mv.labelCandidates).toHaveLength(0);
  });

  it('handles MultiLineString geometry', () => {
    const geojson = createTestGeojson([
      createMultiLineFeature('環状道路', 'primary', null),
    ]);

    mv.setTierData('primary', geojson);

    expect(mv.labelCandidates.length).toBeGreaterThan(0);
  });

  it('skips labels for very short lines', () => {
    const geojson = createTestGeojson([{
      type: 'Feature',
      properties: { name: '短い道路', fclass: 'secondary' },
      geometry: {
        type: 'LineString',
        // ~0.0001 degree difference ≈ 10m, under LABEL_MIN_ROAD_LENGTH_M (100m)
        coordinates: [[139.0, 35.0], [139.00001, 35.00001]],
      },
    }]);

    mv.setTierData('secondary', geojson);

    expect(mv.labelCandidates).toHaveLength(0);
  });

  it('generates multiple label points for long lines', () => {
    const geojson = createTestGeojson([{
      type: 'Feature',
      properties: { name: '長い道路', fclass: 'motorway' },
      geometry: {
        type: 'LineString',
        // ~0.5 degree, much longer than LABEL_CANDIDATE_INTERVAL (0.05)
        coordinates: [[139.0, 35.0], [139.5, 35.0]],
      },
    }]);

    mv.setTierData('motorway', geojson);

    // Should generate multiple label points
    expect(mv.labelCandidates.length).toBeGreaterThan(1);
  });

  it('calls deckOverlay.setProps', () => {
    mv.setTierData('motorway', createTestGeojson([]));

    expect(mv.deckOverlay.setProps).toHaveBeenCalled();
    const call = mv.deckOverlay.setProps.mock.calls[0][0];
    expect(call.layers).toBeDefined();
    expect(Array.isArray(call.layers)).toBe(true);
  });

  it('handles features with no geometry gracefully', () => {
    const geojson = createTestGeojson([{
      type: 'Feature',
      properties: { name: 'テスト', fclass: 'motorway' },
      geometry: null,
    }]);

    expect(() => mv.setTierData('motorway', geojson)).not.toThrow();
  });

  it('handles features with empty coordinates', () => {
    const geojson = createTestGeojson([{
      type: 'Feature',
      properties: { name: 'テスト', fclass: 'motorway' },
      geometry: { type: 'LineString', coordinates: [] },
    }]);

    expect(() => mv.setTierData('motorway', geojson)).not.toThrow();
    expect(mv.labelCandidates).toHaveLength(0);
  });

  it('handles single-point line (less than 2 coordinates)', () => {
    const geojson = createTestGeojson([{
      type: 'Feature',
      properties: { name: 'テスト', fclass: 'motorway' },
      geometry: { type: 'LineString', coordinates: [[139.0, 35.0]] },
    }]);

    expect(() => mv.setTierData('motorway', geojson)).not.toThrow();
    expect(mv.labelCandidates).toHaveLength(0);
  });
});

describe('MapView.updateLayers()', () => {
  let mv;

  beforeEach(() => {
    mv = createMockedMapView();
  });

  it('creates road layers (GeoJsonLayer) for each tier', () => {
    GeoJsonLayer.mockClear();
    mv.updateLayers();

    expect(GeoJsonLayer).toHaveBeenCalledTimes(4); // 4 tiers
  });

  it('creates TextLayer when labels are enabled', () => {
    // Need at least one label candidate
    mv.setTierData('motorway', createTestGeojson([
      createLineFeature('テスト道路', 'motorway', null),
    ]));
    TextLayer.mockClear();

    mv.updateLayers();

    expect(TextLayer).toHaveBeenCalled();
  });

  it('does not create TextLayer when labels are disabled', () => {
    mv.showLabels = false;
    TextLayer.mockClear();

    mv.updateLayers();

    expect(TextLayer).not.toHaveBeenCalled();
  });

  it('creates highlight GeoJsonLayer when highlightData exists', () => {
    mv.highlightData = createTestGeojson([
      createLineFeature('ハイライト', 'motorway', null),
    ]);
    GeoJsonLayer.mockClear();

    mv.updateLayers();

    // 4 road layers + 1 highlight layer = 5 calls
    expect(GeoJsonLayer).toHaveBeenCalledTimes(5);
  });

  it('does not create highlight layer when no highlightData', () => {
    mv.highlightData = null;
    GeoJsonLayer.mockClear();

    mv.updateLayers();

    expect(GeoJsonLayer).toHaveBeenCalledTimes(4); // road layers only
  });

  it('caches road layers and reuses them', () => {
    mv.updateLayers();
    const firstCallCount = GeoJsonLayer.mock.calls.length;

    mv.updateLayers();
    // Should not create new road layers (cached)
    expect(GeoJsonLayer.mock.calls.length).toBe(firstCallCount);
  });

  it('rebuilds road layers when cache is invalidated', () => {
    mv.updateLayers();
    const firstCallCount = GeoJsonLayer.mock.calls.length;

    mv._roadLayers = null; // invalidate cache
    mv.updateLayers();

    expect(GeoJsonLayer.mock.calls.length).toBe(firstCallCount + 4);
  });
});

describe('MapView.setLabelsVisible()', () => {
  let mv;

  beforeEach(() => {
    mv = createMockedMapView();
  });

  it('sets showLabels flag to true', () => {
    mv.showLabels = false;
    mv.setLabelsVisible(true);
    expect(mv.showLabels).toBe(true);
  });

  it('sets showLabels flag to false', () => {
    mv.setLabelsVisible(false);
    expect(mv.showLabels).toBe(false);
  });

  it('resets labelsData for recalculation', () => {
    mv.labelsData = [{ name: 'old' }];
    mv.setLabelsVisible(true);
    expect(mv.labelsData).toEqual([]);
  });

  it('calls updateLayers', () => {
    const spy = vi.spyOn(mv, 'updateLayers');
    mv.setLabelsVisible(true);
    expect(spy).toHaveBeenCalled();
  });
});

describe('MapView.setFclassVisible()', () => {
  let mv;

  beforeEach(() => {
    mv = createMockedMapView();
  });

  it('hides a fclass', () => {
    mv.setFclassVisible('motorway', false);
    expect(mv._hiddenFclasses.has('motorway')).toBe(true);
  });

  it('shows a fclass', () => {
    mv._hiddenFclasses.add('motorway');
    mv.setFclassVisible('motorway', true);
    expect(mv._hiddenFclasses.has('motorway')).toBe(false);
  });

  it('invalidates and rebuilds road layer cache', () => {
    mv.updateLayers(); // build cache
    const oldLayers = mv._roadLayers;
    expect(oldLayers).not.toBeNull();

    GeoJsonLayer.mockClear();
    mv.setFclassVisible('motorway', false);
    // Cache was invalidated and rebuilt (new GeoJsonLayer calls)
    expect(GeoJsonLayer).toHaveBeenCalledTimes(4);
    expect(mv._roadLayers).not.toBe(oldLayers);
  });

  it('resets labelsData', () => {
    mv.labelsData = [{ name: 'old' }];
    mv.setFclassVisible('motorway', false);
    expect(mv.labelsData).toEqual([]);
  });

  it('calls updateLayers', () => {
    const spy = vi.spyOn(mv, 'updateLayers');
    mv.setFclassVisible('motorway', false);
    expect(spy).toHaveBeenCalled();
  });
});
