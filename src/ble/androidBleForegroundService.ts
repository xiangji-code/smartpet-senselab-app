import {
  AppState,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

interface BleForegroundServiceNativeModule {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
}

const nativeService = NativeModules.BleForegroundService as
  | BleForegroundServiceNativeModule
  | undefined;

let operation = Promise.resolve();
let started = false;
let notificationPermissionRequested = false;

async function requestNotificationPermission(): Promise<void> {
  if (
    notificationPermissionRequested ||
    Platform.OS !== 'android' ||
    Number(Platform.Version) < 33 ||
    AppState.currentState !== 'active'
  ) return;
  notificationPermissionRequested = true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return;
  await PermissionsAndroid.request(permission);
}

export function setAndroidBleForegroundServiceEnabled(enabled: boolean): Promise<void> {
  if (Platform.OS !== 'android' || !nativeService) return Promise.resolve();
  operation = operation.then(async () => {
    if (enabled === started) return;
    if (enabled) {
      await requestNotificationPermission();
      await nativeService.start();
      started = true;
      return;
    }
    await nativeService.stop();
    started = false;
  }).catch((error) => {
    console.warn(
      `[SmartPet BLE] ${enabled ? '启动' : '停止'}锁屏接收服务失败：`,
      error instanceof Error ? error.message : error,
    );
  });
  return operation;
}
