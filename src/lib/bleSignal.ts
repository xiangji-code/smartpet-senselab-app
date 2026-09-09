export type BleSignalLevel = 'strong' | 'good' | 'fair' | 'weak';

export interface BleSignalPresentation {
  level: BleSignalLevel;
  label: string;
}

/** Converts BLE RSSI into a stable user-facing signal level while preserving the raw dBm value. */
export function describeBleSignal(rssi: number | null): BleSignalPresentation | null {
  if (rssi == null || !Number.isFinite(rssi)) return null;
  if (rssi >= -60) return { level: 'strong', label: `信号强 ${rssi} dBm` };
  if (rssi >= -75) return { level: 'good', label: `信号良好 ${rssi} dBm` };
  if (rssi >= -85) return { level: 'fair', label: `信号一般 ${rssi} dBm` };
  return { level: 'weak', label: `信号很弱 ${rssi} dBm` };
}
