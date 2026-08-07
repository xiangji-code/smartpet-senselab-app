import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from './encoding';
import { buildBleFrameDiagnostic } from './frameDiagnostic';
import { BleFrameError } from './protocol';

describe('BLE frame diagnostics', () => {
  it('exposes the raw first frame when a newer A5 5A envelope is parsed as the old data frame', () => {
    const value = bytesToBase64(Uint8Array.from([0xa5, 0x5a, 0x01, 0x10, 0x00, 0x00]));
    const diagnostic = buildBleFrameDiagnostic(
      new BleFrameError('invalid_type', 'Unsupported BLE data type: 0x5a'),
      value,
    );

    expect(diagnostic).toEqual({
      code: 'invalid_type',
      byteLength: 6,
      rawHex: 'A5 5A 01 10 00 00',
      parserMessage: 'Unsupported BLE data type: 0x5a',
      hint: '检测到 A5 5A 帧头，设备可能正在使用新版数据封装。',
    });
  });

  it('identifies an unsupported type in an AA data frame', () => {
    const value = bytesToBase64(Uint8Array.from([0xaa, 0x7f, 0x00, 0x01]));
    const diagnostic = buildBleFrameDiagnostic(
      new BleFrameError('invalid_type', 'Unsupported BLE data type: 0x7f'),
      value,
    );

    expect(diagnostic.hint).toBe(
      '设备返回的数据类型为 0x7F；BLE V2 当前接受 0x01 至 0x05。',
    );
    expect(diagnostic.rawHex).toBe('AA 7F 00 01');
  });
});
