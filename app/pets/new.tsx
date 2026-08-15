import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { DesignScreen } from '../../src/components/design-screen';
import { PageBackButton } from '../../src/components/page-back-button';
import { PetForm, type PetFormInput } from '../../src/components/PetForm';
import { petsApi, type PetInput } from '../../src/api/pets';
import { ApiError } from '../../src/api/client';
import { colors, fontSize, spacing } from '../../src/theme/theme';

export default function NewPetScreen() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(input: PetFormInput) {
    setSubmitting(true);
    setError(null);
    try {
      const pet = await petsApi.create(input);
      if (input.avatarFile) {
        try {
          await petsApi.uploadAvatar(pet.id, input.avatarFile);
        } catch {
          Alert.alert(
            '档案已创建',
            '宠物档案已经保存，但头像上传失败。你可以稍后在宠物档案中重新上传头像。',
          );
        }
      }
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DesignScreen
        title="新建宠物档案"
        subtitle="用于关联设备并归档行为记录"
        leading={<PageBackButton color="#FFFFFF" onPress={() => router.back()} />}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PetForm submitLabel="创建" submitting={submitting} onSubmit={(i) => void create(i)} />
      </DesignScreen>
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.red, fontSize: fontSize.small },
});
