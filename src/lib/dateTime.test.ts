import { describe, expect, it } from 'vitest';

import { formatBeijingDateTime } from './dateTime';

describe('formatBeijingDateTime', () => {
  it('always renders UTC timestamps in Beijing time', () => {
    expect(formatBeijingDateTime('2026-07-21T03:01:00Z')).toBe('7-21 11:01');
    expect(formatBeijingDateTime('2026-07-21T11:01:00')).toBe('7-21 19:01');
    expect(formatBeijingDateTime('2026-07-21T11:01:00+08:00')).toBe('7-21 11:01');
    expect(
      formatBeijingDateTime('2026-07-21T03:01:00Z', { includeYear: true }),
    ).toBe('2026-7-21 11:01');
  });

  it('handles invalid timestamps', () => {
    expect(formatBeijingDateTime('not-a-date')).toBe('时间未知');
  });
});
