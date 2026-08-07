export class BleTxListenerCoordinator {
  private active: { deviceId: string; purpose: string; token: symbol } | null = null;

  acquire(deviceId: string, purpose: string): () => void {
    if (this.active) {
      throw new Error(`设备正在进行${this.active.purpose}，请完成后再进行${purpose}`);
    }
    const token = Symbol(purpose);
    this.active = { deviceId, purpose, token };
    return () => {
      if (this.active?.token === token) this.active = null;
    };
  }

  activePurpose(): string | null {
    return this.active?.purpose ?? null;
  }
}
