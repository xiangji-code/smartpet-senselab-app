import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/theme';

/** 占位卡片：说明该页在哪个 issue 里实现。 */
export function Placeholder({ note }: { note: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.text}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: spacing.lg,
  },
  text: { color: colors.muted, fontSize: fontSize.body, lineHeight: 22 },
});
