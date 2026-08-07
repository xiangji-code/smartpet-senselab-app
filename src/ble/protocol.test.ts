import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from './encoding';
import {
  BLE_UUIDS,
  BleBlockAssembler,
  BleFrameError,
  BLE_TRANSFER,
  buildDataFrameHeaderHex,
  crc32Standard,
  crc8,
  crc16Ccitt,
  encodeBlockAcknowledgement,
  encodeBarkSensitivity,
  encodeDogSize,
  encodeTrainerCommand,
  matchesBindingCodeMac,
  matchesBlockAcknowledgement,
  parseBlockAcknowledgement,
  parseBleTxValue,
  parseDataFrame,
  parseServiceDataAdvertisement,
  parseTrainerCommandResponse,
} from './protocol';

describe('current GD-BLE-DEV GATT layout', () => {
  it('uses the service and characteristics observed in the BLE debug tool', () => {
    expect(BLE_UUIDS.dataService).toBe('00000101-0000-1000-8000-00805f9b34fb');
    expect(BLE_UUIDS.dataRx).toBe('00000102-0000-1000-8000-00805f9b34fb');
    expect(BLE_UUIDS.dataTx).toBe('00000103-0000-1000-8000-00805f9b34fb');
  });
});

describe('SmartPet BLE advertisement protocol', () => {
  it('parses the documented no-pending trainer status used by the UART S command', () => {
    const serviceData = {
      '53504554-444f-4754-0001-00017471ae10': bytesToBase64(
        Uint8Array.from([75, 0x00, 0x00, 0x00]),
      ),
    };

    expect(parseServiceDataAdvertisement(serviceData)).toMatchObject({
      batteryLevel: 75,
      status: 'listening',
      mode: 'training',
      dataPending: false,
    });
  });

  it('parses identity and four status bytes from 128-bit service data', () => {
    const serviceData = {
      '53504554-444f-4754-0001-00017471ae10': bytesToBase64(
        Uint8Array.from([75, 0x01, 0x00, 0x01]),
      ),
    };

    expect(parseServiceDataAdvertisement(serviceData)).toEqual({
      serviceUuid: '53504554-444f-4754-0001-00017471ae10',
      serialNumber: '7471AE10',
      productTypeCode: 1,
      modelCode: 1,
      batteryLevel: 75,
      status: 'bark_deterrent_active',
      mode: 'training',
      dataPending: true,
      rawStatusHex: '4B 01 00 01',
    });
  });

  it('ignores unrelated service data', () => {
    expect(
      parseServiceDataAdvertisement({
        '0000180f-0000-1000-8000-00805f9b34fb': bytesToBase64(Uint8Array.from([80])),
      }),
    ).toBeNull();
  });

  it('accepts a platform UUID string whose 128-bit service UUID bytes are reversed', () => {
    const advertisement = parseServiceDataAdvertisement({
      '10ae7174-0100-0100-5447-4f4454455053': bytesToBase64(
        Uint8Array.from([86, 0x00, 0x00, 0x01]),
      ),
    });

    expect(advertisement?.serialNumber).toBe('7471AE10');
    expect(advertisement?.dataPending).toBe(true);
  });

  it('matches an XG or ZF binding code against the final four MAC bytes', () => {
    expect(matchesBindingCodeMac('XGAE100779', '74:71:AE:10:07:79')).toBe(true);
    expect(matchesBindingCodeMac('ZFAE100779', '74-71-AE-10-07-79')).toBe(true);
    expect(matchesBindingCodeMac('XGAE100779', '74:71:AE:10:07:78')).toBe(false);
    expect(matchesBindingCodeMac('iPet-7A68', '74:71:AE:10:07:79')).toBe(false);
    expect(matchesBindingCodeMac('XG0779', '74:71:AE:10:07:79')).toBe(false);
  });
});

describe('SmartPet BLE read-frame protocol', () => {
  it('implements CRC16-CCITT with the documented parameters', () => {
    expect(crc16Ccitt(Uint8Array.from(new TextEncoder().encode('123456789')))).toBe(0x29b1);
  });

  it('implements standard CRC-32 for complete-block verification', () => {
    expect(crc32Standard(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('accepts the V2 RF_DATA and META frame types', () => {
    expect(parseDataFrame(buildFrame(0x04, 7, 6, 0, [1, 2, 3]))?.type).toBe('rf_data');
    expect(parseDataFrame(buildFrame(0x05, 7, 6, 0, [0x26, 0x39, 0xf4, 0xcb]))?.type).toBe('meta');
  });

  it('accepts the documented 229-byte maximum payload', () => {
    expect(BLE_TRANSFER.maxPayloadBytes).toBe(229);
    const payload = Array.from({ length: 229 }, (_, index) => index & 0xff);
    expect(parseDataFrame(buildFrame(0x04, 1, 229, 0, payload))?.dataLength).toBe(229);
  });

  it('encodes and parses V2 block OK/NACK commands', () => {
    const ok = encodeBlockAcknowledgement('ok', 0x1234, 0);
    expect(parseBlockAcknowledgement(ok)).toEqual({
      status: 'ok',
      blockId: 0x1234,
      resendOffset: 0,
      rawHex: '01 3A 00 12 34 00 00 00 35',
    });

    const nack = encodeBlockAcknowledgement('nack', 0x1234, 0x010203);
    expect(parseBlockAcknowledgement(nack)).toMatchObject({
      status: 'nack',
      blockId: 0x1234,
      resendOffset: 0x010203,
    });
    expect(parseBleTxValue(ok)).toMatchObject({ kind: 'acknowledgement' });
    expect(matchesBlockAcknowledgement(parseBlockAcknowledgement(ok), 'ok', 0x1234, 0)).toBe(true);
    expect(matchesBlockAcknowledgement(parseBlockAcknowledgement(ok), 'nack', 0x1234, 0)).toBe(false);
    expect(matchesBlockAcknowledgement(parseBlockAcknowledgement(ok), 'ok', 0x1235, 0)).toBe(false);
    expect(parseBleTxValue(buildFrame(0x04, 1, 1, 0, [0x41]))).toMatchObject({
      kind: 'frame',
      frame: { type: 'rf_data' },
    });
  });

  it('parses a complete big-endian data frame', () => {
    const value = bytesToBase64(
      Uint8Array.from([
        0xaa,
        0x03,
        0x00,
        0x01,
        0x00,
        0x00,
        0x03,
        0x00,
        0x00,
        0x00,
        0x00,
        0x03,
        0x41,
        0x41,
        0x41,
        0xdd,
        0xa1,
        0xbb,
      ]),
    );

    expect(parseDataFrame(value)).toEqual({
      type: 'mixed',
      typeCode: 0x03,
      blockId: 1,
      totalLength: 3,
      offset: 0,
      dataLength: 3,
      headerHex: 'AA 03 00 01 00 00 03 00 00 00 00 03',
      tailHex: 'DD A1 BB',
      payload: Uint8Array.from([0x41, 0x41, 0x41]),
    });
  });

  it('formats the documented 12-byte frame header in big-endian order', () => {
    expect(
      buildDataFrameHeaderHex({
        typeCode: 0x03,
        blockId: 1,
        totalLength: 1674,
        offset: 1620,
        dataLength: 54,
      }),
    ).toBe('AA 03 00 01 00 06 8A 00 06 54 00 36');
  });

  it('uses an empty read response as the end-of-transfer marker', () => {
    expect(parseDataFrame('')).toBeNull();
    expect(parseDataFrame(null)).toBeNull();
  });

  it('rejects a frame whose CRC does not match', () => {
    const invalid = bytesToBase64(
      Uint8Array.from([
        0xaa, 0x03, 0x00, 0x01, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x03,
        0x41, 0x41, 0x41, 0x00, 0x00, 0xbb,
      ]),
    );

    expect(() => parseDataFrame(invalid)).toThrowError(BleFrameError);
    expect(() => parseDataFrame(invalid)).toThrowError(/CRC/);
  });

  it('reassembles frames by block ID and offset', () => {
    const assembler = new BleBlockAssembler();
    const completePayload = Uint8Array.from([0x41, 0x42, 0x43, 0x44, 0x45]);
    const blockCrc = crc32Standard(completePayload);
    const meta = parseDataFrame(
      buildFrame(0x05, 3, completePayload.length, 0, [
        blockCrc & 0xff,
        (blockCrc >>> 8) & 0xff,
        (blockCrc >>> 16) & 0xff,
        (blockCrc >>> 24) & 0xff,
      ]),
    );
    const first = parseDataFrame(
      bytesToBase64(
        Uint8Array.from([
          0xaa, 0x01, 0x00, 0x03, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x03,
          0x41, 0x42, 0x43, 0x02, 0x10, 0xbb,
        ]),
      ),
    );
    const second = parseDataFrame(
      bytesToBase64(
        Uint8Array.from([
          0xaa, 0x01, 0x00, 0x03, 0x00, 0x00, 0x05, 0x00, 0x00, 0x03, 0x00, 0x02,
          0x44, 0x45, 0x04, 0xf0, 0xbb,
        ]),
      ),
    );

    expect(assembler.append(meta!)).toBeNull();
    expect(assembler.pendingBlockCount).toBe(1);
    expect(assembler.pendingResendRequest).toEqual({ blockId: 3, resendOffset: 0 });
    expect(assembler.append(first!)).toBeNull();
    expect(assembler.pendingResendRequest).toEqual({ blockId: 3, resendOffset: 3 });
    expect(assembler.append(second!)).toEqual({
      blockId: 3,
      type: 'audio',
      totalLength: 5,
      payload: Uint8Array.from([0x41, 0x42, 0x43, 0x44, 0x45]),
    });
  });

  it('rejects a completed block whose CRC32 does not match its META frame', () => {
    const assembler = new BleBlockAssembler();
    assembler.append(parseDataFrame(buildFrame(0x05, 9, 3, 0, [0, 0, 0, 0]))!);

    expect(() =>
      assembler.append(parseDataFrame(buildFrame(0x04, 9, 3, 0, [0x41, 0x42, 0x43]))!),
    ).toThrow(/CRC32/);
  });
});

describe('BLE remote-control protocol V2.0', () => {
  it('implements the documented CRC-8 check vector', () => {
    expect(crc8(Uint8Array.from([0x01, 0x38, 0x01]))).toBe(0x3d);
    expect(crc8(Uint8Array.from([0x01, 0x38, 0xf1]))).toBe(0xe3);
  });

  it('encodes five-byte commands with intensity and clamps to each documented limit', () => {
    expect(encodeTrainerCommand('sound', true, 3)).toBe(commandBase64(0x01, 3));
    expect(encodeTrainerCommand('vibration', true, 99)).toBe(commandBase64(0x02, 16));
    expect(encodeTrainerCommand('shock', true, 80)).toBe(commandBase64(0x03, 80));
    expect(encodeTrainerCommand('light', true, 99)).toBe(commandBase64(0x04, 0));
    expect(encodeTrainerCommand('sound', false, 8)).toBe(commandBase64(0x05, 0));
    expect(() => encodeTrainerCommand('shock', true, 0)).toThrow(/大于 0/);
  });

  it('parses V2 intensity responses and legacy four-byte responses', () => {
    expect(parseTrainerCommandResponse(commandResponseBase64(0xf1, 3))).toEqual({
      ok: true,
      statusCode: 0xf1,
      command: 'sound',
      enabled: true,
      intensity: 3,
      rawHex: `01 38 F1 03 ${crc8(Uint8Array.from([0x01, 0x38, 0xf1, 0x03])).toString(16).padStart(2, '0').toUpperCase()}`,
    });
    expect(parseTrainerCommandResponse(bytesToBase64(Uint8Array.from([0x01, 0x38, 0xf1, 0xe3])))).toMatchObject({
      ok: true,
      command: 'sound',
    });
    expect(parseTrainerCommandResponse(bytesToBase64(Uint8Array.from([0x01, 0x38, 0xfe, 0xce])))).toMatchObject({
      ok: false,
      statusCode: 0xfe,
      error: 'frame_error',
    });
    expect(parseTrainerCommandResponse(bytesToBase64(Uint8Array.from([0x01, 0x38, 0xff, 0xc9])))).toMatchObject({
      ok: false,
      statusCode: 0xff,
      error: 'crc_error',
    });
  });

  it('rejects malformed or CRC-invalid responses', () => {
    expect(() => parseTrainerCommandResponse(bytesToBase64(Uint8Array.from([0x01, 0x38, 0xf1])))).toThrow(/4 或 5 字节/);
    expect(() =>
      parseTrainerCommandResponse(bytesToBase64(Uint8Array.from([0x01, 0x38, 0xf1, 0x00]))),
    ).toThrow(/CRC-8/);
  });

  it('keeps unrelated bark-stopper commands unchanged', () => {
    expect(encodeBarkSensitivity(3)).toBe(bytesToBase64(Uint8Array.from([0x20, 0x03])));
    expect(encodeDogSize('large')).toBe(bytesToBase64(Uint8Array.from([0x21, 0x02])));
  });
});

function buildFrame(
  typeCode: number,
  blockId: number,
  totalLength: number,
  offset: number,
  payload: number[],
): string {
  const bytes = Uint8Array.from([
    0xaa,
    typeCode,
    (blockId >>> 8) & 0xff,
    blockId & 0xff,
    (totalLength >>> 16) & 0xff,
    (totalLength >>> 8) & 0xff,
    totalLength & 0xff,
    (offset >>> 16) & 0xff,
    (offset >>> 8) & 0xff,
    offset & 0xff,
    (payload.length >>> 8) & 0xff,
    payload.length & 0xff,
    ...payload,
    0,
    0,
    0xbb,
  ]);
  const crcOffset = 12 + payload.length;
  const crc = crc16Ccitt(bytes.slice(1, crcOffset));
  bytes[crcOffset] = (crc >>> 8) & 0xff;
  bytes[crcOffset + 1] = crc & 0xff;
  return bytesToBase64(bytes);
}

function commandBase64(controlCode: number, intensity: number): string {
  const bytes = Uint8Array.from([0x01, 0x38, controlCode, intensity, 0]);
  bytes[4] = crc8(bytes.slice(0, 4));
  return bytesToBase64(bytes);
}

function commandResponseBase64(statusCode: number, intensity: number): string {
  const bytes = Uint8Array.from([0x01, 0x38, statusCode, intensity, 0]);
  bytes[4] = crc8(bytes.slice(0, 4));
  return bytesToBase64(bytes);
}
