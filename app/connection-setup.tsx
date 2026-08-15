import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { DesignScreen } from '../src/components/design-screen';
import { BleReceivePreviewCard } from '../src/components/BleReceivePreviewCard';
import { ConfirmModal } from '../src/components/ConfirmModal';
import { PageBackButton } from '../src/components/page-back-button';
import { SectionCard } from '../src/components/SectionCard';
import { StatusPill } from '../src/components/StatusPill';
import { detectDeviceType, devicesApi } from '../src/api/devices';
import { useAuth } from '../src/auth/AuthContext';
import { useConsent } from '../src/consent/ConsentContext';
import type { AudioUploadProgress, BleUploadResult } from '../src/ble/audioUploadFlow';
import { usePendingUploads } from '../src/ble/PendingUploadContext';
import { useForegroundBleSync } from '../src/ble/ForegroundBleSyncProvider';
import {
  connectSmartPetDevice,
  disconnectSmartPetDevice,
  getActiveConnectedSmartPetDevice,
  getLatestConnectedSmartPetDevice,
  type BleConnectedDevice,
  type DataSyncProgress,
} from '../src/ble/smartPetBle';
import {
  formatExactByteSize,
  type BlePullPreview,
} from '../src/ble/pullPreview';
import { deviceTypeLabel } from '../src/lib/deviceDisplay';
import { href } from '../src/lib/nav';
import type { BluetoothStatus } from '../src/types/domain';
import { colors, fontSize, radius, spacing } from '../src/theme/theme';

/**
 * Connection Setup（issue-03）。
 * 绑定成功后必经此页：展示设备识别信息与蓝牙状态，
 * 提供 BLE 连接与缓存数据分片同步入口，完成后按 device_type 进入对应详情。
 */
export default function ConnectionSetupScreen() {
  const router = useRouter();
  const { user, devices, refreshDevices } = useAuth();
  const { consent, ready: consentReady } = useConsent();
  const { state: pendingUploadState } = usePendingUploads();
  const { state: foregroundSyncState, syncDevice: syncForegroundDevice } = useForegroundBleSync();
  const { deviceId, deviceSn, deviceName } = useLocalSearchParams<{
    deviceId?: string;
    deviceSn?: string;
    deviceName?: string;
  }>();

  const type = detectDeviceType(deviceSn ?? '');
  const numericDeviceId = Number(deviceId);
  const appDevice = devices.find((item) => item.id === numericDeviceId);
  const rememberedConnection = deviceSn
    ? getLatestConnectedSmartPetDevice({ deviceSn, deviceName, deviceType: type })
    : null;
  const [bt, setBt] = useState<BluetoothStatus>(rememberedConnection ? 'connected' : 'disconnected');
  const [btBusy, setBtBusy] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [cancelConfirmVisible, setCancelConfirmVisible] = useState(false);
  const [bindingConfirmed, setBindingConfirmed] = useState(appDevice?.bindStatus === 'bound');
  const [syncBusy, setSyncBusy] = useState(false);
  const [connected, setConnected] = useState<BleConnectedDevice | null>(rememberedConnection);
  const [syncProgress, setSyncProgress] = useState<DataSyncProgress | null>(null);
  const [receivePreview, setReceivePreview] = useState<BlePullPreview | null>(null);
  const [uploadProgress, setUploadProgress] = useState<AudioUploadProgress | null>(null);
  const [uploadResult, setUploadResult] = useState<BleUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBindingConfirmed(appDevice?.bindStatus === 'bound');
  }, [appDevice?.bindStatus]);

  useEffect(() => {
    if (!deviceSn) return;

    let cancelled = false;
    void getActiveConnectedSmartPetDevice({ deviceSn, deviceName, deviceType: type }).then(async (current) => {
      if (cancelled) return;
      setConnected(current);
      setBt(current ? 'connected' : 'disconnected');
      if (current && appDevice?.bindStatus === 'pending_verification') {
        try {
          await confirmCloudBinding();
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : '设备归属确认失败，请重试');
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [appDevice?.bindStatus, deviceName, deviceSn, type]);

  useEffect(() => {
    if (!deviceSn || foregroundSyncState.deviceSn !== deviceSn) return;
    const busy = foregroundSyncState.phase === 'receiving' || foregroundSyncState.phase === 'uploading';
    setSyncBusy(busy);
    setSyncProgress(foregroundSyncState.receiveProgress);
    setReceivePreview(foregroundSyncState.preview);
    setUploadProgress(foregroundSyncState.uploadProgress);
    setUploadResult(foregroundSyncState.uploadResult);
    if (foregroundSyncState.advertisement) {
      const latest = getLatestConnectedSmartPetDevice({ deviceSn, deviceName, deviceType: type });
      if (latest) {
        setConnected(latest);
        setBt('connected');
      }
    }
    if (foregroundSyncState.phase === 'error' && foregroundSyncState.message) {
      setError(foregroundSyncState.message);
    } else if (foregroundSyncState.phase === 'complete') {
      setError(null);
    }
  }, [deviceName, deviceSn, foregroundSyncState, type]);

  async function confirmCloudBinding() {
    if (!Number.isInteger(numericDeviceId) || numericDeviceId <= 0) {
      throw new Error('设备信息不完整，无法完成绑定');
    }
    setVerificationBusy(true);
    try {
      await devicesApi.confirmVerification(numericDeviceId);
      await refreshDevices();
      setBindingConfirmed(true);
    } finally {
      setVerificationBusy(false);
    }
  }

  async function connectBluetooth() {
    if (!deviceSn) return;
    setError(null);
    setBtBusy(true);
    setBt('connecting');
    try {
      const result = await connectSmartPetDevice({
        deviceSn,
        deviceName,
        deviceType: type,
      });
      setConnected(result);
      setBt('connected');
      try {
        await confirmCloudBinding();
      } catch (e) {
        setError(
          `蓝牙已连接，但账号绑定尚未完成：${e instanceof Error ? e.message : '请重试'}`,
        );
      }
    } catch (e) {
      setBt('disconnected');
      setError(e instanceof Error ? e.message : '蓝牙连接失败，请确认设备在附近并已开启');
    } finally {
      setBtBusy(false);
    }
  }

  async function completePendingBinding() {
    setError(null);
    try {
      await confirmCloudBinding();
    } catch (e) {
      setError(e instanceof Error ? e.message : '设备归属确认失败，请重试');
    }
  }

  function retrySyncData() {
    if (appDevice) void syncForegroundDevice(appDevice);
  }

  async function reconnectBluetooth() {
    if (!deviceSn) return;
    setBtBusy(true);
    setError(null);
    setBt('connecting');
    try {
      await disconnectSmartPetDevice(connected?.id);
      setConnected(null);
      setSyncProgress(null);
      const result = await connectSmartPetDevice({
        deviceSn,
        deviceName,
        deviceType: type,
      });
      setConnected(result);
      setBt('connected');
      try {
        await confirmCloudBinding();
      } catch (e) {
        setError(
          `蓝牙已重新连接，但账号绑定尚未完成：${e instanceof Error ? e.message : '请重试'}`,
        );
      }
    } catch (e) {
      setBt('disconnected');
      setError(e instanceof Error ? e.message : '重新扫描并连接失败');
    } finally {
      setBtBusy(false);
    }
  }

  async function cancelPendingVerification() {
    if (!Number.isInteger(numericDeviceId) || numericDeviceId <= 0) return;
    setVerificationBusy(true);
    setError(null);
    try {
      await devicesApi.cancelVerification(numericDeviceId);
      setCancelConfirmVisible(false);
      await refreshDevices();
      await disconnectSmartPetDevice(connected?.id);
      router.replace(href('/(tabs)'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '取消添加设备失败');
    } finally {
      setVerificationBusy(false);
    }
  }

  const canEnter = bt === 'connected' && bindingConfirmed;

  function enterDetail() {
    if (!deviceId) {
      router.replace(href('/(tabs)'));
      return;
    }
    router.replace(href(`/device/${deviceId}`));
  }

  const btTone = bt === 'connected' ? 'ok' : bt === 'connecting' ? 'warn' : 'muted';

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DesignScreen
        title="连接设置"
        subtitle={bindingConfirmed ? '设备已归属当前账号，可正常使用' : '验证设备并同步本地缓存数据'}
        leading={<PageBackButton color="#FFFFFF" onPress={() => router.back()} />}
      >
        <SectionCard>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Ionicons
                name={bindingConfirmed ? 'checkmark-circle' : 'shield-checkmark-outline'}
                size={26}
                color={colors.green}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{deviceName || '新设备'}</Text>
              <Text style={styles.meta}>类型：{deviceTypeLabel(type)}</Text>
              <Text style={styles.meta}>设备码：{deviceSn ?? '—'}</Text>
              <Text style={styles.meta}>
                账号状态：{bindingConfirmed ? '已绑定' : '待蓝牙验证，不可上传数据或关联宠物'}
              </Text>
            </View>
          </View>
        </SectionCard>

        <SectionCard title="蓝牙连接" right={<StatusPill tone={btTone} label={btLabel(bt)} />}>
          <Text style={styles.hint}>用于近距离控制、设备状态读取和缓存数据同步。</Text>
          <Pressable
            style={[styles.btn, (btBusy || verificationBusy || (bt === 'connected' && bindingConfirmed)) && styles.btnMuted]}
            disabled={btBusy || verificationBusy || (bt === 'connected' && bindingConfirmed)}
            onPress={bt === 'connected' ? completePendingBinding : connectBluetooth}
          >
            {btBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>
                {verificationBusy
                  ? '正在确认设备归属…'
                  : bt === 'connected' && bindingConfirmed
                    ? '蓝牙与账号均已验证'
                    : bt === 'connected'
                      ? '完成账号绑定'
                      : '连接蓝牙并验证'}
              </Text>
            )}
          </Pressable>
          {connected ? <AdvertisementSummary connected={connected} /> : null}
          {bt === 'connected' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="断开蓝牙后重新扫描并连接"
              style={[styles.btnGhost, btBusy && styles.btnMuted]}
              disabled={btBusy}
              onPress={reconnectBluetooth}
            >
              <Text style={styles.btnGhostText}>重新扫描并连接</Text>
            </Pressable>
          ) : null}
        </SectionCard>

        <SectionCard
          title="数据同步"
          right={
            syncBusy && syncProgress ? (
              <StatusPill
                tone={
                  syncProgress.phase === 'complete' || syncProgress.phase === 'empty'
                    ? 'ok'
                    : syncProgress.phase === 'error'
                      ? 'bad'
                      : 'warn'
                }
                label={syncLabel(syncProgress)}
              />
            ) : foregroundSyncState.isScanning ? (
              <StatusPill tone="warn" label="监听中" />
            ) : (
              <StatusPill tone="muted" label="等待广播" />
            )
          }
        >
          <Text style={styles.hint}>
            蓝牙连接成功后会自动订阅 TX Notify，接收、校验并上传设备主动发送的数据。
          </Text>
          <View style={styles.autoReceiveBox} accessibilityLiveRegion="polite">
            {syncBusy ? <ActivityIndicator color={colors.greenDark} /> : null}
            <Text style={styles.progressText}>
              {syncBusy
                ? '正在自动接收设备数据…'
                : !consentReady
                  ? '正在读取数据采集授权…'
                  : !consent
                    ? '开启数据采集授权后将自动接收'
                    : bt === 'connected' && bindingConfirmed
                      ? foregroundSyncState.isScanning
                        ? '正在监听设备广播，有数据时会自动接收'
                        : '等待下一轮设备广播扫描'
                      : bindingConfirmed
                        ? '蓝牙连接后将自动接收'
                        : '完成蓝牙验证后将自动接收'}
            </Text>
          </View>
          {syncProgress ? (
            <View style={styles.progressBox}>
              <Text style={styles.progressText}>{syncProgress.message}</Text>
              <Text style={styles.hint}>
                {formatExactByteSize(syncProgress.receivedBytes)} / {formatExactByteSize(syncProgress.pendingBytes)}
              </Text>
              <Text style={styles.hint}>
                当前 Block：{syncProgress.currentBlock || '—'} · 已接收 {syncProgress.receivedFrames ?? 0} 帧
                {syncProgress.phase === 'paused' ? ' · 正在等待重传' : ''}
              </Text>
            </View>
          ) : null}
          {receivePreview ? <BleReceivePreviewCard preview={receivePreview} /> : null}
          {uploadProgress ? (
            <View style={styles.progressBox}>
              <Text style={styles.progressText}>{uploadProgress.message}</Text>
            </View>
          ) : null}
          {uploadResult ? (
            <View style={styles.progressBox}>
              <Text style={styles.progressText}>
                已上传后端 · 批次 #{uploadResult.batchId}
              </Text>
              <Text style={styles.hint}>
                {uploadResult.files.length} 个文件 · {formatExactByteSize(uploadResult.totalBytes)}
              </Text>
            </View>
          ) : null}
          {!uploadProgress && pendingUploadState.deviceSn === deviceSn && pendingUploadState.message ? (
            <View style={styles.progressBox}>
              <Text style={pendingUploadState.phase === 'error' ? styles.error : styles.progressText}>
                {pendingUploadState.message}
              </Text>
            </View>
          ) : null}
          {!syncBusy && bt === 'connected' && syncProgress?.phase === 'error' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新接收设备数据"
              style={styles.btnGhost}
              onPress={retrySyncData}
            >
              <Text style={styles.btnGhostText}>重新接收</Text>
            </Pressable>
          ) : null}
        </SectionCard>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {appDevice?.bindStatus === 'pending_verification' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消添加此设备"
            style={[styles.cancelBtn, verificationBusy && styles.btnMuted]}
            disabled={verificationBusy}
            onPress={() => setCancelConfirmVisible(true)}
          >
            <Text style={styles.cancelBtnText}>取消添加此设备</Text>
          </Pressable>
        ) : null}

        <Pressable
          style={[styles.enterBtn, !canEnter && styles.btnMuted]}
          disabled={!canEnter}
          onPress={enterDetail}
        >
          <Text style={styles.btnText}>
            {canEnter ? `进入${deviceTypeLabel(type)}详情` : '请先验证蓝牙连接'}
          </Text>
        </Pressable>
        <ConfirmModal
          visible={cancelConfirmVisible}
          title="取消添加设备"
          message={`确定取消添加「${deviceName || deviceSn || '此设备'}」吗？之后可以重新扫描添加。`}
          confirmText="取消添加"
          destructive
          onConfirm={() => void cancelPendingVerification()}
          onCancel={() => setCancelConfirmVisible(false)}
        />
      </DesignScreen>
    </>
  );
}

function btLabel(s: BluetoothStatus): string {
  return s === 'connected' ? '已验证' : s === 'connecting' ? '验证中' : '未验证';
}

function AdvertisementSummary({ connected }: { connected: BleConnectedDevice }) {
  const advertisement = connected.advertisement;
  if (!advertisement) {
    return (
      <Text style={styles.hint}>
        验证方式：{connected.mode === 'native' ? '真实蓝牙' : '模拟蓝牙'} · 未解析到 SmartPet 广播内容
      </Text>
    );
  }

  return (
    <View style={styles.advertisementBox}>
      <Text style={styles.progressText}>
        广播 SN：{advertisement.serialNumber} · 电量 {advertisement.batteryLevel}%
      </Text>
      <Text style={styles.hint}>
        状态：
        {advertisement.status === 'listening'
          ? '侦听中'
          : advertisement.status === 'bark_deterrent_active'
            ? '止吠中'
            : '未知'}
        {' · '}模式：
        {advertisement.mode === 'training'
          ? '训狗'
          : advertisement.mode === 'anti_bark'
            ? '止吠'
            : '未知'}
        {' · '}待传数据：{advertisement.dataPending ? '有' : '无'}
      </Text>
      <Text style={styles.rawAdvertisement}>原始状态字节：{advertisement.rawStatusHex}</Text>
    </View>
  );
}

function syncLabel(p: DataSyncProgress): string {
  if (p.phase === 'complete') return '完成';
  if (p.phase === 'empty') return '无待同步';
  if (p.phase === 'error') return '失败';
  if (p.phase === 'paused') return '重传中';
  if (p.totalBlocks > 0) return `${p.currentBlock}/${p.totalBlocks}`;
  return '接收中';
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mint,
  },
  name: { fontSize: fontSize.title, fontWeight: '800', color: colors.ink },
  meta: { fontSize: fontSize.small, color: colors.muted, marginTop: 2 },
  hint: { fontSize: fontSize.small, color: colors.muted },
  error: { fontSize: fontSize.small, color: colors.red, fontWeight: '700' },
  progressBox: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.soft,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  autoReceiveBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.soft,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  progressText: { color: colors.ink, fontSize: fontSize.small, fontWeight: '700' },
  rawAdvertisement: { color: colors.greenDark, fontSize: fontSize.small, fontFamily: 'monospace' },
  advertisementBox: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.soft,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  btn: {
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnMuted: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '800' },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    backgroundColor: '#fff',
  },
  btnGhostText: { color: colors.greenDark, fontWeight: '800' },
  enterBtn: {
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  cancelBtn: { alignItems: 'center', padding: spacing.md },
  cancelBtnText: { color: colors.red, fontWeight: '700' },
});
