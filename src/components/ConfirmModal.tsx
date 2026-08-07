import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/theme';

/** 跨平台二次确认对话框（替代在 Web 上不可靠的 Alert.alert）。 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
          {message ? (
            <Text selectable style={styles.message}>
              {message}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={cancelText}
              style={({ pressed }) => [
                styles.btn,
                styles.cancel,
                pressed && styles.cancelPressed,
              ]}
              onPress={onCancel}
            >
              <Text style={styles.cancelText}>{cancelText}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmText}
              style={({ pressed }) => [
                styles.btn,
                destructive ? styles.destructive : styles.confirm,
                pressed && styles.confirmPressed,
              ]}
              onPress={onConfirm}
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
  message: { fontSize: fontSize.body, color: colors.muted, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
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
  destructive: { backgroundColor: colors.red },
  confirmPressed: { opacity: 0.8 },
  confirmText: { color: '#fff', fontWeight: '800' },
});
