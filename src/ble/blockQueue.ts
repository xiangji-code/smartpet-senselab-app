import { Platform } from 'react-native';

import { sha256Hex } from '../lib/sha256';
import type { BleReceivedBlock } from './protocol';
import {
  DEVICE_PCM_WAV_FORMAT,
  isDevicePcmBlockType,
  wrapDevicePcmAsWav,
  type DevicePcmWavFormat,
} from './pcmWav';

const QUEUE_DIRECTORY = 'smartpet-ble-upload-queue';
let activeQueueUserId: number | null = null;

export function configureBleQueueOwner(userId: number | null): void {
  activeQueueUserId = userId;
}

export function getBleQueueOwner(): number | null {
  return activeQueueUserId;
}

export interface StoredBleBlock {
  id: string;
  deviceSn: string;
  blockId: number;
  type: BleReceivedBlock['type'];
  totalLength: number;
  sha256: string;
  storedAt: string;
  status: 'pending_upload';
  source: 'device' | 'simulation';
  appUserId: number | null;
  fileName: string;
  fileUri: string;
  audioFormat?: DevicePcmWavFormat;
}

type StoredBleBlockMetadata = Omit<StoredBleBlock, 'fileUri'>;

export async function persistBleBlock(
  deviceSn: string,
  block: BleReceivedBlock,
  source: StoredBleBlock['source'] = 'device',
  appUserId: number | null = activeQueueUserId,
): Promise<StoredBleBlock | null> {
  if (Platform.OS === 'web') return null;

  const { Directory, File, Paths } = await import('expo-file-system');
  const directory = new Directory(Paths.document, QUEUE_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });

  const storedAt = new Date().toISOString();
  const isDevicePcm = source === 'device' && isDevicePcmBlockType(block.type);
  const storedPayload =
    isDevicePcm
      ? wrapDevicePcmAsWav(block.payload)
      : block.payload;
  const sha256 = sha256Hex(storedPayload);
  const id = createQueueId(deviceSn, block.blockId, sha256);
  const fileName = `${id}.${isDevicePcm ? 'wav' : 'bin'}`;
  const dataFile = new File(directory, fileName);
  const metadataFile = new File(directory, `${id}.json`);

  dataFile.create({ overwrite: false });
  try {
    dataFile.write(storedPayload);
    const metadata: StoredBleBlockMetadata = {
      id,
      deviceSn,
      blockId: block.blockId,
      type: block.type,
      totalLength: block.totalLength,
      sha256,
      storedAt,
      status: 'pending_upload',
      source,
      appUserId,
      fileName,
      audioFormat: isDevicePcm ? DEVICE_PCM_WAV_FORMAT : undefined,
    };
    metadataFile.create({ overwrite: false });
    metadataFile.write(JSON.stringify(metadata));
    return { ...metadata, fileUri: dataFile.uri };
  } catch (error) {
    if (metadataFile.exists) metadataFile.delete();
    if (dataFile.exists) dataFile.delete();
    throw error;
  }
}

export async function listPendingBleBlocks(options?: {
  appUserId?: number;
  includeUnassigned?: boolean;
}): Promise<StoredBleBlock[]> {
  if (Platform.OS === 'web') return [];

  const { Directory, File, Paths } = await import('expo-file-system');
  const directory = new Directory(Paths.document, QUEUE_DIRECTORY);
  if (!directory.exists) return [];

  const records: StoredBleBlock[] = [];
  for (const entry of directory.list()) {
    if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(await entry.text()) as StoredBleBlockMetadata & {
        source?: StoredBleBlock['source'];
        appUserId?: number | null;
      };
      // 旧版本没有来源字段；这些文件均来自真实 BLE 接收流程，按 device 兼容。
      const metadata: StoredBleBlockMetadata = {
        ...parsed,
        source: parsed.source ?? 'device',
        appUserId: parsed.appUserId ?? null,
      };
      const dataFile = new File(directory, metadata.fileName);
      if (metadata.status === 'pending_upload' && dataFile.exists) {
        const belongsToUser =
          options?.appUserId === undefined || metadata.appUserId === options.appUserId;
        const isAllowedUnassigned =
          metadata.appUserId !== null || options?.includeUnassigned === true;
        if (belongsToUser && isAllowedUnassigned) {
          records.push({ ...metadata, fileUri: dataFile.uri });
        }
      }
    } catch {
      // Ignore incomplete metadata; the raw file is never deleted automatically.
    }
  }
  return records.sort((a, b) => a.storedAt.localeCompare(b.storedAt));
}

export interface BleQueueStats {
  ownedCount: number;
  ownedBytes: number;
  unassignedCount: number;
  unassignedBytes: number;
  otherAccountCount: number;
  otherAccountBytes: number;
}

export async function getPendingBleQueueStats(appUserId: number): Promise<BleQueueStats> {
  const all = await listPendingBleBlocks({ includeUnassigned: true });
  return all.reduce<BleQueueStats>(
    (stats, item) => {
      if (item.appUserId === appUserId) {
        stats.ownedCount += 1;
        stats.ownedBytes += item.totalLength;
      } else if (item.appUserId === null) {
        stats.unassignedCount += 1;
        stats.unassignedBytes += item.totalLength;
      } else {
        stats.otherAccountCount += 1;
        stats.otherAccountBytes += item.totalLength;
      }
      return stats;
    },
    {
      ownedCount: 0,
      ownedBytes: 0,
      unassignedCount: 0,
      unassignedBytes: 0,
      otherAccountCount: 0,
      otherAccountBytes: 0,
    },
  );
}

/** 删除本机全部待上传设备文件；仅由用户明确选择后调用。 */
export async function clearAllPendingBleBlocks(): Promise<void> {
  if (Platform.OS === 'web') return;

  const { Directory, Paths } = await import('expo-file-system');
  const directory = new Directory(Paths.document, QUEUE_DIRECTORY);
  if (directory.exists) directory.delete();
}

export async function deleteStoredBleBlockAfterUpload(id: string): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid BLE queue item ID');

  const { Directory, File, Paths } = await import('expo-file-system');
  const directory = new Directory(Paths.document, QUEUE_DIRECTORY);
  const metadataFile = new File(directory, `${id}.json`);
  let fileName = `${id}.bin`;
  if (metadataFile.exists) {
    try {
      const metadata = JSON.parse(await metadataFile.text()) as StoredBleBlockMetadata;
      if (metadata.fileName === `${id}.bin` || metadata.fileName === `${id}.wav`) {
        fileName = metadata.fileName;
      }
    } catch {
      // 旧队列或不完整元数据仍按 .bin 兼容清理。
    }
  }
  const dataFile = new File(directory, fileName);
  if (metadataFile.exists) metadataFile.delete();
  if (dataFile.exists) dataFile.delete();
}

function createQueueId(deviceSn: string, blockId: number, sha256: string): string {
  const safeSn = deviceSn.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'device';
  const time = Date.now().toString(36);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${time}-${safeSn}-b${blockId}-${sha256.slice(0, 12)}-${nonce}`;
}
