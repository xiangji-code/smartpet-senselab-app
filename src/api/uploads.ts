/** 音频上传 API：创建批次 → 上传真实本地文件 → 完成批次。 */
import { api, type RequestOptions } from './client';
import type { AudioBatch, AudioBatchStatus } from '../types/domain';

interface BatchDto {
  id: number;
  app_user_id: number;
  device_id: number;
  device_sn: string;
  pet_profile_id?: number | null;
  source: string;
  status: string;
  file_count: number;
  total_bytes: number;
  created_at: string;
  completed_at?: string | null;
}

interface AudioFileDto {
  id: number;
  batch_id: number;
  device_id: number;
  pet_profile_id?: number | null;
  original_filename: string;
  storage_path: string;
  file_hash: string;
  file_size: number;
  format?: string | null;
  duration_seconds?: number | null;
  sample_rate?: number | null;
  uploaded_at: string;
}

interface BatchStatusDto {
  batch: BatchDto;
  files: AudioFileDto[];
  job_status?: string | null;
  sync_status?: string | null;
}

export interface UploadedAudioFile {
  id: number;
  batchId: number;
  originalFilename: string;
  storagePath: string;
  fileHash: string;
  fileSize: number;
  format?: string | null;
  durationSeconds?: number | null;
  sampleRate?: number | null;
  uploadedAt: string;
}

export interface CompletedAudioBatch {
  batch: AudioBatch;
  files: UploadedAudioFile[];
  jobStatus?: string | null;
  syncStatus?: string | null;
}

function mapBatch(dto: BatchDto): AudioBatch {
  return {
    id: dto.id,
    deviceId: dto.device_id,
    deviceSn: dto.device_sn,
    petProfileId: dto.pet_profile_id ?? null,
    source: dto.source,
    status: dto.status as AudioBatchStatus,
    fileCount: dto.file_count,
    totalBytes: dto.total_bytes,
    createdAt: dto.created_at,
    completedAt: dto.completed_at ?? null,
  };
}

function mapAudioFile(dto: AudioFileDto): UploadedAudioFile {
  return {
    id: dto.id,
    batchId: dto.batch_id,
    originalFilename: dto.original_filename,
    storagePath: dto.storage_path,
    fileHash: dto.file_hash,
    fileSize: dto.file_size,
    format: dto.format ?? null,
    durationSeconds: dto.duration_seconds ?? null,
    sampleRate: dto.sample_rate ?? null,
    uploadedAt: dto.uploaded_at,
  };
}

const BASE = '/api/app/uploads';

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export const uploadsApi = {
  async createBatch(deviceId: number, petProfileId?: number | null): Promise<AudioBatch> {
    const body: Record<string, unknown> = { device_id: deviceId, source: 'app_upload' };
    if (petProfileId != null) body.pet_profile_id = petProfileId;
    return mapBatch(await api.post<BatchDto>(`${BASE}/batches`, body));
  },

  async uploadLocalFile(
    batchId: number,
    input: {
      fileUri: string;
      filename: string;
      contentType: string;
      clientFileHash: string;
      durationSeconds?: number;
      sampleRate?: number;
      collectedAt?: string;
    },
  ): Promise<UploadedAudioFile> {
    const query = buildQuery({
      collected_at: input.collectedAt ?? new Date().toISOString(),
      duration_seconds: input.durationSeconds,
      sample_rate: input.sampleRate,
      client_file_hash: input.clientFileHash,
    });

    const { File } = await import('expo-file-system');
    const localFile = new File(input.fileUri);
    if (!localFile.exists) throw new Error('待上传的本地语音文件不存在');

    const form = new FormData();
    // Expo File 实现了标准 Blob；新版 React Native FormData 不接受旧式 { uri, name, type } 对象。
    form.append('file', localFile, input.filename);

    const dto = await api.upload<AudioFileDto>(
      `${BASE}/batches/${batchId}/files${query}`,
      form,
    );
    return mapAudioFile(dto);
  },

  async completeBatch(batchId: number): Promise<CompletedAudioBatch> {
    const dto = await api.post<BatchStatusDto>(
      `${BASE}/batches/${batchId}/complete`,
      undefined,
    );
    return {
      batch: mapBatch(dto.batch),
      files: dto.files.map(mapAudioFile),
      jobStatus: dto.job_status ?? null,
      syncStatus: dto.sync_status ?? null,
    };
  },

  async getBatchStatus(
    batchId: number,
    options?: RequestOptions,
  ): Promise<CompletedAudioBatch> {
    const dto = await api.get<BatchStatusDto>(`${BASE}/batches/${batchId}/status`, options);
    return {
      batch: mapBatch(dto.batch),
      files: dto.files.map(mapAudioFile),
      jobStatus: dto.job_status ?? null,
      syncStatus: dto.sync_status ?? null,
    };
  },

  async listBatches(options?: RequestOptions): Promise<AudioBatch[]> {
    const dtos = await api.get<BatchDto[]>(`${BASE}/batches`, options);
    return dtos.map(mapBatch);
  },
};
