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
import { Screen } from '../../src/components/Screen';
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
    <Screen
      title="记录详情"
      subtitle="时间均为北京时间"
      leading={<PageBackButton onPress={() => router.back()} />}
    >
      {record ? <RecordInfo record={record} /> : (
        <SectionCard title="记录信息">
          <DetailRow label="记录编号" value={recordId || '未知'} />
          <Text style={styles.hint}>当前页面缺少列表上下文，仍会继续查询文件信息。</Text>
        </SectionCard>
      )}

      <SectionCard title="蓝牙接收与文件">
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
    </Screen>
  );
}

function RecordInfo({ record }: { record: RecordItem }) {
  return (
    <SectionCard
      title="记录信息"
      right={<StatusPill tone={TYPE_TONE[record.recordType]} label={TYPE_LABEL[record.recordType]} />}
    >
      <DetailRow label="记录编号" value={record.id} />
      <DetailRow label="设备" value={record.deviceName} />
      <DetailRow label="宠物" value={record.petName || '未关联'} />
      <DetailRow
        label="采集时间"
        value={formatBeijingDateTime(record.occurredAt, { includeYear: true })}
      />
      <DetailRow label="摘要" value={record.summary} />
      <DetailRow label="来源" value={record.source || '未知'} />
      <DetailRow label="状态" value={record.status || '未知'} />
      {record.barkCount != null ? (
        <DetailRow label="吠叫次数" value={String(record.barkCount)} />
      ) : null}
      {record.durationSeconds != null ? (
        <DetailRow label="时长" value={`${record.durationSeconds} 秒`} />
      ) : null}
      {record.confidence != null ? (
        <DetailRow label="置信度" value={`${Math.round(record.confidence * 100)}%`} />
      ) : null}
    </SectionCard>
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
