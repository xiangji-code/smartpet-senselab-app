/**
 * App 领域类型 — 与云端后端模型及 v1 开发文档对齐。
 * 字段名与后端 JSON 保持一致，便于 API 对接。
 */

// ── 枚举与字面量 ──────────────────────────────────────────

export type AppUserStatus = 'active' | 'inactive' | 'suspended';

export type DeviceType = 'trainer' | 'bark_stopper' | 'collar' | 'unknown';

export type BindStatus = 'bound' | 'pending_verification' | 'unbound';

export type EntityStatus = 'active' | 'inactive';

export type BindingStatus = 'active' | 'inactive';

export type OnlineStatus = 'online' | 'offline' | 'unknown';

export type BluetoothStatus = 'connected' | 'disconnected' | 'connecting' | 'unknown';

export type AudioBatchStatus = 'created' | 'uploading' | 'completed' | 'failed';

export type RecordType = 'bark' | 'imu' | 'motion';

export type MessageType = 'bark' | 'device' | 'system';

export type DogSizeMode = 'small' | 'medium' | 'large';

export type TrainerCommand = 'sound' | 'vibration' | 'shock' | 'light';

// ── 核心实体 ──────────────────────────────────────────────

/** 当前登录用户（含本地 token，不来自 API 响应体） */
export interface CurrentUser {
  id: number;
  email: string;
  status: AppUserStatus;
  accessToken: string;
  refreshToken: string;
}

export interface PetProfile {
  id: number;
  name: string;
  species: string;
  breed?: string | null;
  sex?: string | null;
  birthday?: string | null; // ISO date
  weightKg?: number | null;
  avatarUrl?: string | null;
  notes?: string | null;
  status: EntityStatus;
}

export interface Device {
  id: number;
  deviceSn: string;
  deviceName?: string | null;
  deviceType: DeviceType;
  manufacturer?: string | null;
  model?: string | null;
  firmwareVersion?: string | null;
  bindStatus: BindStatus;
  status: EntityStatus;
  lastSeenAt?: string | null; // ISO datetime
  // 以下字段 v1 文档要求展示；后端 Device 表可能尚未全部提供，可由状态接口或本地缓存补充
  onlineStatus?: OnlineStatus;
  batteryLevel?: number | null;
  bluetoothStatus?: BluetoothStatus;
  currentPetProfileId?: number | null;
  currentPetName?: string | null;
}

export interface DevicePetBinding {
  id: number;
  deviceId: number;
  petProfileId: number;
  status: BindingStatus;
  boundAt: string;
  unboundAt?: string | null;
}

// ── 数据记录与消息（App 展示层）────────────────────────────

export interface BarkRecord {
  id: number;
  deviceId: number;
  petProfileId?: number | null;
  petName?: string | null;
  occurredAt: string;
  barkCount: number;
  durationSeconds?: number | null;
  source?: string | null;
  status?: string | null;
}

export interface MotionRecord {
  id: number;
  deviceId: number;
  petProfileId?: number | null;
  petName?: string | null;
  occurredAt: string;
  recordType: 'imu' | 'motion';
  summary?: string | null;
  status?: string | null;
}

export interface Message {
  id: number;
  type: MessageType;
  title: string;
  content: string;
  relatedDeviceId?: number | null;
  relatedPetProfileId?: number | null;
  readAt?: string | null;
  createdAt: string;
}

// ── 后台音频上传 ──────────────────────────────────────────────

export interface AudioBatch {
  id: number;
  deviceId: number;
  deviceSn: string;
  petProfileId?: number | null;
  source: string;
  status: AudioBatchStatus;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  completedAt?: string | null;
}

// ── 设备控制与止吠设置（多为设备/云端指令，非持久化表）────

export interface TrainerSettings {
  soundLevel: number; // 1–10
  vibrationLevel: number;
  shockLevel: number;
}

export interface BarkStopperSettings {
  sensitivity: number; // 1–10
  dogSize: DogSizeMode;
  barkCount: number;
}

export interface DeviceRealtimeStatus {
  deviceId: number;
  onlineStatus: OnlineStatus;
  batteryLevel?: number | null;
  bluetoothStatus: BluetoothStatus;
  workState?: string | null;
  isBarking?: boolean;
}

// ── API 请求体示例 ────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface BindDeviceRequest {
  deviceSn: string;
}

export interface CreateAudioBatchRequest {
  deviceId: number;
  petProfileId?: number;
}

export interface RecordFilters {
  deviceId?: number;
  petProfileId?: number;
  recordType?: RecordType;
  from?: string;
  to?: string;
}
