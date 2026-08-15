import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';

import { PetForm, type PetFormInput } from '../../src/components/PetForm';
import { ConfirmModal } from '../../src/components/ConfirmModal';
import { DesignScreen } from '../../src/components/design-screen';
import { PageBackButton } from '../../src/components/page-back-button';
import { petsApi, type PetInput } from '../../src/api/pets';
import { ApiError } from '../../src/api/client';
import type { PetProfile } from '../../src/types/domain';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

export default function EditPetScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = Number(id);

  const [pet, setPet] = useState<PetProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await petsApi.get(petId);
        if (!cancelled) setPet(p);
      } catch {
        if (!cancelled) setError('加载宠物档案失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [petId]);

  async function save(input: PetFormInput) {
    setSubmitting(true);
    setError(null);
    try {
      await petsApi.update(petId, input);
      if (input.avatarFile) {
        try {
          await petsApi.uploadAvatar(petId, input.avatarFile);
        } catch {
          Alert.alert(
            '档案已保存',
            '宠物资料已经更新，但头像上传失败。你可以稍后重新上传头像。',
          );
        }
      }
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  async function deactivate() {
    setSubmitting(true);
    try {
      await petsApi.deactivate(petId);
      setConfirmDeactivate(false);
      router.back();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DesignScreen
        title={pet?.name ?? '宠物档案'}
        subtitle="编辑基础资料与档案状态"
        leading={<PageBackButton color="#FFFFFF" onPress={() => router.back()} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xl }} />
        ) : pet ? (
          <>
            {pet.status === 'inactive' ? (
              <Text style={styles.inactive}>该档案已停用</Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PetForm
              initial={pet}
              submitLabel="保存修改"
              submitting={submitting}
              onSubmit={(i) => void save(i)}
            />
            {pet.status === 'active' ? (
              <Pressable style={styles.deactivate} onPress={() => setConfirmDeactivate(true)}>
                <Text style={styles.deactivateText}>停用该档案</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <Text style={styles.error}>{error ?? '未找到宠物档案'}</Text>
        )}
      </DesignScreen>

      <ConfirmModal
        visible={confirmDeactivate}
        title="停用宠物档案"
        message="停用后档案将从列表隐藏（非物理删除，历史保留）。确定停用吗？"
        confirmText="停用"
        destructive
        onConfirm={() => void deactivate()}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.red, fontSize: fontSize.small },
  inactive: { color: colors.amber, fontSize: fontSize.small, fontWeight: '700' },
  deactivate: {
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
  },
  deactivateText: { color: colors.red, fontWeight: '800' },
});
