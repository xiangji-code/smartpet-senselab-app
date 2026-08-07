import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/theme';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

const toneColor: Record<Tone, string> = {
  ok: colors.green,
  warn: colors.amber,
  bad: colors.red,
  muted: colors.muted,
};

/** 小圆点 + 文案的状态胶囊。 */
export function StatusPill({ tone = 'muted', label }: { tone?: Tone; label: string }) {
  return (
    <View accessible accessibilityLabel={label} style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: toneColor[tone] }]} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.soft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: fontSize.tiny, color: colors.ink, fontWeight: '600' },
});
