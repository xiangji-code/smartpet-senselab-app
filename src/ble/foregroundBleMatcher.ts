import {
  matchesBindingCodeMac,
  parseServiceDataAdvertisement,
  type SmartPetAdvertisement,
} from './protocol';
import type { BleScanTarget } from './smartPetBle';

export interface ForegroundPendingAdvertisement {
  target: BleScanTarget;
  advertisement: SmartPetAdvertisement;
}

export function matchForegroundAdvertisement(
  targets: readonly BleScanTarget[],
  deviceId: string,
  serviceData?: Record<string, string> | null,
): ForegroundPendingAdvertisement | null {
  const target = targets.find((item) => matchesBindingCodeMac(item.deviceSn, deviceId));
  if (!target) return null;

  const advertisement = parseServiceDataAdvertisement(serviceData);
  return advertisement ? { target, advertisement } : null;
}

export function matchForegroundPendingAdvertisement(
  targets: readonly BleScanTarget[],
  deviceId: string,
  serviceData?: Record<string, string> | null,
): ForegroundPendingAdvertisement | null {
  const match = matchForegroundAdvertisement(targets, deviceId, serviceData);
  return match?.advertisement.dataPending ? match : null;
}
