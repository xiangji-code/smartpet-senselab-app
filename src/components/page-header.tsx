import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '../theme/theme';

export function PageHeader({
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
    <View style={styles.header}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  copy: { flex: 1, minWidth: 0 },
  leading: { flexShrink: 0 },
  title: {
    color: colors.ink,
    fontSize: fontSize.header,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: colors.muted,
    fontSize: fontSize.small,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  action: { flexShrink: 0 },
});
