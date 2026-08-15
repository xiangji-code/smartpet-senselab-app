import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { filterDogBreeds } from '../data/dog-breeds';
import { colors, fontSize, radius, spacing } from '../theme/theme';

export function BreedPickerModal({
  visible,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: string;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const options = useMemo(() => filterDogBreeds(query), [query]);

  function select(nextValue: string) {
    onSelect(nextValue);
    setQuery('');
    onClose();
  }

  function close() {
    setQuery('');
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}>
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>选择品种</Text>
              <Text style={styles.subtitle}>支持中文或英文搜索</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭品种选择" hitSlop={8} onPress={close}>
              <Ionicons name="close" size={26} color={colors.ink} />
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search" size={19} color={colors.muted} />
            <TextInput
              autoFocus
              accessibilityLabel="搜索宠物品种"
              autoCapitalize="none"
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="搜索品种，如：德牧、Labrador"
              placeholderTextColor={colors.muted}
            />
            {query ? (
              <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" hitSlop={8} onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={21} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.specialRow}>
            <Choice label="未选择" selected={!value} icon="remove-circle-outline" onPress={() => select('')} />
            <Choice label="其他" selected={value === '其他'} icon="ellipsis-horizontal-circle-outline" onPress={() => select('其他')} />
          </View>

          <FlatList
            data={options}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>没有搜索到对应品种</Text>
                <Text style={styles.emptyText}>可以选择上方“其他”，或保持未选择。</Text>
              </View>
            }
            renderItem={({ item }) => {
              const selected = value === item.value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                  onPress={() => select(item.value)}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{item.value}</Text>
                  {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.green} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Choice({ label, selected, icon, onPress }: { label: string; selected: boolean; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} style={[styles.choice, selected && styles.choiceSelected]} onPress={onPress}>
      <Ionicons name={icon} size={19} color={selected ? '#FFFFFF' : colors.greenDark} />
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16, 27, 77, 0.38)' },
  sheet: { maxHeight: '82%', gap: spacing.md, paddingTop: spacing.sm, paddingHorizontal: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.panel },
  handle: { width: 44, height: 5, alignSelf: 'center', borderRadius: radius.pill, backgroundColor: colors.lineStrong },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.indigo, fontSize: fontSize.title, fontWeight: '900' },
  subtitle: { paddingTop: 2, color: colors.muted, fontSize: fontSize.small },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  searchInput: { flex: 1, color: colors.ink, fontSize: fontSize.body },
  specialRow: { flexDirection: 'row', gap: spacing.sm },
  choice: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderWidth: 1, borderColor: colors.green, borderRadius: radius.md, backgroundColor: colors.mint },
  choiceSelected: { backgroundColor: colors.green },
  choiceText: { color: colors.greenDark, fontWeight: '800' },
  choiceTextSelected: { color: '#FFFFFF' },
  list: { paddingBottom: spacing.md },
  option: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  optionPressed: { backgroundColor: colors.mint },
  optionText: { color: colors.ink, fontSize: fontSize.body },
  optionTextSelected: { color: colors.greenDark, fontWeight: '800' },
  empty: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xxl },
  emptyTitle: { color: colors.ink, fontWeight: '800' },
  emptyText: { color: colors.muted, fontSize: fontSize.small },
});
