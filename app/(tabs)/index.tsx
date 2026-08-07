import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmModal } from '../../src/components/ConfirmModal';
import { FeedbackState } from '../../src/components/feedback-state';
import { InlineError } from '../../src/components/inline-error';
import { PageHeader } from '../../src/components/page-header';
import { PromptModal } from '../../src/components/PromptModal';
import { StatusPill } from '../../src/components/StatusPill';
import { devicesApi } from '../../src/api/devices';
import { useAuth } from '../../src/auth/AuthContext';
import { getLatestConnectedSmartPetDevice } from '../../src/ble/smartPetBle';
import { useDevicesWithPets } from '../../src/hooks/useDevicesWithPets';
import {
  bluetoothLabel,
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
  const { refreshDevices } = useAuth();
  const { devices, petNameByDevice, loading, error, reload } = useDevicesWithPets();

  const [renameTarget, setRenameTarget] = useState<Device | null>(null);
  const [unbindTarget, setUnbindTarget] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function doRename(name: string) {
    if (!renameTarget) return;
    setBusy(true);
    try {
      await devicesApi.rename(renameTarget.id, name.trim() || null);
      setRenameTarget(null);
      await reload();
      await refreshDevices();
    } finally {
      setBusy(false);
    }
  }

  async function doUnbind() {
    if (!unbindTarget) return;
    setBusy(true);
    try {
      if (unbindTarget.bindStatus === 'pending_verification') {
        await devicesApi.cancelVerification(unbindTarget.id);
      } else {
        await devicesApi.unbind(unbindTarget.id);
      }
      setUnbindTarget(null);
      await reload();
      await refreshDevices();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PageHeader
          title="我的设备"
          subtitle={
            devices.length > 0
              ? `${devices.filter((device) => device.bindStatus === 'bound').length} 台已绑定 · ${devices.filter((device) => device.bindStatus === 'pending_verification').length} 台待验证`
              : '添加并连接你的设备'
          }
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加设备"
              style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
              onPress={() => router.push(href('/(tabs)/bind'))}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addText}>添加</Text>
            </Pressable>
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      >
        {error && devices.length > 0 ? (
          <InlineError
            message={error}
            retryLabel="重新加载设备"
            retrying={loading}
            onRetry={() => void reload()}
          />
        ) : null}

        {loading && devices.length === 0 ? (
          <View style={styles.state}>
            <FeedbackState
              icon="hardware-chip-outline"
              title="正在加载设备"
              description="正在获取当前账号下的设备信息"
              loading
            />
          </View>
        ) : error && devices.length === 0 ? (
          <View style={styles.state}>
            <FeedbackState
              icon="cloud-offline-outline"
              title="设备列表加载失败"
              description={error}
              actionLabel="重新加载"
              onAction={() => void reload()}
            />
          </View>
        ) : devices.length === 0 ? (
          <View style={styles.state}>
            <FeedbackState
              icon="hardware-chip-outline"
              title="还没有绑定设备"
              description="绑定后可在这里查看设备并进入连接设置"
              actionLabel="去绑定设备"
              onAction={() => router.push(href('/(tabs)/bind'))}
            />
          </View>
        ) : (
          devices.map((d) => {
            const status = resolveDeviceStatus(d);
            const bleConnection = getLatestConnectedSmartPetDevice({
              deviceSn: d.deviceSn,
              deviceName: d.deviceName,
              deviceType: d.deviceType,
            });
            const nativeBleConnection = bleConnection?.mode === 'native' ? bleConnection : null;
            const advertisement = nativeBleConnection?.advertisement ?? null;
            const battery = advertisement?.batteryLevel ?? status.battery;
            const bluetooth = nativeBleConnection
              ? '本次蓝牙已验证'
              : bluetoothLabel(status.bluetooth);
            const petName = petNameByDevice[d.id];
            return (
              <Pressable
                key={d.id}
                accessibilityRole="button"
                accessibilityLabel={`查看设备 ${d.deviceName || d.deviceSn} 详情`}
                accessibilityHint="打开设备详情页"
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() =>
                  router.push(
                    d.bindStatus === 'pending_verification'
                      ? connectionSetupHref(d)
                      : href(`/device/${d.id}`),
                  )
                }
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardIcon}>
                    <Ionicons name="hardware-chip-outline" size={22} color={colors.greenDark} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{d.deviceName || d.deviceSn}</Text>
                    <Text style={styles.meta}>
                      {deviceTypeLabel(d.deviceType)} · {d.deviceSn}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </View>

                <View style={styles.pills}>
                  {d.bindStatus === 'pending_verification' ? (
                    <StatusPill tone="warn" label="待蓝牙验证" />
                  ) : null}
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
                    tone={nativeBleConnection ? 'ok' : 'muted'}
                    label={bluetooth}
                  />
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
                  {d.bindStatus === 'bound' ? (
                    <StatusPill
                      tone={petName ? 'ok' : 'muted'}
                      label={petName ? `宠物：${petName}` : '未关联宠物'}
                    />
                  ) : null}
                </View>

                <View style={styles.actions}>
                  {d.bindStatus === 'bound' ? <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`修改 ${d.deviceName || d.deviceSn} 的名称`}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      pressed && styles.actionBtnPressed,
                    ]}
                    onPress={(event) => {
                      event.stopPropagation();
                      setRenameTarget(d);
                    }}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.ink} />
                    <Text style={styles.actionText}>改名</Text>
                  </Pressable> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`为 ${d.deviceName || d.deviceSn} 进行蓝牙验证`}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      pressed && styles.actionBtnPressed,
                    ]}
                    onPress={(event) => {
                      event.stopPropagation();
                      router.push(connectionSetupHref(d));
                    }}
                  >
                    <Ionicons name="bluetooth-outline" size={16} color={colors.greenDark} />
                    <Text style={[styles.actionText, { color: colors.greenDark }]}>
                      {d.bindStatus === 'pending_verification' ? '继续验证' : '蓝牙连接'}
                    </Text>
                  </Pressable>
                  {d.bindStatus === 'bound' ? <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`为 ${d.deviceName || d.deviceSn} 关联宠物`}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      pressed && styles.actionBtnPressed,
                    ]}
                    onPress={(event) => {
                      event.stopPropagation();
                      router.push(href(`/link-pet?deviceId=${d.id}`));
                    }}
                  >
                    <Ionicons name="paw-outline" size={16} color={colors.ink} />
                    <Text style={styles.actionText}>关联宠物</Text>
                  </Pressable> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${d.bindStatus === 'pending_verification' ? '取消添加' : '解绑设备'} ${d.deviceName || d.deviceSn}`}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      pressed && styles.actionBtnPressed,
                    ]}
                    onPress={(event) => {
                      event.stopPropagation();
                      setUnbindTarget(d);
                    }}
                  >
                    <Ionicons
                      name={d.bindStatus === 'pending_verification' ? 'close-circle-outline' : 'unlink-outline'}
                      size={16}
                      color={colors.red}
                    />
                    <Text style={[styles.actionText, { color: colors.red }]}>
                      {d.bindStatus === 'pending_verification' ? '取消添加' : '设备解绑'}
                    </Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <PromptModal
        visible={renameTarget !== null}
        title="设备改名"
        placeholder="输入新的设备名称"
        initialValue={renameTarget?.deviceName || ''}
        allowEmpty
        onConfirm={(v) => void doRename(v)}
        onCancel={() => setRenameTarget(null)}
      />
      <ConfirmModal
        visible={unbindTarget !== null}
        title={unbindTarget?.bindStatus === 'pending_verification' ? '取消添加设备' : '解绑设备'}
        message={
          unbindTarget?.bindStatus === 'pending_verification'
            ? `确定取消添加「${unbindTarget?.deviceName || unbindTarget?.deviceSn}」吗？之后可以重新扫描添加。`
            : `确定解绑「${unbindTarget?.deviceName || unbindTarget?.deviceSn}」吗？解绑后将从列表移除，历史记录保留。`
        }
        confirmText={unbindTarget?.bindStatus === 'pending_verification' ? '取消添加' : '解绑'}
        destructive
        onConfirm={() => void doUnbind()}
        onCancel={() => setUnbindTarget(null)}
      />
    </View>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg },
  addBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.green,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  addBtnPressed: { backgroundColor: colors.greenPressed },
  addText: { color: '#fff', fontWeight: '800', fontSize: fontSize.small },
  content: { padding: spacing.lg, gap: spacing.md },
  state: { minHeight: 320, justifyContent: 'center' },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardPressed: { borderColor: colors.lineStrong, backgroundColor: colors.surfaceAlt },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mint,
  },
  name: { fontSize: fontSize.title, fontWeight: '800', color: colors.ink },
  meta: { fontSize: fontSize.small, color: colors.muted, marginTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  actionBtn: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  actionBtnPressed: { backgroundColor: colors.soft },
  actionText: { fontSize: fontSize.small, color: colors.ink, fontWeight: '700' },
});
