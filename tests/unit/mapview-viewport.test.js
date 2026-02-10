import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockedMapView, createTestGeojson, createLineFeature } from './helpers.js';

describe('MapView.filterLabelsForViewport()', () => {
  let mv;

  beforeEach(() => {
    mv = createMockedMapView();
  });

  it('returns empty array when no candidates', () => {
    mv.labelCandidates = [];
    expect(mv.filterLabelsForViewport()).toEqual([]);
  });

  it('returns empty array when map is null', () => {
    mv.map = null;
    mv.labelCandidates = [{ position: [139.5, 35.5], name: 'test' }];
    expect(mv.filterLabelsForViewport()).toEqual([]);
  });

  it('includes candidates within viewport bounds', () => {
    // Mock viewport: 138-141 lng, 34-37 lat
    mv.labelCandidates = [
      { position: [139.5, 35.5], name: 'inside', fclass: 'motorway', label: 'inside', priority: 5 },
    ];

    const result = mv.filterLabelsForViewport();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('inside');
  });

  it('excludes candidates outside viewport bounds', () => {
    mv.labelCandidates = [
      { position: [130.0, 35.5], name: 'outside-west', fclass: 'motorway', label: 'test', priority: 5 },
      { position: [150.0, 35.5], name: 'outside-east', fclass: 'motorway', label: 'test', priority: 5 },
      { position: [139.5, 30.0], name: 'outside-south', fclass: 'motorway', label: 'test', priority: 5 },
      { position: [139.5, 40.0], name: 'outside-north', fclass: 'motorway', label: 'test', priority: 5 },
    ];

    const result = mv.filterLabelsForViewport();
    expect(result).toHaveLength(0);
  });

  it('deduplicates labels by pixel grid spacing', () => {
    // Two candidates at nearly the same pixel position
    // map.project maps lng/lat to pixels: x = (lng-138)*500, y = (37-lat)*500
    // Both at 139.5, 35.5 → pixel (750, 750)
    mv.labelCandidates = [
      { position: [139.500, 35.500], name: 'first', fclass: 'motorway', label: 'first', priority: 5 },
      { position: [139.501, 35.501], name: 'second', fclass: 'motorway', label: 'second', priority: 4 },
    ];

    const result = mv.filterLabelsForViewport();
    // Both map to very close pixels, so only first one should be kept
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('first');
  });

  it('allows labels that are far apart in pixel space', () => {
    // Place candidates far enough apart: LABEL_MIN_SPACING_PX = 150
    // pixel x = (lng-138)*500, need > 2 grid cells apart (3x3 neighborhood check)
    // 139.0 → x=500, cell=3; 139.5 → x=750, cell=5 (gap of 2 cells, no overlap in 3x3)
    mv.labelCandidates = [
      { position: [139.0, 35.5], name: 'left', fclass: 'motorway', label: 'left', priority: 5 },
      { position: [139.5, 35.5], name: 'right', fclass: 'motorway', label: 'right', priority: 5 },
    ];

    const result = mv.filterLabelsForViewport();
    expect(result).toHaveLength(2);
  });

  it('skips labels for hidden fclasses', () => {
    mv._hiddenFclasses.add('motorway');
    mv.labelCandidates = [
      { position: [139.5, 35.5], name: 'hidden', fclass: 'motorway', label: 'hidden', priority: 5 },
      { position: [140.0, 35.5], name: 'visible', fclass: 'trunk', label: 'visible', priority: 4 },
    ];

    const result = mv.filterLabelsForViewport();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('visible');
  });

  it('processes highlight candidates before regular candidates', () => {
    // Place two candidates at the same pixel position
    // Highlight candidate should win since it's processed first
    mv.labelCandidates = [
      { position: [139.5, 35.5], name: 'regular', fclass: 'motorway', label: 'regular', priority: 5 },
    ];
    mv.highlightCandidates = [
      { position: [139.5, 35.5], name: 'highlight', fclass: 'motorway', label: 'highlight', priority: 5 },
    ];

    const result = mv.filterLabelsForViewport();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('highlight');
  });

  it('handles unknown fclass as non-hidden by default', () => {
    mv.labelCandidates = [
      { position: [139.5, 35.5], name: 'unknown', fclass: 'tertiary', label: 'unknown', priority: 1 },
    ];

    const result = mv.filterLabelsForViewport();
    expect(result).toHaveLength(1);
  });
});

describe('MapView label generation (integration via setTierData)', () => {
  let mv;

  beforeEach(() => {
    mv = createMockedMapView();
  });

  it('label candidates have required properties', () => {
    const geojson = createTestGeojson([
      createLineFeature('東名高速道路', 'motorway', 'E1'),
    ]);

    mv.setTierData('motorway', geojson);

    for (const candidate of mv.labelCandidates) {
      expect(candidate).toHaveProperty('name');
      expect(candidate).toHaveProperty('position');
      expect(candidate).toHaveProperty('angle');
      expect(candidate).toHaveProperty('fclass');
      expect(candidate).toHaveProperty('label');
      expect(candidate).toHaveProperty('priority');
      expect(candidate.position).toHaveLength(2);
      expect(typeof candidate.angle).toBe('number');
      expect(typeof candidate.priority).toBe('number');
    }
  });

  it('higher priority roads have higher priority values', () => {
    const geojson = createTestGeojson([
      createLineFeature('高速道路', 'motorway', null),
      createLineFeature('国道', 'trunk', null),
      createLineFeature('県道', 'secondary', null),
    ]);

    mv.setTierData('motorway', geojson);

    const motorwayCandidate = mv.labelCandidates.find(c => c.fclass === 'motorway');
    const trunkCandidate = mv.labelCandidates.find(c => c.fclass === 'trunk');
    const secondaryCandidate = mv.labelCandidates.find(c => c.fclass === 'secondary');

    expect(motorwayCandidate.priority).toBeGreaterThan(trunkCandidate.priority);
    expect(trunkCandidate.priority).toBeGreaterThan(secondaryCandidate.priority);
  });

  it('candidates are sorted by priority (descending)', () => {
    const geojson = createTestGeojson([
      createLineFeature('県道', 'secondary', null),
      createLineFeature('高速道路', 'motorway', null),
      createLineFeature('国道', 'trunk', null),
    ]);

    mv.setTierData('motorway', geojson);

    for (let i = 1; i < mv.labelCandidates.length; i++) {
      expect(mv.labelCandidates[i - 1].priority).toBeGreaterThanOrEqual(
        mv.labelCandidates[i].priority
      );
    }
  });

  it('label angle is within -90 to 90 degrees', () => {
    const geojson = createTestGeojson([
      createLineFeature('道路A', 'motorway', null, [[139.0, 35.0], [139.1, 35.2]]),
      createLineFeature('道路B', 'trunk', null, [[139.0, 35.0], [138.9, 35.1]]),
      createLineFeature('道路C', 'primary', null, [[139.0, 35.0], [139.0, 35.5]]),
    ]);

    mv.setTierData('motorway', geojson);

    for (const candidate of mv.labelCandidates) {
      expect(candidate.angle).toBeGreaterThanOrEqual(-90);
      expect(candidate.angle).toBeLessThanOrEqual(90);
    }
  });

  it('label positions lie along the original line', () => {
    const coords = [[139.0, 35.0], [140.0, 35.0]];
    const geojson = createTestGeojson([
      createLineFeature('直線道路', 'motorway', null, coords),
    ]);

    mv.setTierData('motorway', geojson);

    for (const candidate of mv.labelCandidates) {
      const [lng, lat] = candidate.position;
      expect(lng).toBeGreaterThanOrEqual(139.0);
      expect(lng).toBeLessThanOrEqual(140.0);
      // Latitude should be approximately 35.0 for a horizontal line
      expect(lat).toBeCloseTo(35.0, 5);
    }
  });

  it('does not generate labels when showLabels is false', () => {
    mv.showLabels = false;
    const geojson = createTestGeojson([
      createLineFeature('テスト', 'motorway', null),
    ]);

    mv.setTierData('motorway', geojson);

    expect(mv.labelCandidates).toHaveLength(0);
  });
});
