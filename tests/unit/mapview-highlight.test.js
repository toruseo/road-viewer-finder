import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockedMapView, createTestGeojson, createLineFeature } from './helpers.js';

describe('MapView.setHighlight()', () => {
  let mv;

  beforeEach(() => {
    mv = createMockedMapView();
  });

  it('sets highlightData from features', () => {
    const features = [
      createLineFeature('東名高速道路', 'motorway', 'E1'),
    ];

    mv.setHighlight(features);

    expect(mv.highlightData).not.toBeNull();
    expect(mv.highlightData.type).toBe('FeatureCollection');
    expect(mv.highlightData.features).toHaveLength(1);
  });

  it('generates highlight label candidates for named features', () => {
    const features = [
      createLineFeature('東名高速道路', 'motorway', 'E1'),
    ];

    mv.setHighlight(features);

    expect(mv.highlightCandidates.length).toBeGreaterThan(0);
  });

  it('calls fitToData on highlighted features', () => {
    const spy = vi.spyOn(mv, 'fitToData');
    const features = [
      createLineFeature('東名高速道路', 'motorway', 'E1'),
    ];

    mv.setHighlight(features);

    expect(spy).toHaveBeenCalledWith(mv.highlightData);
  });

  it('calls updateLayers', () => {
    const spy = vi.spyOn(mv, 'updateLayers');
    mv.setHighlight([createLineFeature('test', 'motorway', null)]);
    expect(spy).toHaveBeenCalled();
  });

  it('clears highlight when passed empty array', () => {
    mv.highlightData = createTestGeojson([createLineFeature('old', 'motorway', null)]);
    mv.highlightCandidates = [{ name: 'old' }];

    mv.setHighlight([]);

    expect(mv.highlightData).toBeNull();
    expect(mv.highlightCandidates).toEqual([]);
  });

  it('clears highlight when passed null', () => {
    mv.highlightData = createTestGeojson([createLineFeature('old', 'motorway', null)]);

    mv.setHighlight(null);

    expect(mv.highlightData).toBeNull();
    expect(mv.highlightCandidates).toEqual([]);
  });

  it('resets labelsData for recalculation', () => {
    mv.labelsData = [{ name: 'cached' }];
    mv.setHighlight([createLineFeature('test', 'motorway', null)]);
    expect(mv.labelsData).toEqual([]);
  });
});

describe('MapView.clearHighlight()', () => {
  let mv;

  beforeEach(() => {
    mv = createMockedMapView();
  });

  it('clears highlightData', () => {
    mv.highlightData = createTestGeojson([createLineFeature('test', 'motorway', null)]);
    mv.clearHighlight();
    expect(mv.highlightData).toBeNull();
  });

  it('clears highlightCandidates', () => {
    mv.highlightCandidates = [{ name: 'test' }];
    mv.clearHighlight();
    expect(mv.highlightCandidates).toEqual([]);
  });

  it('resets labelsData', () => {
    mv.labelsData = [{ name: 'cached' }];
    mv.clearHighlight();
    expect(mv.labelsData).toEqual([]);
  });

  it('calls updateLayers', () => {
    const spy = vi.spyOn(mv, 'updateLayers');
    mv.clearHighlight();
    expect(spy).toHaveBeenCalled();
  });
});

describe('MapView.fitToData()', () => {
  let mv;

  beforeEach(() => {
    mv = createMockedMapView();
  });

  it('calls map.fitBounds with correct bounds', () => {
    const geojson = createTestGeojson([
      createLineFeature('テスト', 'motorway', null, [[139.0, 35.0], [140.0, 36.0]]),
    ]);

    mv.fitToData(geojson);

    expect(mv.map.fitBounds).toHaveBeenCalledOnce();
    const [bounds, options] = mv.map.fitBounds.mock.calls[0];
    // SW corner should be near [139.0, 35.0] minus padding
    expect(bounds[0][0]).toBeLessThan(139.0);
    expect(bounds[0][1]).toBeLessThan(35.0);
    // NE corner should be near [140.0, 36.0] plus padding
    expect(bounds[1][0]).toBeGreaterThan(140.0);
    expect(bounds[1][1]).toBeGreaterThan(36.0);
    expect(options.padding).toBe(50);
    expect(options.maxZoom).toBe(18);
  });

  it('does not call fitBounds for empty features', () => {
    mv.fitToData(createTestGeojson([]));
    expect(mv.map.fitBounds).not.toHaveBeenCalled();
  });

  it('handles features with nested coordinates (MultiLineString)', () => {
    const geojson = createTestGeojson([{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [[139.0, 35.0], [139.5, 35.5]],
          [[140.0, 36.0], [140.5, 36.5]],
        ],
      },
    }]);

    mv.fitToData(geojson);

    expect(mv.map.fitBounds).toHaveBeenCalledOnce();
  });

  it('handles features with null geometry', () => {
    const geojson = createTestGeojson([{
      type: 'Feature',
      properties: {},
      geometry: null,
    }]);

    expect(() => mv.fitToData(geojson)).not.toThrow();
    expect(mv.map.fitBounds).not.toHaveBeenCalled();
  });

  it('samples features when there are many (performance)', () => {
    // Create 20000 features
    const features = Array.from({ length: 20000 }, (_, i) => ({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [[139.0 + i * 0.0001, 35.0], [139.0 + i * 0.0001, 35.1]],
      },
    }));

    mv.fitToData(createTestGeojson(features));

    expect(mv.map.fitBounds).toHaveBeenCalledOnce();
  });
});
