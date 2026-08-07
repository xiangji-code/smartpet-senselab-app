import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/theme';

/** 跨平台单行文本输入对话框（如：设备改名）。 */
export function PromptModal({
  visible,
  title,
  placeholder,
  initialValue = '',
  confirmText = '保存',
  allowEmpty = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  confirmText?: string;
  allowEmpty?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const canConfirm = allowEmpty || value.trim().length > 0;

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          accessibilityViewIsModal
          accessibilityLabel={title}
          onAccessibilityEscape={onCancel}
          style={styles.card}
          onPress={() => {}}
        >
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <TextInput
            accessibilityLabel={title}
            style={styles.input}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            value={value}
            onChangeText={setValue}
            autoFocus
          />
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消"
              style={({ pressed }) => [
                styles.btn,
                styles.cancel,
                pressed && styles.cancelPressed,
              ]}
              onPress={onCancel}
            >
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmText}
              accessibilityState={{ disabled: !canConfirm }}
              style={({ pressed }) => [
                styles.btn,
                styles.confirm,
                !canConfirm && styles.disabled,
                pressed && styles.confirmPressed,
              ]}
              disabled={!canConfirm}
              onPress={() => onConfirm(value.trim())}
            >
              <Text style={styles.confirmText}>{confirmText}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontSize: fontSize.title, fontWeight: '800', color: colors.ink },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  actions: { flexDirection: 'row', gap: spacing.md },
  btn: {
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  cancel: { backgroundColor: colors.soft },
  cancelPressed: { backgroundColor: colors.line },
  cancelText: { color: colors.ink, fontWeight: '700' },
  confirm: { backgroundColor: colors.green },
  confirmPressed: { backgroundColor: colors.greenPressed },
  disabled: { opacity: 0.5 },
  confirmText: { color: '#fff', fontWeight: '800' },
});
