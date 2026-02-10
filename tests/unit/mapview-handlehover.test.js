import { describe, it, expect, beforeEach } from 'vitest';
import { MapView } from '../../src/MapView.js';

describe('MapView.handleHover()', () => {
  let mv;
  let tooltip;

  beforeEach(() => {
    mv = new MapView('map');
    tooltip = { style: { display: 'none', left: '', top: '' }, textContent: '' };
    mv.tooltip = tooltip;
  });

  it('named feature hover shows tooltip with correct text', () => {
    mv.handleHover({
      object: { properties: { name: '東名高速道路', fclass: 'motorway', ref: 'E1' } },
      x: 100,
      y: 200,
    });
    expect(tooltip.style.display).toBe('block');
    expect(tooltip.textContent).toBe('東名高速道路 (高速道路 E1)');
  });

  it('tooltip position is offset by +10px', () => {
    mv.handleHover({
      object: { properties: { name: '国道1号', fclass: 'trunk' } },
      x: 50,
      y: 75,
    });
    expect(tooltip.style.left).toBe('60px');
    expect(tooltip.style.top).toBe('85px');
  });

  it('feature without name hides tooltip', () => {
    mv.handleHover({
      object: { properties: { fclass: 'motorway', ref: 'E1' } },
      x: 100,
      y: 200,
    });
    expect(tooltip.style.display).toBe('none');
  });

  it('no object hides tooltip', () => {
    tooltip.style.display = 'block';
    mv.handleHover({ x: 100, y: 200 });
    expect(tooltip.style.display).toBe('none');
  });

  it('tooltip being null does not throw', () => {
    mv.tooltip = null;
    expect(() => mv.handleHover({ object: { properties: { name: 'test' } }, x: 0, y: 0 })).not.toThrow();
    expect(() => mv.handleHover({ x: 0, y: 0 })).not.toThrow();
  });

  it('feature with name only (no fclass/ref) shows name alone', () => {
    mv.handleHover({
      object: { properties: { name: '無名道路' } },
      x: 10,
      y: 20,
    });
    expect(tooltip.textContent).toBe('無名道路');
  });

  it('feature with unknown fclass shows raw fclass value', () => {
    mv.handleHover({
      object: { properties: { name: 'テスト道路', fclass: 'tertiary' } },
      x: 10,
      y: 20,
    });
    expect(tooltip.textContent).toBe('テスト道路 (tertiary)');
  });
});
