import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/theme';

/** 带标题的卡片容器，用于详情页分区。 */
export function SectionCard({
  title,
  right,
  children,
}: {
  title?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      {(title || right) && (
        <View style={styles.header}>
          {title ? <Text style={styles.title}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: fontSize.body, fontWeight: '800', color: colors.ink },
});
