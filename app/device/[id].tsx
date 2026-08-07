import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ConfirmModal } from '../../src/components/ConfirmModal';
import { BleReceivePreviewCard } from '../../src/components/BleReceivePreviewCard';
import { LevelStepper } from '../../src/components/LevelStepper';
import { SectionCard } from '../../src/components/SectionCard';
import { StatusPill } from '../../src/components/StatusPill';
import { useConsent } from '../../src/consent/ConsentContext';
import { useAuth } from '../../src/auth/AuthContext';
import { devicesApi } from '../../src/api/devices';
import { bindingsApi } from '../../src/api/bindings';
import { petsApi } from '../../src/api/pets';
import {
  simulateBleAudioPullAndUpload,
  type AudioUploadProgress,
  type BleUploadResult,
} from '../../src/ble/audioUploadFlow';
import {
  getLatestConnectedSmartPetDevice,
  sendBarkSettingsBleCommand,
  sendTrainerBleCommand,
  type DataSyncProgress,
  type TrainerCommandPhase,
} from '../../src/ble/smartPetBle';
import { trainerCommandPhaseLabel } from '../../src/ble/trainerCommandPolicy';
import { usePendingUploads } from '../../src/ble/PendingUploadContext';
import { useForegroundBleSync } from '../../src/ble/ForegroundBleSyncProvider';
import type { BleFrameDiagnostic } from '../../src/ble/frameDiagnostic';
import type { SmartPetAdvertisement } from '../../src/ble/protocol';
import {
  formatExactByteSize,
  type BlePullPreview,
} from '../../src/ble/pullPreview';
import {
  bluetoothLabel,
  deviceTypeLabel,
  onlineLabel,
  resolveDeviceStatus,
} from '../../src/lib/deviceDisplay';
import { href } from '../../src/lib/nav';
import type { Device, DogSizeMode, TrainerCommand } from '../../src/types/domain';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

export default function DeviceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const deviceId = Number(id);

  const [device, setDevice] = useState<Device | null>(null);
  const [petName, setPetName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [advertisementOverride, setAdvertisementOverride] = useState<SmartPetAdvertisement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await devicesApi.get(deviceId);
      setDevice(d);
      const b = await bindingsApi.activeForDevice(deviceId);
      if (b) {
        const pet = await petsApi.get(b.petProfileId).catch(() => null);
        setPetName(pet?.name ?? null);
      } else {
        setPetName(null);
      }
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading && !device) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: '设备详情' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      </>
    );
  }

  if (!device) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: '设备详情' }} />
        <View style={styles.center}>
          <Text style={styles.meta}>未找到设备</Text>
        </View>
      </>
    );
  }

  const status = resolveDeviceStatus(device);
  const bleConnection = getLatestConnectedSmartPetDevice({
    deviceSn: device.deviceSn,
    deviceName: device.deviceName,
    deviceType: device.deviceType,
  });
  const nativeBleConnection = bleConnection?.mode === 'native' ? bleConnection : null;
  const advertisement = advertisementOverride ?? nativeBleConnection?.advertisement ?? null;
  const battery = advertisement?.batteryLevel ?? status.battery;
  const bluetooth = nativeBleConnection
    ? '本次蓝牙已验证'
    : bluetoothLabel(status.bluetooth);
  const workState = advertisement
    ? advertisement.status === 'listening'
      ? '侦听中（待机）'
      : advertisement.status === 'bark_deterrent_active'
        ? '止吠中'
        : '未知'
    : status.workState ?? '未知';
  const workMode = advertisement
    ? advertisement.mode === 'training'
      ? '训狗模式'
      : advertisement.mode === 'anti_bark'
        ? '止吠模式'
        : '未知'
    : null;

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: device.deviceName || deviceTypeLabel(device.deviceType) }}
      />
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <SectionCard>
          <Text style={styles.name}>{device.deviceName || device.deviceSn}</Text>
          <Text style={styles.meta}>
            {deviceTypeLabel(device.deviceType)} · {device.deviceSn}
          </Text>
          <View style={styles.pills}>
            <StatusPill
              tone={
                status.online === 'online'
                  ? 'ok'
                  : status.online === 'offline'
                    ? 'bad'
                    : 'muted'
              }
              label={onlineLabel(status.online)}
            />
            <StatusPill tone={nativeBleConnection ? 'ok' : 'muted'} label={bluetooth} />
            <StatusPill
              tone={battery == null ? 'muted' : battery < 20 ? 'bad' : battery < 50 ? 'warn' : 'ok'}
              label={
                battery == null
                  ? '电量未知'
                  : advertisement
                    ? `广播电量 ${battery}%`
                    : `电量 ${battery}%`
              }
            />
            <StatusPill tone="muted" label={`工作状态：${workState}`} />
            {workMode ? <StatusPill tone="muted" label={`工作模式：${workMode}`} /> : null}
            {advertisement ? (
              <StatusPill
                tone={advertisement.dataPending ? 'warn' : 'ok'}
                label={`待传数据：${advertisement.dataPending ? '有' : '无'}`}
              />
            ) : null}
          </View>
          <Text style={styles.bleSource}>
            {advertisement
              ? '状态来源：本次真实 BLE 广播'
              : '暂未获取到设备实时状态，完成蓝牙连接后可查看电量和工作状态。'}
          </Text>
          <Pressable style={styles.verifyBtn} onPress={() => router.push(connectionSetupHref(device))}>
            <Ionicons name="bluetooth-outline" size={16} color={colors.greenDark} />
            <Text style={styles.verifyText}>蓝牙验证</Text>
          </Pressable>
        </SectionCard>

        <SectionCard
          title="关联宠物"
          right={
            <Pressable onPress={() => router.push(href(`/link-pet?deviceId=${device.id}`))}>
              <Text style={styles.link}>{petName ? '更换' : '关联'}</Text>
            </Pressable>
          }
        >
          <Text style={styles.meta}>{petName ? petName : '未关联宠物'}</Text>
        </SectionCard>

        {device.deviceType === 'trainer' ? (
          <TrainerControls device={device} />
        ) : device.deviceType === 'bark_stopper' ? (
          <BarkStopperControls device={device} />
        ) : (
          <SectionCard title="设备能力">
            <Text style={styles.meta}>
              该设备类型（{deviceTypeLabel(device.deviceType)}）暂无专属控制。绑定
              XG / ZF 前缀的设备码可体验训狗器 / 止吠器控制。
            </Text>
          </SectionCard>
        )}

        <BleSyncCard device={device} onAdvertisementUpdate={setAdvertisementOverride} />
      </ScrollView>
    </>
  );
}

// ── Trainer（issue-07）─────────────────────────────────────
function TrainerControls({ device }: { device: Device }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState<{
    key: string;
    phase: TrainerCommandPhase;
  } | null>(null);
  const [confirmShock, setConfirmShock] = useState(false);
  const [soundIntensity, setSoundIntensity] = useState(4);
  const [vibrationIntensity, setVibrationIntensity] = useState(8);
  const [shockIntensity, setShockIntensity] = useState(20);

  async function send(kind: TrainerCommand, enabled: boolean) {
    const label = trainerCommandLabel(kind);
    const action = enabled ? '启动' : '关闭';
    const commandKey = `${kind}-${enabled ? 'on' : 'off'}`;
    setSending({ key: commandKey, phase: 'checking_connection' });
    setFeedback(null);
    try {
      const result = await sendTrainerBleCommand(
        {
          deviceSn: device.deviceSn,
          deviceName: device.deviceName,
          deviceType: device.deviceType,
        },
        kind,
        enabled,
        enabled
          ? kind === 'sound'
            ? soundIntensity
            : kind === 'vibration'
              ? vibrationIntensity
              : kind === 'shock'
                ? shockIntensity
                : 0
          : 0,
        (phase) => {
          setSending((current) =>
            current?.key === commandKey ? { ...current, phase } : current,
          );
        },
      );
      if (result.ok) {
        setFeedback(
          result.device.mode === 'native'
            ? `设备已确认${action}${label}${result.intensity ? `，强度 ${result.intensity} 档` : ''}（${result.rawHex}）`
            : `已模拟确认${action}${label}`,
        );
      } else {
        setFeedback(result.error === 'crc_error' ? '设备报告命令 CRC 错误' : '设备报告命令格式错误');
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : `${action}${label}失败`);
    } finally {
      setSending(null);
      setTimeout(() => setFeedback(null), 3500);
    }
  }

  return (
    <>
      <SectionCard title="训狗控制">
        <Text style={styles.meta}>
          BLE V2 指令携带强度档位；App 收到设备确认响应后才显示执行成功。
        </Text>

        <TrainerActionBlock
          label="声音"
          kind="sound"
          color={colors.blue}
          sending={sending}
          intensity={soundIntensity}
          maxIntensity={8}
          onIntensityChange={setSoundIntensity}
          onStart={() => void send('sound', true)}
          onStop={() => void send('sound', false)}
        />
        <TrainerActionBlock
          label="震动"
          kind="vibration"
          color={colors.amber}
          sending={sending}
          intensity={vibrationIntensity}
          maxIntensity={16}
          onIntensityChange={setVibrationIntensity}
          onStart={() => void send('vibration', true)}
          onStop={() => void send('vibration', false)}
        />
        <TrainerActionBlock
          label="电击"
          kind="shock"
          color={colors.red}
          sending={sending}
          requiresConfirmation
          intensity={shockIntensity}
          maxIntensity={99}
          onIntensityChange={setShockIntensity}
          onStart={() => setConfirmShock(true)}
          onStop={() => void send('shock', false)}
        />
        <TrainerActionBlock
          label="灯光"
          kind="light"
          color={colors.green}
          sending={sending}
          onStart={() => void send('light', true)}
          onStop={() => void send('light', false)}
        />

        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
      </SectionCard>

      <ConfirmModal
        visible={confirmShock}
        title="确认启动电击"
        message={`将以 ${shockIntensity}/99 档启动电击。电击为强刺激，请确认当前操作对宠物是必要且安全的。`}
        confirmText="确认启动"
        destructive
        onConfirm={() => {
          setConfirmShock(false);
          void send('shock', true);
        }}
        onCancel={() => setConfirmShock(false)}
      />
    </>
  );
}

function TrainerActionBlock({
  label,
  kind,
  color,
  sending,
  requiresConfirmation = false,
  intensity,
  maxIntensity,
  onIntensityChange,
  onStart,
  onStop,
}: {
  label: string;
  kind: TrainerCommand;
  color: string;
  sending: { key: string; phase: TrainerCommandPhase } | null;
  requiresConfirmation?: boolean;
  intensity?: number;
  maxIntensity?: number;
  onIntensityChange?: (value: number) => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const disabled = sending !== null;
  const starting = sending?.key === `${kind}-on`;
  const stopping = sending?.key === `${kind}-off`;
  const phaseLabel = sending ? trainerCommandPhaseLabel(sending.phase) : '';
  return (
    <View style={styles.controlBlock}>
      <View style={styles.controlHeader}>
        <Text style={styles.controlLabel}>{label}</Text>
        {requiresConfirmation ? (
          <View style={styles.warnTag}>
            <Ionicons name="warning-outline" size={12} color={colors.red} />
            <Text style={styles.warnText}>启动需确认</Text>
          </View>
        ) : null}
      </View>
      {intensity !== undefined && maxIntensity && onIntensityChange ? (
        <IntensityControl
          value={intensity}
          max={maxIntensity}
          disabled={disabled}
          onChange={onIntensityChange}
        />
      ) : null}
      <View style={styles.trainerActions}>
        <Pressable
          style={[styles.trainerActionBtn, { backgroundColor: color }, disabled && styles.btnMuted]}
          disabled={disabled}
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel={`启动${label}`}
          accessibilityState={{ disabled, busy: starting }}
        >
          {starting ? (
            <View style={styles.trainerActionProgress}>
              <ActivityIndicator color="#fff" size="small" />
              <Text
                style={styles.sendText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {phaseLabel}
              </Text>
            </View>
          ) : (
            <Text style={styles.sendText}>启动{label}</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.trainerActionBtn, styles.trainerStopBtn, disabled && styles.btnMuted]}
          disabled={disabled}
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel={`关闭${label}`}
          accessibilityState={{ disabled, busy: stopping }}
        >
          {stopping ? (
            <View style={styles.trainerActionProgress}>
              <ActivityIndicator color={colors.ink} size="small" />
              <Text
                style={styles.trainerStopText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {phaseLabel}
              </Text>
            </View>
          ) : (
            <Text style={styles.trainerStopText}>关闭{label}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function IntensityControl({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const step = max >= 99 ? 5 : 1;
  return (
    <View style={styles.intensityRow}>
      <Text style={styles.meta}>强度</Text>
      <Pressable
        accessibilityLabel="降低强度"
        disabled={disabled || value <= 1}
        style={[styles.intensityButton, (disabled || value <= 1) && styles.btnMuted]}
        onPress={() => onChange(Math.max(1, value - step))}
      >
        <Text style={styles.intensityButtonText}>−</Text>
      </Pressable>
      <Text style={styles.intensityValue}>{value} / {max}</Text>
      <Pressable
        accessibilityLabel="提高强度"
        disabled={disabled || value >= max}
        style={[styles.intensityButton, (disabled || value >= max) && styles.btnMuted]}
        onPress={() => onChange(Math.min(max, value + step))}
      >
        <Text style={styles.intensityButtonText}>＋</Text>
      </Pressable>
    </View>
  );
}

function trainerCommandLabel(kind: TrainerCommand): string {
  if (kind === 'sound') return '声音';
  if (kind === 'vibration') return '震动';
  if (kind === 'shock') return '电击';
  return '灯光';
}

// ── Bark Stopper（issue-08）────────────────────────────────
function BarkStopperControls({ device }: { device: Device }) {
  const [sensitivity, setSensitivity] = useState(5);
  const [dogSize, setDogSize] = useState<DogSizeMode>('medium');
  const [barkCount, setBarkCount] = useState(12);
  const [barking, setBarking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!barking) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 300, useNativeDriver: false }),
      ]),
    );
    anim.start();
    const stop = setTimeout(() => setBarking(false), 2400);
    return () => {
      anim.stop();
      clearTimeout(stop);
    };
  }, [barking, pulse]);

  function simulateBark() {
    setBarkCount((c) => c + 1);
    setBarking(true);
  }

  async function saveSettings() {
    setSaving(true);
    setFeedback(null);
    try {
      const result = await sendBarkSettingsBleCommand(
        {
          deviceSn: device.deviceSn,
          deviceName: device.deviceName,
          deviceType: device.deviceType,
        },
        { sensitivity, dogSize },
      );
      setFeedback(result.mode === 'native' ? '设置已通过蓝牙同步到设备' : '设置已模拟同步到设备');
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : '设置同步失败');
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 2200);
    }
  }

  const bg = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.panel, '#ffe3df'],
  });

  const sizeOptions: { k: string; v: DogSizeMode }[] = [
    { k: '小型犬', v: 'small' },
    { k: '中型犬', v: 'medium' },
    { k: '大型犬', v: 'large' },
  ];

  return (
    <>
      <Animated.View style={[styles.barkCard, { backgroundColor: bg }]}>
        <View style={styles.barkHeader}>
          <Text style={styles.controlLabel}>吠叫检测</Text>
          <StatusPill tone={barking ? 'bad' : 'ok'} label={barking ? '检测到吠叫' : '安静'} />
        </View>
        <Text style={styles.barkCount}>{barkCount}</Text>
        <Text style={styles.meta}>累计吠叫次数</Text>
        <View style={styles.barkActions}>
          <Pressable style={styles.smallBtn} onPress={simulateBark}>
            <Text style={styles.smallBtnText}>模拟一次吠叫</Text>
          </Pressable>
          <Pressable style={[styles.smallBtn, styles.smallBtnGhost]} onPress={() => setConfirmClear(true)}>
            <Text style={[styles.smallBtnText, { color: colors.red }]}>计数清零</Text>
          </Pressable>
        </View>
      </Animated.View>

      <SectionCard title="止吠设置">
        <Text style={styles.controlLabel}>灵敏度</Text>
        <LevelStepper value={sensitivity} onChange={setSensitivity} color={colors.green} />

        <Text style={[styles.controlLabel, { marginTop: spacing.md }]}>犬型</Text>
        <View style={styles.segment}>
          {sizeOptions.map((o) => (
            <Pressable
              key={o.v}
              style={[styles.segBtn, dogSize === o.v && styles.segActive]}
              onPress={() => setDogSize(o.v)}
            >
              <Text style={[styles.segText, dogSize === o.v && styles.segTextActive]}>{o.k}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={[styles.sendBtn, saving && styles.btnMuted]} disabled={saving} onPress={() => void saveSettings()}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>保存并同步设置</Text>}
        </Pressable>
        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
      </SectionCard>

      <ConfirmModal
        visible={confirmClear}
        title="吠叫计数清零"
        message="确定将累计吠叫次数清零吗？此操作会同步到设备。"
        confirmText="清零"
        destructive
        onConfirm={() => {
          setBarkCount(0);
          setConfirmClear(false);
          setFeedback('计数已清零并同步');
          setTimeout(() => setFeedback(null), 1800);
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}

function BleSyncCard({
  device,
  onAdvertisementUpdate,
}: {
  device: Device;
  onAdvertisementUpdate: (advertisement: SmartPetAdvertisement) => void;
}) {
  const { consent, ready: consentReady } = useConsent();
  const { user } = useAuth();
  const { state: pendingUploadState } = usePendingUploads();
  const { state: foregroundSyncState, syncDevice: syncForegroundDevice } = useForegroundBleSync();
  const [progress, setProgress] = useState<DataSyncProgress | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<AudioUploadProgress | null>(null);
  const [uploadResult, setUploadResult] = useState<BleUploadResult | null>(null);
  const [pullPreview, setPullPreview] = useState<BlePullPreview | null>(null);
  const [frameDiagnostic, setFrameDiagnostic] = useState<BleFrameDiagnostic | null>(null);

  useEffect(() => {
    if (foregroundSyncState.deviceSn !== device.deviceSn) return;
    setProgress(foregroundSyncState.receiveProgress);
    setSyncing(
      foregroundSyncState.phase === 'receiving' || foregroundSyncState.phase === 'uploading',
    );
    setUploadProgress(foregroundSyncState.uploadProgress);
    setUploadResult(foregroundSyncState.uploadResult);
    setPullPreview(foregroundSyncState.preview);
    setFrameDiagnostic(foregroundSyncState.frameDiagnostic);
    setMessage(foregroundSyncState.message);
    if (foregroundSyncState.advertisement) {
      onAdvertisementUpdate(foregroundSyncState.advertisement);
    }
  }, [device.deviceSn, foregroundSyncState, onAdvertisementUpdate]);

  function retrySync() {
    void syncForegroundDevice(device);
  }

  async function simulateAudioUpload() {
    setUploadProgress(null);
    setUploadResult(null);
    if (!user) {
      setUploadProgress({ phase: 'generating', message: '登录状态已失效，请重新登录' });
      return;
    }
    if (!consentReady || !consent) {
      setUploadProgress({ phase: 'generating', message: '请先在“我的”页面开启数据采集授权' });
      return;
    }

    setUploading(true);
    try {
      const result = await simulateBleAudioPullAndUpload(
        {
          id: device.id,
          deviceSn: device.deviceSn,
          petProfileId: device.currentPetProfileId,
          appUserId: user.id,
        },
        setUploadProgress,
      );
      setUploadResult(result);
    } catch (error) {
      setUploadProgress({
        phase: 'generating',
        message: error instanceof Error ? error.message : '模拟语音上传失败，本地文件已保留',
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <SectionCard
      title="蓝牙数据同步"
      right={syncing && progress
        ? <StatusPill tone={syncTone(progress)} label={syncLabel(progress)} />
        : foregroundSyncState.isScanning
          ? <StatusPill tone="warn" label="监听中" />
          : <StatusPill tone="muted" label="等待广播" />}
    >
      <Text style={styles.meta}>
        打开设备页后自动连接并订阅设备主动上传；逐帧校验、安全保存后自动上传后端。
      </Text>
      <View style={styles.syncBox} accessibilityLiveRegion="polite">
        {syncing ? <ActivityIndicator color={colors.greenDark} /> : null}
        <Text style={styles.feedback}>
          {syncing
            ? '正在自动连接并接收设备数据…'
            : !consentReady
              ? '正在读取数据采集授权…'
              : !consent
                ? '开启数据采集授权后将自动接收'
                : foregroundSyncState.isScanning
                  ? '正在监听设备广播，有数据时会自动接收'
                  : '等待下一轮设备广播扫描'}
        </Text>
      </View>
      {!syncing && progress?.phase === 'error' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新接收设备数据"
          style={styles.sendBtn}
          onPress={retrySync}
        >
          <Text style={styles.sendText}>重新接收</Text>
        </Pressable>
      ) : null}
      {progress ? (
        <View style={styles.syncBox}>
          <Text style={styles.feedback}>{progress.message}</Text>
          <Text style={styles.meta}>
            {formatExactByteSize(progress.receivedBytes)} / {formatExactByteSize(progress.pendingBytes)}
          </Text>
          <Text style={styles.meta}>
            当前 Block：{progress.currentBlock || '—'} · 已接收 {progress.receivedFrames ?? 0} 帧
            {progress.phase === 'paused' ? ' · 正在等待重传' : ''}
          </Text>
        </View>
      ) : null}
      {frameDiagnostic ? (
        <View style={styles.diagnosticBox} accessibilityLabel="首帧诊断信息">
          <Text style={styles.diagnosticTitle}>首帧诊断</Text>
          <Text style={styles.meta}>
            错误：{frameDiagnostic.code} · 长度：{frameDiagnostic.byteLength} 字节
          </Text>
          <Text style={styles.previewLabel}>设备返回的原始 HEX</Text>
          <Text selectable style={styles.previewBytes}>
            {frameDiagnostic.rawHex || '空'}
          </Text>
          <Text style={styles.diagnosticHint}>{frameDiagnostic.hint}</Text>
          <Text selectable style={styles.meta}>解析信息：{frameDiagnostic.parserMessage}</Text>
        </View>
      ) : null}
      {pullPreview ? <BleReceivePreviewCard preview={pullPreview} /> : null}
      {!uploadProgress && pendingUploadState.deviceSn === device.deviceSn && pendingUploadState.message ? (
        <View style={styles.syncBox}>
          <Text style={pendingUploadState.phase === 'error' ? styles.errorText : styles.feedback}>
            {pendingUploadState.message}
          </Text>
        </View>
      ) : null}
      {message ? <Text style={styles.feedback}>{message}</Text> : null}

      <View style={styles.controlBlock}>
        <Text style={styles.controlLabel}>上传链路模拟测试</Text>
        <Text style={styles.meta}>
          生成一段有效 WAV，模拟“BLE 语音已接收并进入本地队列”，再上传后端并完成批次。此项不代表固件已输出真实语音。
        </Text>
        <Pressable
          style={[styles.sendBtn, (uploading || syncing) && styles.btnMuted]}
          disabled={uploading || syncing}
          onPress={() => void simulateAudioUpload()}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendText}>模拟语音接收并上传 OSS</Text>
          )}
        </Pressable>
        {uploadProgress ? <Text style={styles.feedback}>{uploadProgress.message}</Text> : null}
        {uploadResult ? (
          <View style={styles.syncBox}>
            <Text style={styles.feedback}>批次 #{uploadResult.batchId}，状态：{uploadResult.batchStatus}</Text>
            <Text style={styles.meta}>{uploadResult.files.length} 个文件 · {formatExactByteSize(uploadResult.totalBytes)}</Text>
            {uploadResult.files.map((file) => (
              <View key={file.fileId}>
                <Text style={styles.meta}>Block {file.blockId} · 文件 #{file.fileId} · {formatExactByteSize(file.fileSize)}</Text>
                <Text selectable style={styles.meta}>存储路径：{file.storagePath}</Text>
                <Text selectable style={styles.meta}>服务端哈希：{file.fileHash}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </SectionCard>
  );
}

function connectionSetupHref(device: Device) {
  const query = new URLSearchParams({
    deviceId: String(device.id),
    deviceSn: device.deviceSn,
    deviceName: device.deviceName ?? '',
  });
  return href(`/connection-setup?${query.toString()}`);
}

function syncLabel(p: DataSyncProgress): string {
  if (p.phase === 'complete') return '完成';
  if (p.phase === 'empty') return '无数据';
  if (p.phase === 'error') return '失败';
  if (p.phase === 'paused') return '重传中';
  if (p.totalBlocks > 0) return `${p.currentBlock}/${p.totalBlocks}`;
  return '接收中';
}

function syncTone(p: DataSyncProgress): 'ok' | 'warn' | 'bad' {
  if (p.phase === 'complete' || p.phase === 'empty') return 'ok';
  if (p.phase === 'error') return 'bad';
  return 'warn';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  name: { fontSize: fontSize.header, fontWeight: '800', color: colors.ink },
  meta: { fontSize: fontSize.small, color: colors.muted },
  bleSource: { fontSize: fontSize.small, color: colors.greenDark, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  link: { color: colors.greenDark, fontWeight: '800' },
  btnMuted: { opacity: 0.5 },
  controlBlock: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md },
  trainerActions: { flexDirection: 'row', gap: spacing.sm },
  intensityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  intensityButton: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  intensityButtonText: { color: colors.ink, fontSize: fontSize.body, fontWeight: '800' },
  intensityValue: {
    minWidth: 64,
    textAlign: 'center',
    color: colors.ink,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  trainerActionBtn: { flex: 1, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
  trainerActionProgress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  trainerStopBtn: { backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.line },
  trainerStopText: { color: colors.ink, fontWeight: '800' },
  controlHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlLabel: { fontSize: fontSize.body, fontWeight: '800', color: colors.ink },
  warnTag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: '#fdeceb', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  warnText: { color: colors.red, fontSize: fontSize.tiny, fontWeight: '700' },
  sendBtn: { backgroundColor: colors.green, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
  sendText: { color: '#fff', fontWeight: '800' },
  feedback: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '700' },
  errorText: { color: colors.red, fontSize: fontSize.small, fontWeight: '700' },
  verifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  verifyText: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '800' },
  syncBox: { backgroundColor: colors.soft, borderRadius: radius.sm, padding: spacing.md, gap: spacing.xs },
  diagnosticBox: {
    backgroundColor: '#FFF7E8',
    borderWidth: 1,
    borderColor: '#E8C98D',
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  diagnosticTitle: { color: colors.ink, fontSize: fontSize.body, fontWeight: '800' },
  diagnosticHint: { color: '#8A5A00', fontSize: fontSize.small, fontWeight: '700' },
  previewBox: {
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  previewLabel: { color: colors.muted, fontSize: fontSize.tiny, fontWeight: '700' },
  blockSummaryList: { gap: spacing.xs },
  blockSummaryText: { color: colors.ink, fontSize: fontSize.small, fontWeight: '700' },
  frameHeaderList: { gap: spacing.sm },
  frameHeaderItem: { gap: spacing.xs },
  frameHeaderMeta: { color: colors.muted, fontSize: fontSize.tiny },
  previewBytes: {
    color: colors.ink,
    fontSize: fontSize.tiny,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  barkCard: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: spacing.lg, gap: spacing.xs },
  barkHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barkCount: { fontSize: 44, fontWeight: '900', color: colors.ink },
  barkActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  smallBtn: { flex: 1, backgroundColor: colors.green, borderRadius: radius.sm, padding: spacing.sm, alignItems: 'center' },
  smallBtnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.red },
  smallBtnText: { color: '#fff', fontWeight: '800', fontSize: fontSize.small },
  segment: { flexDirection: 'row', backgroundColor: colors.soft, borderRadius: radius.sm, padding: spacing.xs },
  segBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm - 2 },
  segActive: { backgroundColor: colors.panel },
  segText: { color: colors.muted, fontWeight: '700' },
  segTextActive: { color: colors.greenDark },
});
