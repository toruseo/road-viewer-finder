import { describe, it, expect } from 'vitest';
import { ROAD_STYLES, DEFAULT_ROAD_STYLE, ROAD_LAYERS } from '../../src/MapView.js';

describe('ROAD_STYLES', () => {
  const expectedFclasses = ['motorway', 'trunk', 'primary', 'secondary'];

  it('should have all 4 fclass keys', () => {
    expect(Object.keys(ROAD_STYLES).sort()).toEqual(expectedFclasses.sort());
  });

  it.each(expectedFclasses)('"%s" should have a valid color (RGBA array with 4 elements 0-255)', (fclass) => {
    const style = ROAD_STYLES[fclass];
    expect(style.color).toHaveLength(4);
    for (const val of style.color) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(255);
    }
  });

  it.each(expectedFclasses)('"%s" should have a positive width', (fclass) => {
    expect(ROAD_STYLES[fclass].width).toBeGreaterThan(0);
  });
});

describe('DEFAULT_ROAD_STYLE', () => {
  it('should have color and width', () => {
    expect(DEFAULT_ROAD_STYLE.color).toHaveLength(4);
    expect(DEFAULT_ROAD_STYLE.width).toBeGreaterThan(0);
  });
});

describe('ROAD_LAYERS', () => {
  it('should have 4 layers in draw order: secondary -> primary -> trunk -> motorway', () => {
    expect(ROAD_LAYERS).toHaveLength(4);
    expect(ROAD_LAYERS[0].fclass).toBe('secondary');
    expect(ROAD_LAYERS[1].fclass).toBe('primary');
    expect(ROAD_LAYERS[2].fclass).toBe('trunk');
    expect(ROAD_LAYERS[3].fclass).toBe('motorway');
  });

  it('each layer should have color and width matching ROAD_STYLES', () => {
    for (const layer of ROAD_LAYERS) {
      const style = ROAD_STYLES[layer.fclass];
      expect(layer.color).toEqual(style.color);
      expect(layer.width).toBe(style.width);
    }
  });

  it('each layer should have a unique id', () => {
    const ids = ROAD_LAYERS.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
