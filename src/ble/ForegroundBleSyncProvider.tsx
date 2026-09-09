import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { useConsent } from '../consent/ConsentContext';
import { captureSessionScope } from '../auth/sessionScope';
import type { Device } from '../types/domain';
import {
  foregroundScanDurationMs,
  nextForegroundScanDelayMs,
} from './adaptiveScanPolicy';
import type { AudioUploadProgress, BleUploadResult } from './audioUploadFlow';
import { receiveAndUploadDeviceData } from './deviceDataSyncFlow';
import {
  BleDataFrameDiagnosticError,
  configureSmartPetAutoReconnect,
  canAutomaticallyConnectSmartPet,
  getBleConnectionsSnapshot,
  hasQueuedSmartPetData,
  scanForForegroundPendingDevice,
  stopForegroundSmartPetScan,
  subscribeBleConnections,
  verifyActiveSmartPetBleConnections,
  type BleScanTarget,
  type DataSyncProgress,
} from './smartPetBle';
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
  const activeSyncRef = useRef(new Map<string, Promise<void>>());
  const bleConnectionsSnapshot = useSyncExternalStore(
    subscribeBleConnections,
    getBleConnectionsSnapshot,
    getBleConnectionsSnapshot,
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const targets: BleScanTarget[] = devices.map((device) => ({
      deviceSn: device.deviceSn,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
    }));
    void configureSmartPetAutoReconnect({
      enabled: appState === 'active' && !isLoading && Boolean(user),
      ownerId: user?.id ?? null,
      targets,
    });
  }, [appState, devices, isLoading, user]);

  useEffect(() => {
    if (appState !== 'active' || isLoading || !user) return;
    const timer = setInterval(() => {
      void verifyActiveSmartPetBleConnections();
    }, 5_000);
    return () => clearInterval(timer);
  }, [appState, isLoading, user]);

  const syncDevice = useCallback((device: Device): Promise<void> => {
    const scope = captureSessionScope();
    const targetKey = device.deviceSn.trim().toUpperCase();
    const active = activeSyncRef.current.get(targetKey);
    if (active) return active;
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
            if (scope.signal.aborted) return;
            setState((current) => ({
              ...current,
              phase: 'receiving',
              message: progress.message,
              receiveProgress: progress,
            }));
          },
          onUploadProgress: (progress) => {
            if (scope.signal.aborted) return;
            setState((current) => ({
              ...current,
              phase: progress.phase === 'error' ? 'error' : 'uploading',
              message: progress.message,
              uploadProgress: progress,
            }));
          },
          onReceived: (received) => {
            if (scope.signal.aborted) return;
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
        if (scope.signal.aborted) return;
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
        if (scope.signal.aborted) return;
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
      activeSyncRef.current.delete(targetKey);
    });
    activeSyncRef.current.set(targetKey, task);
    return task;
  }, [user]);

  useEffect(() => {
    if (
      appState !== 'active' ||
      isLoading ||
      !user ||
      !consentReady ||
      !consent
    ) return;
    for (const device of devices) {
      const target: BleScanTarget = {
        deviceSn: device.deviceSn,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
      };
      if (hasQueuedSmartPetData(target)) void syncDevice(device);
    }
  }, [
    appState,
    bleConnectionsSnapshot,
    consent,
    consentReady,
    devices,
    isLoading,
    syncDevice,
    user,
  ]);

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
        const match = await scanForForegroundPendingDevice(
          targets,
          scanDurationMs,
          (isScanning) => {
            if (!cancelled) setState((current) => ({ ...current, isScanning }));
          },
        );
        if (cancelled || !match) return;

        const device = devices.find(
          (item) => item.deviceSn.trim().toUpperCase() === match.target.deviceSn.trim().toUpperCase(),
        );
        if (!device) return;
        if (!canAutomaticallyConnectSmartPet(match.target)) return;
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
