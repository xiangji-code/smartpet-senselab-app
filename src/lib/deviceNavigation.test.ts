import { describe, expect, it } from 'vitest';

import { deviceDestination } from './deviceNavigation';

describe('device navigation', () => {
  it('routes a verified device to its control details', () => {
    expect(deviceDestination({
      id: 15,
      deviceSn: 'XG39717606',
      deviceName: '1号设备',
      bindStatus: 'bound',
    })).toBe('/device/15');
  });

  it('routes a pending device back to connection verification with encoded identity', () => {
    expect(deviceDestination({
      id: 21,
      deviceSn: 'XG3A71702A',
      deviceName: '7 号/测试',
      bindStatus: 'pending_verification',
    })).toBe(
      '/connection-setup?deviceId=21&deviceSn=XG3A71702A&deviceName=7%20%E5%8F%B7%2F%E6%B5%8B%E8%AF%95',
    );
  });
});
