import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadsApi } from '../api/uploads';
import { deleteStoredBleBlockAfterUpload, type StoredBleBlock } from './blockQueue';
import { uploadPulledDeviceBlocks } from './audioUploadFlow';
import { makeSimulatedVoiceWav } from './simulatedWav';

vi.mock('../api/uploads', () => ({
  uploadsApi: {
    createBatch: vi.fn(),
    uploadLocalFile: vi.fn(),
    completeBatch: vi.fn(),
  },
}));

vi.mock('./blockQueue', () => ({
  deleteStoredBleBlockAfterUpload: vi.fn(),
  listPendingBleBlocks: vi.fn(),
  persistBleBlock: vi.fn(),
}));

describe('makeSimulatedVoiceWav', () => {
  it('creates a valid one-second mono 16 kHz PCM WAV container', () => {
    const bytes = makeSimulatedVoiceWav();
    const view = new DataView(bytes.buffer);
    const ascii = (start: number, length: number) =>
      String.fromCharCode(...bytes.slice(start, start + length));

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(32_000);
    expect(bytes.length).toBe(32_044);
  });
});

describe('uploadPulledDeviceBlocks', () => {
  const first = storedBlock('first', 1, 100);
  const second = storedBlock('second', 2, 240);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(uploadsApi.createBatch).mockResolvedValue({
      id: 31,
      deviceId: 7,
      deviceSn: 'XGAE100A28',
      petProfileId: null,
      source: 'app_upload',
      status: 'uploading',
      fileCount: 0,
      totalBytes: 0,
      createdAt: '2026-07-21T08:00:00.000Z',
      completedAt: null,
    });
    vi.mocked(uploadsApi.uploadLocalFile)
      .mockResolvedValueOnce(uploadedFile(101, 31, 100))
      .mockResolvedValueOnce(uploadedFile(102, 31, 240));
    vi.mocked(uploadsApi.completeBatch).mockResolvedValue({
      batch: {
        id: 31,
        deviceId: 7,
        deviceSn: 'XGAE100A28',
        petProfileId: null,
        source: 'app_upload',
        status: 'completed',
        fileCount: 2,
        totalBytes: 340,
        createdAt: '2026-07-21T08:00:00.000Z',
        completedAt: '2026-07-21T08:01:00.000Z',
      },
      files: [uploadedFile(101, 31, 100), uploadedFile(102, 31, 240)],
    });
  });

  it('uploads each complete block as a separate file in one batch', async () => {
    const result = await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [first, second],
    );

    expect(uploadsApi.createBatch).toHaveBeenCalledTimes(1);
    expect(uploadsApi.uploadLocalFile).toHaveBeenCalledTimes(2);
    expect(uploadsApi.uploadLocalFile).toHaveBeenNthCalledWith(
      1,
      31,
      expect.objectContaining({ fileUri: first.fileUri, clientFileHash: first.sha256 }),
    );
    expect(uploadsApi.uploadLocalFile).toHaveBeenNthCalledWith(
      2,
      31,
      expect.objectContaining({ fileUri: second.fileUri, clientFileHash: second.sha256 }),
    );
    expect(uploadsApi.completeBatch).toHaveBeenCalledWith(31);
    expect(deleteStoredBleBlockAfterUpload).toHaveBeenCalledTimes(2);
    expect(result.totalBytes).toBe(340);
    expect(result.files.map((file) => file.blockId)).toEqual([1, 2]);
  });

  it('uploads parsed device audio as 16 kHz mono WAV with its PCM duration', async () => {
    const audio: StoredBleBlock = {
      ...first,
      type: 'audio',
      totalLength: 32_000,
      fileName: 'first.wav',
      fileUri: 'file:///first.wav',
      audioFormat: 'wav_pcm_s16le_16khz_mono',
    };

    await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [audio],
    );

    expect(uploadsApi.uploadLocalFile).toHaveBeenCalledWith(
      31,
      expect.objectContaining({
        filename: 'ble-device-XGAE100A28-block-1.wav',
        contentType: 'audio/wav',
        durationSeconds: 1,
        sampleRate: 16_000,
      }),
    );
  });

  it('uploads RF_DATA PCM captured by the device as a 16 kHz mono WAV', async () => {
    const rfAudio: StoredBleBlock = {
      ...first,
      type: 'rf_data',
      totalLength: 32_768,
      fileName: 'first.wav',
      fileUri: 'file:///first.wav',
      audioFormat: 'wav_pcm_s16le_16khz_mono',
    };

    await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [rfAudio],
    );

    expect(uploadsApi.uploadLocalFile).toHaveBeenCalledWith(
      31,
      expect.objectContaining({
        filename: 'ble-device-XGAE100A28-block-1.wav',
        contentType: 'audio/wav',
        durationSeconds: 1.024,
        sampleRate: 16_000,
      }),
    );
  });

  it('keeps the original 8 kHz metadata for legacy queued WAV files', async () => {
    const legacyAudio: StoredBleBlock = {
      ...first,
      type: 'audio',
      totalLength: 16_000,
      fileName: 'legacy.wav',
      fileUri: 'file:///legacy.wav',
      audioFormat: 'wav_pcm_s16le_8khz_mono',
    };

    await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [legacyAudio],
    );

    expect(uploadsApi.uploadLocalFile).toHaveBeenCalledWith(
      31,
      expect.objectContaining({
        filename: 'ble-device-XGAE100A28-block-1.wav',
        contentType: 'audio/wav',
        durationSeconds: 1,
        sampleRate: 8_000,
      }),
    );
  });

  it('keeps every local block when the batch cannot be completed', async () => {
    vi.mocked(uploadsApi.completeBatch).mockRejectedValueOnce(new Error('server unavailable'));

    await expect(
      uploadPulledDeviceBlocks(
        { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
        [first, second],
      ),
    ).rejects.toThrow('完成批次阶段失败');

    expect(deleteStoredBleBlockAfterUpload).not.toHaveBeenCalled();
  });

  it('rejects a queued block that belongs to another App account', async () => {
    const otherUsersBlock = { ...first, appUserId: 99 };

    await expect(
      uploadPulledDeviceBlocks(
        { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
        [otherUsersBlock],
      ),
    ).rejects.toThrow('待上传数据不属于当前登录账号');

    expect(uploadsApi.createBatch).not.toHaveBeenCalled();
    expect(uploadsApi.uploadLocalFile).not.toHaveBeenCalled();
    expect(deleteStoredBleBlockAfterUpload).not.toHaveBeenCalled();
  });
});

function storedBlock(id: string, blockId: number, totalLength: number): StoredBleBlock {
  return {
    id,
    deviceSn: 'XGAE100A28',
    blockId,
    type: 'mixed',
    totalLength,
    sha256: `${id}-hash`,
    storedAt: '2026-07-21T08:00:00.000Z',
    status: 'pending_upload',
    source: 'device',
    appUserId: 23,
    fileName: `${id}.bin`,
    fileUri: `file:///${id}.bin`,
  };
}

function uploadedFile(id: number, batchId: number, fileSize: number) {
  return {
    id,
    batchId,
    originalFilename: `${id}.bin`,
    storagePath: `oss/${id}.bin`,
    fileHash: `server-hash-${id}`,
    fileSize,
    format: null,
    durationSeconds: null,
    sampleRate: null,
    uploadedAt: '2026-07-21T08:00:30.000Z',
  };
}
