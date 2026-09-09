const FAILURE_DELAYS_MS = [5_000, 15_000, 30_000, 60_000] as const;

/** One foreground retry timer; network wakeups never create overlapping uploads. */
export function createUploadRetryLoop(run: () => Promise<boolean>) {
  let stopped = false;
  let running = false;
  let wakePending = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => { void tick(); }, ms);
  };
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    let succeeded = false;
    try { succeeded = await run(); } catch { /* Retain the queue and retry later. */ }
    running = false;
    if (stopped) return;
    failures = succeeded ? 0 : failures + 1;
    const delay = wakePending ? 0 : succeeded ? 60_000
      : FAILURE_DELAYS_MS[Math.min(failures - 1, FAILURE_DELAYS_MS.length - 1)];
    wakePending = false;
    schedule(delay);
  };
  return {
    wake() {
      if (stopped) return;
      failures = 0;
      if (running) wakePending = true;
      else schedule(0);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
