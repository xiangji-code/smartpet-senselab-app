import { describe, expect, it } from 'vitest';

import type { Device } from '../types/domain';
import {
  bluetoothLabel,
  onlineLabel,
  resolveDeviceStatus,
} from './deviceDisplay';

const device: Device = {
  id: 7,
  deviceSn: 'XG00000001',
  deviceType: 'trainer',
  bindStatus: 'bound',
  status: 'active',
};

describe('device display status', () => {
  it('does not treat an active or bound device as online', () => {
    expect(resolveDeviceStatus(device)).toEqual({
      online: 'unknown',
      battery: null,
      bluetooth: 'unknown',
      workState: null,
    });
  });

  it('uses explicit real status fields when they are available', () => {
    expect(
      resolveDeviceStatus({
        ...device,
        onlineStatus: 'offline',
        batteryLevel: 19.6,
        bluetoothStatus: 'disconnected',
      }),
    ).toEqual({
      online: 'offline',
      battery: 20,
      bluetooth: 'disconnected',
      workState: null,
    });
  });

  it('uses explicit unknown labels instead of implying an offline state', () => {
    expect(onlineLabel('unknown')).toBe('状态未知');
    expect(bluetoothLabel('unknown')).toBe('蓝牙状态未知');
  });
});
