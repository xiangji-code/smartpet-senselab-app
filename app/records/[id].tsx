import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiError } from '../../src/api/client';
import {
  recordsApi,
  type RecordItem,
  type RecordUploadDetail,
} from '../../src/api/records';
import { formatExactByteSize } from '../../src/ble/pullPreview';
import { PageBackButton } from '../../src/components/page-back-button';
import { DesignScreen } from '../../src/components/design-screen';
import { SectionCard } from '../../src/components/SectionCard';
import { StatusPill } from '../../src/components/StatusPill';
import { formatBeijingDateTime } from '../../src/lib/dateTime';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';
import type { RecordType } from '../../src/types/domain';

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

export default function RecordDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; record?: string }>();
  const recordId = firstParam(params.id);
  const recordParam = firstParam(params.record);
  const record = useMemo(() => parseRecord(recordParam), [recordParam]);
  const [detail, setDetail] = useState<RecordUploadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    if (!recordId) {
      setError('缺少记录编号，无法加载详情');
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void recordsApi
      .getUploadDetail(recordId, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(recordDetailError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [recordId, reloadKey]);

  return (
    <DesignScreen
      title="记录详情"
      subtitle="查看顶圈上传的真实行为与运动数据"
      leading={<PageBackButton color="#FFFFFF" onPress={() => router.back()} />}
    >
      {record ? <RecordInfo record={record} /> : (
        <SectionCard title="记录信息">
          <DetailRow label="记录编号" value={recordId || '未知'} />
          <Text style={styles.hint}>当前页面缺少列表上下文，仍会继续查询文件信息。</Text>
        </SectionCard>
      )}

      <SectionCard title="上传批次与文件">
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.green} />
            <Text style={styles.hint}>正在查询上传批次与文件存储信息…</Text>
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Text selectable style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新加载文件详情"
              style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
              onPress={reload}
            >
              <Text style={styles.retryText}>重新加载</Text>
            </Pressable>
          </View>
        ) : detail ? (
          <UploadInfo detail={detail} />
        ) : (
          <Text style={styles.hint}>这条记录没有可关联的上传文件详情。</Text>
        )}
      </SectionCard>
    </DesignScreen>
  );
}

function RecordInfo({ record }: { record: RecordItem }) {
  return (
    <>
      <View style={styles.recordHeading}>
        <Text selectable style={styles.recordId}>记录 #{record.id}</Text>
        <StatusPill tone={TYPE_TONE[record.recordType]} label="真实同步" />
      </View>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>{TYPE_LABEL[record.recordType]}记录</Text>
        <Text style={styles.heroTitle}>{record.summary}</Text>
        <View style={styles.heroMetrics}>
          <Text selectable style={styles.heroValue}>
            {record.barkCount != null ? `${record.barkCount} 次` : TYPE_LABEL[record.recordType]}
            {record.durationSeconds != null ? ` · ${record.durationSeconds} 秒` : ''}
          </Text>
          {record.confidence != null ? (
            <Text selectable style={styles.heroConfidence}>
              置信度 {Math.round(record.confidence * 100)}%
            </Text>
          ) : null}
        </View>
      </View>
      <SectionCard title="基础信息">
        <DetailRow label="设备" value={record.deviceName} />
        <DetailRow label="宠物" value={record.petName || '未关联'} />
        <DetailRow
          label="采集时间"
          value={formatBeijingDateTime(record.occurredAt, { includeYear: true })}
        />
        <DetailRow label="来源 / 状态" value={`${record.source || '未知'} · ${record.status || '未知'}`} />
      </SectionCard>
    </>
  );
}

function UploadInfo({ detail }: { detail: RecordUploadDetail }) {
  return (
    <View style={styles.details}>
      <DetailRow label="批次" value={`#${detail.batchId}`} />
      <DetailRow label="批次状态" value={detail.batchStatus} />
      <DetailRow
        label="批次文件"
        value={`${detail.batchFileCount} 个 · ${formatExactByteSize(detail.batchTotalBytes)}`}
      />
      <DetailRow label="Block" value={detail.blockId == null ? '未知' : String(detail.blockId)} />
      <DetailRow label="文件编号" value={`#${detail.fileId}`} />
      <DetailRow label="文件名" value={detail.originalFilename} />
      <DetailRow label="文件大小" value={formatExactByteSize(detail.fileSize)} />
      <DetailRow label="存储路径" value={detail.storagePath} />
      <DetailRow label="服务端哈希" value={detail.fileHash} />
      <DetailRow label="文件格式" value={detail.format || '未知'} />
      {detail.durationSeconds != null ? (
        <DetailRow label="音频时长" value={`${detail.durationSeconds} 秒`} />
      ) : null}
      {detail.sampleRate != null ? (
        <DetailRow label="采样率" value={`${detail.sampleRate} Hz`} />
      ) : null}
      <DetailRow
        label="上传时间"
        value={formatBeijingDateTime(detail.uploadedAt, { includeYear: true })}
      />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>{value}</Text>
    </View>
  );
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function parseRecord(value: string): RecordItem | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<RecordItem>;
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.deviceId !== 'number' ||
      typeof parsed.deviceName !== 'string' ||
      !isRecordType(parsed.recordType) ||
      typeof parsed.occurredAt !== 'string' ||
      typeof parsed.summary !== 'string'
    ) {
      return null;
    }
    return parsed as RecordItem;
  } catch {
    return null;
  }
}

function isRecordType(value: unknown): value is RecordType {
  return value === 'bark' || value === 'imu' || value === 'motion';
}

function recordDetailError(cause: unknown): string {
  if (!(cause instanceof ApiError)) return '文件详情加载失败，请稍后重试';
  if (cause.kind === 'timeout') return '文件详情加载超时，请重试';
  if (cause.kind === 'network') return '网络连接失败，请检查网络后重试';
  if (cause.kind === 'cancelled') return '请求已取消';
  return cause.message || '文件详情加载失败，请重试';
}

const styles = StyleSheet.create({
  buttonPressed: { opacity: 0.7 },
  details: { gap: spacing.md },
  recordHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  recordId: { flex: 1, color: colors.indigo, fontSize: fontSize.title, fontWeight: '900' },
  hero: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.indigo },
  heroEyebrow: { color: '#B9C8E8', fontSize: fontSize.small, fontWeight: '800' },
  heroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', lineHeight: 30 },
  heroMetrics: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  heroValue: { flex: 1, color: '#FFFFFF', fontSize: 25, fontWeight: '900', fontVariant: ['tabular-nums'] },
  heroConfidence: { color: '#9FE1D8', fontSize: fontSize.small, fontWeight: '800' },
  row: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  label: { color: colors.muted, fontSize: fontSize.tiny, fontWeight: '700' },
  value: { color: colors.ink, fontSize: fontSize.small, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: fontSize.small, lineHeight: 20 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorBox: { gap: spacing.md },
  errorText: { color: colors.red, fontSize: fontSize.small, lineHeight: 20 },
  retryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.mint,
  },
  retryText: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '800' },
});
