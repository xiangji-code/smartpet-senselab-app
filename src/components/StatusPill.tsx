import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/theme';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

const toneColor: Record<Tone, string> = {
  ok: colors.green,
  warn: colors.amber,
  bad: colors.red,
  muted: colors.muted,
};

const toneSurface: Record<Tone, string> = {
  ok: colors.mint,
  warn: colors.warningSurface,
  bad: colors.dangerSurface,
  muted: colors.soft,
};

/** 小圆点 + 文案的状态胶囊。 */
export function StatusPill({ tone = 'muted', label }: { tone?: Tone; label: string }) {
  return (
    <View accessible accessibilityLabel={label} style={[styles.pill, { backgroundColor: toneSurface[tone] }]}>
      <View style={[styles.dot, { backgroundColor: toneColor[tone] }]} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, color: colors.ink, fontWeight: '700' },
});
