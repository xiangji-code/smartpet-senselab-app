import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { PetForm } from '../../src/components/PetForm';
import { petsApi, type PetInput } from '../../src/api/pets';
import { ApiError } from '../../src/api/client';
import { colors, fontSize, spacing } from '../../src/theme/theme';

export default function NewPetScreen() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(input: PetInput) {
    setSubmitting(true);
    setError(null);
    try {
      await petsApi.create(input);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: '新建宠物档案' }} />
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PetForm submitLabel="创建" submitting={submitting} onSubmit={(i) => void create(i)} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  error: { color: colors.red, fontSize: fontSize.small },
});
