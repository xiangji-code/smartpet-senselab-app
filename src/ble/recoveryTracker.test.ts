import { describe, expect, it } from 'vitest';

import { BleRecoveryTracker } from './recoveryTracker';

describe('BleRecoveryTracker', () => {
  it('counts retries independently for each block and offset', () => {
    const tracker = new BleRecoveryTracker(3);

    expect(tracker.register(2, 1000)).toBe(1);
    expect(tracker.register(2, 1000)).toBe(2);
    expect(tracker.register(2, 5000)).toBe(1);
    expect(tracker.register(3, 1000)).toBe(1);
  });

  it('clears all retry positions after a block completes', () => {
    const tracker = new BleRecoveryTracker(3);
    tracker.register(2, 1000);
    tracker.register(2, 5000);

    tracker.clearBlock(2);

    expect(tracker.register(2, 1000)).toBe(1);
    expect(tracker.register(2, 5000)).toBe(1);
  });
});
