export class BleTxListenerCoordinator {
  private readonly activeByDevice = new Map<string, { purpose: string; token: symbol }>();

  acquire(deviceId: string, purpose: string): () => void {
    const active = this.activeByDevice.get(deviceId);
    if (active) {
      throw new Error(`设备正在进行${active.purpose}，请完成后再进行${purpose}`);
    }
    const token = Symbol(purpose);
    this.activeByDevice.set(deviceId, { purpose, token });
    return () => {
      if (this.activeByDevice.get(deviceId)?.token === token) {
        this.activeByDevice.delete(deviceId);
      }
    };
  }

  activePurpose(deviceId: string): string | null {
    return this.activeByDevice.get(deviceId)?.purpose ?? null;
  }
}
