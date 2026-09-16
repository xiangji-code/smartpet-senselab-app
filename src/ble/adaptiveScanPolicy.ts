// Keep Android's BLE scanner open instead of attempting to restart it every
// 100 ms. Android rate-limits repeated scanner starts; a long-lived window is
// continuously receptive, and only the gap between windows needs to be 100 ms.
export const FOREGROUND_INITIAL_SCAN_MS = 30_000;
export const FOREGROUND_REGULAR_SCAN_MS = 30_000;
export const FOREGROUND_SCAN_CYCLE_MS = 30_100;
export const FOREGROUND_POST_TRANSFER_DELAY_MS = 100;
const MIN_RESTART_DELAY_MS = 100;

export function foregroundScanDurationMs(initial: boolean): number {
  return initial ? FOREGROUND_INITIAL_SCAN_MS : FOREGROUND_REGULAR_SCAN_MS;
}

/** Restarts foreground pending-data scanning 100 ms after each completed window. */
export function nextForegroundScanDelayMs(
  _cycleElapsedMs: number,
  _transferAttempted: boolean,
): number {
  return MIN_RESTART_DELAY_MS;
}
