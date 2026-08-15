import { describe, expect, it } from 'vitest';

import {
  clampIntensity,
  intensityFromHorizontalPosition,
} from './circular-intensity';

describe('circular intensity', () => {
  it('always returns an integer level inside the supported range', () => {
    expect(clampIntensity(4.49, 8)).toBe(4);
    expect(clampIntensity(0, 8)).toBe(1);
    expect(clampIntensity(9, 8)).toBe(8);
  });

  it('maps a horizontal slider position to a bounded integer level', () => {
    expect(intensityFromHorizontalPosition(0, 200, 8)).toBe(1);
    expect(intensityFromHorizontalPosition(100, 200, 8)).toBe(4);
    expect(intensityFromHorizontalPosition(200, 200, 8)).toBe(8);
    expect(intensityFromHorizontalPosition(120, 200, 99)).toBe(59);
    expect(intensityFromHorizontalPosition(250, 200, 8)).toBe(8);
  });
});
