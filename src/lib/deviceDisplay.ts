/** 设备类型与可信状态展示规则。未取得真实数据时始终返回 unknown/null。 */
import type { BluetoothStatus, Device, DeviceType, OnlineStatus } from '../types/domain';

export function deviceTypeLabel(t: DeviceType): string {
  switch (t) {
    case 'trainer':
      return '训狗器';
    case 'bark_stopper':
      return '止吠器';
    case 'collar':
      return '智能项圈';
    default:
      return '未知设备';
  }
}

export interface DeviceDisplayStatus {
  online: OnlineStatus;
  battery: number | null;
  bluetooth: BluetoothStatus;
  workState: string | null;
}

/**
 * Device.status 是账号侧启用状态，不代表设备在线。
 * 只有后端状态接口或真实设备数据明确提供的字段才允许显示具体值。
 */
export function resolveDeviceStatus(device: Device): DeviceDisplayStatus {
  return {
    online: device.onlineStatus ?? 'unknown',
    battery: validBattery(device.batteryLevel),
    bluetooth: device.bluetoothStatus ?? 'unknown',
    workState: null,
  };
}

export function onlineLabel(s: OnlineStatus): string {
  return s === 'online' ? '在线' : s === 'offline' ? '离线' : '状态未知';
}

export function bluetoothLabel(s: BluetoothStatus): string {
  switch (s) {
    case 'connected':
      return '蓝牙已连接';
    case 'connecting':
      return '蓝牙连接中';
    case 'disconnected':
      return '蓝牙未连接';
    default:
      return '蓝牙状态未知';
  }
}

function validBattery(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value)
    : null;
}
