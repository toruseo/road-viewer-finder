import { describe, it, expect } from 'vitest';
import { MapView } from '../../src/MapView.js';

function createFeature(name, fclass, ref) {
  return {
    type: 'Feature',
    properties: { name, fclass, ref },
    geometry: { type: 'LineString', coordinates: [[139.7, 35.7], [139.8, 35.8]] },
  };
}

function createMapViewWithFeatures(features) {
  const mv = new MapView('map');
  mv.currentData = { type: 'FeatureCollection', features };
  return mv;
}

describe('MapView.search()', () => {
  const features = [
    createFeature('東名高速道路', 'motorway', 'E1'),
    createFeature('新東名高速道路', 'motorway', 'E1A'),
    createFeature('国道1号', 'trunk', '1'),
    createFeature('国道246号', 'trunk', '246'),
    createFeature('環状八号線', 'primary', null),
    createFeature('県道100号', 'secondary', '100'),
    createFeature(null, 'motorway', 'E20'),  // name無し
  ];

  it('empty query returns empty array', () => {
    const mv = createMapViewWithFeatures(features);
    expect(mv.search({ name: '', fclass: '', ref: '' })).toEqual([]);
    expect(mv.search({})).toEqual([]);
  });

  it('name partial match', () => {
    const mv = createMapViewWithFeatures(features);
    const results = mv.search({ name: '東名' });
    expect(results).toHaveLength(2);
    expect(results.map(f => f.properties.name)).toContain('東名高速道路');
    expect(results.map(f => f.properties.name)).toContain('新東名高速道路');
  });

  it('fclass exact match', () => {
    const mv = createMapViewWithFeatures(features);
    const results = mv.search({ fclass: 'trunk' });
    expect(results).toHaveLength(2);
    expect(results.every(f => f.properties.fclass === 'trunk')).toBe(true);
  });

  it('ref case-insensitive match', () => {
    const mv = createMapViewWithFeatures(features);
    const results = mv.search({ ref: 'e1a' });
    expect(results).toHaveLength(1);
    expect(results[0].properties.name).toBe('新東名高速道路');
  });

  it('ref match against semicolon-separated values', () => {
    const featureWithMultiRef = createFeature('東名/新東名', 'motorway', 'E1;E1A');
    const mv = createMapViewWithFeatures([featureWithMultiRef]);
    expect(mv.search({ ref: 'E1A' })).toHaveLength(1);
    expect(mv.search({ ref: 'e1' })).toHaveLength(1);
  });

  it('combined query (name + fclass + ref)', () => {
    const mv = createMapViewWithFeatures(features);
    const results = mv.search({ name: '東名', fclass: 'motorway', ref: 'E1A' });
    expect(results).toHaveLength(1);
    expect(results[0].properties.name).toBe('新東名高速道路');
  });

  it('currentData is null returns empty array', () => {
    const mv = new MapView('map');
    mv.currentData = null;
    expect(mv.search({ name: 'test' })).toEqual([]);
  });

  it('features with empty/null properties do not cause errors', () => {
    const badFeatures = [
      { type: 'Feature', properties: null, geometry: null },
      { type: 'Feature', properties: {}, geometry: null },
    ];
    const mv = createMapViewWithFeatures(badFeatures);
    expect(() => mv.search({ name: 'test' })).not.toThrow();
    expect(mv.search({ name: 'test' })).toEqual([]);
  });

  it('no match returns empty array', () => {
    const mv = createMapViewWithFeatures(features);
    expect(mv.search({ name: '存在しない道路' })).toEqual([]);
  });
});
