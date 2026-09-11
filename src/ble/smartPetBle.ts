import { PermissionsAndroid, Platform } from 'react-native';
import {
  BleManager,
  type Device as BlePlxDevice,
  type Subscription,
} from 'react-native-ble-plx';

import type { Device as AppDevice, TrainerCommand } from '../types/domain';
import { kvGetJson, kvSetJson } from '../lib/kv';
import { getBleQueueOwner, persistBleBlock, type StoredBleBlock } from './blockQueue';
import { BleConnectionEvents } from './connectionEvents';
import { BleRecoveryTracker } from './recoveryTracker';
import { createBleTransferDiagnostics } from './transferDiagnostics';
import { BleTxListenerCoordinator } from './txListenerCoordinator';
import {
  TRAINER_COMMAND_CONNECT_TIMEOUT_MS,
  TRAINER_COMMAND_DISCOVERY_TIMEOUT_MS,
  TRAINER_COMMAND_INITIAL_SCAN_MS,
  TRAINER_COMMAND_RESPONSE_TIMEOUT_MS,
  TRAINER_COMMAND_RETRY_SCAN_MS,
  type TrainerCommandPhase,
} from './trainerCommandPolicy';
import {
  matchForegroundAdvertisement,
  type ForegroundPendingAdvertisement,
} from './foregroundBleMatcher';
import {
  buildBleFrameDiagnostic,
  type BleFrameDiagnostic,
} from './frameDiagnostic';
import {
  BLE_TRANSFER,
  BLE_UUIDS,
  BleBlockAssembler,
  BleFrameError,
  buildDataFrameHeaderHex,
  encodeBlockAcknowledgement,
  encodeBarkSensitivity,
  encodeDogSize,
  encodeTrainerCommand,
  matchesBindingCodeAdvertisement,
  matchesBlockAcknowledgement,
  parseBleTxValue,
  parseDataFrame,
  parseDeviceInfo,
  parseServiceDataAdvertisement,
  parseTrainerCommandResponse,
  type BleDataFrame,
  type BleDeviceInfo,
  type BleReceivedBlock,
  type SmartPetAdvertisement,
  type TrainerCommandResponse,
} from './protocol';

export type BleRuntimeMode = 'native' | 'mock';
export type BleConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'reconnecting'
  | 'discovering'
  | 'connected'
  | 'syncing'
  | 'disconnected'
  | 'error';

export interface BleScanTarget {
  deviceSn: string;
  deviceName?: string | null;
  deviceType?: AppDevice['deviceType'];
}

export interface BleConnectedDevice {
  id: string;
  name: string;
  mode: BleRuntimeMode;
  advertisement?: SmartPetAdvertisement | null;
  advertisementSource?: 'current' | 'cached' | null;
  advertisementObservedAt?: number | null;
  info?: BleDeviceInfo;
}

export interface DataSyncProgress {
  phase: 'status' | 'reading' | 'complete' | 'empty' | 'paused' | 'mock' | 'error';
  pendingBytes: number;
  pendingRecords: number;
  currentBlock: number;
  totalBlocks: number;
  receivedBytes: number;
  receivedFrames?: number;
  message: string;
}

export interface DataSyncResult {
  completed: boolean;
  receivedBytes: number;
  lastBlockId: number;
  blocks: BleReceivedBlock[];
  storedBlocks: StoredBleBlock[];
  blockSummaries: BleBlockTransferSummary[];
  frameSummaries: BleFrameTransferSummary[];
  pullDurationMs: number;
  advertisement?: SmartPetAdvertisement | null;
}

export interface BleBlockTransferSummary {
  blockId: number;
  totalBytes: number;
  frameCount: number;
}

export interface BleFrameTransferSummary {
  frameNumber: number;
  blockId: number;
  totalBytes: number;
  offset: number;
  dataLength: number;
  headerHex: string;
  tailHex: string;
}

export interface BleTrainerCommandResult extends TrainerCommandResponse {
  device: BleConnectedDevice;
}

export type { TrainerCommandPhase } from './trainerCommandPolicy';

export class BleDataFrameDiagnosticError extends Error {
  constructor(public readonly diagnostic: BleFrameDiagnostic) {
    super(
      `数据帧校验失败（${diagnostic.code}）；首帧 ${diagnostic.byteLength} 字节；HEX：${diagnostic.rawHex || '空'}；${diagnostic.hint}`,
    );
    this.name = 'BleDataFrameDiagnosticError';
  }
}

interface NativeSession {
  manager: BleManager;
  device: BlePlxDevice;
  targetKey: string;
  advertisement: SmartPetAdvertisement | null;
  advertisementSource: 'current' | 'cached' | null;
  advertisementObservedAt: number | null;
  disconnectSubscription: Subscription;
}

interface NativeSessionOptions {
  scanTimeoutMs?: number;
  connectTimeoutMs?: number;
  onPhase?: (phase: TrainerCommandPhase) => void;
  knownDeviceId?: string;
  automaticReconnect?: boolean;
}

export interface BleConnectionStatus {
  state: BleConnectionState;
  reconnectPhase: 'waiting' | 'paused' | 'scanning' | 'connecting' | null;
  attempt: number;
  nextRetryAt: number | null;
  error: string | null;
  rssi: number | null;
  lastCheckedAt: number | null;
}

interface AutoReconnectIntent {
  target: BleScanTarget;
  deviceId?: string;
}

interface PersistedAutoReconnectIntent {
  deviceSn: string;
  deviceId?: string;
  enabled?: boolean;
  advertisement?: SmartPetAdvertisement;
  advertisementObservedAt?: number;
}

interface CachedAdvertisement {
  advertisement: SmartPetAdvertisement;
  observedAt: number;
}

interface PersistentDataTxListener {
  deviceId: string;
  subscription: Subscription | null;
  queuedValues: string[];
  consumer: ((value: string) => void) | null;
  consumerError: ((error: Error) => void) | null;
}

const AUTO_RECONNECT_DELAYS_MS = [500, 2_000, 5_000, 10_000, 30_000] as const;
export const MAX_AUTO_RECONNECT_ATTEMPTS = 5;
const AUTO_RECONNECT_DIRECT_CONNECT_TIMEOUT_MS = 3_000;
const AUTO_RECONNECT_SCAN_TIMEOUT_MS = 8_000;
const AUTO_RECONNECT_CONNECT_TIMEOUT_MS = 8_000;
const AUTO_RECONNECT_BATCH_WINDOW_MS = 100;
const INITIAL_ADVERTISEMENT_SCAN_TIMEOUT_MS = 300;
const AUTO_RECONNECT_STORAGE_PREFIX = 'smartpet.ble.auto-reconnect.v1';
const idleConnectionStatus: BleConnectionStatus = {
  state: 'idle',
  reconnectPhase: null,
  attempt: 0,
  nextRetryAt: null,
  error: null,
  rssi: null,
  lastCheckedAt: null,
};

let nativeManager: BleManager | null = null;
const activeNativeSessions = new Map<string, NativeSession>();
const persistentDataTxListeners = new Map<string, PersistentDataTxListener>();
const activeDataConsumers = new Set<string>();
const activeTransfers = new Set<string>();
let pendingNativeSession: {
  targetKey: string;
  promise: Promise<NativeSession | null>;
} | null = null;
let cancelForegroundScan: (() => void) | null = null;
let cancelAutoReconnectScan: (() => void) | null = null;
const latestConnectedDevices = new Map<string, BleConnectedDevice>();
const bleConnectionStatuses = new Map<string, BleConnectionStatus>();
const autoReconnectIntents = new Map<string, AutoReconnectIntent>();
const autoReconnectTargets = new Map<string, BleScanTarget>();
const autoReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const autoReconnectAttempts = new Map<string, number>();
const cachedAdvertisements = new Map<string, CachedAdvertisement>();
const autoReconnectInFlight = new Set<string>();
const readyAutoReconnectAttempts = new Map<string, number>();
const manuallyDisconnectedTargets = new Set<string>();
const connectionHealthFailures = new Map<string, number>();
const bleConnectionEvents = new BleConnectionEvents();
const txListenerCoordinator = new BleTxListenerCoordinator();
let connectionHealthCheckPromise: Promise<void> | null = null;
let connectionHealthTransactionSequence = 0;
let autoReconnectEnabled = false;
let autoReconnectOwnerId: number | null = null;
let autoReconnectConfigurationVersion = 0;
let reconnectPersistenceTask = Promise.resolve();
let autoReconnectBatchTimer: ReturnType<typeof setTimeout> | null = null;
let autoReconnectBatchPromise: Promise<void> | null = null;
let foregroundScanRequestCount = 0;
let foregroundScanCancellationVersion = 0;
let bleSessionVersion = 0;
let bleAccountController = new AbortController();
const connectionAttemptTokens = new Map<string, symbol>();

/** Account cleanup must not persist a user-requested manual disconnect. */
export async function clearSmartPetAccountConnections(): Promise<void> {
  ++bleSessionVersion;
  const previousController = bleAccountController;
  bleAccountController = new AbortController();
  previousController.abort();
  ++autoReconnectConfigurationVersion;
  autoReconnectEnabled = false;
  autoReconnectOwnerId = null;
  cancelAutoReconnectScan?.();
  stopForegroundSmartPetScan();
  clearAllReconnectTimers();
  for (const subscriber of [...sharedScanListeners]) subscriber(new Error('账号已退出'), null);
  const sessions = [...activeNativeSessions.values()];
  for (const session of sessions) dropNativeSession(session.targetKey, 'replace');
  autoReconnectTargets.clear();
  autoReconnectIntents.clear();
  autoReconnectAttempts.clear();
  manuallyDisconnectedTargets.clear();
  cachedAdvertisements.clear();
  latestConnectedDevices.clear();
  bleConnectionStatuses.clear();
  bleConnectionEvents.changed();
  await Promise.all(sessions.map(({ manager, device }) =>
    withTimeout(manager.cancelDeviceConnection(device.id), 1_500, '清理连接超时').catch(() => null),
  ));
}

export const subscribeBleConnections = bleConnectionEvents.subscribe;
export const getBleConnectionsSnapshot = bleConnectionEvents.getSnapshot;

type ScanListener = (error: Error | null, device: BlePlxDevice | null) => void;
const sharedScanListeners = new Set<ScanListener>();
function joinSharedScan(manager: BleManager, listener: ScanListener): () => void {
  sharedScanListeners.add(listener);
  if (sharedScanListeners.size === 1) {
    manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      for (const subscriber of [...sharedScanListeners]) subscriber(error, device);
    });
  }
  return () => {
    sharedScanListeners.delete(listener);
    if (sharedScanListeners.size === 0) manager.stopDeviceScan();
  };
}

export function canAutomaticallyConnectSmartPet(target: BleScanTarget): boolean {
  return !manuallyDisconnectedTargets.has(getTargetKey(target));
}

function dataTransferBusy(): boolean {
  return activeTransfers.size > 0 || activeDataConsumers.size > 0 || [...persistentDataTxListeners.values()]
    .some((listener) => listener.queuedValues.length > 0);
}

export function hasQueuedSmartPetData(target: BleScanTarget): boolean {
  const session = activeNativeSessions.get(getTargetKey(target));
  if (!session) return false;
  return (persistentDataTxListeners.get(session.device.id)?.queuedValues.length ?? 0) > 0;
}

export function getSmartPetBleConnectionStatus(target: BleScanTarget): BleConnectionStatus {
  return bleConnectionStatuses.get(getTargetKey(target)) ?? idleConnectionStatus;
}

export async function configureSmartPetAutoReconnect({
  enabled,
  ownerId,
  targets,
}: {
  enabled: boolean;
  ownerId: number | null;
  targets: readonly BleScanTarget[];
}): Promise<void> {
  const ownerChanged = autoReconnectOwnerId !== ownerId;
  const cleanup = ownerChanged ? clearSmartPetAccountConnections() : Promise.resolve();
  const version = ++autoReconnectConfigurationVersion;
  autoReconnectEnabled = false;
  cancelAutoReconnectScan?.();
  clearAllReconnectTimers();

  if (ownerChanged) {
    autoReconnectIntents.clear();
    autoReconnectAttempts.clear();
    manuallyDisconnectedTargets.clear();
    cachedAdvertisements.clear();
  }
  autoReconnectOwnerId = ownerId;
  autoReconnectTargets.clear();
  for (const target of targets) autoReconnectTargets.set(getTargetKey(target), target);

  await cleanup;
  if (version !== autoReconnectConfigurationVersion || ownerId === null) return;

  const persisted = await kvGetJson<PersistedAutoReconnectIntent[]>(
    autoReconnectStorageKey(ownerId),
    [],
  ).catch(() => []);
  if (version !== autoReconnectConfigurationVersion || autoReconnectOwnerId !== ownerId) return;

  const persistedByTarget = new Map(
    persisted.map((record) => [record.deviceSn.trim().toUpperCase(), record]),
  );
  for (const [targetKey, target] of autoReconnectTargets) {
    const record = persistedByTarget.get(targetKey);
    if (record?.advertisement && Number.isFinite(record.advertisementObservedAt)) {
      cachedAdvertisements.set(targetKey, {
        advertisement: record.advertisement,
        observedAt: record.advertisementObservedAt as number,
      });
    }
    if (record?.enabled === false) {
      manuallyDisconnectedTargets.add(targetKey);
      setBleConnectionStatus(targetKey, { ...idleConnectionStatus, state: 'disconnected' });
    }
    const current = autoReconnectIntents.get(targetKey);
    autoReconnectIntents.set(targetKey, {
      target,
      deviceId: current?.deviceId ?? record?.deviceId,
    });
  }
  removeUnboundReconnectIntents();
  persistAutoReconnectIntents();

  autoReconnectEnabled = enabled;
  if (!enabled) return;
  await adoptCurrentlyConnectedSessions().catch((cause) => {
    console.warn(
      '[SmartPet BLE] 接管系统已有连接失败：',
      cause instanceof Error ? cause.message : cause,
    );
  });
  if (version !== autoReconnectConfigurationVersion || !autoReconnectEnabled) return;
  for (const targetKey of autoReconnectIntents.keys()) {
    if (!activeNativeSessions.has(targetKey)) scheduleAutoReconnect(targetKey);
  }
}

export async function connectSmartPetDevice(target: BleScanTarget): Promise<BleConnectedDevice> {
  const version = bleSessionVersion;
  const targetKey = getTargetKey(target);
  manuallyDisconnectedTargets.delete(targetKey);
  autoReconnectAttempts.delete(targetKey);
  clearReconnectTimer(targetKey);
  readyAutoReconnectAttempts.delete(targetKey);
  persistAutoReconnectIntents();
  try {
    const native = await createNativeSession(target);
    if (!native) {
      const connected = mockConnect(target);
      rememberConnectedDevice(getTargetKey(target), connected);
      return connected;
    }

    if (version !== bleSessionVersion) throw new Error('账号已变更，连接已取消');
    return connectedResult(native, target);
  } catch (cause) {
    if (version !== bleSessionVersion) throw cause;
    setBleConnectionStatus(targetKey, {
      state: 'error',
      reconnectPhase: null,
      nextRetryAt: null,
      error: cause instanceof Error ? cause.message : '蓝牙连接失败',
    });
    throw cause;
  }
}

/** Returns the latest real advertisement snapshot for the currently selected device. */
export function getLatestConnectedSmartPetDevice(target: BleScanTarget): BleConnectedDevice | null {
  return latestConnectedDevices.get(getTargetKey(target)) ?? null;
}

/** Verifies that the remembered native BLE session is still connected. */
export async function getActiveConnectedSmartPetDevice(
  target: BleScanTarget,
): Promise<BleConnectedDevice | null> {
  const remembered = getLatestConnectedSmartPetDevice(target);
  if (!remembered) return null;
  if (remembered.mode === 'mock') return remembered;

  const targetKey = getTargetKey(target);
  const session = activeNativeSessions.get(targetKey);
  if (!nativeManager || !session) {
    forgetConnectedDevice(targetKey);
    return null;
  }

  const connected = await nativeManager.isDeviceConnected(remembered.id).catch(() => false);
  if (connected) return remembered;

  dropNativeSession(targetKey, 'unexpected');
  return null;
}

/** Actively probes idle GATT links so the UI does not depend only on delayed OS disconnect callbacks. */
export function verifyActiveSmartPetBleConnections(): Promise<void> {
  if (connectionHealthCheckPromise) return connectionHealthCheckPromise;
  if (
    pendingNativeSession ||
    cancelForegroundScan ||
    autoReconnectBatchPromise ||
    autoReconnectInFlight.size > 0
  ) return Promise.resolve();

  const promise = runConnectionHealthCheck();
  connectionHealthCheckPromise = promise;
  return promise.finally(() => {
    if (connectionHealthCheckPromise === promise) connectionHealthCheckPromise = null;
  });
}

async function runConnectionHealthCheck(): Promise<void> {
  const sessions = [...activeNativeSessions.entries()];
  for (const [targetKey, session] of sessions) {
    if (
      txListenerCoordinator.activePurpose(session.device.id) ||
      activeDataConsumers.has(session.device.id)
    ) {
      connectionHealthFailures.delete(targetKey);
      continue;
    }

    const connected = await withTimeout(session.manager.isDeviceConnected(session.device.id), 1_500).catch(() => false);
    if (activeNativeSessions.get(targetKey) !== session) continue;
    if (!connected) {
      connectionHealthFailures.delete(targetKey);
      if (activeNativeSessions.get(targetKey)?.device.id === session.device.id) {
        dropNativeSession(targetKey, 'unexpected');
      }
      continue;
    }

    const transactionId = `smartpet-health-${++connectionHealthTransactionSequence}`;
    try {
      const checkedDevice = await withTimeout(
        session.device.readRSSI(transactionId),
        1_500,
        '蓝牙连接状态检查超时',
      );
      if (activeNativeSessions.get(targetKey) !== session) continue;
      connectionHealthFailures.delete(targetKey);
      setBleConnectionStatus(targetKey, {
        state: 'connected',
        reconnectPhase: null,
        error: null,
        rssi: typeof checkedDevice.rssi === 'number' ? checkedDevice.rssi : null,
        lastCheckedAt: Date.now(),
      });
    } catch {
      await withTimeout(session.manager.cancelTransaction(transactionId), 1_500).catch(() => null);
      if (activeNativeSessions.get(targetKey) !== session) continue;
      const failures = (connectionHealthFailures.get(targetKey) ?? 0) + 1;
      connectionHealthFailures.set(targetKey, failures);
      if (failures < 2) continue;
      connectionHealthFailures.delete(targetKey);
      if (activeNativeSessions.get(targetKey)?.device.id === session.device.id) {
        // Clear the stale local session before reconnecting so Android cannot immediately
        // hand the same unresponsive GATT link back as an "already connected" device.
        dropNativeSession(targetKey, 'replace');
        await withTimeout(
          session.manager.cancelDeviceConnection(session.device.id),
          1_500,
          '清理失效蓝牙连接超时',
        ).catch(() => null);
        scheduleAutoReconnect(targetKey);
      }
    }
  }
}

export async function disconnectSmartPetDevice(
  deviceId?: string,
  target?: BleScanTarget,
): Promise<void> {
  let targetKey = target ? getTargetKey(target) : null;

  if (deviceId) {
    for (const [candidateKey, session] of activeNativeSessions) {
      if (session.device.id !== deviceId) continue;
      targetKey = candidateKey;
      break;
    }
  }

  if (targetKey) {
    manuallyDisconnectedTargets.add(targetKey);
    clearReconnectTimer(targetKey);
    readyAutoReconnectAttempts.delete(targetKey);
    autoReconnectAttempts.delete(targetKey);
    persistAutoReconnectIntents();
    dropNativeSession(targetKey, 'manual');
  }

  if (!nativeManager || !deviceId) return;

  const connected = await nativeManager.isDeviceConnected(deviceId).catch(() => false);
  if (connected) await nativeManager.cancelDeviceConnection(deviceId).catch(() => null);
}

/** Scans bound devices without connecting and returns the first pending-data advertisement. */
export async function scanForForegroundPendingDevice(
  targets: readonly BleScanTarget[],
  durationMs: number,
  onScanningChange?: (isScanning: boolean) => void,
): Promise<ForegroundPendingAdvertisement | null> {
  if (Platform.OS === 'web' || targets.length === 0 || dataTransferBusy()) return null;

  const cancellationVersion = foregroundScanCancellationVersion;
  foregroundScanRequestCount += 1;
  try {
    if (cancellationVersion !== foregroundScanCancellationVersion || pendingNativeSession) {
      return null;
    }

    await ensureBluetoothPermissions();
    const manager = getNativeManager();
    for (const [targetKey, session] of activeNativeSessions) {
      const connected = await manager
        .isDeviceConnected(session.device.id)
        .catch(() => false);
      if (connected) continue;
      dropNativeSession(targetKey, 'unexpected');
    }
    if (cancellationVersion !== foregroundScanCancellationVersion) return null;
    stopForegroundSmartPetScan(false);
    onScanningChange?.(true);

    return await new Promise((resolve, reject) => {
      let finished = false;
      let stateSubscription: Subscription | null = null;
      let leaveScan = () => {};
      const observedTargets = new Set<string>();
      const timer = setTimeout(() => finish(null), durationMs);

      const finish = (result: ForegroundPendingAdvertisement | null, error?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        leaveScan();
        stateSubscription?.remove();
        if (cancelForegroundScan === cancel) cancelForegroundScan = null;
        if (error) reject(error);
        else resolve(result);
      };
      const cancel = () => finish(null);
      cancelForegroundScan = cancel;

      stateSubscription = manager.onStateChange((state) => {
        if (state !== 'PoweredOn') return;
        stateSubscription?.remove();
        leaveScan = joinSharedScan(manager, (error, device) => {
          if (error) {
            finish(null, error);
            return;
          }
          if (!device) return;
          const match = matchForegroundAdvertisement(
            targets,
            device.id,
            device.serviceData,
          );
          if (!match) return;
          const targetKey = getTargetKey(match.target);
          if (!observedTargets.has(targetKey)) {
            observedTargets.add(targetKey);
            rememberAutoReconnectIntent(match.target, device.id);
            observeAdvertisement(match.target, match.advertisement);
          }
          if (match.advertisement.dataPending && canAutomaticallyConnectSmartPet(match.target)) finish(match);
        });
      }, true);
    });
  } finally {
    onScanningChange?.(false);
    foregroundScanRequestCount = Math.max(0, foregroundScanRequestCount - 1);
    if (foregroundScanRequestCount === 0 && readyAutoReconnectAttempts.size > 0) {
      startAutoReconnectBatch();
    }
  }
}

export function stopForegroundSmartPetScan(cancelWaitingRequest = true): void {
  if (cancelWaitingRequest) foregroundScanCancellationVersion += 1;
  cancelForegroundScan?.();
}

export async function sendTrainerBleCommand(
  target: BleScanTarget,
  kind: TrainerCommand,
  enabled: boolean,
  intensity?: number,
  onPhase?: (phase: TrainerCommandPhase) => void,
): Promise<BleTrainerCommandResult> {
  const version = bleSessionVersion;
  if (Platform.OS === 'web') return mockTrainerCommand(target, kind, enabled, intensity);

  manuallyDisconnectedTargets.delete(getTargetKey(target));

  let native: NativeSession | null = null;
  let preparationError: unknown = null;
  onPhase?.('checking_connection');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (version !== bleSessionVersion) throw new Error('账号已变更，控制已取消');
    if (attempt > 0) {
      onPhase?.('reconnecting');
      await disconnectNativeSessionByTargetKey(getTargetKey(target));
    }
    try {
      native = await createNativeSession(target, {
        scanTimeoutMs:
          attempt === 0 ? TRAINER_COMMAND_INITIAL_SCAN_MS : TRAINER_COMMAND_RETRY_SCAN_MS,
        connectTimeoutMs: TRAINER_COMMAND_CONNECT_TIMEOUT_MS,
        onPhase,
      });
      if (!native) return mockTrainerCommand(target, kind, enabled, intensity);

      onPhase?.('discovering');
      await withTimeout(
        native.device.discoverAllServicesAndCharacteristics(),
        TRAINER_COMMAND_DISCOVERY_TIMEOUT_MS,
        '准备设备控制服务超时',
      );
      await withTimeout(assertRemoteControlGattAvailable(native.device), 5_000, '检查控制服务超时');
      if (version !== bleSessionVersion) throw new Error('账号已变更，控制已取消');
      preparationError = null;
      break;
    } catch (error) {
      if (version !== bleSessionVersion) throw error;
      preparationError = error;
      native = null;
    }
  }

  if (!native) {
    await disconnectNativeSessionByTargetKey(getTargetKey(target));
    throw trainerPreparationError(preparationError);
  }

  const activePurpose = activeDataConsumers.has(native.device.id)
    ? '设备数据接收'
    : txListenerCoordinator.activePurpose(native.device.id);
  if (activePurpose) {
    throw new Error(
      activePurpose === '设备数据接收'
        ? '正在接收设备数据，请稍后再发送控制指令'
        : `设备正在进行${activePurpose}，请稍后再试`,
    );
  }

  onPhase?.('sending');
  const response = await writeTrainerCommandAndWaitForResponse(
    native.device,
    kind,
    enabled,
    intensity,
    onPhase,
  );
  return { ...response, device: connectedResult(native, target) };
}

export async function sendBarkSettingsBleCommand(
  target: BleScanTarget,
  settings: { sensitivity: number; dogSize: 'small' | 'medium' | 'large' },
): Promise<BleConnectedDevice> {
  const version = bleSessionVersion;
  manuallyDisconnectedTargets.delete(getTargetKey(target));
  const native = await createNativeSession(target);
  if (!native) return mockConnect(target);

  if (version !== bleSessionVersion) throw new Error('账号已变更，控制已取消');
  await withTimeout(native.device.writeCharacteristicWithResponseForService(
    BLE_UUIDS.legacyControlService,
    BLE_UUIDS.legacyControl,
    encodeBarkSensitivity(settings.sensitivity),
  ), 3_000, '写入设置超时');
  if (version !== bleSessionVersion) throw new Error('账号已变更，控制已取消');
  await withTimeout(native.device.writeCharacteristicWithResponseForService(
    BLE_UUIDS.legacyControlService,
    BLE_UUIDS.legacyControl,
    encodeDogSize(settings.dogSize),
  ), 3_000, '写入设置超时');
  return connectedResult(native, target);
}

export async function syncPendingBleData(
  target: BleScanTarget,
  onProgress: (progress: DataSyncProgress) => void,
): Promise<DataSyncResult> {
  const version = bleSessionVersion;
  const ownerId = getBleQueueOwner();
  const assertCurrent = () => {
    if (version !== bleSessionVersion) throw new Error('账号已变更，数据接收已取消');
  };
  if (!canAutomaticallyConnectSmartPet(target)) throw new Error('蓝牙未连接，请手动连接蓝牙');
  if (dataTransferBusy() && !activeNativeSessions.has(getTargetKey(target))) {
    throw new Error('等待其他设备数据传输完成后再连接');
  }
  const native = await createNativeSession(target);
  assertCurrent();
  if (!native) return mockSync(onProgress);

  activeTransfers.add(native.device.id);
  cancelAutoReconnectScan?.();
  stopForegroundSmartPetScan();
  try {
  const transferMode = await withTimeout(assertDataTransferGattAvailable(native.device), 5_000, '检查数据服务超时');
  assertCurrent();
  if (transferMode === 'notify') await withTimeout(ensurePersistentDataTxListener(native), 5_000, '订阅数据服务超时');
  assertCurrent();
  const advertisement = native.advertisement;
  const diagnostics = createBleTransferDiagnostics({
    deviceSn: target.deviceSn,
    deviceId: native.device.id,
    mtu: native.device.mtu,
    rssi: native.device.rssi,
  });
  diagnostics.record('transfer_mode_ready', {
    mode: transferMode,
    advertisedPending: advertisement?.dataPending ?? null,
  });

  const assembler = new BleBlockAssembler();
  const blocks: BleReceivedBlock[] = [];
  const storedBlocks: StoredBleBlock[] = [];
  const declaredBlockLengths = new Map<number, number>();
  const frameCounts = new Map<number, number>();
  const frameSummaries: BleFrameTransferSummary[] = [];
  let completedBytes = 0;
  let lastBlockId = 0;
  let requestedRecovery: { blockId: number; resendOffset: number } | null = null;

  onProgress(
    progress(
      'status',
      0,
      0,
      0,
      0,
      0,
      advertisement && !advertisement.dataPending
        ? '广播标记为无数据，仍继续检查设备 TX 数据'
        : transferMode === 'notify'
          ? '已连接并订阅 TX Notify，等待设备主动上传'
          : '设备未启用 Notify，使用兼容 Read 模式接收',
    ),
  );

  const pullStartedAt = Date.now();

  const consumeFrame = async (
    frame: BleDataFrame,
    acknowledge?: BlockAcknowledgementSender,
  ) => {
    assertCurrent();
    if (requestedRecovery?.blockId === frame.blockId) requestedRecovery = null;
    if (!declaredBlockLengths.has(frame.blockId)) {
      declaredBlockLengths.set(frame.blockId, frame.totalLength);
    }
    frameCounts.set(frame.blockId, (frameCounts.get(frame.blockId) ?? 0) + 1);
    frameSummaries.push({
      frameNumber: frameSummaries.length + 1,
      blockId: frame.blockId,
      totalBytes: frame.totalLength,
      offset: frame.offset,
      dataLength: frame.dataLength,
      headerHex: frame.headerHex,
      tailHex: frame.tailHex,
    });
    lastBlockId = frame.blockId;

    const block = assembler.append(frame);
    if (block) {
      const stored = await persistBleBlock(target.deviceSn, block, 'device', ownerId);
      assertCurrent();
      if (!stored) throw new Error('当前平台无法安全保存设备数据块');
      storedBlocks.push(stored);
      blocks.push(block);
      completedBytes += block.totalLength;
      diagnostics.record('block_persisted', {
        blockId: block.blockId,
        type: block.type,
        totalLength: block.totalLength,
        frameCount: frameCounts.get(block.blockId) ?? 0,
      });
      if (transferMode === 'notify' && acknowledge) {
        await acknowledge('ok', block.blockId, 0);
      }
    }

    const receivedBytes = completedBytes + assembler.pendingReceivedBytes;
    const declaredBytes = sum(declaredBlockLengths.values());
    onProgress(
      progress(
        'reading',
        declaredBytes,
        declaredBlockLengths.size,
        frame.blockId,
        blocks.length,
        receivedBytes,
        frame.type === 'meta'
          ? `已收到数据块 ${frame.blockId} 信息，开始校验并接收内容`
          : `正在接收数据块 ${frame.blockId}，偏移 ${frame.offset + frame.dataLength}/${frame.totalLength}`,
        frameSummaries.length,
      ),
    );
  };

  const consumeTxValue = async (
    value: string,
    acknowledge: BlockAcknowledgementSender,
  ) => {
    try {
      const txValue = parseBleTxValue(value);
      if (txValue.kind === 'empty' || txValue.kind === 'acknowledgement') return;
      await consumeFrame(txValue.frame, acknowledge);
    } catch (error) {
      if (error instanceof BleFrameError && error.blockId !== undefined) {
        diagnostics.record('frame_recovery_requested', {
          blockId: error.blockId,
          resendOffset: error.resendOffset ?? 0,
          reason: error.code,
          message: error.message,
        });
        requestedRecovery = { blockId: error.blockId, resendOffset: error.resendOffset ?? 0 };
        await acknowledge('nack', requestedRecovery.blockId, requestedRecovery.resendOffset);
        onProgress(
          progress(
            'paused',
            sum(declaredBlockLengths.values()),
            declaredBlockLengths.size,
            error.blockId,
            blocks.length,
            completedBytes + assembler.pendingReceivedBytes,
            `数据块 ${error.blockId} 校验失败，已请求从偏移 ${error.resendOffset ?? 0} 重传`,
          ),
        );
        return;
      }
      if (error instanceof BleFrameError) throw createFrameDiagnosticError(error, value);
      throw error;
    }
  };

  try {
    if (transferMode === 'notify') {
      await receiveNotifiedTxValues(
        native.device,
        consumeTxValue,
        async (acknowledge) => {
          const retry = assembler.pendingResendRequest ?? requestedRecovery;
          if (!retry) return false;
          requestedRecovery = retry;
          diagnostics.record('idle_recovery_requested', retry);
          await acknowledge('nack', retry.blockId, retry.resendOffset);
          onProgress(
            progress(
              'paused',
              sum(declaredBlockLengths.values()),
              declaredBlockLengths.size,
              retry.blockId,
              blocks.length,
              completedBytes + assembler.pendingReceivedBytes,
              `数据块 ${retry.blockId} 接收中断，已请求从偏移 ${retry.resendOffset} 重传`,
            ),
          );
          return true;
        },
        (type, details) => diagnostics.record(type, details),
      );
    } else {
      while (true) {
        assertCurrent();
        const frame = await readFrameWithRetry(native.device);
        if (!frame) break;
        await consumeFrame(frame);
      }
    }
  } catch (error) {
    diagnostics.record('transfer_failed', {
      message: error instanceof Error ? error.message : '未知错误',
      currentBlock: lastBlockId,
      receivedBytes: completedBytes + assembler.pendingReceivedBytes,
    });
    await diagnostics.flush();
    throw error;
  }

  if (assembler.pendingBlockCount > 0) {
    diagnostics.record('transfer_incomplete', {
      pendingBlockCount: assembler.pendingBlockCount,
      receivedBytes: completedBytes + assembler.pendingReceivedBytes,
    });
    await diagnostics.flush();
    throw new Error('设备传输已停止，但仍有未完整的数据块');
  }

  assertCurrent();

    const pullDurationMs = Date.now() - pullStartedAt;
    const receivedBytes = completedBytes;
    const blockSummaries = blocks.map((block) => ({
      blockId: block.blockId,
      totalBytes: block.totalLength,
      frameCount: frameCounts.get(block.blockId) ?? 0,
    }));

    if (blocks.length === 0) {
      diagnostics.record('transfer_empty');
      await diagnostics.flush();
      onProgress(progress('empty', 0, 0, 0, 0, 0, '设备没有待接收数据', frameSummaries.length));
      return {
        completed: true,
        receivedBytes: 0,
        lastBlockId: 0,
        blocks: [],
        storedBlocks: [],
        blockSummaries: [],
        frameSummaries: [],
        pullDurationMs,
        advertisement: updateSessionPending(native, false),
      };
    }

    onProgress(
      progress(
        'complete',
        receivedBytes,
        blocks.length,
        lastBlockId,
        blocks.length,
        receivedBytes,
        `蓝牙数据接收完成并已保存，共 ${blocks.length} 个数据块`,
        frameSummaries.length,
      ),
    );
    diagnostics.record('transfer_completed', {
      blockCount: blocks.length,
      receivedBytes,
      frameCount: frameSummaries.length,
      durationMs: pullDurationMs,
    });
    await diagnostics.flush();
    return {
      completed: true,
      receivedBytes,
      lastBlockId,
      blocks,
      storedBlocks,
      blockSummaries,
      frameSummaries,
      pullDurationMs,
      advertisement: updateSessionPending(native, false),
    };
  } finally {
    activeTransfers.delete(native.device.id);
    startAutoReconnectBatch();
  }
}

async function createNativeSession(
  target: BleScanTarget,
  options: NativeSessionOptions = {},
): Promise<NativeSession | null> {
  const version = bleSessionVersion;
  if (Platform.OS === 'web') return null;

  await ensureBluetoothPermissions();
  if (version !== bleSessionVersion) throw new Error('账号已变更，连接已取消');
  const manager = getNativeManager();
  const targetKey = getTargetKey(target);
  const resolvedOptions: NativeSessionOptions = {
    ...options,
    knownDeviceId: options.knownDeviceId ?? autoReconnectIntents.get(targetKey)?.deviceId,
  };

  if (resolvedOptions.automaticReconnect && manuallyDisconnectedTargets.has(targetKey)) {
    throw new Error('自动重连已由用户停止');
  }

  const reusable = await getReusableNativeSession(manager, targetKey);
  if (version !== bleSessionVersion) throw new Error('账号已变更，连接已取消');
  if (reusable) return reusable;
  if (manuallyDisconnectedTargets.has(targetKey)) throw new Error('蓝牙未连接，请手动连接蓝牙');

  if (autoReconnectBatchPromise) {
    await autoReconnectBatchPromise.catch(() => undefined);
    if (version !== bleSessionVersion) throw new Error('账号已变更，连接已取消');
    return createNativeSession(target, resolvedOptions);
  }

  if (pendingNativeSession) {
    if (pendingNativeSession.targetKey === targetKey) {
      options.onPhase?.('connecting');
      return pendingNativeSession.promise;
    }
    await pendingNativeSession.promise.catch(() => null);
    if (version !== bleSessionVersion) throw new Error('账号已变更，连接已取消');
    return createNativeSession(target, resolvedOptions);
  }
  const promise = openNativeSession(manager, target, targetKey, resolvedOptions);
  pendingNativeSession = { targetKey, promise };
  try {
    return await promise;
  } finally {
    if (pendingNativeSession?.promise === promise) pendingNativeSession = null;
  }
}

async function openNativeSession(
  manager: BleManager,
  target: BleScanTarget,
  targetKey: string,
  options: NativeSessionOptions,
): Promise<NativeSession> {
  const version = bleSessionVersion;
  const assertCurrent = () => {
    if (version !== bleSessionVersion) throw new Error('账号已变更，连接已取消');
  };
  let connected: BlePlxDevice | null = null;
  let advertisement: SmartPetAdvertisement | null = null;
  try {
  if (options.knownDeviceId) {
    options.onPhase?.('connecting');
    setBleConnectionStatus(targetKey, {
      state: options.automaticReconnect ? 'reconnecting' : 'connecting',
      reconnectPhase: options.automaticReconnect ? 'connecting' : null,
      error: null,
    });
    connected = await connectKnownDevice(
      manager,
      options.knownDeviceId,
      Math.min(
        options.connectTimeoutMs ?? BLE_TRANSFER.connectTimeoutMs,
        AUTO_RECONNECT_DIRECT_CONNECT_TIMEOUT_MS,
      ),
    ).catch(() => null);
    assertCurrent();
  }

  if (!connected) {
    options.onPhase?.('scanning');
    setBleConnectionStatus(targetKey, {
      state: options.automaticReconnect ? 'reconnecting' : 'scanning',
      reconnectPhase: options.automaticReconnect ? 'scanning' : null,
      error: null,
    });
    const device = await scanForDevice(
      manager,
      target,
      options.scanTimeoutMs ?? BLE_TRANSFER.scanTimeoutMs,
    );
    if (!device) throw new Error('未扫描到与绑定信息匹配的蓝牙设备');
    assertCurrent();
    advertisement = parseServiceDataAdvertisement(device.serviceData);
    rememberAutoReconnectIntent(target, device.id);
    options.onPhase?.('connecting');
    setBleConnectionStatus(targetKey, {
      state: options.automaticReconnect ? 'reconnecting' : 'connecting',
      reconnectPhase: options.automaticReconnect ? 'connecting' : null,
      error: null,
    });
    connected = await connectKnownDevice(manager, device.id,
      options.connectTimeoutMs ?? BLE_TRANSFER.connectTimeoutMs);
  }

  if (options.automaticReconnect && manuallyDisconnectedTargets.has(targetKey)) {
    await manager.cancelDeviceConnection(connected.id).catch(() => null);
    throw new Error('自动重连已由用户停止');
  }

  const connectedDevice = connected;
  assertCurrent();

  if (Platform.OS === 'android') {
    connected = await withTimeout(manager
      .requestMTUForDevice(connectedDevice.id, BLE_TRANSFER.targetMtuAndroid), 3_000, '协商蓝牙 MTU 超时')
      .catch(() => connectedDevice);
  }
  const readyDevice = connected;
  await withTimeout(readyDevice.discoverAllServicesAndCharacteristics(), 5_000, '发现蓝牙服务超时');
  assertCurrent();
  return registerNativeSession(manager, target, targetKey, readyDevice, advertisement);
  } catch (cause) {
    if (connected) await withTimeout(manager.cancelDeviceConnection(connected.id), 1_500, '清理连接超时').catch(() => null);
    throw cause;
  }
}

async function connectKnownDevice(
  manager: BleManager,
  deviceId: string,
  timeoutMs: number,
): Promise<BlePlxDevice> {
  const alreadyConnected = await withTimeout(manager.isDeviceConnected(deviceId), 1_500).catch(() => false);
  if (alreadyConnected) {
    const [known] = await withTimeout(manager.devices([deviceId]), 1_500);
    if (known) return known;
  }
  let expired = false;
  const version = bleSessionVersion;
  const token = Symbol(deviceId);
  connectionAttemptTokens.set(deviceId, token);
  const cancelOwnAttempt = async () => {
    if (connectionAttemptTokens.get(deviceId) !== token) return;
    await withTimeout(manager.cancelDeviceConnection(deviceId), 1_500).catch(() => null);
  };
  const operation = manager.connectToDevice(deviceId, { timeout: timeoutMs }).then(async (device) => {
    if (expired || version !== bleSessionVersion) {
      await cancelOwnAttempt();
      throw new Error('连接任务已过期');
    }
    return device;
  });
  try {
    return await withTimeout(operation, timeoutMs, '建立蓝牙连接超时');
  } catch (cause) {
    expired = true;
    await cancelOwnAttempt();
    throw cause;
  }
}

async function adoptCurrentlyConnectedSessions(): Promise<void> {
  const version = bleSessionVersion;
  if (Platform.OS === 'web' || autoReconnectTargets.size === 0 || dataTransferBusy()) return;
  await ensureBluetoothPermissions();
  const manager = getNativeManager();
  const connectedDevices = await withTimeout(manager.connectedDevices([
    BLE_UUIDS.dataService,
    BLE_UUIDS.legacyControlService,
  ]), 3_000);
  for (const device of connectedDevices) {
    if (version !== bleSessionVersion) return;
    const target = [...autoReconnectTargets.values()].find((candidate) =>
      matchesTarget(device, candidate),
    );
    if (!target) continue;
    const targetKey = getTargetKey(target);
    if (activeNativeSessions.has(targetKey) || manuallyDisconnectedTargets.has(targetKey)) continue;
    const connected = await manager.isDeviceConnected(device.id).catch(() => false);
    if (!connected) continue;
    await withTimeout(device.discoverAllServicesAndCharacteristics(), 5_000, '发现蓝牙服务超时');
    if (version !== bleSessionVersion) return;
    registerNativeSession(manager, target, targetKey, device, null);
  }
}

function registerNativeSession(
  manager: BleManager,
  target: BleScanTarget,
  targetKey: string,
  device: BlePlxDevice,
  advertisement: SmartPetAdvertisement | null,
): NativeSession {
  const disconnectSubscription = manager.onDeviceDisconnected(device.id, () => {
    if (activeNativeSessions.get(targetKey)?.device.id !== device.id) return;
    dropNativeSession(targetKey, 'unexpected');
  });
  const observed = advertisement
    ? rememberAdvertisement(targetKey, advertisement)
    : cachedAdvertisements.get(targetKey) ?? null;
  const session = {
    manager,
    device,
    targetKey,
    advertisement: observed?.advertisement ?? null,
    advertisementSource: advertisement ? 'current' as const : observed ? 'cached' as const : null,
    advertisementObservedAt: observed?.observedAt ?? null,
    disconnectSubscription,
  };
  activeNativeSessions.set(targetKey, session);
  rememberConnectedDevice(targetKey, connectedResult(session, target));
  rememberAutoReconnectIntent(target, device.id);
  autoReconnectAttempts.delete(targetKey);
  connectionHealthFailures.delete(targetKey);
  clearReconnectTimer(targetKey);
  setBleConnectionStatus(targetKey, {
    state: 'connected',
    reconnectPhase: null,
    attempt: 0,
    nextRetryAt: null,
    error: null,
    rssi: typeof device.rssi === 'number' ? device.rssi : null,
    lastCheckedAt: typeof device.rssi === 'number' ? Date.now() : null,
  });
  void ensurePersistentDataTxListener(session).catch((cause) => {
    console.warn(
      `[SmartPet BLE] ${target.deviceSn} 建立持续 TX Notify 监听失败：`,
      cause instanceof Error ? cause.message : cause,
    );
  });
  return session;
}

async function ensurePersistentDataTxListener(session: NativeSession): Promise<void> {
  const existing = persistentDataTxListeners.get(session.device.id);
  if (existing) return;

  const transferMode = await withTimeout(assertDataTransferGattAvailable(session.device), 5_000, '检查数据服务超时');
  if (transferMode !== 'notify') return;
  if (activeNativeSessions.get(session.targetKey) !== session) return;
  if (persistentDataTxListeners.has(session.device.id)) return;

  const listener: PersistentDataTxListener = {
    deviceId: session.device.id,
    subscription: null,
    queuedValues: [],
    consumer: null,
    consumerError: null,
  };
  persistentDataTxListeners.set(session.device.id, listener);
  listener.subscription = session.device.monitorCharacteristicForService(
    BLE_UUIDS.dataService,
    BLE_UUIDS.dataTx,
    (error, characteristic) => {
      if (persistentDataTxListeners.get(session.device.id) !== listener) return;
      if (error) {
        listener.consumerError?.(new Error(`接收设备 TX Notify 失败：${error.message}`));
        removePersistentDataTxListener(session.device.id);
        return;
      }
      const value = characteristic?.value;
      if (!value || !isDeviceDataTxValue(value)) return;
      if (listener.consumer) {
        listener.consumer(value);
        return;
      }
      const wasEmpty = listener.queuedValues.length === 0;
      listener.queuedValues.push(value);
      cancelAutoReconnectScan?.();
      stopForegroundSmartPetScan();
      if (wasEmpty) bleConnectionEvents.changed();
    },
  );
}

function isDeviceDataTxValue(value: string): boolean {
  try {
    const parsed = parseBleTxValue(value);
    return parsed.kind === 'frame' || parsed.kind === 'acknowledgement';
  } catch {
    return false;
  }
}

function removePersistentDataTxListener(deviceId: string): void {
  const listener = persistentDataTxListeners.get(deviceId);
  if (!listener) return;
  persistentDataTxListeners.delete(deviceId);
  listener.consumerError?.(new Error('蓝牙连接已结束，接收已取消'));
  activeDataConsumers.delete(deviceId);
  listener.subscription?.remove();
  startAutoReconnectBatch();
}

function consumePersistentDataTxValues(
  deviceId: string,
  onValue: (value: string) => void,
  onError: (error: Error) => void,
): () => void {
  const listener = persistentDataTxListeners.get(deviceId);
  if (!listener) throw new Error('设备尚未建立持续 TX Notify 监听');
  if (listener.consumer) throw new Error('设备 TX Notify 已有数据接收任务');

  listener.consumer = onValue;
  listener.consumerError = onError;
  activeDataConsumers.add(deviceId);
  cancelAutoReconnectScan?.();
  stopForegroundSmartPetScan();
  const queued = listener.queuedValues.splice(0, listener.queuedValues.length);
  if (queued.length > 0) bleConnectionEvents.changed();
  for (const value of queued) queueMicrotask(() => onValue(value));

  return () => {
    if (listener.consumer !== onValue) return;
    listener.consumer = null;
    listener.consumerError = null;
    activeDataConsumers.delete(deviceId);
    startAutoReconnectBatch();
  };
}

async function getReusableNativeSession(manager: BleManager, targetKey: string): Promise<NativeSession | null> {
  const session = activeNativeSessions.get(targetKey);
  if (!session) return null;

  const connected = await withTimeout(manager.isDeviceConnected(session.device.id), 1_500).catch(() => false);
  if (connected) return session;

  dropNativeSession(targetKey, 'unexpected');
  return null;
}

async function disconnectNativeSessionByTargetKey(targetKey: string): Promise<void> {
  const session = activeNativeSessions.get(targetKey);
  if (!session) {
    forgetConnectedDevice(targetKey);
    return;
  }
  dropNativeSession(targetKey, 'replace');
  const connected = await session.manager.isDeviceConnected(session.device.id).catch(() => false);
  if (connected) await session.manager.cancelDeviceConnection(session.device.id).catch(() => null);
}

function getNativeManager(): BleManager {
  if (!nativeManager) nativeManager = new BleManager();
  return nativeManager;
}

async function ensureBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(permissions);
  const denied = permissions.some((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied) throw new Error('未授予蓝牙权限，无法连接设备');
}

function scanForDevice(
  manager: BleManager,
  target: BleScanTarget,
  timeoutMs: number = BLE_TRANSFER.scanTimeoutMs,
): Promise<BlePlxDevice | null> {
  return new Promise((resolve, reject) => {
    let done = false;
    let subscription: Subscription | null = null;
    let leaveScan = () => {};
    let latestCandidate: BlePlxDevice | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => finish(latestCandidate), timeoutMs);

    const finish = (device: BlePlxDevice | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (settleTimer) clearTimeout(settleTimer);
      leaveScan();
      subscription?.remove();
      resolve(device);
    };

    subscription = manager.onStateChange((state) => {
      if (state !== 'PoweredOn') return;
      subscription?.remove();
      leaveScan = joinSharedScan(manager, (error, device) => {
        if (error) {
          clearTimeout(timer);
          leaveScan();
          reject(error);
          return;
        }
        if (device && matchesTarget(device, target)) {
          latestCandidate = device;
          settleTimer ??= setTimeout(
            () => finish(latestCandidate),
            BLE_TRANSFER.advertisementSettleMs,
          );
        }
      });
    }, true);
  });
}

function scanForReconnectDevices(
  manager: BleManager,
  intents: ReadonlyMap<string, AutoReconnectIntent>,
  timeoutMs: number,
  waitForValidAdvertisements = false,
): Promise<Map<string, BlePlxDevice>> {
  return new Promise((resolve, reject) => {
    const found = new Map<string, BlePlxDevice>();
    let done = false;
    let subscription: Subscription | null = null;
    let leaveScan = () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      leaveScan();
      subscription?.remove();
      if (cancelAutoReconnectScan === cancel) cancelAutoReconnectScan = null;
      resolve(found);
    };
    const cancel = () => finish();
    cancelAutoReconnectScan = cancel;

    timer = setTimeout(finish, timeoutMs);
    subscription = manager.onStateChange((state) => {
      if (state !== 'PoweredOn') return;
      subscription?.remove();
      leaveScan = joinSharedScan(manager, (error, device) => {
        if (error) {
          if (timer) clearTimeout(timer);
          leaveScan();
          if (cancelAutoReconnectScan === cancel) cancelAutoReconnectScan = null;
          reject(error);
          return;
        }
        if (!device) return;

        for (const [targetKey, intent] of intents) {
          if (!matchesTarget(device, intent.target)) continue;
          found.set(targetKey, device);
          // 保存完整 MAC 不必等待 GATT 连接成功；下一轮可直接快速连接。
          rememberAutoReconnectIntent(intent.target, device.id);
          const advertisement = parseServiceDataAdvertisement(device.serviceData);
          if (advertisement) observeAdvertisement(intent.target, advertisement);
          break;
        }
        const allAdvertisementsValid = [...intents.keys()].every((targetKey) =>
          cachedAdvertisements.has(targetKey),
        );
        if (found.size === intents.size && (!waitForValidAdvertisements || allAdvertisementsValid)) {
          finish();
        }
      });
    }, true);
  });
}

function matchesTarget(device: BlePlxDevice, target: BleScanTarget): boolean {
  const advertisement = parseServiceDataAdvertisement(device.serviceData);
  return matchesBindingCodeAdvertisement(target.deviceSn, advertisement?.serialNumber);
}

async function assertDataTransferGattAvailable(device: BlePlxDevice): Promise<'notify' | 'read'> {
  const services = await device.services().catch(() => []);
  const normalizedServices = services.map((service) => normalizeUuid(service.uuid));
  const dataServiceUuid = normalizeUuid(BLE_UUIDS.dataService);
  const dataRxUuid = normalizeUuid(BLE_UUIDS.dataRx);
  const dataTxUuid = normalizeUuid(BLE_UUIDS.dataTx);

  if (!normalizedServices.includes(dataServiceUuid)) {
    const discovered = normalizedServices.length > 0 ? normalizedServices.join(', ') : '未发现任何服务';
    throw new Error(
      `设备未暴露数据传输服务 0x0101，无法接收缓存数据。当前发现的服务：${discovered}。请确认固件已启用 BLE 数据传输服务，或让硬件工程师确认数据服务 UUID 是否已变更。`,
    );
  }

  const characteristics = await device.characteristicsForService(BLE_UUIDS.dataService).catch(() => []);
  const normalizedCharacteristics = characteristics.map((characteristic) => normalizeUuid(characteristic.uuid));
  const rx = characteristics.find((characteristic) => normalizeUuid(characteristic.uuid) === dataRxUuid);
  const tx = characteristics.find((characteristic) => normalizeUuid(characteristic.uuid) === dataTxUuid);
  if (!rx || !tx) {
    const discovered = normalizedCharacteristics.length > 0 ? normalizedCharacteristics.join(', ') : '未发现任何特征';
    throw new Error(
      `设备数据服务 0x0101 中未发现 TX 特征 0x0103，无法读取数据帧。当前特征：${discovered}。请确认固件数据传输特征 UUID。`,
    );
  }
  if (tx.isNotifiable || tx.isIndicatable) return 'notify';
  if (tx.isReadable) return 'read';
  throw new Error('设备 TX 特征 0x0103 未启用 Notify 或 Read，无法接收数据');
}

async function assertRemoteControlGattAvailable(device: BlePlxDevice): Promise<void> {
  const characteristics = await device.characteristicsForService(BLE_UUIDS.dataService).catch(() => []);
  const rx = characteristics.find(
    (characteristic) => normalizeUuid(characteristic.uuid) === normalizeUuid(BLE_UUIDS.dataRx),
  );
  const tx = characteristics.find(
    (characteristic) => normalizeUuid(characteristic.uuid) === normalizeUuid(BLE_UUIDS.dataTx),
  );

  if (!rx || !tx) {
    throw new Error('设备未提供遥控协议需要的 0x0102/0x0103 特征值');
  }
  if (!tx.isNotifiable && !tx.isIndicatable) {
    throw new Error('设备 0x0103 未启用 Notify/Indicate，App 无法接收遥控响应');
  }
}

function writeTrainerCommandAndWaitForResponse(
  device: BlePlxDevice,
  kind: TrainerCommand,
  enabled: boolean,
  intensity?: number,
  onPhase?: (phase: TrainerCommandPhase) => void,
): Promise<TrainerCommandResponse> {
  const releaseTxListener = txListenerCoordinator.acquire(device.id, '设备控制');
  return new Promise((resolve, reject) => {
    const signal = bleAccountController.signal;
    const onAbort = () => finish(new Error('账号已变更，控制已取消'));
    let settled = false;
    let subscription: Subscription | null = null;
    const timer = setTimeout(
      () => finish(new Error('设备已连接，但没有确认控制指令')),
      TRAINER_COMMAND_RESPONSE_TIMEOUT_MS,
    );

    const finish = (error: Error | null, response?: TrainerCommandResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      subscription?.remove();
      releaseTxListener();
      if (error) reject(error);
      else if (response) resolve(response);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    subscription = device.monitorCharacteristicForService(
      BLE_UUIDS.dataService,
      BLE_UUIDS.dataTx,
      (error, characteristic) => {
        if (error) {
          finish(new Error(`订阅遥控响应失败：${error.message}`));
          return;
        }
        if (!characteristic?.value) return;

        let response: TrainerCommandResponse;
        try {
          response = parseTrainerCommandResponse(characteristic.value);
        } catch (parseError) {
          const message = parseError instanceof Error ? parseError.message : '遥控响应格式错误';
          if (message.includes('长度应为 4 字节')) return; // Ignore unrelated data-transfer notifications.
          finish(new Error(message));
          return;
        }

        if (response.ok && (response.command !== kind || response.enabled !== enabled)) return;
        finish(null, response);
      },
    );

    void device
      .writeCharacteristicWithResponseForService(
        BLE_UUIDS.dataService,
        BLE_UUIDS.dataRx,
        encodeTrainerCommand(kind, enabled, intensity),
      )
      .then(() => onPhase?.('waiting_response'))
      .catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error('遥控命令写入失败'));
      });
  });
}

async function writeBlockAcknowledgement(
  device: BlePlxDevice,
  status: 'ok' | 'nack',
  blockId: number,
  resendOffset: number,
): Promise<void> {
  await device.writeCharacteristicWithResponseForService(
    BLE_UUIDS.dataService,
    BLE_UUIDS.dataRx,
    encodeBlockAcknowledgement(status, blockId, resendOffset),
  );
}

type BlockAcknowledgementSender = (
  status: 'ok' | 'nack',
  blockId: number,
  resendOffset: number,
) => Promise<void>;

function receiveNotifiedTxValues(
  device: BlePlxDevice,
  onValue: (value: string, acknowledge: BlockAcknowledgementSender) => Promise<void>,
  onIdle: (acknowledge: BlockAcknowledgementSender) => Promise<boolean>,
  onDiagnostic: (
    type: string,
    details?: Record<string, string | number | boolean | null>,
  ) => void = () => undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sawValue = false;
    let waitingForRetransmission = false;
    const recoveryTracker = new BleRecoveryTracker(BLE_TRANSFER.maxRecoveryAttempts);
    let stopConsuming: (() => void) | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let queue = Promise.resolve();
    let pendingAcknowledgement: {
      status: 'ok' | 'nack';
      blockId: number;
      resendOffset: number;
      timer: ReturnType<typeof setTimeout>;
      resolve: () => void;
      reject: (error: Error) => void;
    } | null = null;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (pendingAcknowledgement) {
        const pending = pendingAcknowledgement;
        pendingAcknowledgement = null;
        clearTimeout(pending.timer);
        pending.reject(error ?? new Error('BLE 通知监听已结束，未收到块确认回显'));
      }
      stopConsuming?.();
      if (error) reject(error);
      else resolve();
    };

    const acknowledge: BlockAcknowledgementSender = async (status, blockId, resendOffset) => {
      if (settled) throw new Error('数据接收已取消，禁止发送确认');
      if (pendingAcknowledgement) throw new Error('上一条 BLE 块确认仍在等待设备回显');
      if (status === 'nack') {
        const attempt = recoveryTracker.register(blockId, resendOffset);
        onDiagnostic('nack_sent', { blockId, resendOffset, attempt });
        if (attempt > BLE_TRANSFER.maxRecoveryAttempts) {
          throw new Error(
            `数据块 ${blockId} 从偏移 ${resendOffset} 重传 ${BLE_TRANSFER.maxRecoveryAttempts} 次仍未完成`,
          );
        }
      } else {
        recoveryTracker.clearBlock(blockId);
        onDiagnostic('block_ok_sent', { blockId });
      }
      waitingForRetransmission = status === 'nack';

      await new Promise<void>((resolveAcknowledgement, rejectAcknowledgement) => {
        const timer = setTimeout(() => {
          if (!pendingAcknowledgement) return;
          pendingAcknowledgement = null;
          rejectAcknowledgement(new Error(`等待数据块 ${blockId} 的 ${status.toUpperCase()} 回显超时`));
        }, BLE_TRANSFER.acknowledgementTimeoutMs);

        pendingAcknowledgement = {
          status,
          blockId,
          resendOffset,
          timer,
          resolve: resolveAcknowledgement,
          reject: rejectAcknowledgement,
        };

        void writeBlockAcknowledgement(device, status, blockId, resendOffset).catch((error: unknown) => {
          if (!pendingAcknowledgement) return;
          pendingAcknowledgement = null;
          clearTimeout(timer);
          rejectAcknowledgement(asError(error));
        });
      });
    };

    const scheduleIdleFinish = () => {
      if (settled) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => {
          void queue.then(
            async () => {
              const shouldContinue = await onIdle(acknowledge);
              if (shouldContinue) scheduleIdleFinish();
              else finish();
            },
            (error: unknown) => finish(asError(error)),
          ).catch((error: unknown) => finish(asError(error)));
        },
        waitingForRetransmission
          ? BLE_TRANSFER.retransmissionWaitMs
          : sawValue
            ? BLE_TRANSFER.notifyIdleCompletionMs
            : BLE_TRANSFER.notifyStartTimeoutMs,
      );
    };

    stopConsuming = consumePersistentDataTxValues(
      device.id,
      (value) => {
        if (settled) return;

        sawValue = true;
        if (idleTimer) clearTimeout(idleTimer);
        try {
          const txValue = parseBleTxValue(value);
          if (txValue.kind === 'acknowledgement') {
            const pending = pendingAcknowledgement;
            if (!pending) {
              scheduleIdleFinish();
              return;
            }
            if (
              !matchesBlockAcknowledgement(
                txValue.acknowledgement,
                pending.status,
                pending.blockId,
                pending.resendOffset,
              )
            ) {
              pendingAcknowledgement = null;
              clearTimeout(pending.timer);
              pending.reject(new Error(`数据块 ${pending.blockId} 的确认回显不匹配`));
              return;
            }
            pendingAcknowledgement = null;
            clearTimeout(pending.timer);
            onDiagnostic('acknowledgement_echo_received', {
              blockId: pending.blockId,
              status: pending.status,
              resendOffset: pending.resendOffset,
            });
            pending.resolve();
            scheduleIdleFinish();
            return;
          }
        } catch {
          // Let the serialized frame handler produce a precise diagnostic or NACK.
        }

        waitingForRetransmission = false;
        queue = queue.then(() => onValue(value, acknowledge));
        void queue.then(scheduleIdleFinish, (queueError: unknown) => finish(asError(queueError)));
      },
      (error) => finish(error),
    );
    onDiagnostic('notify_subscribed');
    scheduleIdleFinish();
  });
}

async function readFrameWithRetry(device: BlePlxDevice): Promise<BleDataFrame | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= BLE_TRANSFER.maxReadRetries; attempt += 1) {
    let value: string | null | undefined;
    try {
      const characteristic = await withTimeout(
        device.readCharacteristicForService(BLE_UUIDS.dataService, BLE_UUIDS.dataTx),
        BLE_TRANSFER.readTimeoutMs,
      );
      value = characteristic.value;
    } catch (error) {
      lastError = error;
      continue;
    }

    try {
      return parseDataFrame(value);
    } catch (error) {
      if (error instanceof BleFrameError) {
        throw createFrameDiagnosticError(error, value);
      }
      throw error;
    }
  }
  throw lastError ?? new Error('读取 BLE 数据帧失败');
}

function createFrameDiagnosticError(
  error: BleFrameError,
  value?: string | null,
): BleDataFrameDiagnosticError {
  const diagnostic = buildBleFrameDiagnostic(error, value);
  console.warn('[SmartPet BLE frame diagnostic]', diagnostic);
  return new BleDataFrameDiagnosticError(diagnostic);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('BLE 数据接收失败');
}

function withTimeout<T>(promise: Promise<T>, ms: number, message = 'BLE 读取超时'): Promise<T> {
  return new Promise((resolve, reject) => {
    const signal = bleAccountController.signal;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(new Error('账号已变更，蓝牙任务已取消')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(message)); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function trainerPreparationError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : '未知错误';
  if (detail.includes('未扫描到')) {
    return new Error('未发现设备广播，请确认设备已唤醒并在手机附近');
  }
  if (detail.includes('准备设备控制服务超时')) {
    return new Error('已连接设备，但准备控制服务超时，请重试');
  }
  return new Error(`蓝牙连接失败：${detail}`);
}

function connectedResult(session: NativeSession, target: BleScanTarget): BleConnectedDevice {
  const { device } = session;
  return {
    id: device.id,
    name: device.localName ?? device.name ?? target.deviceName ?? target.deviceSn,
    mode: 'native',
    advertisement: session.advertisement,
    advertisementSource: session.advertisementSource,
    advertisementObservedAt: session.advertisementObservedAt,
  };
}

function mockConnect(target: BleScanTarget): BleConnectedDevice {
  return {
    id: `mock-${target.deviceSn}`,
    name: target.deviceName ?? target.deviceSn,
    mode: 'mock',
    advertisement: {
      serviceUuid: '53504554-444f-4754-0001-00017471ae10',
      serialNumber: '7471AE10',
      productTypeCode: 1,
      modelCode: 1,
      batteryLevel: 86,
      status: 'listening',
      mode: target.deviceType === 'bark_stopper' ? 'anti_bark' : 'training',
      dataPending: true,
      rawStatusHex: '56 00 00 01',
    },
  };
}

function mockTrainerCommand(
  target: BleScanTarget,
  kind: TrainerCommand,
  enabled: boolean,
  intensity?: number,
): BleTrainerCommandResult {
  const startCodes: Record<TrainerCommand, number> = { sound: 1, vibration: 2, shock: 3, light: 4 };
  return {
    ok: true,
    statusCode: 0xf0 + startCodes[kind] + (enabled ? 0 : 4),
    command: kind,
    enabled,
    intensity: enabled && kind !== 'light' ? intensity : 0,
    rawHex: 'MOCK',
    device: mockConnect(target),
  };
}

async function mockSync(onProgress: (progress: DataSyncProgress) => void): Promise<DataSyncResult> {
  const blockSizes = [1024, 2048, 1536];
  const totalBytes = blockSizes.reduce((total, value) => total + value, 0);
  const blocks: BleReceivedBlock[] = [];
  const storedBlocks: StoredBleBlock[] = [];
  const blockSummaries: BleBlockTransferSummary[] = [];
  const frameSummaries: BleFrameTransferSummary[] = [];
  let receivedBytes = 0;
  const pullStartedAt = Date.now();

  onProgress(progress('mock', totalBytes, blockSizes.length, 0, 0, 0, '当前环境使用模拟蓝牙数据'));
  for (let index = 0; index < blockSizes.length; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    const blockId = index + 1;
    const totalLength = blockSizes[index];
    blocks.push({ blockId, type: 'audio', totalLength, payload: new Uint8Array(totalLength) });
    blockSummaries.push({
      blockId,
      totalBytes: totalLength,
      frameCount: Math.ceil(totalLength / BLE_TRANSFER.maxPayloadBytes),
    });
    for (let offset = 0; offset < totalLength; offset += BLE_TRANSFER.maxPayloadBytes) {
      const dataLength = Math.min(BLE_TRANSFER.maxPayloadBytes, totalLength - offset);
      frameSummaries.push({
        frameNumber: frameSummaries.length + 1,
        blockId,
        totalBytes: totalLength,
        offset,
        dataLength,
        headerHex: buildDataFrameHeaderHex({
          typeCode: 0x01,
          blockId,
          totalLength,
          offset,
          dataLength,
        }),
        tailHex: '模拟数据无真实帧尾',
      });
    }
    receivedBytes += totalLength;
    onProgress(
      progress(
        index === blockSizes.length - 1 ? 'complete' : 'reading',
        totalBytes,
        blockSizes.length,
        blockId,
        blockSizes.length,
        receivedBytes,
        index === blockSizes.length - 1 ? '模拟蓝牙数据接收完成' : `模拟接收数据块 ${blockId}`,
        frameSummaries.length,
      ),
    );
  }

  return {
    completed: true,
    receivedBytes,
    lastBlockId: blocks.length,
    blocks,
    storedBlocks,
    blockSummaries,
    frameSummaries,
    pullDurationMs: Date.now() - pullStartedAt,
  };
}

function updateSessionPending(session: NativeSession, dataPending: boolean): SmartPetAdvertisement | null {
  if (!session.advertisement) return null;

  const rawBytes = session.advertisement.rawStatusHex.split(' ');
  if (rawBytes.length >= 4) rawBytes[3] = dataPending ? '01' : '00';
  const advertisement = {
    ...session.advertisement,
    dataPending,
    rawStatusHex: rawBytes.join(' '),
  };
  session.advertisement = advertisement;
  rememberAdvertisement(session.targetKey, advertisement, session.advertisementObservedAt ?? Date.now());
  const connected = latestConnectedDevices.get(session.targetKey);
  if (connected) {
    rememberConnectedDevice(session.targetKey, { ...connected, advertisement });
  }
  return advertisement;
}

function progress(
  phase: DataSyncProgress['phase'],
  pendingBytes: number,
  pendingRecords: number,
  currentBlock: number,
  totalBlocks: number,
  receivedBytes: number,
  message: string,
  receivedFrames = 0,
): DataSyncProgress {
  return {
    phase,
    pendingBytes,
    pendingRecords,
    currentBlock,
    totalBlocks,
    receivedBytes,
    receivedFrames,
    message,
  };
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function normalizeUuid(value?: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function getTargetKey(target: BleScanTarget): string {
  return target.deviceSn.trim().toUpperCase();
}

function rememberConnectedDevice(targetKey: string, device: BleConnectedDevice): void {
  latestConnectedDevices.set(targetKey, device);
  bleConnectionEvents.changed();
}

function forgetConnectedDevice(targetKey: string): void {
  if (latestConnectedDevices.delete(targetKey)) bleConnectionEvents.changed();
}

function dropNativeSession(
  targetKey: string,
  reason: 'unexpected' | 'manual' | 'replace',
): void {
  const session = activeNativeSessions.get(targetKey);
  session?.disconnectSubscription.remove();
  if (session) removePersistentDataTxListener(session.device.id);
  activeNativeSessions.delete(targetKey);
  connectionHealthFailures.delete(targetKey);
  forgetConnectedDevice(targetKey);

  if (
    reason === 'unexpected' &&
    autoReconnectEnabled &&
    autoReconnectIntents.has(targetKey) &&
    !manuallyDisconnectedTargets.has(targetKey)
  ) {
    scheduleAutoReconnect(targetKey);
    return;
  }
  setBleConnectionStatus(targetKey, {
    state: 'disconnected',
    reconnectPhase: null,
    nextRetryAt: null,
    error: null,
    rssi: null,
    lastCheckedAt: null,
  });
}

function setBleConnectionStatus(
  targetKey: string,
  updates: Partial<BleConnectionStatus>,
): void {
  const current = bleConnectionStatuses.get(targetKey) ?? idleConnectionStatus;
  const next = { ...current, ...updates };
  if (
    current.state === next.state &&
    current.reconnectPhase === next.reconnectPhase &&
    current.attempt === next.attempt &&
    current.nextRetryAt === next.nextRetryAt &&
    current.error === next.error &&
    current.rssi === next.rssi &&
    current.lastCheckedAt === next.lastCheckedAt
  ) return;
  bleConnectionStatuses.set(targetKey, next);
  bleConnectionEvents.changed();
}

function rememberAutoReconnectIntent(target: BleScanTarget, deviceId: string): void {
  const targetKey = getTargetKey(target);
  if (manuallyDisconnectedTargets.has(targetKey)) return;
  autoReconnectIntents.set(targetKey, { target, deviceId });
  persistAutoReconnectIntents();
}

function scheduleAutoReconnect(targetKey: string): void {
  if (
    !autoReconnectEnabled ||
    autoReconnectTimers.has(targetKey) ||
    readyAutoReconnectAttempts.has(targetKey) ||
    autoReconnectInFlight.has(targetKey) ||
    activeNativeSessions.has(targetKey) ||
    manuallyDisconnectedTargets.has(targetKey) ||
    !autoReconnectIntents.has(targetKey)
  ) return;

  const previousAttempt = autoReconnectAttempts.get(targetKey) ?? 0;
  if (previousAttempt >= MAX_AUTO_RECONNECT_ATTEMPTS) {
    stopAutoReconnectUntilManualConnect(targetKey);
    return;
  }

  const attempt = previousAttempt + 1;
  const delayMs = AUTO_RECONNECT_DELAYS_MS[
    Math.min(attempt - 1, AUTO_RECONNECT_DELAYS_MS.length - 1)
  ];
  const nextRetryAt = Date.now() + delayMs;
  setBleConnectionStatus(targetKey, {
    state: 'reconnecting',
    reconnectPhase: 'waiting',
    attempt,
    nextRetryAt,
    rssi: null,
    lastCheckedAt: null,
  });
  const timer = setTimeout(() => {
    autoReconnectTimers.delete(targetKey);
    enqueueAutoReconnect(targetKey, attempt);
  }, delayMs);
  autoReconnectTimers.set(targetKey, timer);
}

function enqueueAutoReconnect(targetKey: string, attempt: number): void {
  if (!isAutoReconnectEligible(targetKey)) return;
  readyAutoReconnectAttempts.set(targetKey, attempt);
  if (autoReconnectBatchTimer || autoReconnectBatchPromise) return;
  autoReconnectBatchTimer = setTimeout(() => {
    autoReconnectBatchTimer = null;
    startAutoReconnectBatch();
  }, AUTO_RECONNECT_BATCH_WINDOW_MS);
}

function startAutoReconnectBatch(): void {
  if (
    autoReconnectBatchPromise ||
    dataTransferBusy() ||
    readyAutoReconnectAttempts.size === 0
  ) {
    if (dataTransferBusy()) {
      for (const targetKey of readyAutoReconnectAttempts.keys()) {
        setBleConnectionStatus(targetKey, { reconnectPhase: 'paused', nextRetryAt: null });
      }
    }
    return;
  }
  const promise = runAutoReconnectBatch();
  autoReconnectBatchPromise = promise;
  void promise.then(() => {
    if (autoReconnectBatchPromise === promise) autoReconnectBatchPromise = null;
    if (readyAutoReconnectAttempts.size > 0) startAutoReconnectBatch();
  }, () => {
    if (autoReconnectBatchPromise === promise) autoReconnectBatchPromise = null;
    if (readyAutoReconnectAttempts.size > 0) startAutoReconnectBatch();
  });
}

async function runAutoReconnectBatch(): Promise<void> {
  const version = bleSessionVersion;
  // Probe existing links before a reconnect batch occupies the BLE adapter. This prevents
  // missing devices from delaying stale-link detection for devices that were connected.
  await verifyActiveSmartPetBleConnections();
  if (pendingNativeSession) await pendingNativeSession.promise.catch(() => null);
  if (version !== bleSessionVersion) return;

  const attempts = new Map(readyAutoReconnectAttempts);
  readyAutoReconnectAttempts.clear();
  const intents = new Map<string, AutoReconnectIntent>();
  for (const [targetKey, attempt] of attempts) {
    const intent = autoReconnectIntents.get(targetKey);
    if (!intent || !isAutoReconnectEligible(targetKey)) continue;
    intents.set(targetKey, intent);
    autoReconnectAttempts.set(targetKey, attempt);
    autoReconnectInFlight.add(targetKey);
    setBleConnectionStatus(targetKey, {
      state: 'reconnecting',
      reconnectPhase: intent.deviceId ? 'connecting' : 'scanning',
      attempt,
      nextRetryAt: null,
      error: null,
    });
  }
  if (intents.size === 0) return;

  const failed = new Map<string, string>();
  try {
    await ensureBluetoothPermissions();
    if (version !== bleSessionVersion) return;
    const manager = getNativeManager();
    const scanCandidates = new Map<string, AutoReconnectIntent>();
    const missingAdvertisementIntents = new Map(
      [...intents].filter(
        ([targetKey]) => !cachedAdvertisements.has(targetKey),
      ),
    );
    const initialAdvertisementDevices = missingAdvertisementIntents.size > 0
      ? await scanForReconnectDevices(
          manager,
          missingAdvertisementIntents,
          INITIAL_ADVERTISEMENT_SCAN_TIMEOUT_MS,
          true,
        )
      : new Map<string, BlePlxDevice>();
    if (dataTransferBusy()) {
      deferAutoReconnectIntents(intents, attempts);
      return;
    }

    for (const [targetKey, intent] of intents) {
      if (version !== bleSessionVersion) return;
      if (dataTransferBusy()) {
        deferAutoReconnectIntents(intents, attempts);
        return;
      }
      if (!isAutoReconnectEligible(targetKey)) continue;
      const advertisedDevice = initialAdvertisementDevices.get(targetKey);
      if (advertisedDevice) {
        try {
          await connectAutoReconnectDevice(
            manager,
            targetKey,
            intent,
            advertisedDevice.id,
            parseServiceDataAdvertisement(advertisedDevice.serviceData),
            false,
          );
          continue;
        } catch {
          if (isAutoReconnectEligible(targetKey)) scanCandidates.set(targetKey, intent);
          continue;
        }
      }
      if (!intent.deviceId) {
        scanCandidates.set(targetKey, intent);
        continue;
      }
      try {
        await connectAutoReconnectDevice(manager, targetKey, intent, intent.deviceId, null, true);
      } catch {
        if (isAutoReconnectEligible(targetKey)) scanCandidates.set(targetKey, intent);
      }
    }

    if (scanCandidates.size > 0) {
      if (version !== bleSessionVersion) return;
      if (dataTransferBusy()) {
        deferAutoReconnectIntents(intents, attempts);
        return;
      }
      for (const targetKey of scanCandidates.keys()) {
        setBleConnectionStatus(targetKey, {
          state: 'reconnecting',
          reconnectPhase: 'scanning',
          nextRetryAt: null,
          error: null,
        });
      }
      const found = await scanForReconnectDevices(
        manager,
        scanCandidates,
        AUTO_RECONNECT_SCAN_TIMEOUT_MS,
      );
      if (dataTransferBusy()) {
        deferAutoReconnectIntents(intents, attempts);
        return;
      }
      for (const [targetKey, intent] of scanCandidates) {
        if (version !== bleSessionVersion) return;
        if (!isAutoReconnectEligible(targetKey)) continue;
        const device = found.get(targetKey);
        if (!device) {
          failed.set(targetKey, '未发现设备广播');
          continue;
        }
        try {
          await connectAutoReconnectDevice(
            manager,
            targetKey,
            intent,
            device.id,
            parseServiceDataAdvertisement(device.serviceData),
            false,
          );
        } catch (cause) {
          failed.set(
            targetKey,
            cause instanceof Error ? cause.message : '蓝牙连接失败',
          );
        }
      }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '自动重连失败';
    for (const targetKey of intents.keys()) {
      if (isAutoReconnectEligible(targetKey) && !activeNativeSessions.has(targetKey)) {
        failed.set(targetKey, message);
      }
    }
  } finally {
    for (const targetKey of intents.keys()) autoReconnectInFlight.delete(targetKey);
    for (const [targetKey, error] of failed) {
      if (version !== bleSessionVersion) break;
      if (!isAutoReconnectEligible(targetKey)) continue;
      const attempt = attempts.get(targetKey) ?? autoReconnectAttempts.get(targetKey) ?? 0;
      if (attempt >= MAX_AUTO_RECONNECT_ATTEMPTS) {
        stopAutoReconnectUntilManualConnect(targetKey);
        continue;
      }
      setBleConnectionStatus(targetKey, {
        state: 'reconnecting',
        reconnectPhase: 'waiting',
        error,
      });
      scheduleAutoReconnect(targetKey);
    }
  }
}

function deferAutoReconnectIntents(
  intents: ReadonlyMap<string, AutoReconnectIntent>,
  attempts: ReadonlyMap<string, number>,
): void {
  for (const targetKey of intents.keys()) {
    if (!isAutoReconnectEligible(targetKey)) continue;
    const attempt = attempts.get(targetKey);
    if (attempt !== undefined) {
      readyAutoReconnectAttempts.set(targetKey, attempt);
      setBleConnectionStatus(targetKey, { reconnectPhase: 'paused', nextRetryAt: null });
    }
  }
}

async function connectAutoReconnectDevice(
  manager: BleManager,
  targetKey: string,
  intent: AutoReconnectIntent,
  deviceId: string,
  advertisement: SmartPetAdvertisement | null,
  direct: boolean,
): Promise<NativeSession> {
  const version = bleSessionVersion;
  setBleConnectionStatus(targetKey, {
    state: 'reconnecting',
    reconnectPhase: 'connecting',
    nextRetryAt: null,
    error: null,
  });
  let connected: BlePlxDevice | null = null;
  try {
    connected = await connectKnownDevice(manager, deviceId,
      direct ? AUTO_RECONNECT_DIRECT_CONNECT_TIMEOUT_MS : AUTO_RECONNECT_CONNECT_TIMEOUT_MS);
    if (version !== bleSessionVersion || !isAutoReconnectEligible(targetKey)) throw new Error('自动重连已由用户停止');
    if (Platform.OS === 'android') {
      connected = await withTimeout(
        manager.requestMTUForDevice(connected.id, BLE_TRANSFER.targetMtuAndroid),
        3_000, '协商蓝牙 MTU 超时',
      );
    }
    await withTimeout(connected.discoverAllServicesAndCharacteristics(), 5_000, '发现蓝牙服务超时');
    if (version !== bleSessionVersion || !isAutoReconnectEligible(targetKey)) throw new Error('自动重连已停止');
    return registerNativeSession(manager, intent.target, targetKey, connected, advertisement);
  } catch (cause) {
    await withTimeout(manager.cancelDeviceConnection(deviceId), 1_500, '清理连接超时').catch(() => null);
    throw cause;
  }
}

function isAutoReconnectEligible(targetKey: string): boolean {
  return (
    autoReconnectEnabled &&
    autoReconnectIntents.has(targetKey) &&
    !manuallyDisconnectedTargets.has(targetKey) &&
    !activeNativeSessions.has(targetKey)
  );
}

function clearReconnectTimer(targetKey: string): void {
  const timer = autoReconnectTimers.get(targetKey);
  if (timer) clearTimeout(timer);
  autoReconnectTimers.delete(targetKey);
}

function clearAllReconnectTimers(): void {
  for (const targetKey of autoReconnectTimers.keys()) clearReconnectTimer(targetKey);
  readyAutoReconnectAttempts.clear();
  if (autoReconnectBatchTimer) clearTimeout(autoReconnectBatchTimer);
  autoReconnectBatchTimer = null;
}

function stopAutoReconnectUntilManualConnect(targetKey: string): void {
  manuallyDisconnectedTargets.add(targetKey);
  autoReconnectAttempts.delete(targetKey);
  readyAutoReconnectAttempts.delete(targetKey);
  clearReconnectTimer(targetKey);
  setBleConnectionStatus(targetKey, {
    state: 'disconnected',
    reconnectPhase: null,
    attempt: 0,
    nextRetryAt: null,
    error: null,
    rssi: null,
    lastCheckedAt: null,
  });
  persistAutoReconnectIntents();
}

function removeUnboundReconnectIntents(): void {
  for (const targetKey of autoReconnectIntents.keys()) {
    if (!autoReconnectTargets.has(targetKey)) {
      autoReconnectIntents.delete(targetKey);
      autoReconnectAttempts.delete(targetKey);
      readyAutoReconnectAttempts.delete(targetKey);
      clearReconnectTimer(targetKey);
    }
  }
  for (const targetKey of manuallyDisconnectedTargets) {
    if (!autoReconnectTargets.has(targetKey)) manuallyDisconnectedTargets.delete(targetKey);
  }
}

function autoReconnectStorageKey(ownerId: number): string {
  return `${AUTO_RECONNECT_STORAGE_PREFIX}.${ownerId}`;
}

function rememberAdvertisement(
  targetKey: string,
  advertisement: SmartPetAdvertisement,
  observedAt = Date.now(),
): CachedAdvertisement {
  const cached = { advertisement, observedAt };
  cachedAdvertisements.set(targetKey, cached);
  persistAutoReconnectIntents();
  return cached;
}

function observeAdvertisement(
  target: BleScanTarget,
  advertisement: SmartPetAdvertisement,
): void {
  const targetKey = getTargetKey(target);
  const observed = rememberAdvertisement(targetKey, advertisement);
  const session = activeNativeSessions.get(targetKey);
  if (!session) return;

  session.advertisement = advertisement;
  session.advertisementSource = 'current';
  session.advertisementObservedAt = observed.observedAt;
  rememberConnectedDevice(targetKey, connectedResult(session, target));
}

function persistAutoReconnectIntents(): void {
  const ownerId = autoReconnectOwnerId;
  if (ownerId === null) return;
  const records = [...autoReconnectTargets.entries()].map(([targetKey, target]) => {
    const intent = autoReconnectIntents.get(targetKey);
    const cached = cachedAdvertisements.get(targetKey);
    if (manuallyDisconnectedTargets.has(targetKey)) {
      return {
        deviceSn: target.deviceSn,
        deviceId: intent?.deviceId,
        enabled: false,
        advertisement: cached?.advertisement,
        advertisementObservedAt: cached?.observedAt,
      };
    }
    return {
      deviceSn: target.deviceSn,
      deviceId: intent?.deviceId,
      enabled: true,
      advertisement: cached?.advertisement,
      advertisementObservedAt: cached?.observedAt,
    };
  });
  reconnectPersistenceTask = reconnectPersistenceTask
    .catch(() => undefined)
    .then(() => kvSetJson(autoReconnectStorageKey(ownerId), records))
    .catch((cause) => {
      console.warn(
        '[SmartPet BLE] 自动重连设备列表保存失败：',
        cause instanceof Error ? cause.message : cause,
      );
    });
}
