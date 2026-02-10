import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MapView } from '../../src/MapView.js';

describe('MapView.handleClick()', () => {
  let mv;
  let mockCallback;
  let currentTime;

  beforeEach(() => {
    mv = new MapView('map');
    mockCallback = vi.fn();
    mv.onFeatureDoubleClick = mockCallback;
    currentTime = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const feature1 = { properties: { name: '東名高速道路', fclass: 'motorway' } };
  const feature2 = { properties: { name: '国道1号', fclass: 'trunk' } };

  it('single click does not fire callback', () => {
    mv.handleClick({ object: feature1 });
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('double click within 400ms fires callback', () => {
    mv.handleClick({ object: feature1 });
    currentTime = 1300; // 300ms later
    mv.handleClick({ object: feature1 });
    expect(mockCallback).toHaveBeenCalledOnce();
    expect(mockCallback).toHaveBeenCalledWith(feature1.properties);
  });

  it('two clicks more than 400ms apart do not fire callback', () => {
    mv.handleClick({ object: feature1 });
    currentTime = 1500; // 500ms later
    mv.handleClick({ object: feature1 });
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('clicks on different features do not fire callback', () => {
    mv.handleClick({ object: feature1 });
    currentTime = 1200;
    mv.handleClick({ object: feature2 });
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('info.object being null does not throw', () => {
    expect(() => mv.handleClick({ object: null })).not.toThrow();
    expect(() => mv.handleClick({})).not.toThrow();
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('state resets after double click', () => {
    mv.handleClick({ object: feature1 });
    currentTime = 1200;
    mv.handleClick({ object: feature1 });
    expect(mockCallback).toHaveBeenCalledOnce();

    // Third click should not trigger again immediately
    currentTime = 1300;
    mv.handleClick({ object: feature1 });
    expect(mockCallback).toHaveBeenCalledOnce();
  });
});
