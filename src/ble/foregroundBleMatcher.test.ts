import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from './encoding';
import { matchForegroundPendingAdvertisement } from './foregroundBleMatcher';

const targets = [{ deviceSn: 'XGAE100779', deviceName: '测试设备' }];
const serviceUuid = '53504554-444f-4754-0001-00017471ae10';

describe('foreground pending advertisement matching', () => {
  it('selects a bound device only when its advertisement reports pending data', () => {
    const result = matchForegroundPendingAdvertisement(
      targets,
      '74:71:AE:10:07:79',
      { [serviceUuid]: bytesToBase64(Uint8Array.from([80, 0, 0, 1])) },
    );

    expect(result?.target.deviceSn).toBe('XGAE100779');
    expect(result?.advertisement.dataPending).toBe(true);
  });

  it('ignores a matching device without pending data', () => {
    expect(
      matchForegroundPendingAdvertisement(
        targets,
        '74:71:AE:10:07:79',
        { [serviceUuid]: bytesToBase64(Uint8Array.from([80, 0, 0, 0])) },
      ),
    ).toBeNull();
  });

  it('ignores an unbound device even when it has pending data', () => {
    expect(
      matchForegroundPendingAdvertisement(
        targets,
        '74:71:AE:10:07:78',
        { [serviceUuid]: bytesToBase64(Uint8Array.from([80, 0, 0, 1])) },
      ),
    ).toBeNull();
  });
});
