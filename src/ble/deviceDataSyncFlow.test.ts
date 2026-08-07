import { beforeEach, describe, expect, it, vi } from 'vitest';

import { syncPendingBleData } from './smartPetBle';
import { retryPendingUploadForDevice } from './pendingUploadCoordinator';
import { receiveAndUploadDeviceData } from './deviceDataSyncFlow';

vi.mock('./smartPetBle', () => ({
  syncPendingBleData: vi.fn(),
}));

vi.mock('./pendingUploadCoordinator', () => ({
  retryPendingUploadForDevice: vi.fn(),
}));

describe('receiveAndUploadDeviceData', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads the durable queue immediately after BLE receive completes', async () => {
    const receiveResult = {
      completed: true,
      receivedBytes: 48_128,
      lastBlockId: 1,
      blocks: [],
      storedBlocks: [{ id: 'pending-block' }],
      blockSummaries: [],
      frameSummaries: [],
      pullDurationMs: 800,
    };
    vi.mocked(syncPendingBleData).mockResolvedValue(receiveResult as never);
    vi.mocked(retryPendingUploadForDevice).mockResolvedValue({
      batchId: 41,
      batchStatus: 'completed',
      totalBytes: 48_128,
      files: [],
    });
    const onReceived = vi.fn();

    const result = await receiveAndUploadDeviceData({
      target: { deviceSn: 'XGAE100779', deviceType: 'trainer' },
      device: { id: 7, deviceSn: 'XGAE100779', appUserId: 1 },
      onReceived,
    });

    expect(onReceived).toHaveBeenCalledWith(receiveResult);
    expect(retryPendingUploadForDevice).toHaveBeenCalledWith(
      { id: 7, deviceSn: 'XGAE100779', appUserId: 1 },
      undefined,
    );
    expect(result.upload?.batchId).toBe(41);
  });

  it('shares one BLE receive when two UI entry points request the same device', async () => {
    let finishReceive!: (value: unknown) => void;
    vi.mocked(syncPendingBleData).mockReturnValue(
      new Promise((resolve) => {
        finishReceive = resolve;
      }) as never,
    );
    vi.mocked(retryPendingUploadForDevice).mockResolvedValue(null);
    const input = {
      target: { deviceSn: 'XGAE100779', deviceType: 'trainer' as const },
      device: { id: 7, deviceSn: 'XGAE100779', appUserId: 1 },
    };

    const first = receiveAndUploadDeviceData(input);
    const second = receiveAndUploadDeviceData(input);
    expect(syncPendingBleData).toHaveBeenCalledTimes(1);

    finishReceive({
      completed: true,
      receivedBytes: 0,
      lastBlockId: 0,
      blocks: [],
      storedBlocks: [],
      blockSummaries: [],
      frameSummaries: [],
      pullDurationMs: 100,
    });

    await expect(first).resolves.toEqual(await second);
    expect(retryPendingUploadForDevice).toHaveBeenCalledTimes(1);
  });
});
