/**
 * 轻量键值持久化（非敏感数据）。
 *
 * 原生使用 expo-secure-store，Web 回退 localStorage。
 * 敏感的 refresh token 仍走 `src/auth/tokenStore.ts`；这里用于偏好/队列等。
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

export async function kvGet(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (isWeb) {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function kvRemove(key: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function kvGetJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await kvGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function kvSetJson(key: string, value: unknown): Promise<void> {
  await kvSet(key, JSON.stringify(value));
}
