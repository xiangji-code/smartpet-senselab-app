import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { lastAccountStore } from '../src/auth/lastAccountStore';
import {
  clearAllPendingBleBlocks,
  getPendingBleQueueStats,
  type BleQueueStats,
} from '../src/ble/blockQueue';
import { clearBleTransferDiagnostics } from '../src/ble/transferDiagnostics';
import { appCache, type CacheStats } from '../src/cache/cacheStore';
import { ConfirmModal } from '../src/components/ConfirmModal';
import { DesignScreen } from '../src/components/design-screen';
import { PageBackButton } from '../src/components/page-back-button';
import { SectionCard } from '../src/components/SectionCard';
import { useConsent } from '../src/consent/ConsentContext';
import { colors, fontSize, radius, spacing } from '../src/theme/theme';

const EMPTY_CACHE_STATS: CacheStats = {
  entryCount: 0,
  sizeBytes: 0,
  oldestUpdatedAt: null,
  newestUpdatedAt: null,
};
const EMPTY_QUEUE_STATS: BleQueueStats = {
  ownedCount: 0,
  ownedBytes: 0,
  unassignedCount: 0,
  unassignedBytes: 0,
  otherAccountCount: 0,
  otherAccountBytes: 0,
};

interface ClearSelection {
  pageCache: boolean;
  loginSession: boolean;
  accountPreferences: boolean;
  pendingDeviceFiles: boolean;
}

const DEFAULT_CLEAR_SELECTION: ClearSelection = {
  pageCache: true,
  loginSession: true,
  accountPreferences: true,
  pendingDeviceFiles: true,
};

export default function StorageCacheScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { clearConsent, ready: consentReady } = useConsent();
  const [cacheStats, setCacheStats] = useState(EMPTY_CACHE_STATS);
  const [queueStats, setQueueStats] = useState(EMPTY_QUEUE_STATS);
  const [selection, setSelection] = useState<ClearSelection>({
    ...DEFAULT_CLEAR_SELECTION,
  });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [nextCacheStats, nextQueueStats] = await Promise.all([
        appCache.stats(user.id),
        getPendingBleQueueStats(user.id),
      ]);
      setCacheStats(nextCacheStats);
      setQueueStats(nextQueueStats);
    } catch {
      setError('暂时无法读取本地存储信息');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void loadStats();
    }, [loadStats]),
  );

  async function clearSelectedContent() {
    if (!user || clearing || selectedCount === 0) return;
    setConfirmClear(false);
    setClearing(true);
    setError(null);
    try {
      if (selection.pageCache) {
        await Promise.all([appCache.clearUser(user.id), clearBleTransferDiagnostics()]);
      }
      if (selection.accountPreferences) {
        await Promise.all([lastAccountStore.clear(), clearConsent()]);
      }
      if (selection.pendingDeviceFiles) {
        await clearAllPendingBleBlocks();
      }
      if (selection.loginSession) {
        await signOut();
        return;
      }
      await loadStats();
      setClearing(false);
    } catch {
      setError('部分内容未能清除，请稍后重试');
      setClearing(false);
    }
  }

  function toggleSelection(key: keyof ClearSelection) {
    if (clearing) return;
    setSelection((current) => ({ ...current, [key]: !current[key] }));
  }

  const queuedCount =
    queueStats.ownedCount + queueStats.unassignedCount + queueStats.otherAccountCount;
  const queuedBytes =
    queueStats.ownedBytes + queueStats.unassignedBytes + queueStats.otherAccountBytes;
  const selectedCount = Object.values(selection).filter(Boolean).length;
  const selectionUnavailable =
    loading || clearing || selectedCount === 0 || (selection.accountPreferences && !consentReady);
  const selectedNames = [
    selection.pageCache ? '页面缓存' : null,
    selection.loginSession ? '登录状态' : null,
    selection.accountPreferences ? '登录邮箱与隐私选择' : null,
    selection.pendingDeviceFiles ? '待上传设备文件' : null,
  ].filter((item): item is string => item !== null);
  const actionText =
    selectedCount === 0
      ? '请选择要清除的内容'
      : selection.loginSession
        ? '清除所选内容并退出登录'
        : '清除所选内容';
  const confirmMessage = [
    `将清除：${selectedNames.join('、')}。`,
    selection.loginSession ? '完成后需要重新登录。' : '当前登录状态将保留。',
    selection.pendingDeviceFiles ? '待上传设备文件删除后无法恢复。' : '',
  ]
    .filter(Boolean)
    .join('');

  return (
    <DesignScreen
      title="存储与缓存"
      subtitle="管理本机数据、隐私授权和帮助入口"
      leading={<PageBackButton color="#FFFFFF" onPress={() => router.back()} />}
    >
      <View style={styles.summary}>
        <View style={styles.summaryIcon}>
          <Ionicons name="phone-portrait-outline" size={24} color={colors.greenDark} />
        </View>
        <View style={styles.summaryBody}>
          <Text style={styles.eyebrow}>本账号缓存</Text>
          {loading ? (
            <ActivityIndicator color={colors.green} style={styles.loader} />
          ) : (
            <Text style={styles.totalSize}>{formatBytes(cacheStats.sizeBytes)}</Text>
          )}
          <Text style={styles.meta}>设备、宠物、绑定、记录和消息会保存在本机，打开页面时自动更新。</Text>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SectionCard title="缓存内容">
        <InfoRow
          icon="albums-outline"
          title="本地数据"
          value={`${cacheStats.entryCount} 项 · ${formatBytes(cacheStats.sizeBytes)}`}
        />
        <View style={styles.divider} />
        <InfoRow
          icon="time-outline"
          title="自动管理"
          value="30 天或达到 10 MB"
        />
        <Text style={styles.note}>
          App 会优先显示本机数据，再从服务器刷新；缓存不会改变蓝牙实时状态。
        </Text>
      </SectionCard>

      <SectionCard title="待上传设备数据">
        <InfoRow
          icon="cloud-upload-outline"
          title="待上传文件"
          value={`${queuedCount} 个文件 · ${formatBytes(queuedBytes)}`}
        />
        <Text style={styles.note}>
          这些文件尚未上传到服务器。默认会随本次操作清除；如需保留，请取消下方对应勾选。
        </Text>
        {queueStats.unassignedCount + queueStats.otherAccountCount > 0 ? (
          <View style={styles.warning}>
            <Ionicons name="shield-outline" size={18} color={colors.greenDark} />
            <Text style={styles.warningText}>
              本机还有 {queueStats.unassignedCount + queueStats.otherAccountCount}{' '}
              个旧版或其他账号文件，勾选清除后也会一并删除。
            </Text>
          </View>
        ) : null}
      </SectionCard>

      <SectionCard title="选择要清除的内容">
        <Text style={styles.selectionHint}>默认全部勾选，点击任意一项可取消。</Text>
        <SelectionRow
          checked={selection.pageCache}
          title="页面缓存"
          description="设备、宠物、绑定、记录和消息"
          onPress={() => toggleSelection('pageCache')}
        />
        <View style={styles.divider} />
        <SelectionRow
          checked={selection.loginSession}
          title="登录状态"
          description="清除后返回登录页"
          onPress={() => toggleSelection('loginSession')}
        />
        <View style={styles.divider} />
        <SelectionRow
          checked={selection.accountPreferences}
          title="登录邮箱与隐私选择"
          description="下次使用时需要重新填写和确认"
          onPress={() => toggleSelection('accountPreferences')}
        />
        <View style={styles.divider} />
        <SelectionRow
          checked={selection.pendingDeviceFiles}
          title="待上传设备文件"
          description="删除后无法恢复"
          onPress={() => toggleSelection('pendingDeviceFiles')}
        />
      </SectionCard>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionText}
        disabled={selectionUnavailable}
        style={({ pressed }) => [
          styles.clearButton,
          selectionUnavailable && styles.disabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => setConfirmClear(true)}
      >
        {clearing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="trash-outline" size={19} color="#fff" />
            <Text style={styles.clearText}>{actionText}</Text>
          </>
        )}
      </Pressable>

      <SectionCard title="相关设置">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="前往隐私数据授权设置"
          style={({ pressed }) => [styles.relatedRow, pressed && styles.buttonPressed]}
          onPress={() => router.push('/(tabs)/me')}
        >
          <View style={styles.smallIcon}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.greenDark} />
          </View>
          <View style={styles.relatedCopy}>
            <Text style={styles.selectionTitle}>隐私数据授权</Text>
            <Text style={styles.selectionDescription}>在“我的”中管理声音、行为和状态数据授权</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="前往帮助与设备连接指南"
          style={({ pressed }) => [styles.relatedRow, pressed && styles.buttonPressed]}
          onPress={() => router.push('/(tabs)/me')}
        >
          <View style={styles.smallIcon}>
            <Ionicons name="help-circle-outline" size={18} color={colors.greenDark} />
          </View>
          <Text style={styles.infoTitle}>帮助与设备连接指南</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      </SectionCard>

      <ConfirmModal
        visible={confirmClear}
        title={selection.loginSession ? '清除所选内容并退出？' : '清除所选内容？'}
        message={confirmMessage}
        confirmText={selection.loginSession ? '清除并退出' : '确认清除'}
        destructive
        onConfirm={() => void clearSelectedContent()}
        onCancel={() => setConfirmClear(false)}
      />
    </DesignScreen>
  );
}

function InfoRow({
  icon,
  title,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.smallIcon}>
        <Ionicons name={icon} size={18} color={colors.greenDark} />
      </View>
      <Text style={styles.infoTitle}>{title}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function SelectionRow({
  checked,
  title,
  description,
  onPress,
}: {
  checked: boolean;
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${title}，${description}`}
      accessibilityState={{ checked }}
      hitSlop={4}
      style={({ pressed }) => [styles.selectionRow, pressed && styles.selectionPressed]}
      onPress={onPress}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={24}
        color={checked ? colors.red : colors.muted}
      />
      <View style={styles.selectionBody}>
        <Text style={styles.selectionTitle}>{title}</Text>
        <Text style={styles.selectionDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  buttonPressed: { opacity: 0.72 },
  summary: {
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.indigo,
  },
  summaryIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: '#dff5eb',
  },
  summaryBody: { flex: 1 },
  eyebrow: { color: '#B9C8E8', fontSize: fontSize.tiny, fontWeight: '800' },
  totalSize: { color: '#fff', fontSize: 30, fontWeight: '900', marginVertical: 2 },
  loader: { alignSelf: 'flex-start', marginVertical: spacing.sm },
  meta: { color: '#D6DDF1', fontSize: fontSize.small, lineHeight: 19 },
  error: {
    color: colors.red,
    fontSize: fontSize.small,
    paddingHorizontal: spacing.sm,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  smallIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.mint,
  },
  infoTitle: { flex: 1, color: colors.ink, fontSize: fontSize.body, fontWeight: '700' },
  infoValue: { color: colors.muted, fontSize: fontSize.small, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  note: { color: colors.muted, fontSize: fontSize.small, lineHeight: 20 },
  warning: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.mint,
  },
  warningText: { flex: 1, color: colors.greenDark, fontSize: fontSize.small, lineHeight: 19 },
  selectionHint: { color: colors.muted, fontSize: fontSize.small, lineHeight: 20 },
  selectionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  selectionPressed: { opacity: 0.65 },
  selectionBody: { flex: 1, gap: 2 },
  selectionTitle: { color: colors.ink, fontSize: fontSize.body, fontWeight: '700' },
  selectionDescription: { color: colors.muted, fontSize: fontSize.small, lineHeight: 18 },
  clearButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.red,
  },
  disabled: { opacity: 0.55 },
  clearText: { color: '#fff', fontSize: fontSize.body, fontWeight: '800' },
  relatedRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  relatedCopy: { flex: 1, gap: 2 },
});
