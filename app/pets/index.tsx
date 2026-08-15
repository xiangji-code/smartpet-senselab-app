import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authorizedMediaSource } from '../../src/api/client';
import { MAX_ACTIVE_PET_PROFILES, petsApi } from '../../src/api/pets';
import { DesignScreen } from '../../src/components/design-screen';
import { PageBackButton } from '../../src/components/page-back-button';
import { href } from '../../src/lib/nav';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';
import type { PetProfile } from '../../src/types/domain';

export default function PetsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pets, setPets] = useState<PetProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPets(await petsApi.list());
    } catch {
      setError('宠物档案加载失败，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const atLimit = pets.length >= MAX_ACTIVE_PET_PROFILES;
  const createPet = () => {
    if (!atLimit) router.push(href('/pets/new'));
  };

  const renderPet = ({ item: pet }: { item: PetProfile }) => (
    <Pressable style={styles.card} onPress={() => router.push(href(`/pets/${pet.id}`))}>
      <View style={styles.avatar}>
        {pet.avatarUrl ? (
          <Image
            accessibilityLabel={`${pet.name}的头像`}
            source={authorizedMediaSource(pet.avatarUrl)}
            style={styles.avatarImage}
          />
        ) : (
          <Ionicons name="paw" size={20} color={colors.greenDark} />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.name}>{pet.name}</Text>
        <Text style={styles.meta}>
          {[pet.species, pet.breed, pet.sex === 'male' ? '公' : pet.sex === 'female' ? '母' : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DesignScreen
        title={`宠物档案（${pets.length}/${MAX_ACTIVE_PET_PROFILES}）`}
        subtitle="管理设备关联宠物与基础资料"
        leading={<PageBackButton color="#FFFFFF" onPress={() => router.back()} />}
        action={atLimit ? undefined : (
          <Pressable
            accessibilityLabel="新建宠物档案"
            onPress={createPet}
            hitSlop={10}
          >
            <Ionicons name="add-circle-outline" size={28} color="#FFFFFF" />
          </Pressable>
        )}
        scrollable={false}
      >
        {loading && pets.length === 0 ? (
          <ActivityIndicator color={colors.green} style={styles.loader} />
        ) : (
          <FlatList
            data={pets}
            renderItem={renderPet}
            keyExtractor={(pet) => String(pet.id)}
            contentInsetAdjustmentBehavior="automatic"
            showsVerticalScrollIndicator={false}
            refreshing={loading}
            onRefresh={() => void reload()}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xl },
              pets.length === 0 && styles.emptyList,
            ]}
            ListEmptyComponent={(
              <View style={styles.empty}>
                <Ionicons name={error ? 'cloud-offline-outline' : 'paw-outline'} size={40} color={colors.muted} />
                <Text style={styles.emptyText}>{error ?? '还没有宠物档案'}</Text>
                <Pressable style={styles.emptyBtn} onPress={error ? () => void reload() : createPet}>
                  <Text style={styles.emptyBtnText}>{error ? '重新加载' : '创建宠物档案'}</Text>
                </Pressable>
              </View>
            )}
            ListFooterComponent={pets.length > 0 ? (
              <View style={styles.footer}>
                {atLimit ? (
                  <View style={styles.limitCard}>
                    <Ionicons name="information-circle-outline" size={20} color={colors.indigo} />
                    <Text style={styles.limitText}>已达到 1000 个宠物档案上限</Text>
                  </View>
                ) : (
                  <Pressable style={styles.addButton} onPress={createPet}>
                    <Ionicons name="add" size={20} color="#FFFFFF" />
                    <Text style={styles.addButtonText}>新建宠物档案</Text>
                  </Pressable>
                )}
                <View style={styles.ruleCard}>
                  <Text style={styles.ruleEyebrow}>档案规则</Text>
                  <Text style={styles.ruleText}>
                    每个账号最多创建 1000 个宠物档案；同一账号下宠物名称不能重复。
                  </Text>
                </View>
              </View>
            ) : null}
          />
        )}
      </DesignScreen>
    </>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: spacing.xl },
  listContent: { padding: spacing.lg, gap: spacing.lg },
  emptyList: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyText: { color: colors.muted, fontSize: fontSize.body, textAlign: 'center' },
  emptyBtn: {
    backgroundColor: colors.green,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '800' },
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
  cardBody: { flex: 1 },
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
  footer: { gap: spacing.lg },
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
  limitCard: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.blueSoft,
  },
  limitText: { color: colors.indigo, fontWeight: '800' },
  ruleCard: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.blueSoft },
  ruleEyebrow: { color: colors.blue, fontSize: fontSize.tiny, fontWeight: '800' },
  ruleText: { color: colors.indigo, fontSize: fontSize.small, fontWeight: '700', lineHeight: 20 },
});
