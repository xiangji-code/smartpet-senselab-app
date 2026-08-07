/**
 * Device-Pet Binding API（对接后端 `/api/app/bindings`）。
 * 同一 Device 同时仅一个 active 绑定；解除仅置 inactive，保留历史。
 */
import { api } from './client';
import type { BindingStatus, DevicePetBinding } from '../types/domain';

interface BindingDto {
  id: number;
  app_user_id: number;
  device_id: number;
  pet_profile_id: number;
  status: string;
  bound_at: string;
  unbound_at?: string | null;
}

function mapBinding(dto: BindingDto): DevicePetBinding {
  return {
    id: dto.id,
    deviceId: dto.device_id,
    petProfileId: dto.pet_profile_id,
    status: (dto.status === 'active' ? 'active' : 'inactive') as BindingStatus,
    boundAt: dto.bound_at,
    unboundAt: dto.unbound_at ?? null,
  };
}

const BASE = '/api/app/bindings';

export const bindingsApi = {
  async list(params?: { deviceId?: number; activeOnly?: boolean }): Promise<DevicePetBinding[]> {
    const q: string[] = [];
    if (params?.deviceId != null) q.push(`device_id=${params.deviceId}`);
    if (params?.activeOnly) q.push('active_only=true');
    const qs = q.length ? `?${q.join('&')}` : '';
    const dtos = await api.get<BindingDto[]>(`${BASE}${qs}`);
    return dtos.map(mapBinding);
  },

  /** 关联设备与宠物；后端会自动停用该设备的旧 active 绑定 */
  async create(deviceId: number, petProfileId: number): Promise<DevicePetBinding> {
    const dto = await api.post<BindingDto>(BASE, {
      device_id: deviceId,
      pet_profile_id: petProfileId,
    });
    return mapBinding(dto);
  },

  async deactivate(bindingId: number): Promise<DevicePetBinding> {
    return mapBinding(await api.delete<BindingDto>(`${BASE}/${bindingId}`));
  },

  /** 便捷：取某设备当前 active 绑定（无则 null） */
  async activeForDevice(deviceId: number): Promise<DevicePetBinding | null> {
    const list = await this.list({ deviceId, activeOnly: true });
    return list[0] ?? null;
  },
};
