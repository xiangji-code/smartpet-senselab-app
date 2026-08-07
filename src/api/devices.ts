/**
 * 设备相关 API（对接后端 `/api/app/devices`）。
 *
 * 负责后端 snake_case DTO 与前端领域类型（camelCase）的映射，
 * 使上层只依赖 `src/types/domain.ts`。
 */
import { api } from './client';
import type { Device, DeviceType } from '../types/domain';

export interface DeviceDto {
  id: number;
  app_user_id: number;
  device_sn: string;
  device_name?: string | null;
  device_type: string;
  manufacturer?: string | null;
  model?: string | null;
  firmware_version?: string | null;
  bind_status: string;
  last_seen_at?: string | null;
  status: string;
  created_at: string;
}

export function mapDevice(dto: DeviceDto): Device {
  const inferredType = detectDeviceType(dto.device_sn);
  return {
    id: dto.id,
    deviceSn: dto.device_sn,
    deviceName: dto.device_name ?? null,
    deviceType: inferredType === 'collar' ? ((dto.device_type as DeviceType) ?? 'collar') : inferredType,
    manufacturer: dto.manufacturer ?? null,
    model: dto.model ?? null,
    firmwareVersion: dto.firmware_version ?? null,
    bindStatus:
      dto.bind_status === 'bound'
        ? 'bound'
        : dto.bind_status === 'pending_verification'
          ? 'pending_verification'
          : 'unbound',
    status: dto.status === 'active' ? 'active' : 'inactive',
    lastSeenAt: dto.last_seen_at ?? null,
  };
}

const BASE = '/api/app/devices';

/**
 * 由 Device SN 前缀识别设备类型（模拟「后端按 SN 识别」）。
 * 临时约定：XG* → 训狗器，ZF* → 止吠器，其余 → collar。
 */
export function detectDeviceType(deviceSn: string): DeviceType {
  const sn = deviceSn.trim().toUpperCase();
  if (sn.startsWith('XG')) return 'trainer';
  if (sn.startsWith('ZF')) return 'bark_stopper';
  return 'collar';
}

export const devicesApi = {
  async list(): Promise<Device[]> {
    const dtos = await api.get<DeviceDto[]>(BASE);
    return dtos.map(mapDevice);
  },

  async get(id: number): Promise<Device> {
    const dto = await api.get<DeviceDto>(`${BASE}/${id}`);
    return mapDevice(dto);
  },

  /**
   * 通过 Device SN 绑定设备到当前 App User。
   * device_type 由 SN 前缀识别后随请求带上（后端默认 collar）。
   */
  async bind(deviceSn: string): Promise<Device> {
    const dto = await api.post<DeviceDto>(BASE, {
      device_sn: deviceSn,
      device_type: detectDeviceType(deviceSn),
    });
    return mapDevice(dto);
  },

  /** 仅登记设备归属；蓝牙验证成功前不可关联宠物或上传数据。 */
  async beginVerification(deviceSn: string): Promise<Device> {
    const dto = await api.post<DeviceDto>(`${BASE}/verifications`, {
      device_sn: deviceSn,
      device_type: detectDeviceType(deviceSn),
    });
    return mapDevice(dto);
  },

  async confirmVerification(id: number): Promise<Device> {
    const dto = await api.put<DeviceDto>(`${BASE}/${id}/verification`);
    return mapDevice(dto);
  },

  async cancelVerification(id: number): Promise<Device> {
    const dto = await api.delete<DeviceDto>(`${BASE}/${id}/verification`);
    return mapDevice(dto);
  },

  async rename(id: number, deviceName: string | null): Promise<Device> {
    const dto = await api.patch<DeviceDto>(`${BASE}/${id}`, { device_name: deviceName });
    return mapDevice(dto);
  },

  async unbind(id: number): Promise<Device> {
    const dto = await api.delete<DeviceDto>(`${BASE}/${id}`);
    return mapDevice(dto);
  },
};
