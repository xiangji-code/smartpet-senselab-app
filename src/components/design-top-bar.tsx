import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '../theme/theme';

export function DesignTopBar({
  title,
  subtitle,
  leading,
  action,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.bar}>
      <View style={styles.signalLeft} />
      <View style={styles.signalRight} />
      <View style={styles.row}>
        <View style={styles.side}>{leading ?? <Ionicons name="paw-outline" size={22} color="#FFFFFF" />}</View>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={[styles.side, styles.action]}>{action}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 84,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.indigo,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, zIndex: 1 },
  side: { width: 72, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  action: { alignItems: 'flex-end' },
  copy: { flex: 1, alignItems: 'center', gap: 2 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#C7CFE8', fontSize: fontSize.tiny, textAlign: 'center' },
  signalLeft: {
    position: 'absolute', left: -48, bottom: -70, width: 132, height: 132,
    borderRadius: 999, borderWidth: 1, borderColor: '#354273',
  },
  signalRight: {
    position: 'absolute', right: -38, top: -78, width: 144, height: 144,
    borderRadius: 999, borderWidth: 1, borderColor: '#354273',
  },
});
