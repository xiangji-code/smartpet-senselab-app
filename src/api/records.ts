/** App records API backed by files uploaded from the App and persisted in the cloud. */
import { api, type RequestOptions } from './client';
import { uploadsApi } from './uploads';
import type { RecordType } from '../types/domain';

export interface RecordItem {
  id: string;
  deviceId: number;
  deviceName: string;
  petProfileId: number | null;
  petName: string | null;
  recordType: RecordType;
  occurredAt: string;
  summary: string;
  barkCount: number | null;
  durationSeconds: number | null;
  confidence: number | null;
  source: string | null;
  status: string | null;
}

interface RecordDto {
  id: string;
  device_id: number;
  device_name: string;
  pet_profile_id?: number | null;
  pet_name?: string | null;
  record_type: RecordType;
  occurred_at: string;
  summary: string;
  bark_count?: number | null;
  duration_seconds?: number | null;
  confidence?: number | null;
  source?: string | null;
  status?: string | null;
}

interface RecordPageDto {
  items: RecordDto[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface RecordQuery {
  deviceId?: number;
  petProfileId?: number;
  recordType?: RecordType;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface RecordPage {
  items: RecordItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface RecordUploadDetail {
  blockId: number | null;
  batchId: number;
  batchStatus: string;
  batchFileCount: number;
  batchTotalBytes: number;
  fileId: number;
  originalFilename: string;
  storagePath: string;
  fileHash: string;
  fileSize: number;
  format: string | null;
  durationSeconds: number | null;
  sampleRate: number | null;
  uploadedAt: string;
}

export function mapRecord(dto: RecordDto): RecordItem {
  return {
    id: dto.id,
    deviceId: dto.device_id,
    deviceName: dto.device_name,
    petProfileId: dto.pet_profile_id ?? null,
    petName: dto.pet_name ?? null,
    recordType: dto.record_type,
    occurredAt: dto.occurred_at,
    summary: dto.summary,
    barkCount: dto.bark_count ?? null,
    durationSeconds: dto.duration_seconds ?? null,
    confidence: dto.confidence ?? null,
    source: dto.source ?? null,
    status: dto.status ?? null,
  };
}

function buildQuery(query: RecordQuery): string {
  const params: string[] = [];
  if (query.deviceId != null) params.push(`device_id=${query.deviceId}`);
  if (query.petProfileId != null) params.push(`pet_profile_id=${query.petProfileId}`);
  if (query.recordType) params.push(`record_type=${query.recordType}`);
  if (query.from) params.push(`from=${encodeURIComponent(query.from)}`);
  if (query.to) params.push(`to=${encodeURIComponent(query.to)}`);
  params.push(`page=${query.page ?? 1}`);
  params.push(`page_size=${query.pageSize ?? 20}`);
  return params.join('&');
}

export const recordsApi = {
  async list(query: RecordQuery = {}, options?: RequestOptions): Promise<RecordPage> {
    const dto = await api.get<RecordPageDto>(
      `/api/app/records?${buildQuery(query)}`,
      options,
    );
    return {
      items: dto.items.map(mapRecord),
      page: dto.page,
      pageSize: dto.page_size,
      total: dto.total,
      hasMore: dto.has_more,
    };
  },

  async getUploadDetail(
    recordId: string,
    options?: RequestOptions,
  ): Promise<RecordUploadDetail | null> {
    const fileId = uploadFileId(recordId);
    if (fileId == null) return null;

    const batches = await uploadsApi.listBatches(options);
    for (const batch of batches) {
      const status = await uploadsApi.getBatchStatus(batch.id, options);
      const file = status.files.find((candidate) => candidate.id === fileId);
      if (!file) continue;

      return {
        blockId: blockIdFromFilename(file.originalFilename),
        batchId: status.batch.id,
        batchStatus: status.batch.status,
        batchFileCount: status.batch.fileCount,
        batchTotalBytes: status.batch.totalBytes,
        fileId: file.id,
        originalFilename: file.originalFilename,
        storagePath: file.storagePath,
        fileHash: file.fileHash,
        fileSize: file.fileSize,
        format: file.format ?? null,
        durationSeconds: file.durationSeconds ?? null,
        sampleRate: file.sampleRate ?? null,
        uploadedAt: file.uploadedAt,
      };
    }
    return null;
  },
};

function uploadFileId(recordId: string): number | null {
  const match = /^upload:(\d+)$/.exec(recordId);
  if (!match) return null;
  const fileId = Number(match[1]);
  return Number.isSafeInteger(fileId) ? fileId : null;
}

function blockIdFromFilename(filename: string): number | null {
  const match = /(?:-block-|-)(\d+)(?:\.[^.]+)?$/.exec(filename);
  if (!match) return null;
  const blockId = Number(match[1]);
  return Number.isSafeInteger(blockId) ? blockId : null;
}
