/**
 * 加载当前用户的设备，并附带每台设备当前 active 关联的宠物信息。
 * 供设备列表、记录、消息等页面复用。
 */
import { useCallback, useState } from 'react';

import { devicesApi } from '../api/devices';
import { bindingsApi } from '../api/bindings';
import { ApiError } from '../api/client';
import { petsApi } from '../api/pets';
import { useAuth } from '../auth/AuthContext';
import { appCache } from '../cache/cacheStore';
import { cacheKeys } from '../cache/cachePolicy';
import type { Device, DevicePetBinding, PetProfile } from '../types/domain';

export interface DevicesWithPets {
  devices: Device[];
  petById: Record<number, PetProfile>;
  activeBindingByDevice: Record<number, DevicePetBinding>;
  petNameByDevice: Record<number, string | null>;
}

const EMPTY: DevicesWithPets = {
  devices: [],
  petById: {},
  activeBindingByDevice: {},
  petNameByDevice: {},
};

export function useDevicesWithPets() {
  const { user } = useAuth();
  const [data, setData] = useState<DevicesWithPets>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let hasCachedData = false;
    try {
      const cached = await appCache.get<DevicesWithPets>(user.id, cacheKeys.entities);
      if (cached) {
        hasCachedData = true;
        setData(cached.value);
        setLoading(false);
      }
    } catch {
      // 缓存损坏或不可用时继续从服务器加载。
    }
    try {
      const [devices, bindings, pets] = await Promise.all([
        devicesApi.list(),
        bindingsApi.list({ activeOnly: true }),
        petsApi.list(),
      ]);
      const petById: Record<number, PetProfile> = {};
      pets.forEach((p) => (petById[p.id] = p));

      const activeBindingByDevice: Record<number, DevicePetBinding> = {};
      const petNameByDevice: Record<number, string | null> = {};
      bindings.forEach((b) => {
        activeBindingByDevice[b.deviceId] = b;
        petNameByDevice[b.deviceId] = petById[b.petProfileId]?.name ?? null;
      });
      devices.forEach((d) => {
        if (!(d.id in petNameByDevice)) petNameByDevice[d.id] = null;
      });

      const next = { devices, petById, activeBindingByDevice, petNameByDevice };
      setData(next);
      await appCache.set(user.id, cacheKeys.entities, next);
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.kind === 'timeout') {
          setError(hasCachedData ? '网络较慢，当前显示上次保存的数据' : '加载设备超时，请重试');
        } else if (cause.kind === 'network') {
          setError(hasCachedData ? '网络连接失败，当前显示上次保存的数据' : '网络连接失败，请检查网络后重试');
        } else if (cause.status >= 500) {
          setError(hasCachedData ? '服务器暂时不可用，当前显示上次保存的数据' : '服务器暂时不可用，请稍后重试');
        } else {
          setError(cause.message || '加载设备失败，请重试');
        }
      } else {
        setError(hasCachedData ? '暂时无法更新，当前显示上次保存的数据' : '加载设备失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  return { ...data, loading, error, reload };
}
