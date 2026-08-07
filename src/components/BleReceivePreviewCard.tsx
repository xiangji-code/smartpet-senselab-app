import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BleDataType } from '../ble/protocol';
import {
  formatExactByteSize,
  formatPullDuration,
  type BlePullFramePreview,
  type BlePullPreview,
} from '../ble/pullPreview';
import { colors, fontSize, radius, spacing } from '../theme/theme';

export function BleReceivePreviewCard({ preview }: { preview: BlePullPreview }) {
  const [expanded, setExpanded] = useState(false);
  const visibleFrames = useMemo(() => {
    if (expanded || preview.frames.length <= 2) return preview.frames;
    return [preview.frames[0], preview.frames[preview.frames.length - 1]];
  }, [expanded, preview.frames]);

  return (
    <View style={styles.card} accessibilityLabel="本次蓝牙接收数据详情">
      <View style={styles.titleRow}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={18} color={colors.greenDark} />
        </View>
        <View style={styles.titleCopy}>
          <Text style={styles.title}>数据接收完成</Text>
          <Text style={styles.summary}>
            {preview.blockCount} 个完整文件 · {formatExactByteSize(preview.totalBytes)}
          </Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric label="完整帧数" value={`${preview.totalFrames} 帧`} />
        <Metric label="接收耗时" value={formatPullDuration(preview.pullDurationMs)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>接收文件</Text>
        {preview.blocks.map((block) => (
          <View key={block.blockId} style={styles.fileRow}>
            <View style={styles.fileIcon}>
              <Ionicons name="document-outline" size={17} color={colors.greenDark} />
            </View>
            <View style={styles.fileCopy}>
              <Text style={styles.fileTitle}>Block {block.blockId} · {typeLabel(block.type)}</Text>
              <Text style={styles.meta}>{block.frameCount} 帧</Text>
            </View>
            <Text selectable style={styles.fileSize}>{formatExactByteSize(block.totalBytes)}</Text>
          </View>
        ))}
      </View>

      {preview.frames.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.sectionTitle}>帧结构</Text>
              <Text style={styles.meta}>默认展示第一帧和最后一帧</Text>
            </View>
            {preview.frames.length > 2 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={expanded ? '收起全部帧' : '查看全部帧'}
                hitSlop={8}
                onPress={() => setExpanded((value) => !value)}
                style={styles.expandButton}
              >
                <Text style={styles.expandText}>{expanded ? '收起' : `查看全部 ${preview.frames.length} 帧`}</Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.greenDark} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.frameList}>
            {visibleFrames.map((frame) => <FrameDetail key={frame.frameNumber} frame={frame} />)}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>文件内容预览</Text>
        <Text style={styles.hexLabel}>文件开头 50 字节</Text>
        <Text selectable style={styles.hex}>{preview.firstHex || '空'}</Text>
        <Text style={styles.hexLabel}>文件末尾 50 字节</Text>
        <Text selectable style={styles.hex}>{preview.lastHex || '空'}</Text>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text selectable style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function FrameDetail({ frame }: { frame: BlePullFramePreview }) {
  return (
    <View style={styles.frame}>
      <Text style={styles.frameTitle}>帧 {frame.frameNumber} · Block {frame.blockId}</Text>
      <Text style={styles.meta}>
        总长 {frame.totalBytes} · 偏移 {frame.offset} · 载荷 {frame.dataLength} B
      </Text>
      <Text style={styles.hexLabel}>帧头 · 12 字节</Text>
      <Text selectable style={styles.hex}>{frame.headerHex}</Text>
      <Text style={styles.hexLabel}>帧尾 · CRC16 + EOF</Text>
      <Text selectable style={styles.hex}>{frame.tailHex}</Text>
    </View>
  );
}

function typeLabel(type: BleDataType): string {
  if (type === 'audio') return '音频';
  if (type === 'motion') return '运动';
  if (type === 'mixed') return '混合数据';
  return '433 通信数据';
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  successIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCopy: { flex: 1, gap: 2 },
  title: { color: colors.ink, fontSize: fontSize.body, fontWeight: '800' },
  summary: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, backgroundColor: colors.soft, borderRadius: radius.sm, padding: spacing.sm, gap: 2 },
  metricLabel: { color: colors.muted, fontSize: fontSize.tiny },
  metricValue: { color: colors.ink, fontSize: fontSize.small, fontWeight: '800', fontVariant: ['tabular-nums'] },
  section: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md, gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  sectionHeaderCopy: { flex: 1, gap: 2 },
  sectionTitle: { color: colors.ink, fontSize: fontSize.small, fontWeight: '800' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fileIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  fileCopy: { flex: 1 },
  fileTitle: { color: colors.ink, fontSize: fontSize.small, fontWeight: '700' },
  fileSize: { color: colors.ink, fontSize: fontSize.tiny, fontWeight: '700', fontVariant: ['tabular-nums'] },
  meta: { color: colors.muted, fontSize: fontSize.tiny, fontVariant: ['tabular-nums'] },
  expandButton: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: spacing.xs },
  expandText: { color: colors.greenDark, fontSize: fontSize.tiny, fontWeight: '800' },
  frameList: { gap: spacing.sm },
  frame: { backgroundColor: colors.soft, borderRadius: radius.sm, padding: spacing.sm, gap: spacing.xs },
  frameTitle: { color: colors.ink, fontSize: fontSize.small, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hexLabel: { color: colors.muted, fontSize: fontSize.tiny, fontWeight: '700' },
  hex: { color: colors.ink, fontSize: fontSize.tiny, fontFamily: 'monospace', lineHeight: 19 },
});
