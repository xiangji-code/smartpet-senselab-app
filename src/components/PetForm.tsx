import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import * as ImagePicker from 'expo-image-picker';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { authorizedMediaSource } from '../api/client';
import type { PetAvatarFile, PetInput } from '../api/pets';
import type { PetProfile } from '../types/domain';
import { colors, fontSize, radius, spacing } from '../theme/theme';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function parseDate(value: string): Date {
  const match = DATE_RE.exec(value);
  if (!match) return new Date();
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface PetFormInput extends PetInput {
  avatarFile?: PetAvatarFile;
}

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
  onSubmit: (input: PetFormInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [species, setSpecies] = useState(initial?.species ?? 'dog');
  const [breed, setBreed] = useState(initial?.breed ?? '');
  const [sex, setSex] = useState<string>(initial?.sex ?? '');
  const [birthday, setBirthday] = useState(initial?.birthday ?? '');
  const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);
  const [weight, setWeight] = useState(
    initial?.weightKg != null ? String(initial.weightKg) : '',
  );
  const [avatarFile, setAvatarFile] = useState<PetAvatarFile | undefined>();
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
      avatarUrl: initial?.avatarUrl,
      avatarFile,
      notes: notes.trim() || null,
    });
  }

  async function selectAvatar() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('需要允许访问照片，才能选择宠物头像');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (asset.fileSize != null && asset.fileSize > MAX_AVATAR_BYTES) {
      setError('头像图片不能超过 5 MB');
      return;
    }
    const mimeType = asset.mimeType || 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      setError('请选择 JPEG、PNG 或 WebP 图片');
      return;
    }
    setAvatarFile({ uri: asset.uri, fileName: asset.fileName, mimeType });
  }

  return (
    <View style={styles.form}>
      <Field label="名称 *">
        <TextInput accessibilityLabel="宠物名称" style={styles.input} value={name} onChangeText={setName} placeholder="如：豆豆" placeholderTextColor={colors.muted} />
      </Field>
      <Field label="宠物头像">
        <View style={styles.avatarRow}>
          <View style={styles.avatarPreview}>
            {avatarFile?.uri || initial?.avatarUrl ? (
              <Image accessibilityLabel="宠物头像预览" source={avatarFile?.uri ? { uri: avatarFile.uri } : authorizedMediaSource(initial!.avatarUrl!)} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarInitial}>{name.trim().slice(0, 1).toUpperCase() || '宠'}</Text>
            )}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="从手机相册选择宠物头像" style={({ pressed }) => [styles.avatarButton, pressed && styles.btnPressed]} onPress={() => void selectAvatar()}>
            <Ionicons name="images-outline" size={19} color={colors.greenDark} />
            <Text style={styles.avatarButtonText}>{avatarFile || initial?.avatarUrl ? '更换头像' : '从相册选择'}</Text>
          </Pressable>
        </View>
        <Text style={styles.avatarHelp}>支持 JPEG、PNG、WebP，最大 5 MB。保存后会同步到宠物档案。</Text>
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
        <View style={styles.pickerField}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="选择宠物生日"
            style={styles.pickerButton}
            onPress={() => setShowBirthdayPicker(true)}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.greenDark} />
            <Text style={[styles.pickerValue, !birthday && styles.pickerPlaceholder]}>
              {birthday || '请选择日期'}
            </Text>
          </Pressable>
          {birthday ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清空宠物生日"
              hitSlop={8}
              onPress={() => setBirthday('')}
            >
              <Ionicons name="close-circle" size={22} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        {showBirthdayPicker ? (
          <DateTimePicker
            value={parseDate(birthday)}
            mode="date"
            maximumDate={new Date()}
            presentation={process.env.EXPO_OS === 'android' ? 'dialog' : 'inline'}
            onValueChange={(_event, selectedDate) => {
              setShowBirthdayPicker(false);
              setBirthday(formatDate(selectedDate));
            }}
            onDismiss={() => setShowBirthdayPicker(false)}
          />
        ) : null}
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
  form: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
  },
  field: { gap: spacing.xs },
  label: { fontSize: fontSize.small, color: colors.muted, fontWeight: '600' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  pickerField: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: '#fff',
  },
  pickerButton: { minHeight: 46, flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickerValue: { flex: 1, color: colors.ink },
  pickerPlaceholder: { color: colors.muted },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarPreview: { width: 56, height: 56, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.mint },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { color: colors.greenDark, fontSize: fontSize.title, fontWeight: '900' },
  avatarButton: { minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.green, borderRadius: radius.md, backgroundColor: colors.mint },
  avatarButtonText: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '800' },
  avatarHelp: { color: colors.muted, fontSize: fontSize.tiny, lineHeight: 18 },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  segment: { flexDirection: 'row', backgroundColor: colors.soft, borderRadius: radius.md, padding: spacing.xs },
  segBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm - 2 },
  segActive: { backgroundColor: colors.panel },
  segText: { color: colors.muted, fontWeight: '700' },
  segTextActive: { color: colors.greenDark },
  error: { color: colors.red, fontSize: fontSize.small },
  btn: { backgroundColor: colors.green, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  btnPressed: { backgroundColor: colors.greenPressed },
  disabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '800' },
});
