import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/theme';

/**
 * 1–10 档位选择器（无第三方 Slider 依赖）。
 * 用一排格子表示强度，点击某格设为该值。
 */
export function LevelStepper({
  value,
  onChange,
  min = 1,
  max = 10,
  color = colors.green,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  color?: string;
  disabled?: boolean;
}) {
  const cells = [];
  for (let i = min; i <= max; i++) {
    const active = i <= value;
    cells.push(
      <Pressable
        key={i}
        disabled={disabled}
        onPress={() => onChange(i)}
        style={[
          styles.cell,
          { backgroundColor: active ? color : colors.soft },
          disabled && styles.disabled,
        ]}
      />,
    );
  }
  return (
    <View>
      <View style={styles.row}>{cells}</View>
      <Text style={styles.value}>
        当前档位：{value} / {max}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  cell: {
    flex: 1,
    height: 24,
    borderRadius: radius.sm - 4,
  },
  disabled: { opacity: 0.5 },
  value: { marginTop: spacing.sm, fontSize: fontSize.small, color: colors.muted },
});
