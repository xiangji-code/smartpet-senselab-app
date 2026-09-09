/**
 * Token 安全存储。
 *
 * 原生平台使用 expo-secure-store（Keychain / Keystore）安全保存 refresh token；
 * Web 预览无 SecureStore，回退到 localStorage（仅用于开发预览，不作为安全承诺）。
 *
 * 只持久化 refresh token 与最小用户标识；access token 仅存内存，随进程销毁。
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'smartpet.refreshToken';

const isWeb = Platform.OS === 'web';
let pendingMutation: Promise<void> = Promise.resolve();

function mutate(operation: () => Promise<void>): Promise<void> {
  const task = pendingMutation.catch(() => undefined).then(operation);
  pendingMutation = task;
  return task;
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // 忽略无痕/禁用存储的场景
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const tokenStore = {
  getRefreshToken: async () => {
    await pendingMutation.catch(() => undefined);
    return getItem(REFRESH_TOKEN_KEY);
  },
  saveRefreshToken: (token: string) => mutate(() => setItem(REFRESH_TOKEN_KEY, token)),
  clear: () => mutate(() => removeItem(REFRESH_TOKEN_KEY)),
};
