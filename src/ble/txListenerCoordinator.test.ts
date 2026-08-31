import { describe, expect, it } from 'vitest';

import { BleTxListenerCoordinator } from './txListenerCoordinator';

describe('BleTxListenerCoordinator', () => {
  it('allows only one TX notification listener at a time', () => {
    const coordinator = new BleTxListenerCoordinator();
    const release = coordinator.acquire('device-1', '设备数据接收');

    expect(() => coordinator.acquire('device-1', '设备控制')).toThrow('设备正在进行设备数据接收');

    release();
    expect(() => coordinator.acquire('device-1', '设备控制')).not.toThrow();
  });

  it('does not let an old release callback clear a newer listener', () => {
    const coordinator = new BleTxListenerCoordinator();
    const releaseFirst = coordinator.acquire('device-1', '第一次接收');
    releaseFirst();
    const releaseSecond = coordinator.acquire('device-1', '第二次接收');

    releaseFirst();
    expect(() => coordinator.acquire('device-1', '设备控制')).toThrow('设备正在进行第二次接收');

    releaseSecond();
  });

  it('allows different devices to use their TX channels concurrently', () => {
    const coordinator = new BleTxListenerCoordinator();
    const releaseFirst = coordinator.acquire('device-1', '设备数据接收');
    const releaseSecond = coordinator.acquire('device-2', '设备控制');

    expect(coordinator.activePurpose('device-1')).toBe('设备数据接收');
    expect(coordinator.activePurpose('device-2')).toBe('设备控制');

    releaseFirst();
    releaseSecond();
  });

  it('exposes the active purpose for immediate user-facing busy feedback', () => {
    const coordinator = new BleTxListenerCoordinator();
    expect(coordinator.activePurpose('device-1')).toBeNull();

    const release = coordinator.acquire('device-1', '设备数据接收');
    expect(coordinator.activePurpose('device-1')).toBe('设备数据接收');
    expect(coordinator.activePurpose('device-2')).toBeNull();

    release();
    expect(coordinator.activePurpose('device-1')).toBeNull();
  });
});
