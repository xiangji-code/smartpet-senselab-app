import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { useConsent } from '../consent/ConsentContext';
import type { Device } from '../types/domain';
import {
  foregroundScanDurationMs,
  nextForegroundScanDelayMs,
} from './adaptiveScanPolicy';
import type { AudioUploadProgress, BleUploadResult } from './audioUploadFlow';
import { receiveAndUploadDeviceData } from './deviceDataSyncFlow';
import { BleDataFrameDiagnosticError, scanForForegroundPendingDevice, stopForegroundSmartPetScan, type BleScanTarget, type DataSyncProgress } from './smartPetBle';
import type { BleFrameDiagnostic } from './frameDiagnostic';
import type { SmartPetAdvertisement } from './protocol';
import { buildBlePullPreview, type BlePullPreview } from './pullPreview';

export interface ForegroundBleSyncState {
  phase: 'idle' | 'receiving' | 'uploading' | 'complete' | 'empty' | 'error';
  isScanning: boolean;
  deviceSn: string | null;
  message: string | null;
  receiveProgress: DataSyncProgress | null;
  uploadProgress: AudioUploadProgress | null;
  uploadResult: BleUploadResult | null;
  preview: BlePullPreview | null;
  advertisement: SmartPetAdvertisement | null;
  frameDiagnostic: BleFrameDiagnostic | null;
  completedAt: number | null;
}

interface ForegroundBleSyncContextValue {
  state: ForegroundBleSyncState;
  syncDevice: (device: Device) => Promise<void>;
}

const initialState: ForegroundBleSyncState = {
  phase: 'idle',
  isScanning: false,
  deviceSn: null,
  message: null,
  receiveProgress: null,
  uploadProgress: null,
  uploadResult: null,
  preview: null,
  advertisement: null,
  frameDiagnostic: null,
  completedAt: null,
};

const ForegroundBleSyncContext = createContext<ForegroundBleSyncContextValue | undefined>(undefined);

export function ForegroundBleSyncProvider({ children }: { children: React.ReactNode }) {
  const { user, devices, isLoading } = useAuth();
  const { consent, ready: consentReady } = useConsent();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [state, setState] = useState<ForegroundBleSyncState>(initialState);
  const activeSyncRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  const syncDevice = useCallback((device: Device): Promise<void> => {
    if (activeSyncRef.current) return activeSyncRef.current;
    if (!user) return Promise.resolve();

    stopForegroundSmartPetScan();
    const target: BleScanTarget = {
      deviceSn: device.deviceSn,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
    };
    const task = (async () => {
      let receiveFinished = false;
      setState({
        ...initialState,
        phase: 'receiving',
        deviceSn: device.deviceSn,
        message: '已发现待传数据，正在连接设备…',
      });
      try {
        const result = await receiveAndUploadDeviceData({
          target,
          device: {
            id: device.id,
            deviceSn: device.deviceSn,
            petProfileId: device.currentPetProfileId,
            appUserId: user.id,
          },
          onReceiveProgress: (progress) => {
            setState((current) => ({
              ...current,
              phase: 'receiving',
              message: progress.message,
              receiveProgress: progress,
            }));
          },
          onUploadProgress: (progress) => {
            setState((current) => ({
              ...current,
              phase: progress.phase === 'error' ? 'error' : 'uploading',
              message: progress.message,
              uploadProgress: progress,
            }));
          },
          onReceived: (received) => {
            receiveFinished = received.completed;
            setState((current) => ({
              ...current,
              advertisement: received.advertisement ?? current.advertisement,
              preview: received.blocks.length > 0
                ? buildBlePullPreview(
                    received.blocks,
                    received.blockSummaries,
                    received.frameSummaries,
                    received.pullDurationMs,
                  )
                : current.preview,
            }));
          },
        });

        const completedAt = Date.now();
        setState((current) => ({
          ...current,
          phase: result.upload ? 'complete' : 'empty',
          message: result.upload
            ? `${result.upload.files.length} 个文件已接收并上传后端`
            : '设备当前没有待传数据',
          uploadResult: result.upload,
          completedAt,
        }));
      } catch (error) {
        const frameDiagnostic = error instanceof BleDataFrameDiagnosticError ? error.diagnostic : null;
        const detail = error instanceof Error ? error.message : '未知错误';
        setState((current) => ({
          ...current,
          phase: 'error',
          message: receiveFinished
            ? `${detail}；文件仍安全保留在手机中`
            : detail,
          frameDiagnostic,
        }));
      }
    })().finally(() => {
      activeSyncRef.current = null;
    });
    activeSyncRef.current = task;
    return task;
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let initialScan = true;

    const enabled =
      appState === 'active' &&
      !isLoading &&
      Boolean(user) &&
      consentReady &&
      Boolean(consent) &&
      devices.length > 0;

    if (!enabled || !user) {
      stopForegroundSmartPetScan();
      setState((current) => ({ ...current, isScanning: false }));
      return;
    }

    const targets: BleScanTarget[] = devices.map((device) => ({
      deviceSn: device.deviceSn,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
    }));

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = setTimeout(() => void runCycle(), delayMs);
    };

    const runCycle = async () => {
      const cycleStartedAt = Date.now();
      const scanDurationMs = foregroundScanDurationMs(initialScan);
      initialScan = false;
      let transferAttempted = false;

      try {
        setState((current) => ({ ...current, isScanning: true }));
        const match = await scanForForegroundPendingDevice(targets, scanDurationMs);
        if (cancelled || !match) return;

        const device = devices.find(
          (item) => item.deviceSn.trim().toUpperCase() === match.target.deviceSn.trim().toUpperCase(),
        );
        if (!device) return;
        transferAttempted = true;
        await syncDevice(device);
      } catch (error) {
        console.warn(
          '[SmartPet BLE] 前台自动接收失败，将在下一轮重试：',
          error instanceof Error ? error.message : error,
        );
      } finally {
        setState((current) => ({ ...current, isScanning: false }));
        if (!cancelled) {
          schedule(nextForegroundScanDelayMs(Date.now() - cycleStartedAt, transferAttempted));
        }
      }
    };

    void runCycle();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stopForegroundSmartPetScan();
    };
  }, [appState, consent, consentReady, devices, isLoading, syncDevice, user]);

  const value = useMemo(() => ({ state, syncDevice }), [state, syncDevice]);
  return (
    <ForegroundBleSyncContext.Provider value={value}>
      {children}
    </ForegroundBleSyncContext.Provider>
  );
}

export function useForegroundBleSync(): ForegroundBleSyncContextValue {
  const context = useContext(ForegroundBleSyncContext);
  if (!context) throw new Error('useForegroundBleSync 必须在 ForegroundBleSyncProvider 内使用');
  return context;
}
