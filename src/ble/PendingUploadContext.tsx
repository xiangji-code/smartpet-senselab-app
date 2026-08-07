import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { useConsent } from '../consent/ConsentContext';
import type { AudioUploadProgress, BleUploadResult } from './audioUploadFlow';
import { retryPendingUploadForDevice } from './pendingUploadCoordinator';

export interface PendingUploadState {
  phase: 'idle' | 'checking' | AudioUploadProgress['phase'] | 'error';
  deviceSn: string | null;
  message: string | null;
  result: BleUploadResult | null;
}

interface PendingUploadContextValue {
  state: PendingUploadState;
  retryAll: () => Promise<void>;
}

const initialState: PendingUploadState = {
  phase: 'idle',
  deviceSn: null,
  message: null,
  result: null,
};

const PendingUploadContext = createContext<PendingUploadContextValue | undefined>(undefined);

export function PendingUploadProvider({ children }: { children: React.ReactNode }) {
  const { user, devices, isLoading } = useAuth();
  const { consent, ready: consentReady } = useConsent();
  const runningRef = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<PendingUploadState>(initialState);

  const retryAll = useCallback((): Promise<void> => {
    if (runningRef.current) return runningRef.current;
    if (isLoading || !user || !consentReady || !consent || devices.length === 0) {
      return Promise.resolve();
    }

    const task = (async () => {
      let uploadedFiles = 0;
      let uploadedBytes = 0;
      for (const device of devices) {
        setState({
          phase: 'checking',
          deviceSn: device.deviceSn,
          message: `正在检查 ${device.deviceName || device.deviceSn} 的待上传文件…`,
          result: null,
        });
        try {
          const result = await retryPendingUploadForDevice(
            {
              id: device.id,
              deviceSn: device.deviceSn,
              petProfileId: device.currentPetProfileId,
              appUserId: user.id,
            },
            (progress) => {
              setState({
                phase: progress.phase,
                deviceSn: device.deviceSn,
                message: progress.message,
                result: null,
              });
            },
          );
          if (result) {
            uploadedFiles += result.files.length;
            uploadedBytes += result.totalBytes;
            setState({
              phase: 'complete',
              deviceSn: device.deviceSn,
              message: `${result.files.length} 个待上传文件已自动续传`,
              result,
            });
          }
        } catch (error) {
          setState({
            phase: 'error',
            deviceSn: device.deviceSn,
            message: `${error instanceof Error ? error.message : '自动续传失败'}；文件仍安全保留在手机中`,
            result: null,
          });
        }
      }
      if (uploadedFiles > 0) {
        setState((current) => ({
          ...current,
          phase: 'complete',
          message: `自动续传完成：${uploadedFiles} 个文件，共 ${uploadedBytes} B`,
        }));
      } else {
        setState((current) => current.phase === 'error' ? current : initialState);
      }
    })().finally(() => {
      runningRef.current = null;
    });
    runningRef.current = task;
    return task;
  }, [consent, consentReady, devices, isLoading, user]);

  useEffect(() => {
    if (!user) {
      setState(initialState);
      return;
    }
    void retryAll();
  }, [retryAll, user]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void retryAll();
    });
    return () => subscription.remove();
  }, [retryAll]);

  const value = useMemo(() => ({ state, retryAll }), [retryAll, state]);
  return <PendingUploadContext.Provider value={value}>{children}</PendingUploadContext.Provider>;
}

export function usePendingUploads(): PendingUploadContextValue {
  const context = useContext(PendingUploadContext);
  if (!context) throw new Error('usePendingUploads 必须在 PendingUploadProvider 内使用');
  return context;
}
