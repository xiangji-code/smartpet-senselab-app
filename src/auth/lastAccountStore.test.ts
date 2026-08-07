import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kvGet, kvRemove, kvSet } from '../lib/kv';
import { lastAccountStore } from './lastAccountStore';

vi.mock('../lib/kv', () => ({
  kvGet: vi.fn(),
  kvRemove: vi.fn(),
  kvSet: vi.fn(),
}));

const getMock = vi.mocked(kvGet);
const removeMock = vi.mocked(kvRemove);
const setMock = vi.mocked(kvSet);

describe('lastAccountStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the normalized last successful App email', async () => {
    getMock.mockResolvedValue('  User@Example.COM  ');

    await expect(lastAccountStore.getEmail()).resolves.toBe('user@example.com');
    expect(getMock).toHaveBeenCalledWith('smartpet.lastAccount.email');
  });

  it('ignores missing, invalid, or unreadable values', async () => {
    getMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('not-an-email')
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(lastAccountStore.getEmail()).resolves.toBeNull();
    await expect(lastAccountStore.getEmail()).resolves.toBeNull();
    await expect(lastAccountStore.getEmail()).resolves.toBeNull();
  });

  it('stores only a normalized email identifier', async () => {
    await lastAccountStore.setEmail('  User@Example.COM ');

    expect(setMock).toHaveBeenCalledWith(
      'smartpet.lastAccount.email',
      'user@example.com',
    );
  });

  it('clears the remembered App email', async () => {
    await lastAccountStore.clear();

    expect(removeMock).toHaveBeenCalledWith('smartpet.lastAccount.email');
  });
});
