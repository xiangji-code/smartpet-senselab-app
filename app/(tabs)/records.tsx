import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../../src/api/client';
import { recordsApi, type RecordItem } from '../../src/api/records';
import { useAuth } from '../../src/auth/AuthContext';
import { useForegroundBleSync } from '../../src/ble/ForegroundBleSyncProvider';
import { cacheKeys } from '../../src/cache/cachePolicy';
import { appCache } from '../../src/cache/cacheStore';
import { FeedbackState } from '../../src/components/feedback-state';
import { InlineError } from '../../src/components/inline-error';
import { PageHeader } from '../../src/components/page-header';
import { StatusPill } from '../../src/components/StatusPill';
import { useDevicesWithPets } from '../../src/hooks/useDevicesWithPets';
import { formatBeijingDateTime } from '../../src/lib/dateTime';
import { deviceTypeLabel } from '../../src/lib/deviceDisplay';
import { href } from '../../src/lib/nav';
import type { RecordType } from '../../src/types/domain';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

type Range = 'all' | '24h' | '7d';

const PAGE_SIZE = 20;
interface RecordCacheSnapshot {
  items: RecordItem[];
  total: number;
  hasMore: boolean;
}
const TYPE_LABEL: Record<RecordType, string> = {
  bark: '吠叫',
  imu: 'IMU',
  motion: '运动',
};
const TYPE_TONE: Record<RecordType, 'bad' | 'warn' | 'ok'> = {
  bark: 'bad',
  imu: 'warn',
  motion: 'ok',
};

export default function RecordsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { state: foregroundSyncState } = useForegroundBleSync();
  const {
    devices,
    petById,
    loading: metadataLoading,
    error: metadataError,
    reload: reloadMetadata,
  } = useDevicesWithPets();
  const [deviceId, setDeviceId] = useState<number | undefined>();
  const [petProfileId, setPetProfileId] = useState<number | undefined>();
  const [type, setType] = useState<RecordType | undefined>();
  const [range, setRange] = useState<Range>('all');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const recordsRef = useRef<RecordItem[]>([]);
  const lastBleRefreshRef = useRef<number | null>(null);

  const pets = useMemo(
    () => Object.values(petById).sort((a, b) => a.name.localeCompare(b.name)),
    [petById],
  );

  const from = useMemo(() => {
    if (range === '24h') return new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    if (range === '7d') return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    return undefined;
  }, [range]);
  const cacheKey = useMemo(
    () => cacheKeys.records({ deviceId, petProfileId, recordType: type, range }),
    [deviceId, petProfileId, range, type],
  );

  const loadPage = useCallback(
    async (page: number, append = false) => {
      if (!user) {
        setLoading(false);
        return;
      }
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      let hasCachedData = false;

      if (!append) {
        try {
          const cached = await appCache.get<RecordCacheSnapshot>(user.id, cacheKey);
          if (requestId !== requestIdRef.current) return;
          if (cached) {
            hasCachedData = true;
            recordsRef.current = cached.value.items;
            setRecords(cached.value.items);
            setTotal(cached.value.total);
            setHasMore(cached.value.hasMore);
            setLoading(false);
          }
        } catch {
          // 缓存不可用时继续请求服务器。
        }
      }

      try {
        const result = await recordsApi.list(
          {
            deviceId,
            petProfileId,
            recordType: type,
            from,
            page,
            pageSize: PAGE_SIZE,
          },
          { signal: controller.signal },
        );
        if (requestId !== requestIdRef.current) return;
        const nextItems = append ? [...recordsRef.current, ...result.items] : result.items;
        recordsRef.current = nextItems;
        setRecords(nextItems);
        setTotal(result.total);
        setHasMore(result.hasMore);
        await appCache.set<RecordCacheSnapshot>(user.id, cacheKey, {
          items: nextItems,
          total: result.total,
          hasMore: result.hasMore,
        });
      } catch (cause) {
        if (requestId !== requestIdRef.current) return;
        if (cause instanceof ApiError && cause.kind === 'cancelled') return;
        const message = recordErrorMessage(cause);
        setError(hasCachedData ? `${message}，当前显示上次保存的数据` : message);
        if (!append && !hasCachedData) {
          recordsRef.current = [];
          setRecords([]);
          setTotal(0);
          setHasMore(false);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [cacheKey, deviceId, from, petProfileId, type, user],
  );

  useEffect(() => {
    const completedAt = foregroundSyncState.completedAt;
    if (
      !user ||
      foregroundSyncState.phase !== 'complete' ||
      !completedAt ||
      lastBleRefreshRef.current === completedAt
    ) {
      return;
    }
    lastBleRefreshRef.current = completedAt;
    void (async () => {
      await appCache.remove(user.id, cacheKey);
      await loadPage(1);
    })();
  }, [cacheKey, foregroundSyncState.completedAt, foregroundSyncState.phase, loadPage, user]);

  useFocusEffect(
    useCallback(() => {
      void reloadMetadata();
    }, [reloadMetadata]),
  );

  useFocusEffect(
    useCallback(() => {
      void loadPage(1);
      return () => {
        abortRef.current?.abort();
      };
    }, [loadPage]),
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    void reloadMetadata();
    void loadPage(1);
  }, [loadPage, reloadMetadata]);

  const loadMore = useCallback(() => {
    if (!loading && !loadingMore && hasMore) {
      void loadPage(Math.floor(records.length / PAGE_SIZE) + 1, true);
    }
  }, [hasMore, loadPage, loading, loadingMore, records.length]);

  const unavailableType = type === 'imu' ? 'IMU' : type === 'motion' ? '运动' : null;
  const visibleError = error ?? metadataError;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PageHeader title="数据记录" />
      </View>

      <View style={styles.filters}>
        <FilterRow label="设备">
          <Chip
            label="全部设备"
            active={deviceId === undefined}
            onPress={() => setDeviceId(undefined)}
          />
          {devices.map((device) => (
            <Chip
              key={device.id}
              label={device.deviceName || deviceTypeLabel(device.deviceType)}
              active={deviceId === device.id}
              onPress={() => setDeviceId(device.id)}
            />
          ))}
        </FilterRow>

        {pets.length > 0 ? (
          <FilterRow label="宠物">
            <Chip
              label="全部宠物"
              active={petProfileId === undefined}
              onPress={() => setPetProfileId(undefined)}
            />
            {pets.map((pet) => (
              <Chip
                key={pet.id}
                label={pet.name}
                active={petProfileId === pet.id}
                onPress={() => setPetProfileId(pet.id)}
              />
            ))}
          </FilterRow>
        ) : null}

        <View style={styles.filterGrid}>
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>类型</Text>
            <View style={styles.wrapChips}>
              <Chip label="全部类型" active={type === undefined} onPress={() => setType(undefined)} />
              {(['bark', 'imu', 'motion'] as RecordType[]).map((recordType) => (
                <Chip
                  key={recordType}
                  label={TYPE_LABEL[recordType]}
                  active={type === recordType}
                  onPress={() => setType(recordType)}
                />
              ))}
            </View>
          </View>

          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>时间</Text>
            <View style={styles.wrapChips}>
              {(['all', '24h', '7d'] as Range[]).map((value) => (
                <Chip
                  key={value}
                  label={value === 'all' ? '全部时间' : value === '24h' ? '近 24 小时' : '近 7 天'}
                  active={range === value}
                  onPress={() => setRange(value)}
                />
              ))}
            </View>
          </View>
        </View>
      </View>

      {visibleError ? (
        <View style={styles.errorWrap}>
          <InlineError
            message={visibleError}
            retryLabel="重新加载记录"
            retrying={loading || metadataLoading}
            onRetry={refresh}
          />
        </View>
      ) : null}

      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.content,
          records.length === 0 && styles.contentEmpty,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />
        }
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <RecordCard
            item={item}
            onPress={() => router.push(recordDetailHref(item))}
          />
        )}
        ListEmptyComponent={
          loading || metadataLoading ? (
            <FeedbackState
              icon="document-text-outline"
              title="正在加载记录"
              description="正在获取当前筛选条件下的数据"
              loading
            />
          ) : visibleError ? null : (
            <FeedbackState
              icon={devices.length === 0 ? 'hardware-chip-outline' : 'document-text-outline'}
              title={
                devices.length === 0
                  ? '暂无设备'
                  : unavailableType
                    ? `暂无${unavailableType}记录`
                    : '暂无记录'
              }
              description={
                devices.length === 0
                  ? '绑定设备并完成数据上传后，可在这里查看记录。'
                  : unavailableType
                    ? `当前没有 App 上传的${unavailableType}数据。`
                    : ''
              }
            />
          )
        }
        ListFooterComponent={
          records.length > 0 ? (
            <View style={styles.footer}>
              <Text style={styles.countText}>已显示 {records.length} / {total} 条</Text>
              {hasMore ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="加载更多记录"
                  disabled={loadingMore}
                  onPress={loadMore}
                  style={styles.moreButton}
                >
                  {loadingMore ? (
                    <ActivityIndicator color={colors.greenDark} size="small" />
                  ) : (
                    <Text style={styles.moreText}>加载更多</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
      />
    </View>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.filterSection}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalChips}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}${active ? '，已选择' : ''}`}
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text numberOfLines={1} style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function RecordCard({ item, onPress }: { item: RecordItem; onPress: () => void }) {
  const summary = presentRecordSummary(item.summary);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${TYPE_LABEL[item.recordType]}记录，${item.summary}，设备 ${item.deviceName}`}
      accessibilityHint="打开记录详情"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.cardTop}>
        <StatusPill tone={TYPE_TONE[item.recordType]} label={TYPE_LABEL[item.recordType]} />
        <Text style={styles.time}>{formatBeijingDateTime(item.occurredAt)}</Text>
      </View>
      <Text style={styles.summary}>{summary.title}</Text>
      {summary.detail ? (
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.detail}>
          {summary.detail}
        </Text>
      ) : null}
      <View style={styles.cardBottom}>
        <Text style={styles.meta}>
          {item.deviceName}
          {item.petName ? ` · ${item.petName}` : ''}
        </Text>
        <Text style={styles.detailLink}>{'>>>'}</Text>
      </View>
    </Pressable>
  );
}

function recordDetailHref(item: RecordItem) {
  const record = encodeURIComponent(JSON.stringify(item));
  return href(`/records/${encodeURIComponent(item.id)}?record=${record}`);
}

function presentRecordSummary(summary: string): { title: string; detail?: string } {
  const prefix = '已上传音频：';
  if (summary.startsWith(prefix)) {
    return { title: '已上传音频', detail: summary.slice(prefix.length) };
  }
  return { title: summary };
}

function recordErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiError)) return '记录加载失败，请稍后重试';
  if (cause.kind === 'timeout') return '记录加载超时，请重试';
  if (cause.kind === 'network') return '网络连接失败，请检查网络后重试';
  if (cause.status >= 500) return '服务器暂时不可用，请稍后重试';
  return cause.message || '记录加载失败，请重试';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg },
  filters: {
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
  },
  filterSection: { gap: spacing.xs },
  filterGrid: { gap: spacing.md },
  filterGroup: { gap: spacing.xs },
  filterLabel: { color: colors.muted, fontSize: fontSize.tiny, fontWeight: '700' },
  horizontalChips: { gap: spacing.sm },
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    maxWidth: 168,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipActive: { backgroundColor: colors.green },
  chipText: { fontSize: fontSize.small, color: colors.muted, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  errorWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  content: { padding: spacing.lg, gap: spacing.md },
  contentEmpty: { flexGrow: 1, justifyContent: 'center' },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardPressed: { backgroundColor: colors.soft },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { fontSize: fontSize.tiny, color: colors.muted },
  summary: { fontSize: fontSize.body, fontWeight: '700', color: colors.ink },
  detail: { fontSize: fontSize.small, color: colors.muted },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  meta: { flex: 1, fontSize: fontSize.small, color: colors.muted },
  detailLink: {
    color: colors.greenDark,
    fontSize: fontSize.small,
    fontWeight: '800',
    letterSpacing: 1,
  },
  footer: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  countText: { color: colors.muted, fontSize: fontSize.tiny },
  moreButton: {
    minHeight: 44,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.mint,
  },
  moreText: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '800' },
});
