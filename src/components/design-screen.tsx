import type { ReactNode, Ref } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../theme/theme';
import { DesignTopBar } from './design-top-bar';

export function DesignScreen({
  title,
  subtitle,
  leading,
  action,
  children,
  scrollable = true,
  scrollViewRef,
  keyboardBottomInset = 0,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  scrollable?: boolean;
  scrollViewRef?: Ref<ScrollView>;
  keyboardBottomInset?: number;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.indigo }}>
        <DesignTopBar title={title} subtitle={subtitle} leading={leading} action={action} />
      </View>
      <View style={styles.surface}>
        {scrollable ? (
          <ScrollView
            ref={scrollViewRef}
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.content,
              {
                paddingBottom:
                  Math.max(insets.bottom, spacing.lg) + spacing.xl + keyboardBottomInset,
              },
            ]}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={styles.staticContent}>{children}</View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.indigo },
  surface: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg + 8,
    borderTopRightRadius: radius.lg + 8,
  },
  content: { padding: spacing.lg, gap: spacing.lg },
  staticContent: { flex: 1 },
});
