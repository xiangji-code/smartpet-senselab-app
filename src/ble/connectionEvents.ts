export class BleConnectionEvents {
  private readonly listeners = new Set<() => void>();

  private version = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): number => this.version;

  changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
