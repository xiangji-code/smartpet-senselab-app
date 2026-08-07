import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadPendingDeviceBlocks } from './audioUploadFlow';
import { retryPendingUploadForDevice } from './pendingUploadCoordinator';

vi.mock('./audioUploadFlow', () => ({
  uploadPendingDeviceBlocks: vi.fn(),
}));

describe('retryPendingUploadForDevice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deduplicates page and foreground retries for the same account and device', async () => {
    let finish!: () => void;
    const pending = new Promise<null>((resolve) => {
      finish = () => resolve(null);
    });
    vi.mocked(uploadPendingDeviceBlocks).mockReturnValue(pending);
    const device = { id: 7, deviceSn: 'XGAE100779', appUserId: 1 };

    const first = retryPendingUploadForDevice(device);
    const second = retryPendingUploadForDevice(device);
    finish();

    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    expect(uploadPendingDeviceBlocks).toHaveBeenCalledTimes(1);
  });
});
