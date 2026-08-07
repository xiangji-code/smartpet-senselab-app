import { describe, expect, it } from 'vitest';

import {
  foregroundScanDurationMs,
  nextForegroundScanDelayMs,
} from './adaptiveScanPolicy';

describe('adaptive foreground BLE scan policy', () => {
  it('uses a longer scan immediately after entering the foreground', () => {
    expect(foregroundScanDurationMs(true)).toBe(8_000);
    expect(foregroundScanDurationMs(false)).toBe(5_000);
  });

  it('starts idle scan windows 15 seconds apart', () => {
    expect(nextForegroundScanDelayMs(5_000, false)).toBe(10_000);
    expect(nextForegroundScanDelayMs(8_000, false)).toBe(7_000);
    expect(nextForegroundScanDelayMs(20_000, false)).toBe(1_000);
  });

  it('rests after a transfer attempt before scanning again', () => {
    expect(nextForegroundScanDelayMs(30_000, true)).toBe(10_000);
  });
});
