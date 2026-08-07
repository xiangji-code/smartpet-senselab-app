import type { AudioUploadProgress, BleUploadResult } from './audioUploadFlow';
import {
  retryPendingUploadForDevice,
  type PendingUploadDevice,
} from './pendingUploadCoordinator';
import {
  syncPendingBleData,
  type BleScanTarget,
  type DataSyncProgress,
  type DataSyncResult,
} from './smartPetBle';

export interface ReceiveAndUploadInput {
  target: BleScanTarget;
  device: PendingUploadDevice;
  onReceiveProgress?: (progress: DataSyncProgress) => void;
  onUploadProgress?: (progress: AudioUploadProgress) => void;
  onReceived?: (result: DataSyncResult) => void;
}

export interface ReceiveAndUploadResult {
  receive: DataSyncResult;
  upload: BleUploadResult | null;
}

const activeJobs = new Map<string, Promise<ReceiveAndUploadResult>>();

/** One shared durable receive -> upload path for every BLE entry screen. */
export async function receiveAndUploadDeviceData(
  input: ReceiveAndUploadInput,
): Promise<ReceiveAndUploadResult> {
  const key = `${input.device.appUserId}:${input.device.id}:${input.device.deviceSn.trim().toUpperCase()}`;
  const active = activeJobs.get(key);
  if (active) return active;

  const job = (async () => {
    const receive = await syncPendingBleData(
      input.target,
      input.onReceiveProgress ?? (() => undefined),
    );
    input.onReceived?.(receive);
    if (!receive.completed) return { receive, upload: null };

    const upload = await retryPendingUploadForDevice(input.device, input.onUploadProgress);
    return { receive, upload };
  })().finally(() => {
    activeJobs.delete(key);
  });
  activeJobs.set(key, job);
  return job;
}
