import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/theme';

export function FeedbackState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  loading = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.root}>
      <View style={styles.icon}>
        {loading ? (
          <ActivityIndicator color={colors.greenDark} />
        ) : (
          <Ionicons name={icon} size={28} color={colors.greenDark} />
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          onPress={onAction}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mint,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.ink,
    fontSize: fontSize.title,
    fontWeight: '800',
    textAlign: 'center',
  },
  description: {
    maxWidth: 320,
    color: colors.muted,
    fontSize: fontSize.body,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
  },
  actionPressed: { backgroundColor: colors.greenPressed },
  actionText: { color: '#fff', fontSize: fontSize.small, fontWeight: '800' },
});
