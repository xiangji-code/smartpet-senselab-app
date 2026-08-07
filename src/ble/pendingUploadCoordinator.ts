import {
  uploadPendingDeviceBlocks,
  type AudioUploadProgress,
  type BleUploadResult,
} from './audioUploadFlow';

export interface PendingUploadDevice {
  id: number;
  deviceSn: string;
  petProfileId?: number | null;
  appUserId: number;
}

interface UploadJob {
  promise: Promise<BleUploadResult | null>;
  listeners: Set<(progress: AudioUploadProgress) => void>;
}

const jobs = new Map<string, UploadJob>();

/**
 * Ensures foreground recovery and a page action cannot upload the same durable
 * queue twice. Every caller joins the same promise and receives stage updates.
 */
export function retryPendingUploadForDevice(
  device: PendingUploadDevice,
  onProgress?: (progress: AudioUploadProgress) => void,
): Promise<BleUploadResult | null> {
  const key = `${device.appUserId}:${device.id}:${device.deviceSn}`;
  const active = jobs.get(key);
  if (active) {
    if (onProgress) active.listeners.add(onProgress);
    return active.promise;
  }

  const listeners = new Set<(progress: AudioUploadProgress) => void>();
  if (onProgress) listeners.add(onProgress);
  const promise = uploadPendingDeviceBlocks(device, (progress) => {
    for (const listener of listeners) listener(progress);
  }).finally(() => {
    jobs.delete(key);
  });
  jobs.set(key, { promise, listeners });
  return promise;
}
