import { describe, expect, it } from 'vitest';

import { clampIntensity, intensityFromPoint, intensityProgress } from './circular-intensity';

describe('circular intensity', () => {
  it('uses an exact value/max ratio for the progress ring', () => {
    expect(intensityProgress(4, 8)).toBe(0.5);
    expect(intensityProgress(8, 8)).toBe(1);
  });

  it('always returns an integer level inside the supported range', () => {
    expect(clampIntensity(4.49, 8)).toBe(4);
    expect(clampIntensity(0, 8)).toBe(1);
    expect(clampIntensity(9, 8)).toBe(8);
  });

  it('maps cardinal drag positions clockwise from the top', () => {
    expect(intensityFromPoint(100, 200, 200, 8, 1)).toBe(4);
    expect(intensityFromPoint(200, 100, 200, 8, 1)).toBe(2);
    expect(intensityFromPoint(0, 100, 200, 8, 1)).toBe(6);
  });

  it('keeps the current level when a drag passes through the center', () => {
    expect(intensityFromPoint(100, 100, 200, 8, 4)).toBe(4);
  });
});
