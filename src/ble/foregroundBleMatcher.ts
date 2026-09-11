import {
  matchesBindingCodeAdvertisement,
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
  _deviceId: string,
  serviceData?: Record<string, string> | null,
): ForegroundPendingAdvertisement | null {
  const advertisement = parseServiceDataAdvertisement(serviceData);
  if (!advertisement) return null;

  const target = targets.find((item) =>
    matchesBindingCodeAdvertisement(item.deviceSn, advertisement.serialNumber),
  );
  if (!target) return null;

  return { target, advertisement };
}

export function matchForegroundPendingAdvertisement(
  targets: readonly BleScanTarget[],
  deviceId: string,
  serviceData?: Record<string, string> | null,
): ForegroundPendingAdvertisement | null {
  const match = matchForegroundAdvertisement(targets, deviceId, serviceData);
  return match?.advertisement.dataPending ? match : null;
}
