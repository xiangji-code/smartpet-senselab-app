import { uploadsApi, type UploadedAudioFile } from '../api/uploads';
import { sha256Hex } from '../lib/sha256';
import { uploadJournal, type StoredUploadFile } from './uploadJournal';
import { captureSessionScope } from '../auth/sessionScope';
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
  const scope = captureSessionScope();
  const storedBlocks = (await listPendingBleBlocks({ appUserId: device.appUserId })).filter(
    (stored) => stored.deviceSn === device.deviceSn && stored.source === 'device',
  );
  scope.assertCurrent();
  if (storedBlocks.length === 0) return null;
  return uploadPulledDeviceBlocks(device, storedBlocks, onProgress);
}

const uploadJobs = new Map<string, Promise<BleUploadResult>>();

function uploadStoredBlocks(
  device: UserOwnedUploadDevice,
  files: readonly StoredUploadFile[],
  onProgress?: (progress: AudioUploadProgress) => void,
): Promise<BleUploadResult> {
  const key = `smartpet.upload.v1.${device.appUserId}.${device.id}.${files[0]?.stored.source ?? 'device'}`;
  const active = uploadJobs.get(key);
  if (active) return active;
  const task = resumeStoredBlocks(key, device, files, onProgress).finally(() => {
    if (uploadJobs.get(key) === task) uploadJobs.delete(key);
  });
  uploadJobs.set(key, task);
  return task;
}

async function resumeStoredBlocks(
  key: string,
  device: UserOwnedUploadDevice,
  requestedFiles: readonly StoredUploadFile[],
  onProgress?: (progress: AudioUploadProgress) => void,
): Promise<BleUploadResult> {
  const scope = captureSessionScope();
  if (requestedFiles.length === 0) throw new Error('没有待上传的数据文件');
  await uploadsApi.requireIdempotentUploads();
  scope.assertCurrent();
  let journal = await uploadJournal.read(key);
  scope.assertCurrent();
  if (!journal) {
    journal = {
      version: 1,
      requestKey: sha256Hex(new TextEncoder().encode(JSON.stringify([key, requestedFiles.map((file) => file.stored.id)]))),
      batchId: null,
      files: requestedFiles.map((file) => ({
        ...file,
        filename: `ble-${file.stored.id}.${file.filename.endsWith('.wav') ? 'wav' : 'bin'}`,
      })),
    };
    await uploadJournal.save(key, journal);
  }
  scope.assertCurrent();
  const files = journal.files;
  if (files.some(({ stored }) => stored.appUserId !== device.appUserId || stored.deviceSn !== device.deviceSn)) {
    throw new Error('续传记录与当前账号或设备不匹配');
  }

  onProgress?.({ phase: 'creating_batch', message: '正在恢复上传批次…' });
  if (journal.batchId === null) {
    const batch = await withStageError('创建批次',
      uploadsApi.createBatch(device.id, device.petProfileId, journal.requestKey));
    scope.assertCurrent();
    journal.batchId = batch.id;
    await uploadJournal.save(key, journal);
  }
  scope.assertCurrent();
  const batchId = journal.batchId;
  const server = await uploadsApi.getBatchStatus(batchId);
  scope.assertCurrent();
  if (server.batch.id !== batchId || server.batch.deviceId !== device.id) {
    throw new Error('服务器批次归属不匹配，本地文件已保留');
  }

  const uploadedFiles = [];
  for (const [index, file] of files.entries()) {
    scope.assertCurrent();
    onProgress?.({ phase: 'uploading', message: `正在确认第 ${index + 1}/${files.length} 个文件…` });
    const matches = server.files.filter((remote) => remote.originalFilename === file.filename);
    if (matches.length > 1) throw new Error('服务器出现重复文件记录，本地文件已保留');
    let uploaded = matches[0];
    if (!uploaded) {
      if (server.batch.status === 'completed') throw new Error('已完成批次缺少文件，本地文件已保留');
      uploaded = await withStageError(`上传第 ${index + 1} 个文件`, uploadsApi.uploadLocalFile(batchId, {
        fileUri: file.stored.fileUri, filename: file.filename, contentType: file.contentType,
        clientFileHash: file.stored.sha256, durationSeconds: file.durationSeconds,
        sampleRate: file.sampleRate, collectedAt: file.stored.storedAt,
        idempotencyKey: `${journal.requestKey}-${index}`,
      }));
      scope.assertCurrent();
    }
    assertConfirmedFile(uploaded, file, batchId);
    uploadedFiles.push({ stored: file.stored, uploaded });
  }

  onProgress?.({ phase: 'completing', message: '正在核对云端完整文件清单…' });
  const completed = server.batch.status === 'completed'
    ? server : await withStageError('完成批次', uploadsApi.completeBatch(batchId));
  scope.assertCurrent();
  if (completed.batch.id !== batchId || completed.batch.deviceId !== device.id ||
    completed.batch.status !== 'completed' || completed.files.length !== files.length ||
    completed.batch.fileCount !== files.length ||
    new Set(completed.files.map((file) => file.id)).size !== files.length) {
    throw new Error('服务器尚未确认完整批次，本地文件已保留');
  }
  const confirmedFiles = uploadedFiles.map(({ stored, uploaded }, index) => {
    const confirmed = completed.files.find((file) => file.id === uploaded.id);
    if (!confirmed) throw new Error('服务器文件确认信息不完整，本地文件已保留');
    assertConfirmedFile(confirmed, files[index], batchId);
    return { blockId: stored.blockId, batchId, fileId: confirmed.id,
      storagePath: confirmed.storagePath, fileHash: confirmed.fileHash, fileSize: confirmed.fileSize };
  });
  if (completed.batch.totalBytes !== confirmedFiles.reduce((sum, file) => sum + file.fileSize, 0)) {
    throw new Error('服务器批次大小不一致，本地文件已保留');
  }

  // Keep the journal until every local cleanup succeeds: restarting can query the same completed batch.
  for (const file of files) {
    scope.assertCurrent();
    await deleteStoredBleBlockAfterUpload(file.stored.id);
  }
  await uploadJournal.remove(key);
  scope.assertCurrent();
  onProgress?.({ phase: 'complete', message: `${files.length} 个文件已上传并核对完整` });
  return { batchId, batchStatus: completed.batch.status,
    totalBytes: files.reduce((sum, file) => sum + file.stored.totalLength, 0), files: confirmedFiles };
}

function assertConfirmedFile(remote: UploadedAudioFile, file: StoredUploadFile, batchId: number): void {
  const expectedSize = file.stored.totalLength + (file.stored.audioFormat ? 44 : 0);
  if (remote.batchId !== batchId || remote.originalFilename !== file.filename || !remote.storagePath ||
    remote.fileHash.toLowerCase() !== file.stored.sha256.toLowerCase() || remote.fileSize !== expectedSize) {
    throw new Error('服务器文件大小或校验值不一致，本地文件已保留');
  }
}

async function withStageError<T>(stage: string, operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误';
    throw new Error(`${stage}阶段失败：${detail}`);
  }
}
