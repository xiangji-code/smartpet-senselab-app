import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  Pressable,
  RefreshControl,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedbackState } from '../../src/components/feedback-state';
import { ApiError, authorizedMediaSource } from '../../src/api/client';
import { devicesApi } from '../../src/api/devices';
import { InlineError } from '../../src/components/inline-error';
import { PromptModal } from '../../src/components/PromptModal';
import { StatusPill } from '../../src/components/StatusPill';
import {
  getBleConnectionsSnapshot,
  getLatestConnectedSmartPetDevice,
  subscribeBleConnections,
} from '../../src/ble/smartPetBle';
import { useDevicesWithPets } from '../../src/hooks/useDevicesWithPets';
import {
  deviceTypeLabel,
  onlineLabel,
  resolveDeviceStatus,
} from '../../src/lib/deviceDisplay';
import { href } from '../../src/lib/nav';
import type { Device } from '../../src/types/domain';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

export default function DevicesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { devices, petById, petNameByDevice, loading, error, reload } = useDevicesWithPets();
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  useSyncExternalStore(
    subscribeBleConnections,
    getBleConnectionsSnapshot,
    getBleConnectionsSnapshot,
  );

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const connectedDeviceCount = devices.reduce(
    (count, device) => count + (isDeviceBleConnected(device) ? 1 : 0),
    0,
  );
  const pets = Object.values(petById);
  const openRename = (device: Device) => {
    setRenameError(null);
    setEditingDevice(device);
  };

  const renameDevice = async (deviceName: string) => {
    if (!editingDevice || renameBusy) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      await devicesApi.rename(editingDevice.id, deviceName.trim());
      setEditingDevice(null);
      await reload();
    } catch (cause) {
      setRenameError(cause instanceof ApiError ? cause.message : '设备名称保存失败，请稍后重试');
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      >
        {error && devices.length > 0 ? (
          <InlineError message={error} retryLabel="重新加载" retrying={loading} onRetry={() => void reload()} />
        ) : null}

        {loading && devices.length === 0 && pets.length === 0 ? (
          <FeedbackState icon="hardware-chip-outline" title="正在加载设备" description="正在获取当前账号下的设备信息" loading />
        ) : error && devices.length === 0 && pets.length === 0 ? (
          <FeedbackState icon="cloud-offline-outline" title="设备列表加载失败" description={error} actionLabel="重新加载" onAction={() => void reload()} />
        ) : (
          <>
            <View style={styles.sectionTitleRow}>
              <SectionTitle title="我的宠物" subtitle="宠物档案与关联设备" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="添加宠物"
                style={styles.sectionAdd}
                onPress={() => router.push(href('/pets/new'))}
              >
                <Ionicons name="add" size={17} color="#fff" />
                <Text style={styles.sectionAddText}>添加</Text>
              </Pressable>
            </View>
            {pets.length === 0 ? (
              <Pressable style={styles.emptyPetCard} onPress={() => router.push(href('/pets/new'))}>
                <View style={styles.petAvatar}><Ionicons name="paw-outline" size={22} color={colors.greenDark} /></View>
                <View style={styles.petCopy}>
                  <Text style={styles.petName}>去创建宠物档案</Text>
                  <Text style={styles.petMeta}>添加宠物资料和头像</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ) : (
              <View style={styles.petList}>
                {pets.map((pet) => (
                  <Pressable key={pet.id} style={styles.petCard} onPress={() => router.push(href(`/pets/${pet.id}`))}>
                    <View style={styles.petAvatar}>
                      {pet.avatarUrl ? <Image source={authorizedMediaSource(pet.avatarUrl)} style={styles.petAvatarImage} /> : <Text style={styles.petInitials}>{initials(pet.name)}</Text>}
                    </View>
                    <View style={styles.petCopy}>
                      <Text style={styles.petName}>{pet.name}</Text>
                      <Text style={styles.petMeta}>{pet.breed || pet.species || '宠物档案'}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Pressable>
                ))}
              </View>
            )}

            <View style={styles.sectionTitleRow}>
              <SectionTitle title="当前设备" subtitle="查看连接、电量和关联宠物" />
              <Pressable accessibilityRole="button" accessibilityLabel="添加设备" style={styles.sectionAdd} onPress={() => router.push(href('/(tabs)/bind'))}>
                <Ionicons name="add" size={17} color="#fff" /><Text style={styles.sectionAddText}>添加</Text>
              </Pressable>
            </View>
            {devices.length > 0 ? (
              <View
                accessible
                accessibilityLabel={`蓝牙已连接 ${connectedDeviceCount}/${devices.length} 台`}
                accessibilityLiveRegion="polite"
                style={styles.bleSummary}
              >
                <View style={styles.bleSummaryLabel}>
                  <View style={styles.bleSummaryIcon}>
                    <Ionicons name="bluetooth-outline" size={17} color={colors.greenDark} />
                  </View>
                  <Text style={styles.bleSummaryText}>蓝牙已连接</Text>
                </View>
                <Text style={styles.bleSummaryCount}>{connectedDeviceCount}/{devices.length} 台</Text>
              </View>
            ) : null}
            {devices.length === 0 ? (
              <FeedbackState icon="hardware-chip-outline" title="还没有绑定设备" description="扫描二维码或输入设备码开始添加" actionLabel="添加设备" onAction={() => router.push(href('/(tabs)/bind'))} />
            ) : (
              <View style={styles.deviceList}>
                {devices.map((device) => (
                  <CompactDeviceCard
                    key={device.id}
                    device={device}
                    petName={petNameByDevice[device.id] ?? undefined}
                    onEditName={() => openRename(device)}
                    onPress={() => router.push(deviceHref(device))}
                  />
                ))}
              </View>
            )}

          </>
        )}
      </ScrollView>
      <PromptModal
        visible={editingDevice !== null}
        title="编辑设备名称"
        placeholder="请输入设备名称"
        initialValue={editingDevice?.deviceName || editingDevice?.deviceSn || ''}
        confirmText="保存名称"
        busy={renameBusy}
        error={renameError}
        maxLength={120}
        onConfirm={(value) => void renameDevice(value)}
        onCancel={() => {
          if (renameBusy) return;
          setEditingDevice(null);
          setRenameError(null);
        }}
      />
    </View>
  );
}

function CompactDeviceCard({
  device,
  petName,
  onEditName,
  onPress,
}: {
  device: Device;
  petName?: string;
  onEditName: () => void;
  onPress: () => void;
}) {
  const state = resolveDeviceStatus(device);
  const connection = getLatestConnectedSmartPetDevice({
    deviceSn: device.deviceSn,
    deviceName: device.deviceName,
    deviceType: device.deviceType,
  });
  const advertisement = connection?.mode === 'native' ? connection.advertisement : null;
  const battery = advertisement?.batteryLevel ?? state.battery;
  const connected = connection?.mode === 'native';
  const connectionLabel = connected ? '蓝牙已连接' : '蓝牙未连接';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看设备 ${device.deviceName || device.deviceSn}，${connectionLabel}`}
      style={({ pressed }) => [styles.deviceCard, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.deviceIcon}>
        <Text style={styles.deviceInitial}>{deviceTypeLabel(device.deviceType).slice(0, 1)}</Text>
      </View>
      <View style={styles.deviceCopy}>
        <View style={styles.deviceNameRow}>
          <Text selectable numberOfLines={1} style={styles.deviceName}>{device.deviceName || device.deviceSn}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`编辑设备 ${device.deviceName || device.deviceSn} 的名称`}
            hitSlop={11}
            style={({ pressed }) => [styles.editNameButton, pressed && styles.pressed]}
            onPress={(event) => {
              event.stopPropagation();
              onEditName();
            }}
          >
            <Ionicons name="create-outline" size={16} color={colors.greenDark} />
          </Pressable>
        </View>
        <Text numberOfLines={1} style={styles.deviceMeta}>{deviceTypeLabel(device.deviceType)}{petName ? ` · 已关联 ${petName}` : ''}</Text>
        <View style={styles.pills}>
          <StatusPill tone={connected ? 'ok' : 'muted'} label={connectionLabel} />
          <StatusPill tone={battery == null ? 'muted' : battery < 20 ? 'bad' : 'ok'} label={battery == null ? '电量未知' : `${battery}% 电量`} />
        </View>
      </View>
      <View style={styles.deviceAction}>
        <Text style={styles.controlText}>{device.bindStatus === 'pending_verification' ? '继续验证' : '进入控制'}</Text>
        <Ionicons name="chevron-forward" size={15} color="#fff" />
      </View>
    </Pressable>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function isDeviceBleConnected(device: Device): boolean {
  return getLatestConnectedSmartPetDevice({
    deviceSn: device.deviceSn,
    deviceName: device.deviceName,
    deviceType: device.deviceType,
  })?.mode === 'native';
}

function deviceHref(device: Device) {
  if (device.bindStatus !== 'pending_verification') return href(`/device/${device.id}`);
  const query = new URLSearchParams({
    deviceId: String(device.id),
    deviceSn: device.deviceSn,
    deviceName: device.deviceName ?? '',
  });
  return href(`/connection-setup?${query.toString()}`);
}

function initials(value: string) {
  const letters = value.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2);
  return letters.toUpperCase() || 'SP';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.72 },
  content: { padding: spacing.lg, gap: spacing.md },
  petList: { gap: spacing.sm },
  petCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.panel },
  emptyPetCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.green, backgroundColor: colors.panel },
  petAvatar: { width: 44, height: 44, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.mint },
  petAvatarImage: { width: '100%', height: '100%' },
  petInitials: { color: colors.indigo, fontSize: fontSize.small, fontWeight: '900' },
  petCopy: { flex: 1, minWidth: 0, gap: 2 },
  petName: { color: colors.ink, fontSize: fontSize.body, fontWeight: '900' },
  petMeta: { color: colors.muted, fontSize: fontSize.tiny },
  sectionHeading: { gap: 2, paddingTop: 2 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionAdd: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.green },
  sectionAddText: { color: '#fff', fontSize: fontSize.tiny, fontWeight: '800' },
  sectionTitle: { color: colors.indigo, fontSize: fontSize.body, fontWeight: '900' },
  sectionSubtitle: { color: colors.muted, fontSize: fontSize.tiny },
  bleSummary: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.mint },
  bleSummaryLabel: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bleSummaryIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panel },
  bleSummaryText: { flexShrink: 1, color: colors.greenDark, fontSize: fontSize.small, fontWeight: '800' },
  bleSummaryCount: { color: colors.indigo, fontSize: fontSize.body, fontWeight: '900', fontVariant: ['tabular-nums'] },
  deviceList: { gap: spacing.sm },
  deviceCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.panel },
  cardPressed: { backgroundColor: colors.surfaceAlt, borderColor: colors.lineStrong },
  deviceIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.indigoSoft },
  deviceInitial: { color: colors.indigo, fontSize: fontSize.small, fontWeight: '900' },
  deviceCopy: { flex: 1, minWidth: 0, gap: 2 },
  deviceNameRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  deviceName: { flexShrink: 1, color: colors.ink, fontSize: fontSize.small, fontWeight: '900' },
  editNameButton: { width: 22, height: 24, alignItems: 'center', justifyContent: 'center' },
  deviceMeta: { color: colors.muted, fontSize: 11 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingTop: 3 },
  deviceAction: { flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 9, minHeight: 32, borderRadius: radius.sm, backgroundColor: colors.green },
  controlText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
