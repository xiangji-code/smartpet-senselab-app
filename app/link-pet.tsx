import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ConfirmModal } from '../src/components/ConfirmModal';
import { SectionCard } from '../src/components/SectionCard';
import { bindingsApi } from '../src/api/bindings';
import { petsApi } from '../src/api/pets';
import { devicesApi } from '../src/api/devices';
import { href } from '../src/lib/nav';
import type { Device, DevicePetBinding, PetProfile } from '../src/types/domain';
import { colors, fontSize, radius, spacing } from '../src/theme/theme';

export default function LinkPetScreen() {
  const router = useRouter();
  const { deviceId } = useLocalSearchParams<{ deviceId?: string }>();
  const id = Number(deviceId);

  const [device, setDevice] = useState<Device | null>(null);
  const [pets, setPets] = useState<PetProfile[]>([]);
  const [binding, setBinding] = useState<DevicePetBinding | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PetProfile | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [d, ps, b] = await Promise.all([
        devicesApi.get(id),
        petsApi.list(),
        bindingsApi.activeForDevice(id),
      ]);
      setDevice(d);
      setPets(ps);
      setBinding(b);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const currentPetName = binding
    ? pets.find((p) => p.id === binding.petProfileId)?.name ?? `#${binding.petProfileId}`
    : null;

  async function bindTo(pet: PetProfile) {
    setBusy(true);
    try {
      await bindingsApi.create(id, pet.id);
      await load();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function onSelect(pet: PetProfile) {
    if (binding && binding.petProfileId === pet.id) return; // 已是当前关联
    if (binding && binding.petProfileId !== pet.id) {
      setPending(pet); // 需确认替换
      return;
    }
    void bindTo(pet);
  }

  async function unbind() {
    if (!binding) return;
    setBusy(true);
    try {
      await bindingsApi.deactivate(binding.id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: '关联宠物' }} />
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            <SectionCard title={device?.deviceName || device?.deviceSn || '设备'}>
              <Text style={styles.meta}>
                当前关联：{currentPetName ? `${currentPetName}` : '未关联宠物'}
              </Text>
              {binding ? (
                <Pressable style={styles.unbindBtn} onPress={unbind} disabled={busy}>
                  <Text style={styles.unbindText}>解除当前关联</Text>
                </Pressable>
              ) : null}
            </SectionCard>

            <Text style={styles.hint}>选择一只宠物关联到该设备（同一设备同时仅一个关联）：</Text>

            {pets.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>还没有宠物档案</Text>
                <Pressable style={styles.emptyBtn} onPress={() => router.push(href('/pets/new'))}>
                  <Text style={styles.emptyBtnText}>去创建宠物</Text>
                </Pressable>
              </View>
            ) : (
              pets.map((p) => {
                const active = binding?.petProfileId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.petRow, active && styles.petRowActive]}
                    onPress={() => onSelect(p)}
                    disabled={busy}
                  >
                    <View style={styles.avatar}>
                      <Ionicons name="paw" size={18} color={colors.greenDark} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{p.name}</Text>
                      <Text style={styles.meta}>{[p.species, p.breed].filter(Boolean).join(' · ')}</Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.green} />
                    ) : (
                      <Text style={styles.link}>关联</Text>
                    )}
                  </Pressable>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      <ConfirmModal
        visible={pending !== null}
        title="替换关联宠物"
        message={`该设备当前已关联「${currentPetName}」。改为关联「${pending?.name}」吗？原关联将解除并保留历史。`}
        confirmText="改为关联"
        onConfirm={() => pending && void bindTo(pending)}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  meta: { fontSize: fontSize.small, color: colors.muted },
  hint: { fontSize: fontSize.small, color: colors.muted, marginTop: spacing.sm },
  unbindBtn: {
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: radius.sm,
    padding: spacing.sm,
    alignItems: 'center',
  },
  unbindText: { color: colors.red, fontWeight: '700' },
  empty: { alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  emptyText: { color: colors.muted },
  emptyBtn: { backgroundColor: colors.green, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.sm },
  emptyBtnText: { color: '#fff', fontWeight: '800' },
  petRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  petRowActive: { borderColor: colors.green, backgroundColor: colors.mint },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mint,
  },
  name: { fontSize: fontSize.body, fontWeight: '800', color: colors.ink },
  link: { color: colors.greenDark, fontWeight: '800' },
});
