import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
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
  connectSmartPetDevice,
  disconnectSmartPetDevice,
  getBleConnectionsSnapshot,
  getLatestConnectedSmartPetDevice,
  getSmartPetBleConnectionStatus,
  MAX_AUTO_RECONNECT_ATTEMPTS,
  sendBarkSettingsBleCommand,
  sendTrainerBleCommand,
  subscribeBleConnections,
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
  deviceTypeLabel,
  onlineLabel,
  resolveDeviceStatus,
} from '../../src/lib/deviceDisplay';
import { describeBleSignal } from '../../src/lib/bleSignal';
import { clampIntensity, intensityFromHorizontalPosition } from '../../src/lib/circular-intensity';
import { href } from '../../src/lib/nav';
import type { Device, DogSizeMode, TrainerCommand } from '../../src/types/domain';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

const SHOW_INTERNAL_TEST_UI = process.env.EXPO_PUBLIC_SMARTPET_INTERNAL_TEST_UI !== 'hidden';

export default function DeviceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const deviceId = Number(id);

  const [device, setDevice] = useState<Device | null>(null);
  const [petName, setPetName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [advertisementOverride, setAdvertisementOverride] = useState<SmartPetAdvertisement | null>(null);
  const [bleAction, setBleAction] = useState<'connecting' | 'disconnecting' | null>(null);
  const [bleError, setBleError] = useState<string | null>(null);
  useSyncExternalStore(
    subscribeBleConnections,
    getBleConnectionsSnapshot,
    getBleConnectionsSnapshot,
  );

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
  const reconnectStatus = getSmartPetBleConnectionStatus({
    deviceSn: device.deviceSn,
    deviceName: device.deviceName,
    deviceType: device.deviceType,
  });
  const nativeBleConnection = bleConnection?.mode === 'native' ? bleConnection : null;
  const reconnecting = !nativeBleConnection && reconnectStatus.state === 'reconnecting';
  const signal = nativeBleConnection ? describeBleSignal(reconnectStatus.rssi) : null;
  const currentAdvertisement = nativeBleConnection?.advertisement ?? null;
  const advertisementCached = nativeBleConnection?.advertisementSource === 'cached';
  const advertisement = currentAdvertisement ?? advertisementOverride;
  const battery = advertisement?.batteryLevel ?? status.battery;
  const bluetooth = bleAction === 'connecting'
    ? '蓝牙连接中'
    : bleAction === 'disconnecting'
      ? '蓝牙断开中'
      : reconnecting
        ? '自动重连中'
        : nativeBleConnection
        ? '蓝牙已连接'
        : '蓝牙未连接';
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

  async function toggleBluetoothConnection(target: Device) {
    if (bleAction) return;
    setBleError(null);
    const scanTarget = {
      deviceSn: target.deviceSn,
      deviceName: target.deviceName,
      deviceType: target.deviceType,
    };
    if (nativeBleConnection || reconnecting) {
      setBleAction('disconnecting');
      try {
        await disconnectSmartPetDevice(nativeBleConnection?.id, scanTarget);
        setAdvertisementOverride(null);
      } catch (cause) {
        setBleError(cause instanceof Error ? cause.message : '断开蓝牙失败，请重试');
      } finally {
        setBleAction(null);
      }
      return;
    }

    setBleAction('connecting');
    try {
      const connected = await connectSmartPetDevice(scanTarget);
      setAdvertisementOverride(connected.advertisement ?? null);
    } catch (cause) {
      setBleError(cause instanceof Error ? cause.message : '蓝牙连接失败，请确认设备已开启并在附近');
    } finally {
      setBleAction(null);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: device.deviceType === 'trainer'
            ? SHOW_INTERNAL_TEST_UI ? '训狗器遥控器' : '训狗器详情'
            : device.deviceName || deviceTypeLabel(device.deviceType),
          headerStyle: { backgroundColor: colors.indigo },
          headerTintColor: '#FFFFFF',
          headerTitleAlign: 'center',
          headerShadowVisible: false,
        }}
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
            <StatusPill
              tone={nativeBleConnection ? 'ok' : bleAction || reconnecting ? 'warn' : 'muted'}
              label={bluetooth}
            />
            {nativeBleConnection ? (
              <StatusPill
                tone={!signal ? 'muted' : signal.level === 'weak' ? 'bad' : signal.level === 'fair' ? 'warn' : 'ok'}
                label={signal?.label ?? '信号检测中'}
              />
            ) : null}
            <StatusPill
              tone={battery == null ? 'muted' : battery < 20 ? 'bad' : battery < 50 ? 'warn' : 'ok'}
              label={
                battery == null
                  ? '电量未知'
                  : advertisement
                    ? `${advertisementCached ? '最近广播电量' : '本次广播电量'} ${battery}%`
                    : `电量 ${battery}%`
              }
            />
            <StatusPill
              tone="muted"
              label={`${advertisementCached ? '最近广播' : advertisement ? '本次广播' : ''}工作状态：${workState}`}
            />
            {workMode ? (
              <StatusPill
                tone="muted"
                label={`${advertisementCached ? '最近广播' : '本次广播'}工作模式：${workMode}`}
              />
            ) : null}
            {advertisement ? (
              <StatusPill
                tone={advertisement.dataPending ? 'warn' : 'ok'}
                label={`${advertisementCached ? '最近广播' : '本次广播'}待传数据：${advertisement.dataPending ? '有' : '无'}`}
              />
            ) : null}
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.bleSource}>
            {nativeBleConnection && currentAdvertisement
              ? advertisementCached
                ? '状态来源：最近一次设备广播（非实时）；蓝牙信号每 5 秒检测一次。'
                : '状态来源：本次连接前的设备广播；蓝牙信号每 5 秒检测一次。'
              : nativeBleConnection
                ? '蓝牙已连接；蓝牙信号每 5 秒检测一次。'
                 : reconnecting
                  ? reconnectStatus.reconnectPhase === 'paused'
                    ? '等待数据传输完成后继续重连。'
                    : `${reconnectStatus.reconnectPhase === 'scanning' ? '正在搜寻设备' : reconnectStatus.reconnectPhase === 'connecting' ? '正在连接' : '等待重连'}（第 ${reconnectStatus.attempt}/${MAX_AUTO_RECONNECT_ATTEMPTS} 次）。`
                  : advertisement
                    ? '状态来源：最近一次 BLE 广播快照；当前蓝牙未连接。'
                    : '尚未获取设备广播；下次扫描到设备时会显示广播电量和工作状态。'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nativeBleConnection ? '断开蓝牙' : reconnecting ? '停止自动重连' : '连接蓝牙'}
            accessibilityState={{ busy: bleAction !== null, disabled: bleAction !== null }}
            disabled={bleAction !== null}
            style={[styles.bleConnectionBtn, bleAction && styles.btnMuted]}
            onPress={() => void toggleBluetoothConnection(device)}
          >
            <Ionicons name="bluetooth-outline" size={16} color={colors.greenDark} />
            <Text style={styles.bleConnectionText}>
              {bleAction === 'connecting'
                ? '正在连接蓝牙'
                : bleAction === 'disconnecting'
                  ? '正在断开蓝牙'
                  : nativeBleConnection
                    ? '断开蓝牙'
                    : reconnecting
                      ? '停止自动重连'
                      : '连接蓝牙'}
            </Text>
          </Pressable>
          {bleError ? <Text accessibilityRole="alert" style={styles.errorText}>{bleError}</Text> : null}
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

        {SHOW_INTERNAL_TEST_UI ? (
          device.deviceType === 'trainer' ? (
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
          )
        ) : null}

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
  const [soundIntensity, setSoundIntensity] = useState(4);
  const [vibrationIntensity, setVibrationIntensity] = useState(8);
  const [shockIntensity, setShockIntensity] = useState(20);
  const [selectedCommand, setSelectedCommand] = useState<TrainerCommand>('shock');

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

  const selectedIntensity = selectedCommand === 'sound' ? soundIntensity : selectedCommand === 'vibration' ? vibrationIntensity : selectedCommand === 'shock' ? shockIntensity : 0;
  const selectedMax = selectedCommand === 'sound' ? 8 : selectedCommand === 'vibration' ? 16 : selectedCommand === 'shock' ? 99 : 0;
  const changeSelectedIntensity = (delta: number) => {
    if (selectedCommand === 'sound') setSoundIntensity((value) => Math.max(1, Math.min(8, value + delta)));
    if (selectedCommand === 'vibration') setVibrationIntensity((value) => Math.max(1, Math.min(16, value + delta)));
    if (selectedCommand === 'shock') setShockIntensity((value) => Math.max(1, Math.min(99, value + delta)));
  };
  const setSelectedIntensity = (value: number) => {
    if (selectedCommand === 'sound') setSoundIntensity(clampIntensity(value, 8));
    if (selectedCommand === 'vibration') setVibrationIntensity(clampIntensity(value, 16));
    if (selectedCommand === 'shock') setShockIntensity(clampIntensity(value, 99));
  };

  return (
    <>
      <SectionCard title="遥控器" right={<View style={styles.safetyPill}><Ionicons name="shield-checkmark" size={14} color={colors.greenDark} /><Text style={styles.safetyPillText}>安全回执</Text></View>}>
        <View style={styles.commandGrid}>
          <RemoteMode icon="flash-outline" label="电击" danger active={selectedCommand === 'shock'} onPress={() => setSelectedCommand('shock')} />
          <RemoteMode icon="volume-high-outline" label="声音" active={selectedCommand === 'sound'} onPress={() => setSelectedCommand('sound')} />
          <RemoteMode icon="phone-portrait-outline" label="震动" active={selectedCommand === 'vibration'} onPress={() => setSelectedCommand('vibration')} />
          <RemoteMode icon="flashlight-outline" label="灯光" active={selectedCommand === 'light'} onPress={() => setSelectedCommand('light')} />
        </View>

        <View style={styles.remoteDialArea}>
          {selectedCommand === 'light' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="发送灯光指令"
              accessibilityHint="点击后立即发送并等待设备回执"
              accessibilityState={{ disabled: sending !== null, busy: sending !== null }}
              disabled={sending !== null}
              style={({ pressed }) => [styles.remoteDialStatic, pressed && styles.remoteDialPressed, sending && styles.btnMuted]}
              onPress={() => void send('light', true)}
            >
              <View style={styles.remoteDialInner}>
                {sending ? <ActivityIndicator color={colors.greenDark} /> : <Text style={styles.remoteDialLabel}>灯光</Text>}
                <Text style={styles.remoteDialValue}>{sending ? trainerCommandPhaseLabel(sending.phase) : '点击触发'}</Text>
              </View>
            </Pressable>
          ) : (
            <CircularIntensityDial
              danger={selectedCommand === 'shock'}
              disabled={sending !== null}
              label={trainerCommandLabel(selectedCommand)}
              max={selectedMax}
              sendingPhase={sending ? trainerCommandPhaseLabel(sending.phase) : null}
              value={selectedIntensity}
              onActivate={() => void send(selectedCommand, true)}
            />
          )}
          {selectedCommand !== 'light' ? <View style={styles.dialStepper}>
            <RepeatingStepButton
              accessibilityLabel="降低强度一档"
              disabled={sending !== null || selectedIntensity <= 1}
              symbol="−"
              onStep={() => changeSelectedIntensity(-1)}
            />
            <HorizontalIntensitySlider
              danger={selectedCommand === 'shock'}
              disabled={sending !== null}
              max={selectedMax}
              value={selectedIntensity}
              onChange={setSelectedIntensity}
            />
            <RepeatingStepButton
              accessibilityLabel="提高强度一档"
              disabled={sending !== null || selectedIntensity >= selectedMax}
              symbol="+"
              onStep={() => changeSelectedIntensity(1)}
            />
          </View> : null}
        </View>

      </SectionCard>

      {feedback ? (
        <View accessibilityLiveRegion="polite" style={styles.commandFeedback}>
          <Ionicons name="checkmark-circle" size={18} color={colors.greenDark} />
          <Text style={styles.commandFeedbackText}>{feedback}</Text>
        </View>
      ) : null}
    </>
  );
}

function TrainerActionBlock({
  label,
  description,
  icon,
  kind,
  color,
  sending,
  danger = false,
  intensity,
  maxIntensity,
  onIntensityChange,
  onStart,
  onStop,
}: {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  kind: TrainerCommand;
  color: string;
  sending: { key: string; phase: TrainerCommandPhase } | null;
  danger?: boolean;
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
    <View style={[styles.remoteControl, danger && styles.remoteControlDanger]}>
      <View style={styles.controlHeader}>
        <View style={[styles.controlIcon, { backgroundColor: `${color}18` }]}>
          <Ionicons name={icon} size={22} color={color} />
        </View>
        <View style={styles.remoteIntroCopy}>
          <Text style={[styles.controlLabel, danger && styles.controlLabelDanger]}>{label}</Text>
          <Text style={styles.controlDescription}>{description}</Text>
        </View>
        {intensity !== undefined && maxIntensity ? (
          <View style={[styles.intensityBadge, danger && styles.intensityBadgeDanger]}>
            <Text style={[styles.intensityBadgeValue, danger && styles.controlLabelDanger]}>{intensity}</Text>
            <Text style={styles.intensityBadgeMax}>/{maxIntensity}</Text>
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
          style={({ pressed }) => [
            styles.trainerActionBtn,
            { backgroundColor: color },
            pressed && styles.trainerActionPressed,
            disabled && styles.btnMuted,
          ]}
          disabled={disabled}
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel={`启动${label}`}
          accessibilityHint={danger ? '打开安全确认后发送指令' : '发送指令并等待设备确认'}
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
          style={({ pressed }) => [
            styles.trainerActionBtn,
            styles.trainerStopBtn,
            pressed && styles.trainerStopPressed,
            disabled && styles.btnMuted,
          ]}
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

const DIAL_SIZE = 132;

function CircularIntensityDial({
  danger,
  disabled,
  label,
  max,
  sendingPhase,
  value,
  onActivate,
}: {
  danger: boolean;
  disabled: boolean;
  label: string;
  max: number;
  sendingPhase: string | null;
  value: number;
  onActivate: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`发送${label}指令，当前强度 ${value} 档`}
      accessibilityHint="点击后立即发送并等待设备回执"
      accessibilityState={{ disabled, busy: disabled }}
      disabled={disabled}
      onPress={onActivate}
      style={({ pressed }) => [
        styles.remoteDialInner,
        danger && styles.remoteDialInnerDanger,
        pressed && styles.remoteDialPressed,
        disabled && styles.btnMuted,
      ]}
    >
      {sendingPhase ? (
        <>
          <ActivityIndicator color="#FFFFFF" />
          <Text style={styles.remoteDialValue}>{sendingPhase}</Text>
        </>
      ) : (
        <>
          <View style={styles.remoteDialActionRow}>
            <Ionicons name="play" size={16} color="#FFFFFF" />
            <Text style={styles.remoteDialLabel}>{label}</Text>
          </View>
          <Text style={styles.remoteDialValue}>{value} / {max}</Text>
          <View style={styles.remoteDialCue}>
            <Text style={styles.remoteDialCueText}>点击发送</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

function RepeatingStepButton({
  accessibilityLabel,
  disabled,
  symbol,
  onStep,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  symbol: '−' | '+';
  onStep: () => void;
}) {
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const didRepeat = useRef(false);
  const onStepRef = useRef(onStep);

  useEffect(() => {
    onStepRef.current = onStep;
  }, [onStep]);

  const stopRepeating = useCallback(() => {
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }, []);

  useEffect(() => stopRepeating, [stopRepeating]);

  useEffect(() => {
    if (disabled) stopRepeating();
  }, [disabled, stopRepeating]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      delayLongPress={350}
      style={[styles.dialStepButton, disabled && styles.btnMuted]}
      onPressIn={() => {
        didRepeat.current = false;
      }}
      onLongPress={() => {
        if (disabled) return;
        didRepeat.current = true;
        onStepRef.current();
        stopRepeating();
        repeatTimer.current = setInterval(() => onStepRef.current(), 100);
      }}
      onPressOut={stopRepeating}
      onPress={() => {
        if (!didRepeat.current) onStepRef.current();
      }}
    >
      <Text style={styles.dialStepText}>{symbol}</Text>
    </Pressable>
  );
}

function HorizontalIntensitySlider({
  danger,
  disabled,
  max,
  value,
  onChange,
}: {
  danger: boolean;
  disabled: boolean;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const sliderRef = useRef<View>(null);
  const sliderOrigin = useRef(0);
  const sliderWidth = useRef(0);
  const activeColor = danger ? colors.red : colors.green;
  const progress = value / max;

  const measureSlider = useCallback(() => {
    sliderRef.current?.measureInWindow((x, _y, width) => {
      sliderOrigin.current = x;
      sliderWidth.current = width;
    });
  }, []);

  const updateFromPageX = useCallback((pageX: number) => {
    onChange(
      intensityFromHorizontalPosition(
        pageX - sliderOrigin.current,
        sliderWidth.current,
        max,
      ),
    );
  }, [max, onChange]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onStartShouldSetPanResponderCapture: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponderCapture: () => !disabled,
      onPanResponderGrant: (event) => {
        measureSlider();
        updateFromPageX(event.nativeEvent.pageX);
      },
      onPanResponderMove: (_, gesture) => updateFromPageX(gesture.moveX),
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    }),
    [disabled, measureSlider, updateFromPageX],
  );

  return (
    <View
      ref={sliderRef}
      accessibilityRole="adjustable"
      accessibilityLabel="强度档位"
      accessibilityHint="点击或左右拖动调节强度"
      accessibilityState={{ disabled }}
      accessibilityValue={{ min: 1, max, now: value, text: `${value} 档，共 ${max} 档` }}
      accessibilityActions={[
        { name: 'increment', label: '提高一档' },
        { name: 'decrement', label: '降低一档' },
      ]}
      onAccessibilityAction={(event) => onChange(
        value + (event.nativeEvent.actionName === 'increment' ? 1 : -1),
      )}
      onLayout={measureSlider}
      style={[styles.intensitySlider, disabled && styles.btnMuted]}
      {...panResponder.panHandlers}
    >
      <View pointerEvents="none" style={styles.intensitySliderTrack}>
        <View style={[styles.intensitySliderFill, { backgroundColor: activeColor, width: `${progress * 100}%` }]} />
        <View style={[styles.intensitySliderThumb, { backgroundColor: activeColor, left: `${progress * 100}%` }]} />
      </View>
      <Text pointerEvents="none" style={styles.intensitySliderLabel}>强度 {value}/{max}</Text>
    </View>
  );
}

function RemoteMode({ icon, label, active, danger = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active: boolean; danger?: boolean; onPress: () => void }) {
  const foreground = danger ? '#FFFFFF' : active ? '#FFFFFF' : colors.greenDark;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={`选择${label}指令`}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.remoteMode,
        danger && styles.remoteModeDanger,
        active && !danger && styles.remoteModeActive,
        pressed && styles.remoteModePressed,
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={25} color={foreground} />
      <Text style={[styles.remoteModeText, (active || danger) && styles.remoteModeTextActive]}>{label}</Text>
      <View style={[styles.remoteModeCue, (active || danger) && styles.remoteModeCueStrong]}>
        <Text style={[styles.remoteModeCueText, (active || danger) && styles.remoteModeCueTextStrong]}>{active ? '已选择' : '点击选择'}</Text>
      </View>
    </Pressable>
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
    <View style={styles.intensityPanel}>
      <View style={styles.intensityLabelRow}>
        <Text style={styles.intensityLabel}>强度</Text>
        <View style={styles.intensityTrack}>
          <View style={[styles.intensityFill, { width: `${Math.max(4, (value / max) * 100)}%` }]} />
        </View>
      </View>
      <View style={styles.intensityActions}>
      <Pressable
        accessibilityLabel="降低强度"
        accessibilityRole="button"
        disabled={disabled || value <= 1}
        style={[styles.intensityButton, (disabled || value <= 1) && styles.btnMuted]}
        onPress={() => onChange(Math.max(1, value - step))}
      >
        <Text style={styles.intensityButtonText}>−</Text>
      </Pressable>
      <Text accessibilityLabel={`当前强度 ${value}，最高 ${max}`} style={styles.intensityValue}>
        {value} / {max}
      </Text>
      <Pressable
        accessibilityLabel="提高强度"
        accessibilityRole="button"
        disabled={disabled || value >= max}
        style={[styles.intensityButton, (disabled || value >= max) && styles.btnMuted]}
        onPress={() => onChange(Math.min(max, value + step))}
      >
        <Text style={styles.intensityButtonText}>＋</Text>
      </Pressable>
      </View>
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
        : !consentReady
          ? <StatusPill tone="warn" label="准备监听" />
          : !consent
            ? <StatusPill tone="muted" label="监听未开启" />
            : foregroundSyncState.isScanning
              ? <StatusPill tone="warn" label="监听中" />
              : <StatusPill tone="ok" label="监听已开启" />}
    >
      <Text style={styles.meta}>
        App 在前台时会监听设备待传数据；发现数据后自动连接、逐帧校验并安全上传后端。
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
                  : '待传广播监听已开启，发现数据后会自动接收'}
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

      {SHOW_INTERNAL_TEST_UI ? <View style={styles.controlBlock}>
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
      </View> : null}
    </SectionCard>
  );
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
  commandGrid: { flexDirection: 'row', gap: spacing.sm },
  remoteMode: {
    flex: 1,
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderBottomWidth: 4,
    borderColor: colors.lineStrong,
    borderBottomColor: '#B8CBC8',
    borderRadius: radius.sm,
    backgroundColor: colors.mint,
    boxShadow: '0 3px 6px rgba(16, 27, 77, 0.12)',
  },
  remoteModeActive: { borderColor: colors.greenDark, borderBottomColor: '#226D65', backgroundColor: colors.green },
  remoteModeDanger: { borderColor: '#C93329', borderBottomColor: '#A72720', backgroundColor: colors.red },
  remoteModePressed: { transform: [{ translateY: 2 }], opacity: 0.82, boxShadow: '0 1px 2px rgba(16, 27, 77, 0.12)' },
  remoteModeText: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '800' },
  remoteModeTextActive: { color: '#FFFFFF' },
  remoteModeCue: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: '#FFFFFF' },
  remoteModeCueStrong: { backgroundColor: 'rgba(255, 255, 255, 0.22)' },
  remoteModeCueText: { color: colors.greenDark, fontSize: 9, fontWeight: '800' },
  remoteModeCueTextStrong: { color: '#FFFFFF' },
  remoteDialArea: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  remoteDialStatic: { width: DIAL_SIZE, height: DIAL_SIZE, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.green },
  remoteDialPressed: { transform: [{ scale: 0.93 }], opacity: 0.88 },
  remoteDialInner: { width: DIAL_SIZE, height: DIAL_SIZE, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: radius.pill, backgroundColor: colors.green, boxShadow: '0 6px 14px rgba(16, 24, 64, 0.24)' },
  remoteDialInnerDanger: { backgroundColor: colors.red },
  remoteDialActionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  remoteDialLabel: { color: '#FFFFFF', fontSize: fontSize.title, fontWeight: '900' },
  remoteDialValue: { color: 'rgba(255, 255, 255, 0.9)', fontSize: fontSize.small, fontWeight: '800', fontVariant: ['tabular-nums'] },
  remoteDialCue: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: 'rgba(255, 255, 255, 0.22)' },
  remoteDialCueText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  dialStepper: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  dialStepButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.soft },
  dialStepText: { color: colors.indigo, fontSize: 24, fontWeight: '800' },
  intensitySlider: { flex: 1, minWidth: 120, height: 64, position: 'relative' },
  intensitySliderTrack: { position: 'absolute', top: 20, left: 0, right: 0, height: 8, borderRadius: radius.pill, backgroundColor: colors.line },
  intensitySliderFill: { height: '100%', borderRadius: radius.pill },
  intensitySliderThumb: { position: 'absolute', top: -6, width: 20, height: 20, marginLeft: -10, borderRadius: radius.pill, borderWidth: 3, borderColor: colors.panel },
  intensitySliderLabel: { position: 'absolute', top: 40, left: 0, right: 0, color: colors.muted, fontSize: fontSize.small, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  remotePrimary: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.green },
  remotePrimaryText: { color: '#FFFFFF', fontWeight: '900' },
  remoteStop: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.sm, backgroundColor: colors.panel },
  remoteStopText: { color: colors.ink, fontWeight: '800' },
  designDangerButton: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.sm, backgroundColor: colors.red },
  designDangerTitle: { color: '#FFFFFF', fontSize: fontSize.body, fontWeight: '900' },
  designDangerCaption: { color: '#FFE2DF', fontSize: fontSize.tiny, marginTop: 2 },
  safetyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.mint,
  },
  safetyPillText: { color: colors.greenDark, fontSize: fontSize.tiny, fontWeight: '800' },
  remoteIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.indigoSoft,
  },
  remoteIntroIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.panel,
  },
  remoteIntroCopy: { flex: 1, minWidth: 0 },
  remoteIntroTitle: { color: colors.indigo, fontSize: fontSize.body, fontWeight: '800' },
  remoteControl: {
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  remoteControlDanger: { borderColor: '#F2B5B0', backgroundColor: colors.dangerSurface },
  trainerActions: { flexDirection: 'row', gap: spacing.sm },
  intensityPanel: { gap: spacing.sm },
  intensityLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  intensityLabel: { color: colors.muted, fontSize: fontSize.small, fontWeight: '700' },
  intensityTrack: {
    flex: 1,
    height: 6,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.line,
  },
  intensityFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.green },
  intensityActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  intensityButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  intensityButtonText: { color: colors.indigo, fontSize: 22, fontWeight: '700' },
  intensityValue: {
    minWidth: 80,
    textAlign: 'center',
    color: colors.indigo,
    fontSize: fontSize.title,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  intensityBadge: {
    minWidth: 58,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.blueSoft,
  },
  intensityBadgeDanger: { backgroundColor: '#FFD9D5' },
  intensityBadgeValue: { color: colors.indigo, fontSize: fontSize.title, fontWeight: '900' },
  intensityBadgeMax: { color: colors.muted, fontSize: fontSize.tiny, fontWeight: '700' },
  trainerActionBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trainerActionPressed: { opacity: 0.82 },
  trainerActionProgress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  trainerStopBtn: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.lineStrong },
  trainerStopPressed: { backgroundColor: colors.soft },
  trainerStopText: { color: colors.ink, fontWeight: '800' },
  controlHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  controlIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  controlLabel: { fontSize: fontSize.title, fontWeight: '800', color: colors.indigo },
  controlLabelDanger: { color: colors.red },
  controlDescription: { marginTop: 2, color: colors.muted, fontSize: fontSize.small },
  warnTag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: '#fdeceb', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  warnText: { color: colors.red, fontSize: fontSize.tiny, fontWeight: '700' },
  sendBtn: { backgroundColor: colors.green, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
  sendText: { color: '#fff', fontWeight: '800' },
  feedback: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '700' },
  dangerPanel: {
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: '#F2B5B0',
    borderRadius: radius.lg,
    backgroundColor: colors.dangerSurface,
  },
  dangerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dangerIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: '#FFD9D5',
  },
  dangerTitle: { color: colors.red, fontSize: fontSize.body, fontWeight: '900' },
  dangerDescription: { marginTop: 2, color: colors.muted, fontSize: fontSize.small, lineHeight: 19 },
  commandFeedback: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#B8DCD5',
    borderRadius: radius.md,
    backgroundColor: colors.mint,
  },
  commandFeedbackText: { flex: 1, color: colors.greenDark, fontSize: fontSize.small, fontWeight: '700' },
  errorText: { color: colors.red, fontSize: fontSize.small, fontWeight: '700' },
  bleConnectionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  bleConnectionText: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '800' },
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
