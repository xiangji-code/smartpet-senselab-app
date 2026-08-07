import { describe, expect, it } from 'vitest';

import { uploadsApi } from './uploads';
import { mapRecord } from './records';
import { recordsApi } from './records';
import { vi } from 'vitest';

vi.mock('./uploads', () => ({
  uploadsApi: {
    listBatches: vi.fn(),
    getBatchStatus: vi.fn(),
  },
}));

describe('records API mapping', () => {
  it('maps backend fields to the App domain without inventing values', () => {
    expect(
      mapRecord({
        id: 'upload:12',
        device_id: 3,
        device_name: '客厅项圈',
        pet_profile_id: 8,
        pet_name: '旺财',
        record_type: 'bark',
        occurred_at: '2026-07-23T10:00:00Z',
        summary: '已上传音频：bark.wav · 1.2 秒',
        bark_count: null,
        duration_seconds: 1.2,
        confidence: null,
        source: 'app_upload',
        status: 'completed',
      }),
    ).toEqual({
      id: 'upload:12',
      deviceId: 3,
      deviceName: '客厅项圈',
      petProfileId: 8,
      petName: '旺财',
      recordType: 'bark',
      occurredAt: '2026-07-23T10:00:00Z',
      summary: '已上传音频：bark.wav · 1.2 秒',
      barkCount: null,
      durationSeconds: 1.2,
      confidence: null,
      source: 'app_upload',
      status: 'completed',
    });
  });

  it('finds the upload details used by the Bluetooth test result', async () => {
    vi.mocked(uploadsApi.listBatches).mockResolvedValue([
      {
        id: 31,
        deviceId: 3,
        deviceSn: 'XGAE1005CA',
        petProfileId: null,
        source: 'app_upload',
        status: 'completed',
        fileCount: 1,
        totalBytes: 240,
        createdAt: '2026-07-23T10:00:00Z',
        completedAt: '2026-07-23T10:01:00Z',
      },
    ]);
    vi.mocked(uploadsApi.getBatchStatus).mockResolvedValue({
      batch: {
        id: 31,
        deviceId: 3,
        deviceSn: 'XGAE1005CA',
        petProfileId: null,
        source: 'app_upload',
        status: 'completed',
        fileCount: 1,
        totalBytes: 240,
        createdAt: '2026-07-23T10:00:00Z',
        completedAt: '2026-07-23T10:01:00Z',
      },
      files: [
        {
          id: 12,
          batchId: 31,
          originalFilename: 'ble-device-XGAE1005CA-block-7.bin',
          storagePath: 'app_user_1/batch_31/audio.bin',
          fileHash: 'abc123',
          fileSize: 240,
          format: 'bin',
          durationSeconds: null,
          sampleRate: null,
          uploadedAt: '2026-07-23T10:00:30Z',
        },
      ],
    });

    await expect(recordsApi.getUploadDetail('upload:12')).resolves.toMatchObject({
      blockId: 7,
      batchId: 31,
      batchStatus: 'completed',
      fileId: 12,
      storagePath: 'app_user_1/batch_31/audio.bin',
      fileHash: 'abc123',
      fileSize: 240,
    });
  });
});
