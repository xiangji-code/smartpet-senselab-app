import { uploadsApi } from '../api/uploads';
import {
  deleteStoredBleBlockAfterUpload,
  listPendingBleBlocks,
  persistBleBlock,
  type StoredBleBlock,
} from './blockQueue';
import {
  makeSimulatedVoiceWav,
  SIMULATION_DURATION_SECONDS,
  SIMULATION_SAMPLE_RATE,
} from './simulatedWav';
import {
  DEVICE_PCM_WAV_FORMAT,
  LEGACY_DEVICE_PCM_WAV_FORMAT,
  devicePcmDurationSeconds,
  devicePcmSampleRate,
} from './pcmWav';

export { makeSimulatedVoiceWav } from './simulatedWav';

export type AudioUploadPhase =
  | 'generating'
  | 'queued'
  | 'creating_batch'
  | 'uploading'
  | 'completing'
  | 'complete'
  | 'error';

export interface AudioUploadProgress {
  phase: AudioUploadPhase;
  message: string;
}

export interface BleUploadedFileResult {
  blockId: number;
  batchId: number;
  fileId: number;
  storagePath: string;
  fileHash: string;
  fileSize: number;
}

export interface BleUploadResult {
  batchId: number;
  batchStatus: string;
  totalBytes: number;
  files: BleUploadedFileResult[];
}

interface UserOwnedUploadDevice {
  id: number;
  deviceSn: string;
  petProfileId?: number | null;
  appUserId: number;
}

export async function simulateBleAudioPullAndUpload(
  device: UserOwnedUploadDevice,
  onProgress?: (progress: AudioUploadProgress) => void,
): Promise<BleUploadResult> {
  const existing = (await listPendingBleBlocks({ appUserId: device.appUserId })).find(
    (item) => item.deviceSn === device.deviceSn && item.type === 'audio',
  );
  let stored = existing;
  if (stored) {
    onProgress?.({
      phase: 'queued',
      message: `发现上次失败后保留的 ${stored.totalLength} 字节语音，正在重试`,
    });
  } else {
    onProgress?.({ phase: 'generating', message: '正在生成模拟设备语音数据…' });
    const payload = makeSimulatedVoiceWav();
    stored =
      (await persistBleBlock(
        device.deviceSn,
        {
          blockId: Date.now() & 0xffff,
          type: 'audio',
          totalLength: payload.length,
          payload,
        },
        'simulation',
        device.appUserId,
      )) ?? undefined;
    if (!stored) throw new Error('当前平台不支持本地语音文件队列');

    onProgress?.({
      phase: 'queued',
      message: `模拟接收完成，${stored.totalLength} 字节已进入本地待上传队列`,
    });
  }
  return uploadStoredBlocks(
    device,
    [
      {
        stored,
        filename: `ble-simulated-${device.deviceSn}-${stored.blockId}.wav`,
        contentType: 'audio/wav',
        durationSeconds: SIMULATION_DURATION_SECONDS,
        sampleRate: SIMULATION_SAMPLE_RATE,
      },
    ],
    onProgress,
  );
}

/** 将本轮 BLE 接收完成的 Block 作为同一批次中的独立文件上传。 */
export async function uploadPulledDeviceBlocks(
  device: UserOwnedUploadDevice,
  storedBlocks: readonly StoredBleBlock[],
  onProgress?: (progress: AudioUploadProgress) => void,
): Promise<BleUploadResult> {
  if (storedBlocks.length === 0) throw new Error('本轮没有接收到完整的设备数据块');
  if (storedBlocks.some((stored) => stored.deviceSn !== device.deviceSn)) {
    throw new Error('待上传数据与当前设备不匹配');
  }
  if (storedBlocks.some((stored) => stored.appUserId !== device.appUserId)) {
    throw new Error('待上传数据不属于当前登录账号');
  }

  onProgress?.({
    phase: 'queued',
    message: `已接收并校验 ${storedBlocks.length} 个完整数据块，准备自动上传`,
  });
  return uploadStoredBlocks(
    device,
    storedBlocks.map((stored) =>
      stored.audioFormat === DEVICE_PCM_WAV_FORMAT ||
      stored.audioFormat === LEGACY_DEVICE_PCM_WAV_FORMAT
        ? (() => {
            const sampleRate = devicePcmSampleRate(stored.audioFormat);
            return {
            stored,
            filename: `ble-device-${device.deviceSn}-block-${stored.blockId}.wav`,
            contentType: 'audio/wav',
            durationSeconds: devicePcmDurationSeconds(stored.totalLength, sampleRate),
            sampleRate,
          };
          })()
        : {
            stored,
            filename: `ble-device-${device.deviceSn}-block-${stored.blockId}.bin`,
            contentType: 'application/octet-stream',
          },
    ),
    onProgress,
  );
}

/** 自动上传本机队列中的真实设备 Block，包括上次网络失败后保留的内容。 */
export async function uploadPendingDeviceBlocks(
  device: UserOwnedUploadDevice,
  onProgress?: (progress: AudioUploadProgress) => void,
): Promise<BleUploadResult | null> {
  const storedBlocks = (await listPendingBleBlocks({ appUserId: device.appUserId })).filter(
    (stored) => stored.deviceSn === device.deviceSn && stored.source === 'device',
  );
  if (storedBlocks.length === 0) return null;
  return uploadPulledDeviceBlocks(device, storedBlocks, onProgress);
}

interface StoredUploadFile {
  stored: StoredBleBlock;
  filename: string;
  contentType: string;
  durationSeconds?: number;
  sampleRate?: number;
}

async function uploadStoredBlocks(
  device: UserOwnedUploadDevice,
  files: readonly StoredUploadFile[],
  onProgress?: (progress: AudioUploadProgress) => void,
): Promise<BleUploadResult> {
  if (files.length === 0) throw new Error('没有待上传的数据文件');

  onProgress?.({ phase: 'creating_batch', message: '正在创建后端上传批次…' });
  const batch = await withStageError(
    '创建批次',
    uploadsApi.createBatch(device.id, device.petProfileId),
  );

  const uploadedFiles = [];
  for (const [index, file] of files.entries()) {
    onProgress?.({
      phase: 'uploading',
      message: `正在上传第 ${index + 1}/${files.length} 个完整数据块…`,
    });
    const uploaded = await withStageError(
      `上传第 ${index + 1} 个文件`,
      uploadsApi.uploadLocalFile(batch.id, {
        fileUri: file.stored.fileUri,
        filename: file.filename,
        contentType: file.contentType,
        clientFileHash: file.stored.sha256,
        durationSeconds: file.durationSeconds,
        sampleRate: file.sampleRate,
        collectedAt: file.stored.storedAt,
      }),
    );
    uploadedFiles.push({ stored: file.stored, uploaded });
  }

  onProgress?.({ phase: 'completing', message: '全部文件已上传，正在完成批次并确认存储路径…' });
  const completed = await withStageError('完成批次', uploadsApi.completeBatch(batch.id));

  // 只有整个批次完成后才清除本地队列；任何网络或后端错误都会保留全部文件用于重试。
  await Promise.all(files.map((file) => deleteStoredBleBlockAfterUpload(file.stored.id)));
  onProgress?.({
    phase: 'complete',
    message: `${files.length} 个完整数据块已自动上传，后端已确认存储`,
  });

  return {
    batchId: completed.batch.id,
    batchStatus: completed.batch.status,
    totalBytes: files.reduce((total, file) => total + file.stored.totalLength, 0),
    files: uploadedFiles.map(({ stored, uploaded }) => {
      const confirmed = completed.files.find((file) => file.id === uploaded.id) ?? uploaded;
      return {
        blockId: stored.blockId,
        batchId: completed.batch.id,
        fileId: confirmed.id,
        storagePath: confirmed.storagePath,
        fileHash: confirmed.fileHash,
        fileSize: confirmed.fileSize,
      };
    }),
  };
}

async function withStageError<T>(stage: string, operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误';
    throw new Error(`${stage}阶段失败：${detail}`);
  }
}
