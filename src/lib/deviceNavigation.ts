import type { Device } from '../types/domain';

type DeviceNavigationInput = Pick<Device, 'id' | 'deviceSn' | 'deviceName' | 'bindStatus'>;

/** Pending devices must return to BLE verification instead of entering controls. */
export function deviceDestination(device: DeviceNavigationInput): string {
  if (device.bindStatus !== 'pending_verification') return `/device/${device.id}`;

  const params = [
    ['deviceId', String(device.id)],
    ['deviceSn', device.deviceSn],
    ['deviceName', device.deviceName ?? ''],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `/connection-setup?${params}`;
}
