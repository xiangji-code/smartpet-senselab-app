import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from './encoding';
import { matchForegroundPendingAdvertisement } from './foregroundBleMatcher';

const targets = [{ deviceSn: 'XG7471AE10', deviceName: '测试设备' }];
const serviceUuid = '53504554-444f-4754-0001-00017471ae10';

describe('foreground pending advertisement matching', () => {
  it('selects a bound device only when its advertisement reports pending data', () => {
    const result = matchForegroundPendingAdvertisement(
      targets,
      '53A89E91-42A8-4A80-971D-E6D2A2FCDFD9',
      { [serviceUuid]: bytesToBase64(Uint8Array.from([80, 0, 0, 1])) },
    );

    expect(result?.target.deviceSn).toBe('XG7471AE10');
    expect(result?.advertisement.dataPending).toBe(true);
  });

  it('ignores a matching device without pending data', () => {
    expect(
      matchForegroundPendingAdvertisement(
        targets,
        '53A89E91-42A8-4A80-971D-E6D2A2FCDFD9',
        { [serviceUuid]: bytesToBase64(Uint8Array.from([80, 0, 0, 0])) },
      ),
    ).toBeNull();
  });

  it('ignores an unbound device even when it has pending data', () => {
    expect(
      matchForegroundPendingAdvertisement(
        targets,
        '53A89E91-42A8-4A80-971D-E6D2A2FCDFD9',
        { ['53504554-444f-4754-0001-00017471ae11']: bytesToBase64(Uint8Array.from([80, 0, 0, 1])) },
      ),
    ).toBeNull();
  });

  it('matches the advertised serial when iOS exposes a CoreBluetooth UUID instead of a MAC', () => {
    const result = matchForegroundPendingAdvertisement(
      targets,
      '53A89E91-42A8-4A80-971D-E6D2A2FCDFD9',
      { [serviceUuid]: bytesToBase64(Uint8Array.from([80, 0, 0, 1])) },
    );

    expect(result?.target.deviceSn).toBe('XG7471AE10');
    expect(result?.advertisement.serialNumber).toBe('7471AE10');
  });
});
