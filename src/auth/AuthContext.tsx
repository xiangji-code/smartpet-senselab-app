/**
 * App 登录会话生命周期：
 * - access token 只保存在内存，refresh token 由 SecureStore 持久化
 * - 启动时静默恢复会话；临时网络故障不会删除 refresh token
 * - 并发 401 由 API client 合并为一次 refresh
 * - 只有后端明确拒绝 refresh/session 凭证时才清空会话
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { configureAuth } from '../api/client';
import { authApi, type AuthUser, type RegisterInput } from '../api/auth';
import { devicesApi } from '../api/devices';
import { configureBleQueueOwner } from '../ble/blockQueue';
import { appCache } from '../cache/cacheStore';
import { consentStore } from '../consent/consentStore';
import type { Device } from '../types/domain';
import { lastAccountStore } from './lastAccountStore';
import {
  isCredentialRejected,
  SessionSetupError,
  sessionRecoveryMessage,
} from './sessionErrors';
import { tokenStore } from './tokenStore';

interface ConsentGrant {
  dataCollectionConsent: true;
}

interface AuthState {
  user: AuthUser | null;
  devices: Device[];
  isAuthenticated: boolean;
  /** 启动或手动恢复持久化会话中；此时不应做导航决策。 */
  isLoading: boolean;
  /** 临时故障导致会话尚未恢复；refresh token 仍安全保留。 */
  sessionRecoveryError: string | null;
  signIn: (email: string, password: string, consent: ConsentGrant) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    input: RegisterInput,
    consent: ConsentGrant,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  retrySession: () => Promise<void>;
  refreshDevices: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionRecoveryError, setSessionRecoveryError] = useState<string | null>(null);

  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);

  const clearSession = useCallback(async () => {
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    configureBleQueueOwner(null);
    setUser(null);
    setDevices([]);
    setSessionRecoveryError(null);
    await tokenStore.clear();
  }, []);

  const loadCurrentSession = useCallback(async (consentGrant?: ConsentGrant) => {
    const [me, list] = await Promise.all([
      authApi.getMe(),
      devicesApi.list(),
    ]);
    if (consentGrant?.dataCollectionConsent) {
      await consentStore.set(me.id, true);
    }
    configureBleQueueOwner(me.id);
    setUser(me);
    setDevices(list);
    setSessionRecoveryError(null);
    void appCache.cleanup(me.id).catch(() => undefined);
    void lastAccountStore.setEmail(me.email).catch(() => undefined);
  }, []);

  // 注入 access token 与 refresh 行为。临时故障向上抛出，不清除持久化会话。
  useEffect(() => {
    configureAuth(
      () => accessTokenRef.current,
      async () => {
        const refreshToken = refreshTokenRef.current;
        if (!refreshToken) return null;
        try {
          const newAccess = await authApi.refresh(refreshToken);
          accessTokenRef.current = newAccess;
          return newAccess;
        } catch (error) {
          if (isCredentialRejected(error)) {
            await clearSession();
            return null;
          }
          throw error;
        }
      },
    );
  }, [clearSession]);

  const restoreStoredSession = useCallback(async () => {
    try {
      const refreshToken = await tokenStore.getRefreshToken();
      if (!refreshToken) {
        setSessionRecoveryError(null);
        return;
      }

      refreshTokenRef.current = refreshToken;
      const accessToken = await authApi.refresh(refreshToken);
      accessTokenRef.current = accessToken;
      await loadCurrentSession();
    } catch (error) {
      if (isCredentialRejected(error)) {
        await clearSession();
        return;
      }
      // 网络、超时、限流或服务端故障：保留 refresh token，展示显式重试页。
      setSessionRecoveryError(sessionRecoveryMessage(error));
    }
  }, [clearSession, loadCurrentSession]);

  // 启动自举：持久化会话恢复完成前不进行路由跳转。
  useEffect(() => {
    let active = true;
    void restoreStoredSession().finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [restoreStoredSession]);

  /**
   * 登录接口成功后建立完整会话。
   * 后续资料请求失败属于 session setup 错误，不能再被解释成密码错误。
   */
  const establishSession = useCallback(
    async (accessToken: string, refreshToken: string, consentGrant?: ConsentGrant) => {
      accessTokenRef.current = accessToken;
      refreshTokenRef.current = refreshToken;
      setSessionRecoveryError(null);
      try {
        await tokenStore.saveRefreshToken(refreshToken);
        await loadCurrentSession(consentGrant);
      } catch (error) {
        if (isCredentialRejected(error)) {
          await clearSession();
        }
        throw new SessionSetupError(error);
      }
    },
    [clearSession, loadCurrentSession],
  );

  const signIn = useCallback(
    async (email: string, password: string, consent: ConsentGrant) => {
      const { accessToken, refreshToken } = await authApi.login(email, password);
      await establishSession(accessToken, refreshToken, consent);
    },
    [establishSession],
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      input: RegisterInput,
      consent: ConsentGrant,
    ) => {
      await authApi.register(email, password, input);
      const { accessToken, refreshToken } = await authApi.login(email, password);
      await establishSession(accessToken, refreshToken, consent);
    },
    [establishSession],
  );

  const signOut = useCallback(async () => {
    const refreshToken = refreshTokenRef.current;
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // 用户明确退出时，即使后端暂时不可用也应完成本地退出。
      }
    }
    await clearSession();
  }, [clearSession]);

  const retrySession = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      await restoreStoredSession();
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, restoreStoredSession]);

  const refreshDevices = useCallback(async () => {
    if (!accessTokenRef.current) return;
    const list = await devicesApi.list();
    setDevices(list);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      devices,
      isAuthenticated: user !== null,
      isLoading,
      sessionRecoveryError,
      signIn,
      signUp,
      signOut,
      retrySession,
      refreshDevices,
    }),
    [
      user,
      devices,
      isLoading,
      sessionRecoveryError,
      signIn,
      signUp,
      signOut,
      retrySession,
      refreshDevices,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
