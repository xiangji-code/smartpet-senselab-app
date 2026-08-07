import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { PetInput } from '../api/pets';
import type { PetProfile } from '../types/domain';
import { colors, fontSize, radius, spacing } from '../theme/theme';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 宠物档案表单（创建/编辑复用）。 */
export function PetForm({
  initial,
  submitLabel,
  submitting,
  onSubmit,
}: {
  initial?: PetProfile;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (input: PetInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [species, setSpecies] = useState(initial?.species ?? 'dog');
  const [breed, setBreed] = useState(initial?.breed ?? '');
  const [sex, setSex] = useState<string>(initial?.sex ?? '');
  const [birthday, setBirthday] = useState(initial?.birthday ?? '');
  const [weight, setWeight] = useState(
    initial?.weightKg != null ? String(initial.weightKg) : '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (name.trim().length === 0) {
      setError('请输入宠物名称');
      return;
    }
    if (birthday.trim() && !DATE_RE.test(birthday.trim())) {
      setError('生日格式应为 YYYY-MM-DD');
      return;
    }
    let weightKg: number | null = null;
    if (weight.trim()) {
      const n = Number(weight.trim());
      if (Number.isNaN(n) || n <= 0) {
        setError('体重应为正数');
        return;
      }
      weightKg = n;
    }
    setError(null);
    onSubmit({
      name: name.trim(),
      species: species.trim() || 'dog',
      breed: breed.trim() || null,
      sex: sex.trim() || null,
      birthday: birthday.trim() || null,
      weightKg,
      notes: notes.trim() || null,
    });
  }

  return (
    <View style={styles.form}>
      <Field label="名称 *">
        <TextInput accessibilityLabel="宠物名称" style={styles.input} value={name} onChangeText={setName} placeholder="如：豆豆" placeholderTextColor={colors.muted} />
      </Field>
      <Field label="物种">
        <TextInput accessibilityLabel="宠物物种" style={styles.input} value={species} onChangeText={setSpecies} placeholder="dog" placeholderTextColor={colors.muted} />
      </Field>
      <Field label="品种">
        <TextInput accessibilityLabel="宠物品种" style={styles.input} value={breed} onChangeText={setBreed} placeholder="如：柯基" placeholderTextColor={colors.muted} />
      </Field>
      <Field label="性别">
        <View style={styles.segment}>
          {[
            { k: '公', v: 'male' },
            { k: '母', v: 'female' },
            { k: '未知', v: '' },
          ].map((o) => (
            <Pressable
              key={o.k}
              accessibilityRole="button"
              accessibilityLabel={`性别${o.k}`}
              accessibilityState={{ selected: sex === o.v }}
              style={[styles.segBtn, sex === o.v && styles.segActive]}
              onPress={() => setSex(o.v)}
            >
              <Text style={[styles.segText, sex === o.v && styles.segTextActive]}>{o.k}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label="生日">
        <TextInput accessibilityLabel="宠物生日" style={styles.input} value={birthday} onChangeText={setBirthday} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} autoCapitalize="none" />
      </Field>
      <Field label="体重 (kg)">
        <TextInput accessibilityLabel="宠物体重，单位千克" style={styles.input} value={weight} onChangeText={setWeight} placeholder="如：8.5" placeholderTextColor={colors.muted} keyboardType="decimal-pad" />
      </Field>
      <Field label="备注">
        <TextInput accessibilityLabel="宠物备注" style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} placeholder="健康、习惯等" placeholderTextColor={colors.muted} multiline />
      </Field>

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
        accessibilityState={{ disabled: submitting, busy: submitting }}
        style={({ pressed }) => [
          styles.btn,
          submitting && styles.disabled,
          pressed && styles.btnPressed,
        ]}
        disabled={submitting}
        onPress={submit}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{submitLabel}</Text>}
      </Pressable>
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  field: { gap: spacing.xs },
  label: { fontSize: fontSize.small, color: colors.muted, fontWeight: '600' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  segment: { flexDirection: 'row', backgroundColor: colors.soft, borderRadius: radius.sm, padding: spacing.xs },
  segBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm - 2 },
  segActive: { backgroundColor: colors.panel },
  segText: { color: colors.muted, fontWeight: '700' },
  segTextActive: { color: colors.greenDark },
  error: { color: colors.red, fontSize: fontSize.small },
  btn: { backgroundColor: colors.green, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', minHeight: 46, justifyContent: 'center' },
  btnPressed: { backgroundColor: colors.greenPressed },
  disabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '800' },
});
