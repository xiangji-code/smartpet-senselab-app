import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/theme';

export function InlineError({
  message,
  retryLabel = '重试',
  onRetry,
  retrying = false,
}: {
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <View accessibilityRole="alert" style={styles.root}>
      <Ionicons name="cloud-offline-outline" size={20} color={colors.red} />
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          disabled={retrying}
          style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          onPress={onRetry}
        >
          {retrying ? (
            <ActivityIndicator color={colors.greenDark} size="small" />
          ) : (
            <Text style={styles.retryText}>{retryLabel}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: '#f1c4bf',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.dangerSurface,
  },
  message: {
    flex: 1,
    color: colors.ink,
    fontSize: fontSize.small,
    lineHeight: 19,
  },
  retry: {
    minWidth: 52,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  retryPressed: { backgroundColor: colors.mint },
  retryText: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '800' },
});
