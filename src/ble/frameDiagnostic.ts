import { base64ToBytes } from './encoding';
import type { BleFrameError, BleFrameErrorCode } from './protocol';

export interface BleFrameDiagnostic {
  code: BleFrameErrorCode;
  byteLength: number;
  rawHex: string;
  parserMessage: string;
  hint: string;
}

export function buildBleFrameDiagnostic(
  error: BleFrameError,
  value?: string | null,
): BleFrameDiagnostic {
  const bytes = base64ToBytes(value);

  return {
    code: error.code,
    byteLength: bytes.length,
    rawHex: toHex(bytes),
    parserMessage: error.message,
    hint: diagnosticHint(error.code, bytes),
  };
}

function diagnosticHint(code: BleFrameErrorCode, bytes: Uint8Array): string {
  if (bytes[0] === 0xa5 && bytes[1] === 0x5a) {
    return '检测到 A5 5A 帧头，设备可能正在使用新版数据封装。';
  }

  if (code === 'invalid_type' && bytes[1] !== undefined) {
    return `设备返回的数据类型为 0x${toByteHex(bytes[1])}；BLE V2 当前接受 0x01 至 0x05。`;
  }

  if (code === 'invalid_sof' && bytes[0] !== undefined) {
    return `设备返回的帧头为 0x${toByteHex(bytes[0])}；App 当前要求帧头为 0xAA。`;
  }

  return '请将该原始帧交给固件与 App 联调人员核对帧结构。';
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, toByteHex).join(' ');
}

function toByteHex(byte: number): string {
  return byte.toString(16).padStart(2, '0').toUpperCase();
}
