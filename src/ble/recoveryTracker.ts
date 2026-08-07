export class BleRecoveryTracker {
  private readonly attempts = new Map<string, number>();

  constructor(private readonly maxAttempts: number) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('BLE recovery max attempts must be a positive integer');
    }
  }

  register(blockId: number, resendOffset: number): number {
    const key = recoveryKey(blockId, resendOffset);
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    return attempt;
  }

  clearBlock(blockId: number): void {
    const prefix = `${blockId}:`;
    for (const key of this.attempts.keys()) {
      if (key.startsWith(prefix)) this.attempts.delete(key);
    }
  }
}

function recoveryKey(blockId: number, resendOffset: number): string {
  return `${blockId}:${resendOffset}`;
}
