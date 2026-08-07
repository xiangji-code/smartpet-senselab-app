import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { petsApi } from '../../src/api/pets';
import { href } from '../../src/lib/nav';
import type { PetProfile } from '../../src/types/domain';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

export default function PetsListScreen() {
  const router = useRouter();
  const [pets, setPets] = useState<PetProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPets(await petsApi.list());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '宠物档案',
          headerRight: () => (
            <Pressable onPress={() => router.push(href('/pets/new'))} hitSlop={10}>
              <Ionicons name="add" size={24} color={colors.greenDark} />
            </Pressable>
          ),
        }}
      />
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        {loading && pets.length === 0 ? (
          <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xl }} />
        ) : pets.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="paw-outline" size={40} color={colors.muted} />
            <Text style={styles.emptyText}>还没有宠物档案</Text>
            <Pressable style={styles.emptyBtn} onPress={() => router.push(href('/pets/new'))}>
              <Text style={styles.emptyBtnText}>创建宠物档案</Text>
            </Pressable>
          </View>
        ) : (
          pets.map((p) => (
            <Pressable
              key={p.id}
              style={styles.card}
              onPress={() => router.push(href(`/pets/${p.id}`))}
            >
              <View style={styles.avatar}>
                <Ionicons name="paw" size={20} color={colors.greenDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={styles.meta}>
                  {[p.species, p.breed, p.sex === 'male' ? '公' : p.sex === 'female' ? '母' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  empty: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xl * 2 },
  emptyText: { color: colors.muted, fontSize: fontSize.body },
  emptyBtn: { backgroundColor: colors.green, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.sm },
  emptyBtnText: { color: '#fff', fontWeight: '800' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: spacing.lg,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mint,
  },
  name: { fontSize: fontSize.title, fontWeight: '800', color: colors.ink },
  meta: { fontSize: fontSize.small, color: colors.muted, marginTop: 2 },
});
