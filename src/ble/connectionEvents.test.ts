import { describe, expect, it, vi } from 'vitest';

import { BleConnectionEvents } from './connectionEvents';

describe('BleConnectionEvents', () => {
  it('publishes a stable version snapshot after each connection change', () => {
    const events = new BleConnectionEvents();
    const listener = vi.fn();
    const unsubscribe = events.subscribe(listener);

    expect(events.getSnapshot()).toBe(0);
    events.changed();
    events.changed();

    expect(events.getSnapshot()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    events.changed();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
