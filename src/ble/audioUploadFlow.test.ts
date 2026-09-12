import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadsApi } from '../api/uploads';
import { deleteStoredBleBlockAfterUpload, type StoredBleBlock } from './blockQueue';
import { uploadPulledDeviceBlocks } from './audioUploadFlow';
import { makeSimulatedVoiceWav } from './simulatedWav';
import { uploadJournal } from './uploadJournal';

vi.mock('../api/uploads', () => ({
  uploadsApi: {
    requireIdempotentUploads: vi.fn(),
    createBatch: vi.fn(),
    getBatchStatus: vi.fn(),
    uploadLocalFile: vi.fn(),
    completeBatch: vi.fn(),
  },
}));

vi.mock('./blockQueue', () => ({
  deleteStoredBleBlockAfterUpload: vi.fn(),
  listPendingBleBlocks: vi.fn(),
  persistBleBlock: vi.fn(),
}));

vi.mock('./uploadJournal', () => ({
  uploadJournal: {
    read: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  },
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
    vi.mocked(uploadsApi.requireIdempotentUploads).mockResolvedValue();
    vi.mocked(uploadJournal.read).mockResolvedValue(null);
    vi.mocked(uploadJournal.save).mockResolvedValue();
    vi.mocked(uploadJournal.remove).mockResolvedValue();
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
  });

  it('uploads each complete block as a separate file in one batch', async () => {
    configureNewBatch([first, second]);
    const result = await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [first, second],
    );

    expect(uploadsApi.createBatch).toHaveBeenCalledTimes(1);
    expect(uploadsApi.uploadLocalFile).toHaveBeenCalledTimes(2);
    expect(uploadsApi.uploadLocalFile).toHaveBeenNthCalledWith(
      1,
      31,
      expect.objectContaining({
        fileUri: first.fileUri,
        filename: first.fileName,
        clientFileHash: first.sha256,
      }),
    );
    expect(uploadsApi.uploadLocalFile).toHaveBeenNthCalledWith(
      2,
      31,
      expect.objectContaining({
        fileUri: second.fileUri,
        filename: second.fileName,
        clientFileHash: second.sha256,
      }),
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
    configureNewBatch([audio]);

    await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [audio],
    );

    expect(uploadsApi.uploadLocalFile).toHaveBeenCalledWith(
      31,
      expect.objectContaining({
        filename: 'first.wav',
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
    configureNewBatch([rfAudio]);

    await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [rfAudio],
    );

    expect(uploadsApi.uploadLocalFile).toHaveBeenCalledWith(
      31,
      expect.objectContaining({
        filename: 'first.wav',
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
    configureNewBatch([legacyAudio]);

    await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [legacyAudio],
    );

    expect(uploadsApi.uploadLocalFile).toHaveBeenCalledWith(
      31,
      expect.objectContaining({
        filename: 'legacy.wav',
        contentType: 'audio/wav',
        durationSeconds: 1,
        sampleRate: 8_000,
      }),
    );
  });

  it('keeps every local block when the batch cannot be completed', async () => {
    configureNewBatch([first, second]);
    vi.mocked(uploadsApi.completeBatch).mockRejectedValueOnce(new Error('server unavailable'));

    await expect(
      uploadPulledDeviceBlocks(
        { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
        [first, second],
      ),
    ).rejects.toThrow('完成批次阶段失败');

    expect(deleteStoredBleBlockAfterUpload).not.toHaveBeenCalled();
  });

  it('migrates a legacy journal filename and resumes an already-uploaded file', async () => {
    const uploaded = uploadedFile(101, 31, first);
    vi.mocked(uploadJournal.read).mockResolvedValue({
      version: 1,
      requestKey: 'existing-request',
      batchId: 31,
      files: [{
        stored: first,
        filename: 'ble-first.bin',
        contentType: 'application/octet-stream',
      }],
    });
    vi.mocked(uploadsApi.getBatchStatus).mockResolvedValue(batchStatus('uploading', [uploaded]));
    vi.mocked(uploadsApi.completeBatch).mockResolvedValue(batchStatus('completed', [uploaded]));

    const result = await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [first],
    );

    expect(uploadJournal.save).toHaveBeenCalledWith(
      'smartpet.upload.v1.23.7.device',
      expect.objectContaining({
        files: [expect.objectContaining({ filename: 'first.bin' })],
      }),
    );
    expect(uploadsApi.uploadLocalFile).not.toHaveBeenCalled();
    expect(uploadsApi.completeBatch).toHaveBeenCalledWith(31);
    expect(deleteStoredBleBlockAfterUpload).toHaveBeenCalledWith(first.id);
    expect(uploadJournal.remove).toHaveBeenCalledWith('smartpet.upload.v1.23.7.device');
    expect(result.batchStatus).toBe('completed');
  });

  it('refreshes a stale iOS container URI before resuming an upload', async () => {
    const stale = { ...first, fileUri: 'file:///old-app-container/Documents/first.bin' };
    const uploaded = uploadedFile(101, 31, first);
    vi.mocked(uploadJournal.read).mockResolvedValue({
      version: 1,
      requestKey: 'existing-request',
      batchId: 31,
      files: [{
        stored: stale,
        filename: first.fileName,
        contentType: 'application/octet-stream',
      }],
    });
    vi.mocked(uploadsApi.getBatchStatus).mockResolvedValue(batchStatus('uploading', []));
    vi.mocked(uploadsApi.uploadLocalFile).mockResolvedValue(uploaded);
    vi.mocked(uploadsApi.completeBatch).mockResolvedValue(batchStatus('completed', [uploaded]));

    await uploadPulledDeviceBlocks(
      { id: 7, deviceSn: 'XGAE100A28', appUserId: 23 },
      [first],
    );

    expect(uploadJournal.save).toHaveBeenCalledWith(
      'smartpet.upload.v1.23.7.device',
      expect.objectContaining({
        files: [expect.objectContaining({
          stored: expect.objectContaining({ fileUri: first.fileUri }),
        })],
      }),
    );
    expect(uploadsApi.uploadLocalFile).toHaveBeenCalledWith(
      31,
      expect.objectContaining({ fileUri: first.fileUri }),
    );
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

function configureNewBatch(files: StoredBleBlock[]): void {
  const uploaded = files.map((file, index) => uploadedFile(101 + index, 31, file));
  vi.mocked(uploadsApi.getBatchStatus).mockResolvedValue(batchStatus('uploading', []));
  uploaded.forEach((file) => vi.mocked(uploadsApi.uploadLocalFile).mockResolvedValueOnce(file));
  vi.mocked(uploadsApi.completeBatch).mockResolvedValue(batchStatus('completed', uploaded));
}

function batchStatus(status: 'uploading' | 'completed', files: ReturnType<typeof uploadedFile>[]) {
  return {
    batch: {
      id: 31,
      deviceId: 7,
      deviceSn: 'XGAE100A28',
      petProfileId: null,
      source: 'app_upload',
      status,
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.fileSize, 0),
      createdAt: '2026-07-21T08:00:00.000Z',
      completedAt: status === 'completed' ? '2026-07-21T08:01:00.000Z' : null,
    },
    files,
  };
}

function uploadedFile(id: number, batchId: number, stored: StoredBleBlock) {
  return {
    id,
    batchId,
    originalFilename: stored.fileName,
    storagePath: `oss/${id}.bin`,
    fileHash: stored.sha256,
    fileSize: stored.totalLength + (stored.audioFormat ? 44 : 0),
    format: null,
    durationSeconds: null,
    sampleRate: null,
    uploadedAt: '2026-07-21T08:00:30.000Z',
  };
}
