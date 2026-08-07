/** 通用页面容器：安全区 + 背景色 + 标题/副标题。 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '../theme/theme';
import { PageHeader } from './page-header';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  scroll?: boolean;
  leading?: React.ReactNode;
  action?: React.ReactNode;
}

export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
  leading,
  action,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const fixedHeader = scroll && leading && title
    ? <PageHeader title={title} subtitle={subtitle} leading={leading} action={action} />
    : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {fixedHeader ? <View style={styles.fixedHeader}>{fixedHeader}</View> : null}
      {scroll ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xl },
          ]}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {title && !fixedHeader ? (
            <PageHeader title={title} subtitle={subtitle} leading={leading} action={action} />
          ) : null}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
          {title ? (
            <PageHeader title={title} subtitle={subtitle} leading={leading} action={action} />
          ) : null}
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  fixedHeader: {
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.bg,
    zIndex: 1,
  },
});
