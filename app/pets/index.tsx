import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { petsApi } from '../../src/api/pets';
import { authorizedMediaSource } from '../../src/api/client';
import { DesignScreen } from '../../src/components/design-screen';
import { PageBackButton } from '../../src/components/page-back-button';
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
      <Stack.Screen options={{ headerShown: false }} />
      <DesignScreen
        title="宠物档案"
        subtitle="管理设备关联宠物与基础资料"
        leading={<PageBackButton color="#FFFFFF" onPress={() => router.back()} />}
        action={(
          <Pressable onPress={() => router.push(href('/pets/new'))} hitSlop={10}>
            <Ionicons name="add-circle-outline" size={28} color="#FFFFFF" />
          </Pressable>
        )}
      >
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
                {p.avatarUrl ? <Image accessibilityLabel={`${p.name}的头像`} source={authorizedMediaSource(p.avatarUrl)} style={styles.avatarImage} /> : <Ionicons name="paw" size={20} color={colors.greenDark} />}
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
        {pets.length > 0 ? (
          <Pressable style={styles.addButton} onPress={() => router.push(href('/pets/new'))}>
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.addButtonText}>新建宠物档案</Text>
          </Pressable>
        ) : null}
        <View style={styles.ruleCard}>
          <Text style={styles.ruleEyebrow}>档案规则</Text>
          <Text style={styles.ruleText}>名称必填；停用档案不会删除已有设备记录。</Text>
        </View>
      </DesignScreen>
    </>
  );
}

const styles = StyleSheet.create({
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
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mint,
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  name: { fontSize: fontSize.title, fontWeight: '800', color: colors.ink },
  meta: { fontSize: fontSize.small, color: colors.muted, marginTop: 2 },
  addButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.green,
  },
  addButtonText: { color: '#FFFFFF', fontWeight: '800' },
  ruleCard: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.blueSoft },
  ruleEyebrow: { color: colors.blue, fontSize: fontSize.tiny, fontWeight: '800' },
  ruleText: { color: colors.indigo, fontSize: fontSize.small, fontWeight: '700', lineHeight: 20 },
});
