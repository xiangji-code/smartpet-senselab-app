export const FOREGROUND_INITIAL_SCAN_MS = 8_000;
export const FOREGROUND_REGULAR_SCAN_MS = 5_000;
export const FOREGROUND_SCAN_CYCLE_MS = 15_000;
export const FOREGROUND_POST_TRANSFER_DELAY_MS = 10_000;
const MIN_RESTART_DELAY_MS = 1_000;

export function foregroundScanDurationMs(initial: boolean): number {
  return initial ? FOREGROUND_INITIAL_SCAN_MS : FOREGROUND_REGULAR_SCAN_MS;
}

/** Keeps scan starts 15 seconds apart without overlapping scan windows. */
export function nextForegroundScanDelayMs(
  cycleElapsedMs: number,
  transferAttempted: boolean,
): number {
  if (transferAttempted) return FOREGROUND_POST_TRANSFER_DELAY_MS;
  return Math.max(MIN_RESTART_DELAY_MS, FOREGROUND_SCAN_CYCLE_MS - cycleElapsedMs);
}
