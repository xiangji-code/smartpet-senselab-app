import { PermissionsAndroid, Platform } from 'react-native';
import {
  BleManager,
  type Device as BlePlxDevice,
  type Subscription,
} from 'react-native-ble-plx';

import type { Device as AppDevice, TrainerCommand } from '../types/domain';
import { persistBleBlock, type StoredBleBlock } from './blockQueue';
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
  matchForegroundPendingAdvertisement,
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
  matchesBindingCodeMac,
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
}

interface NativeSessionOptions {
  scanTimeoutMs?: number;
  connectTimeoutMs?: number;
  onPhase?: (phase: TrainerCommandPhase) => void;
}

let nativeManager: BleManager | null = null;
const activeNativeSessions = new Map<string, NativeSession>();
let pendingNativeSession: {
  targetKey: string;
  promise: Promise<NativeSession | null>;
} | null = null;
let cancelForegroundScan: (() => void) | null = null;
const latestConnectedDevices = new Map<string, BleConnectedDevice>();
const txListenerCoordinator = new BleTxListenerCoordinator();

export async function connectSmartPetDevice(target: BleScanTarget): Promise<BleConnectedDevice> {
  const native = await createNativeSession(target);
  if (!native) {
    const connected = mockConnect(target);
    latestConnectedDevices.set(getTargetKey(target), connected);
    return connected;
  }

  await native.device.discoverAllServicesAndCharacteristics();

  const connected: BleConnectedDevice = {
    id: native.device.id,
    name: native.device.localName ?? native.device.name ?? target.deviceName ?? target.deviceSn,
    mode: 'native',
    advertisement: native.advertisement,
  };
  latestConnectedDevices.set(getTargetKey(target), connected);
  return connected;
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
    latestConnectedDevices.delete(targetKey);
    return null;
  }

  const connected = await nativeManager.isDeviceConnected(remembered.id).catch(() => false);
  if (connected) return remembered;

  activeNativeSessions.delete(targetKey);
  latestConnectedDevices.delete(targetKey);
  return null;
}

export async function disconnectSmartPetDevice(deviceId?: string): Promise<void> {
  if (!nativeManager || !deviceId) return;

  const connected = await nativeManager.isDeviceConnected(deviceId).catch(() => false);
  if (connected) await nativeManager.cancelDeviceConnection(deviceId).catch(() => null);
  for (const [targetKey, session] of activeNativeSessions) {
    if (session.device.id !== deviceId) continue;
    activeNativeSessions.delete(targetKey);
    latestConnectedDevices.delete(targetKey);
    break;
  }
}

/** Scans bound devices without connecting and returns the first pending-data advertisement. */
export async function scanForForegroundPendingDevice(
  targets: readonly BleScanTarget[],
  durationMs: number,
): Promise<ForegroundPendingAdvertisement | null> {
  if (Platform.OS === 'web' || targets.length === 0) return null;
  if (pendingNativeSession) return null;

  await ensureBluetoothPermissions();
  const manager = getNativeManager();
  for (const [targetKey, session] of activeNativeSessions) {
    const connected = await manager
      .isDeviceConnected(session.device.id)
      .catch(() => false);
    if (connected) continue;
    activeNativeSessions.delete(targetKey);
    latestConnectedDevices.delete(targetKey);
  }
  stopForegroundSmartPetScan();

  return new Promise((resolve, reject) => {
    let finished = false;
    let stateSubscription: Subscription | null = null;
    const timer = setTimeout(() => finish(null), durationMs);

    const finish = (result: ForegroundPendingAdvertisement | null, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      manager.stopDeviceScan();
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
      manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
        if (error) {
          finish(null, error);
          return;
        }
        if (!device) return;
        const match = matchForegroundPendingAdvertisement(
          targets,
          device.id,
          device.serviceData,
        );
        if (match) finish(match);
      });
    }, true);
  });
}

export function stopForegroundSmartPetScan(): void {
  cancelForegroundScan?.();
}

export async function sendTrainerBleCommand(
  target: BleScanTarget,
  kind: TrainerCommand,
  enabled: boolean,
  intensity?: number,
  onPhase?: (phase: TrainerCommandPhase) => void,
): Promise<BleTrainerCommandResult> {
  if (Platform.OS === 'web') return mockTrainerCommand(target, kind, enabled, intensity);

  let native: NativeSession | null = null;
  let preparationError: unknown = null;
  onPhase?.('checking_connection');

  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      await assertRemoteControlGattAvailable(native.device);
      preparationError = null;
      break;
    } catch (error) {
      preparationError = error;
      native = null;
    }
  }

  if (!native) {
    await disconnectNativeSessionByTargetKey(getTargetKey(target));
    throw trainerPreparationError(preparationError);
  }

  const activePurpose = txListenerCoordinator.activePurpose(native.device.id);
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
  const native = await createNativeSession(target);
  if (!native) return mockConnect(target);

  await native.device.discoverAllServicesAndCharacteristics();
  await native.device.writeCharacteristicWithResponseForService(
    BLE_UUIDS.legacyControlService,
    BLE_UUIDS.legacyControl,
    encodeBarkSensitivity(settings.sensitivity),
  );
  await native.device.writeCharacteristicWithResponseForService(
    BLE_UUIDS.legacyControlService,
    BLE_UUIDS.legacyControl,
    encodeDogSize(settings.dogSize),
  );
  return connectedResult(native, target);
}

export async function syncPendingBleData(
  target: BleScanTarget,
  onProgress: (progress: DataSyncProgress) => void,
): Promise<DataSyncResult> {
  const native = await createNativeSession(target);
  if (!native) return mockSync(onProgress);

  await native.device.discoverAllServicesAndCharacteristics();
  const transferMode = await assertDataTransferGattAvailable(native.device);
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
      const stored = await persistBleBlock(target.deviceSn, block);
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
}

async function createNativeSession(
  target: BleScanTarget,
  options: NativeSessionOptions = {},
): Promise<NativeSession | null> {
  if (Platform.OS === 'web') return null;

  await ensureBluetoothPermissions();
  const manager = getNativeManager();
  const targetKey = getTargetKey(target);

  const reusable = await getReusableNativeSession(manager, targetKey);
  if (reusable) return reusable;

  if (pendingNativeSession) {
    if (pendingNativeSession.targetKey === targetKey) {
      options.onPhase?.('connecting');
      return pendingNativeSession.promise;
    }
    await pendingNativeSession.promise.catch(() => null);
    return createNativeSession(target, options);
  }
  const promise = openNativeSession(manager, target, targetKey, options);
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
  options.onPhase?.('scanning');
  const device = await scanForDevice(
    manager,
    target,
    options.scanTimeoutMs ?? BLE_TRANSFER.scanTimeoutMs,
  );
  if (!device) throw new Error('未扫描到与绑定信息匹配的蓝牙设备');
  const advertisement = parseServiceDataAdvertisement(device.serviceData);
  options.onPhase?.('connecting');
  let connected = await manager.connectToDevice(device.id, {
    timeout: options.connectTimeoutMs ?? BLE_TRANSFER.connectTimeoutMs,
  });

  if (Platform.OS === 'android') {
    connected = await manager
      .requestMTUForDevice(connected.id, BLE_TRANSFER.targetMtuAndroid)
      .catch(() => connected);
  }
  const session = { manager, device: connected, targetKey, advertisement };
  activeNativeSessions.set(targetKey, session);
  return session;
}

async function getReusableNativeSession(manager: BleManager, targetKey: string): Promise<NativeSession | null> {
  const session = activeNativeSessions.get(targetKey);
  if (!session) return null;

  const connected = await manager.isDeviceConnected(session.device.id).catch(() => false);
  if (connected) return session;

  activeNativeSessions.delete(targetKey);
  latestConnectedDevices.delete(targetKey);
  return null;
}

async function disconnectNativeSessionByTargetKey(targetKey: string): Promise<void> {
  const session = activeNativeSessions.get(targetKey);
  if (!session) {
    latestConnectedDevices.delete(targetKey);
    return;
  }
  await disconnectSmartPetDevice(session.device.id);
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
  stopForegroundSmartPetScan();
  return new Promise((resolve, reject) => {
    let done = false;
    let subscription: Subscription | null = null;
    let latestCandidate: BlePlxDevice | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => finish(latestCandidate), timeoutMs);

    const finish = (device: BlePlxDevice | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (settleTimer) clearTimeout(settleTimer);
      manager.stopDeviceScan();
      subscription?.remove();
      resolve(device);
    };

    subscription = manager.onStateChange((state) => {
      if (state !== 'PoweredOn') return;
      subscription?.remove();
      manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
        if (error) {
          clearTimeout(timer);
          manager.stopDeviceScan();
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

function matchesTarget(device: BlePlxDevice, target: BleScanTarget): boolean {
  return matchesBindingCodeMac(target.deviceSn, device.id);
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
      subscription?.remove();
      releaseTxListener();
      if (error) reject(error);
      else if (response) resolve(response);
    };

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
  const releaseTxListener = txListenerCoordinator.acquire(device.id, '设备数据接收');
  return new Promise((resolve, reject) => {
    let settled = false;
    let sawValue = false;
    let waitingForRetransmission = false;
    const recoveryTracker = new BleRecoveryTracker(BLE_TRANSFER.maxRecoveryAttempts);
    let subscription: Subscription | null = null;
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
      subscription?.remove();
      releaseTxListener();
      if (error) reject(error);
      else resolve();
    };

    const acknowledge: BlockAcknowledgementSender = async (status, blockId, resendOffset) => {
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

    subscription = device.monitorCharacteristicForService(
      BLE_UUIDS.dataService,
      BLE_UUIDS.dataTx,
      (error, characteristic) => {
        if (settled) return;
        if (error) {
          finish(new Error(`接收设备 TX Notify 失败：${error.message}`));
          return;
        }
        if (!characteristic?.value) return;

        sawValue = true;
        if (idleTimer) clearTimeout(idleTimer);
        try {
          const txValue = parseBleTxValue(characteristic.value);
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
        queue = queue.then(() => onValue(characteristic.value!, acknowledge));
        void queue.then(scheduleIdleFinish, (queueError: unknown) => finish(asError(queueError)));
      },
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
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
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
  const connected = latestConnectedDevices.get(session.targetKey);
  if (connected) {
    latestConnectedDevices.set(session.targetKey, { ...connected, advertisement });
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
