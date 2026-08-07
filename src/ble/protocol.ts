import type { DogSizeMode, TrainerCommand } from '../types/domain';
import { base64ToBytes, bytesToBase64 } from './encoding';

export const BLE_UUIDS = {
  // Current GD-BLE-DEV development-board data service observed in the BLE tool.
  dataService: '00000101-0000-1000-8000-00805f9b34fb',
  dataRx: '00000102-0000-1000-8000-00805f9b34fb',
  dataTx: '00000103-0000-1000-8000-00805f9b34fb',

  // The two new documents do not define the remote-control GATT service yet.
  legacyControlService: '0000ffe0-0000-1000-8000-00805f9b34fb',
  legacyDeviceInfo: '0000ffe1-0000-1000-8000-00805f9b34fb',
  legacyControl: '0000ffe2-0000-1000-8000-00805f9b34fb',
} as const;

export const BLE_TRANSFER = {
  targetMtuAndroid: 247,
  targetMtuIos: 185,
  scanTimeoutMs: 30_000,
  advertisementSettleMs: 800,
  // First-time Android pairing needs enough time for the user to confirm the single system dialog.
  connectTimeoutMs: 15_000,
  readTimeoutMs: 2_000,
  maxReadRetries: 3,
  notifyStartTimeoutMs: 3_000,
  notifyIdleCompletionMs: 1_500,
  acknowledgementTimeoutMs: 3_000,
  retransmissionWaitMs: 10_500,
  maxRecoveryAttempts: 3,
  maxPayloadBytes: 229,
} as const;

const SMARTPET_UUID_PREFIX_HEX = '53504554444F4754'; // ASCII "SPETDOGT"
const REMOTE_COMMAND_ID_HIGH = 0x01;
const REMOTE_COMMAND_ID_LOW = 0x38;
const BLOCK_ACK_COMMAND_LOW = 0x3a;
const FRAME_SOF = 0xaa;
const FRAME_EOF = 0xbb;
const FRAME_MIN_LENGTH = 15;

export type BleAdvertisementStatus = 'listening' | 'bark_deterrent_active' | 'unknown';
export type BleAdvertisementMode = 'training' | 'anti_bark' | 'unknown';
export type BleDataType = 'audio' | 'motion' | 'mixed' | 'rf_data';
export type BleFrameType = BleDataType | 'meta';

export interface SmartPetAdvertisement {
  serviceUuid: string;
  serialNumber: string;
  productTypeCode: number;
  modelCode: number;
  batteryLevel: number;
  status: BleAdvertisementStatus;
  mode: BleAdvertisementMode;
  dataPending: boolean;
  rawStatusHex: string;
}

export interface BleDataFrame {
  type: BleFrameType;
  typeCode: number;
  blockId: number;
  totalLength: number;
  offset: number;
  dataLength: number;
  headerHex: string;
  tailHex: string;
  payload: Uint8Array;
}

export interface BleReceivedBlock {
  blockId: number;
  type: BleDataType;
  totalLength: number;
  payload: Uint8Array;
}

export interface BleBlockAcknowledgement {
  status: 'ok' | 'nack';
  blockId: number;
  resendOffset: number;
  rawHex: string;
}

export type BleTxValue =
  | { kind: 'empty' }
  | { kind: 'frame'; frame: BleDataFrame }
  | { kind: 'acknowledgement'; acknowledgement: BleBlockAcknowledgement };

export interface BleDeviceInfo {
  raw: Uint8Array;
  firmwareVersion?: string;
  hardwareVersion?: string;
  mac?: string;
}

export type TrainerResponseError = 'frame_error' | 'crc_error' | 'reserved_status';

export interface TrainerCommandResponse {
  ok: boolean;
  statusCode: number;
  command?: TrainerCommand;
  enabled?: boolean;
  intensity?: number;
  error?: TrainerResponseError;
  rawHex: string;
}

export type BarkMode = 'sound_only' | 'sound_vibration' | 'progressive';
export type BleFrameErrorCode =
  | 'too_short'
  | 'invalid_sof'
  | 'invalid_eof'
  | 'invalid_type'
  | 'invalid_length'
  | 'invalid_crc'
  | 'invalid_block'
  | 'invalid_meta'
  | 'invalid_block_crc';

export class BleFrameError extends Error {
  constructor(
    public readonly code: BleFrameErrorCode,
    message: string,
    public readonly blockId?: number,
    public readonly resendOffset?: number,
  ) {
    super(message);
    this.name = 'BleFrameError';
  }
}

export function parseServiceDataAdvertisement(
  serviceData?: Record<string, string> | null,
): SmartPetAdvertisement | null {
  if (!serviceData) return null;

  for (const [serviceUuid, value] of Object.entries(serviceData)) {
    const uuidHex = serviceUuid.replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (uuidHex.length !== 32) continue;
    const reversedUuidHex = uuidHex.match(/../g)?.reverse().join('') ?? '';
    const identityHex = uuidHex.startsWith(SMARTPET_UUID_PREFIX_HEX)
      ? uuidHex
      : reversedUuidHex.startsWith(SMARTPET_UUID_PREFIX_HEX)
        ? reversedUuidHex
        : null;
    if (!identityHex) continue;

    const bytes = base64ToBytes(value);
    if (bytes.length < 4) continue;

    const productTypeCode = Number.parseInt(identityHex.slice(16, 20), 16);
    const modelCode = Number.parseInt(identityHex.slice(20, 24), 16);
    return {
      serviceUuid,
      serialNumber: identityHex.slice(24, 32),
      productTypeCode,
      modelCode,
      batteryLevel: bytes[0],
      status: bytes[1] === 0 ? 'listening' : bytes[1] === 1 ? 'bark_deterrent_active' : 'unknown',
      mode: bytes[2] === 0 ? 'training' : bytes[2] === 1 ? 'anti_bark' : 'unknown',
      dataPending: bytes[3] === 1,
      rawStatusHex: Array.from(bytes.slice(0, 4), (byte) => byte.toString(16).padStart(2, '0'))
        .join(' ')
        .toUpperCase(),
    };
  }

  return null;
}

/** Matches `XG/ZF + final four MAC bytes` binding codes to an Android BLE address. */
export function matchesBindingCodeMac(bindingCode: string, bleDeviceId: string): boolean {
  const codeMatch = bindingCode.trim().toUpperCase().match(/^(?:XG|ZF)([0-9A-F]{8})$/);
  if (!codeMatch) return false;

  const normalizedMac = bleDeviceId.replace(/[^0-9A-F]/gi, '').toUpperCase();
  return normalizedMac.length === 12 && normalizedMac.endsWith(codeMatch[1]);
}

export function crc16Ccitt(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function crc32Standard(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function parseDataFrame(value?: string | null): BleDataFrame | null {
  const bytes = base64ToBytes(value);
  if (bytes.length === 0) return null;
  if (bytes.length < FRAME_MIN_LENGTH) {
    throw new BleFrameError('too_short', `BLE frame is too short: ${bytes.length} bytes`);
  }
  if (bytes[0] !== FRAME_SOF) {
    throw new BleFrameError('invalid_sof', 'BLE frame SOF must be 0xAA');
  }
  if (bytes[bytes.length - 1] !== FRAME_EOF) {
    throw new BleFrameError('invalid_eof', 'BLE frame EOF must be 0xBB');
  }

  const typeCode = bytes[1];
  const type = dataTypeFromCode(typeCode);
  if (!type) {
    throw new BleFrameError('invalid_type', `Unsupported BLE data type: 0x${typeCode.toString(16)}`);
  }

  const blockId = readU16be(bytes, 2);
  const totalLength = readU24be(bytes, 4);
  const offset = readU24be(bytes, 7);
  const dataLength = readU16be(bytes, 10);
  const expectedLength = FRAME_MIN_LENGTH + dataLength;
  if (dataLength > BLE_TRANSFER.maxPayloadBytes || bytes.length !== expectedLength) {
    throw new BleFrameError(
      'invalid_length',
      `BLE frame length mismatch: expected ${expectedLength}, got ${bytes.length}`,
    );
  }
  if (type !== 'meta' && offset + dataLength > totalLength) {
    throw new BleFrameError('invalid_length', 'BLE frame payload exceeds the declared block length');
  }

  const payloadEnd = 12 + dataLength;
  const expectedCrc = readU16be(bytes, payloadEnd);
  const actualCrc = crc16Ccitt(bytes.slice(1, payloadEnd));
  if (actualCrc !== expectedCrc) {
    throw new BleFrameError(
      'invalid_crc',
      `BLE frame CRC mismatch: expected 0x${expectedCrc.toString(16)}, got 0x${actualCrc.toString(16)}`,
      blockId,
      offset,
    );
  }

  return {
    type,
    typeCode,
    blockId,
    totalLength,
    offset,
    dataLength,
    headerHex: bytesToHex(bytes.slice(0, 12)),
    tailHex: bytesToHex(bytes.slice(payloadEnd, payloadEnd + 3)),
    payload: bytes.slice(12, payloadEnd),
  };
}

export function buildDataFrameHeaderHex(
  frame: Pick<BleDataFrame, 'typeCode' | 'blockId' | 'totalLength' | 'offset' | 'dataLength'>,
): string {
  return bytesToHex(
    Uint8Array.from([
      FRAME_SOF,
      frame.typeCode,
      (frame.blockId >>> 8) & 0xff,
      frame.blockId & 0xff,
      (frame.totalLength >>> 16) & 0xff,
      (frame.totalLength >>> 8) & 0xff,
      frame.totalLength & 0xff,
      (frame.offset >>> 16) & 0xff,
      (frame.offset >>> 8) & 0xff,
      frame.offset & 0xff,
      (frame.dataLength >>> 8) & 0xff,
      frame.dataLength & 0xff,
    ]),
  );
}

interface PendingBlock {
  type: BleDataType;
  totalLength: number;
  receivedLength: number;
  payload: Uint8Array;
}

interface PendingBlockMetadata {
  totalLength: number;
  crc32: number;
}

export class BleBlockAssembler {
  private readonly pending = new Map<number, PendingBlock>();
  private readonly metadata = new Map<number, PendingBlockMetadata>();

  get pendingBlockCount(): number {
    return this.metadata.size;
  }

  get pendingResendRequest(): { blockId: number; resendOffset: number } | null {
    for (const blockId of this.metadata.keys()) {
      return {
        blockId,
        resendOffset: this.pending.get(blockId)?.receivedLength ?? 0,
      };
    }
    return null;
  }

  get pendingReceivedBytes(): number {
    let total = 0;
    for (const block of this.pending.values()) total += block.receivedLength;
    return total;
  }

  append(frame: BleDataFrame): BleReceivedBlock | null {
    if (frame.type === 'meta') {
      if (frame.offset !== 0 || frame.dataLength !== 4) {
        throw new BleFrameError(
          'invalid_meta',
          `Block ${frame.blockId} META must have offset 0 and a four-byte CRC32`,
          frame.blockId,
          0,
        );
      }
      this.pending.delete(frame.blockId);
      this.metadata.set(frame.blockId, {
        totalLength: frame.totalLength,
        crc32: readU32le(frame.payload, 0),
      });
      return null;
    }

    const metadata = this.metadata.get(frame.blockId);
    if (!metadata) {
      throw new BleFrameError(
        'invalid_meta',
        `Block ${frame.blockId} data arrived before its META frame`,
        frame.blockId,
        0,
      );
    }
    if (metadata.totalLength !== frame.totalLength) {
      throw new BleFrameError(
        'invalid_meta',
        `Block ${frame.blockId} length differs from its META frame`,
        frame.blockId,
        0,
      );
    }

    let block = this.pending.get(frame.blockId);
    if (!block) {
      if (frame.offset !== 0) {
        throw new BleFrameError('invalid_block', `Block ${frame.blockId} must start at offset 0`, frame.blockId, 0);
      }
      block = {
        type: frame.type,
        totalLength: frame.totalLength,
        receivedLength: 0,
        payload: new Uint8Array(frame.totalLength),
      };
      this.pending.set(frame.blockId, block);
    }

    if (block.type !== frame.type || block.totalLength !== frame.totalLength) {
      throw new BleFrameError('invalid_block', `Block ${frame.blockId} metadata changed during transfer`);
    }
    if (frame.offset !== block.receivedLength) {
      throw new BleFrameError(
        'invalid_block',
        `Block ${frame.blockId} expected offset ${block.receivedLength}, got ${frame.offset}`,
        frame.blockId,
        block.receivedLength,
      );
    }

    block.payload.set(frame.payload, frame.offset);
    block.receivedLength += frame.dataLength;
    if (block.receivedLength !== block.totalLength) return null;

    this.pending.delete(frame.blockId);
    this.metadata.delete(frame.blockId);
    const actualCrc32 = crc32Standard(block.payload);
    if (actualCrc32 !== metadata.crc32) {
      throw new BleFrameError(
        'invalid_block_crc',
        `Block ${frame.blockId} CRC32 mismatch: expected 0x${metadata.crc32.toString(16)}, got 0x${actualCrc32.toString(16)}`,
        frame.blockId,
        0,
      );
    }
    return {
      blockId: frame.blockId,
      type: block.type,
      totalLength: block.totalLength,
      payload: block.payload,
    };
  }
}

export function parseDeviceInfo(value?: string | null): BleDeviceInfo {
  return { raw: base64ToBytes(value) };
}

export function crc8(bytes: Uint8Array): number {
  let crc = 0x00;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export function encodeBlockAcknowledgement(
  status: BleBlockAcknowledgement['status'],
  blockId: number,
  resendOffset: number,
): string {
  if (!Number.isInteger(blockId) || blockId < 0 || blockId > 0xffff) {
    throw new Error('BLE block ID must fit in two bytes');
  }
  if (!Number.isInteger(resendOffset) || resendOffset < 0 || resendOffset > 0xffffff) {
    throw new Error('BLE resend offset must fit in three bytes');
  }
  const bytes = Uint8Array.from([
    REMOTE_COMMAND_ID_HIGH,
    BLOCK_ACK_COMMAND_LOW,
    status === 'ok' ? 0x00 : 0x01,
    (blockId >>> 8) & 0xff,
    blockId & 0xff,
    (resendOffset >>> 16) & 0xff,
    (resendOffset >>> 8) & 0xff,
    resendOffset & 0xff,
    0,
  ]);
  bytes[8] = crc8(bytes.slice(0, 8));
  return bytesToBase64(bytes);
}

export function parseBlockAcknowledgement(value?: string | null): BleBlockAcknowledgement {
  const bytes = base64ToBytes(value);
  if (bytes.length !== 9) throw new Error(`块确认响应长度应为 9 字节，实际为 ${bytes.length} 字节`);
  if (bytes[0] !== REMOTE_COMMAND_ID_HIGH || bytes[1] !== BLOCK_ACK_COMMAND_LOW) {
    throw new Error('块确认响应 ID 不是 0x013A');
  }
  const expectedCrc = crc8(bytes.slice(0, 8));
  if (bytes[8] !== expectedCrc) throw new Error('块确认响应 CRC-8 错误');
  if (bytes[2] !== 0x00 && bytes[2] !== 0x01) throw new Error('块确认响应状态无效');
  return {
    status: bytes[2] === 0x00 ? 'ok' : 'nack',
    blockId: readU16be(bytes, 3),
    resendOffset: readU24be(bytes, 5),
    rawHex: bytesToHex(bytes),
  };
}

export function matchesBlockAcknowledgement(
  acknowledgement: BleBlockAcknowledgement,
  status: BleBlockAcknowledgement['status'],
  blockId: number,
  resendOffset: number,
): boolean {
  return (
    acknowledgement.status === status &&
    acknowledgement.blockId === blockId &&
    acknowledgement.resendOffset === resendOffset
  );
}

export function parseBleTxValue(value?: string | null): BleTxValue {
  const bytes = base64ToBytes(value);
  if (bytes.length === 0) return { kind: 'empty' };
  if (bytes.length === 9 && bytes[0] === REMOTE_COMMAND_ID_HIGH && bytes[1] === BLOCK_ACK_COMMAND_LOW) {
    return { kind: 'acknowledgement', acknowledgement: parseBlockAcknowledgement(value) };
  }
  const frame = parseDataFrame(value);
  return frame ? { kind: 'frame', frame } : { kind: 'empty' };
}

export function encodeTrainerCommand(
  kind: TrainerCommand,
  enabled: boolean,
  requestedIntensity?: number,
): string {
  const controlCode = trainerControlCode(kind, enabled);
  const intensity = trainerIntensity(kind, enabled, requestedIntensity);
  const bytes = Uint8Array.from([
    REMOTE_COMMAND_ID_HIGH,
    REMOTE_COMMAND_ID_LOW,
    controlCode,
    intensity,
    0x00,
  ]);
  bytes[4] = crc8(bytes.slice(0, 4));
  return bytesToBase64(bytes);
}

export function parseTrainerCommandResponse(value?: string | null): TrainerCommandResponse {
  const bytes = base64ToBytes(value);
  if (bytes.length !== 4 && bytes.length !== 5) {
    throw new Error(`遥控响应长度应为 4 或 5 字节，实际为 ${bytes.length} 字节`);
  }
  if (bytes[0] !== REMOTE_COMMAND_ID_HIGH || bytes[1] !== REMOTE_COMMAND_ID_LOW) {
    throw new Error('遥控响应 ID 不是 0x0138');
  }

  const crcIndex = bytes.length - 1;
  const expectedCrc = crc8(bytes.slice(0, crcIndex));
  if (bytes[crcIndex] !== expectedCrc) {
    throw new Error(
      `遥控响应 CRC-8 错误：期望 0x${expectedCrc.toString(16).padStart(2, '0')}，收到 0x${bytes[crcIndex]
        .toString(16)
        .padStart(2, '0')}`,
    );
  }

  const statusCode = bytes[2];
  const rawHex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join(' ')
    .toUpperCase();
  if (statusCode >= 0xf1 && statusCode <= 0xf8) {
    const action = trainerActionFromControlCode(statusCode - 0xf0);
    return {
      ok: true,
      statusCode,
      ...action,
      ...(bytes.length === 5 ? { intensity: bytes[3] } : {}),
      rawHex,
    };
  }
  if (statusCode === 0xfe) return { ok: false, statusCode, error: 'frame_error', rawHex };
  if (statusCode === 0xff) return { ok: false, statusCode, error: 'crc_error', rawHex };
  return { ok: false, statusCode, error: 'reserved_status', rawHex };
}

export function encodeBarkSensitivity(level: number): string {
  return bytesToBase64(Uint8Array.from([0x20, clampLevel(level, 1, 5)]));
}

export function encodeDogSize(size: DogSizeMode): string {
  const value = size === 'small' ? 0 : size === 'large' ? 2 : 1;
  return bytesToBase64(Uint8Array.from([0x21, value]));
}

export function encodeBarkMode(mode: BarkMode): string {
  const value = mode === 'sound_only' ? 0 : mode === 'sound_vibration' ? 1 : 2;
  return bytesToBase64(Uint8Array.from([0x22, value]));
}

export function encodeAutoBark(enabled: boolean): string {
  return bytesToBase64(Uint8Array.from([0x30, enabled ? 1 : 0]));
}

function readU16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU24be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 16) | ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0);
}

function readU32le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>> 0
  );
}

function dataTypeFromCode(value: number): BleFrameType | null {
  if (value === 0x01) return 'audio';
  if (value === 0x02) return 'motion';
  if (value === 0x03) return 'mixed';
  if (value === 0x04) return 'rf_data';
  if (value === 0x05) return 'meta';
  return null;
}

function trainerControlCode(kind: TrainerCommand, enabled: boolean): number {
  const startCode: Record<TrainerCommand, number> = {
    sound: 0x01,
    vibration: 0x02,
    shock: 0x03,
    light: 0x04,
  };
  return startCode[kind] + (enabled ? 0 : 4);
}

function trainerIntensity(
  kind: TrainerCommand,
  enabled: boolean,
  requestedIntensity?: number,
): number {
  if (!enabled || kind === 'light') return 0;
  const maximum = kind === 'sound' ? 8 : kind === 'vibration' ? 16 : 99;
  const intensity = requestedIntensity ?? maximum;
  if (!Number.isFinite(intensity) || intensity <= 0) {
    throw new Error('启动声音、震动或电击时，强度必须大于 0');
  }
  return Math.min(maximum, Math.max(1, Math.round(intensity)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join(' ')
    .toUpperCase();
}

function trainerActionFromControlCode(controlCode: number): {
  command: TrainerCommand;
  enabled: boolean;
} {
  const enabled = controlCode <= 4;
  const startCode = enabled ? controlCode : controlCode - 4;
  const command: TrainerCommand =
    startCode === 1 ? 'sound' : startCode === 2 ? 'vibration' : startCode === 3 ? 'shock' : 'light';
  return { command, enabled };
}

function clampLevel(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
