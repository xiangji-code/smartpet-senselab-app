import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kvGetJson, kvRemove, kvSetJson } from '../lib/kv';
import { consentStore, DATA_COLLECTION_POLICY_VERSION } from './consentStore';

vi.mock('../lib/kv', () => ({
  kvGetJson: vi.fn(),
  kvRemove: vi.fn(),
  kvSetJson: vi.fn(),
}));

const getJsonMock = vi.mocked(kvGetJson);
const removeMock = vi.mocked(kvRemove);
const setJsonMock = vi.mocked(kvSetJson);

describe('consentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a separate storage key for each App user', async () => {
    getJsonMock.mockResolvedValue({
      granted: true,
      policyVersion: DATA_COLLECTION_POLICY_VERSION,
      updatedAt: '2026-07-23T00:00:00.000Z',
    });

    await consentStore.get(12);
    await consentStore.get(34);

    expect(getJsonMock).toHaveBeenNthCalledWith(
      1,
      'smartpet.dataCollectionConsent.user.12',
      null,
    );
    expect(getJsonMock).toHaveBeenNthCalledWith(
      2,
      'smartpet.dataCollectionConsent.user.34',
      null,
    );
  });

  it('fails closed when the record is missing, invalid, or for an older policy', async () => {
    getJsonMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ granted: true })
      .mockResolvedValueOnce({
        granted: true,
        policyVersion: 'older-policy',
        updatedAt: '2026-07-23T00:00:00.000Z',
      });

    await expect(consentStore.get(1)).resolves.toBe(false);
    await expect(consentStore.get(1)).resolves.toBe(false);
    await expect(consentStore.get(1)).resolves.toBe(false);
  });

  it('fails closed when storage cannot be read', async () => {
    getJsonMock.mockRejectedValue(new Error('storage unavailable'));

    await expect(consentStore.get(1)).resolves.toBe(false);
  });

  it('stores the decision with the current policy version and timestamp', async () => {
    await consentStore.set(7, true);

    expect(setJsonMock).toHaveBeenCalledOnce();
    expect(setJsonMock).toHaveBeenCalledWith(
      'smartpet.dataCollectionConsent.user.7',
      expect.objectContaining({
        granted: true,
        policyVersion: DATA_COLLECTION_POLICY_VERSION,
      }),
    );

    const stored = setJsonMock.mock.calls[0][1] as { updatedAt: string };
    expect(Number.isNaN(Date.parse(stored.updatedAt))).toBe(false);
  });

  it('clears only the selected App user consent record', async () => {
    await consentStore.clear(7);

    expect(removeMock).toHaveBeenCalledWith(
      'smartpet.dataCollectionConsent.user.7',
    );
  });
});
