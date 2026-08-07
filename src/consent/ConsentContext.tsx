/**
 * Data Collection Consent（数据采集授权）全局开关。
 *
 * 授权按 App 用户隔离；切换账号或读取失败时默认未授权。
 * 用户在登录/注册时首次同意，「我的」页可随时调整。
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

import { useAuth } from '../auth/AuthContext';
import { consentStore } from './consentStore';

interface ConsentState {
  consent: boolean;
  ready: boolean;
  error: string | null;
  setConsent: (value: boolean) => Promise<void>;
  clearConsent: () => Promise<void>;
}

interface StoredState {
  userId: number | null;
  consent: boolean;
  ready: boolean;
  error: string | null;
}

const ConsentContext = createContext<ConsentState | undefined>(undefined);

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const generationRef = useRef(0);
  const [stored, setStored] = useState<StoredState>({
    userId: null,
    consent: false,
    ready: false,
    error: null,
  });

  const currentUserId = user?.id ?? null;

  useEffect(() => {
    const generation = ++generationRef.current;

    if (isLoading) {
      setStored({ userId: null, consent: false, ready: false, error: null });
      return;
    }

    if (currentUserId == null) {
      setStored({ userId: null, consent: false, ready: true, error: null });
      return;
    }

    setStored({ userId: currentUserId, consent: false, ready: false, error: null });
    void consentStore.get(currentUserId).then((consent) => {
      if (generation !== generationRef.current) return;
      setStored({ userId: currentUserId, consent, ready: true, error: null });
    });
  }, [currentUserId, isLoading]);

  const belongsToCurrentUser = stored.userId === currentUserId;
  const ready = !isLoading && belongsToCurrentUser && stored.ready;
  const consent = ready ? stored.consent : false;
  const error = belongsToCurrentUser ? stored.error : null;

  const setConsent = useCallback(
    async (value: boolean) => {
      if (currentUserId == null || !ready) {
        throw new Error('授权状态尚未准备完成');
      }

      const generation = generationRef.current;
      setStored((previous) =>
        previous.userId === currentUserId ? { ...previous, error: null } : previous,
      );

      try {
        await consentStore.set(currentUserId, value);
        if (generation !== generationRef.current) return;
        setStored({ userId: currentUserId, consent: value, ready: true, error: null });
      } catch (cause) {
        if (generation === generationRef.current) {
          setStored((previous) =>
            previous.userId === currentUserId
              ? { ...previous, error: '授权状态保存失败，请稍后重试' }
              : previous,
          );
        }
        throw cause;
      }
    },
    [currentUserId, ready],
  );

  const clearConsent = useCallback(async () => {
    if (currentUserId == null || !ready) {
      throw new Error('授权状态尚未准备完成');
    }

    const generation = generationRef.current;
    setStored((previous) =>
      previous.userId === currentUserId ? { ...previous, error: null } : previous,
    );

    try {
      await consentStore.clear(currentUserId);
      if (generation !== generationRef.current) return;
      setStored({ userId: currentUserId, consent: false, ready: true, error: null });
    } catch (cause) {
      if (generation === generationRef.current) {
        setStored((previous) =>
          previous.userId === currentUserId
            ? { ...previous, error: '授权状态清除失败，请稍后重试' }
            : previous,
        );
      }
      throw cause;
    }
  }, [currentUserId, ready]);

  const value = useMemo<ConsentState>(
    () => ({ consent, ready, error, setConsent, clearConsent }),
    [consent, ready, error, setConsent, clearConsent],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentState {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error('useConsent 必须在 ConsentProvider 内使用');
  return ctx;
}
