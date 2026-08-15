import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { Screen } from '../../src/components/Screen';
import { SectionCard } from '../../src/components/SectionCard';
import { StatusPill } from '../../src/components/StatusPill';
import { ConfirmModal } from '../../src/components/ConfirmModal';
import { useAuth } from '../../src/auth/AuthContext';
import { useConsent } from '../../src/consent/ConsentContext';
import { href } from '../../src/lib/nav';
import { useLanguage } from '../../src/i18n/LanguageContext';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

export default function MeScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { consent, ready: consentReady, error: consentError, setConsent } = useConsent();
  const { language, setLanguage, t } = useLanguage();
  const [confirmOut, setConfirmOut] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [languageExpanded, setLanguageExpanded] = useState(false);

  const statusLabel =
    user?.status === 'active' ? t.normal : user?.status === 'suspended' ? t.suspended : t.inactive;

  async function updateConsent(value: boolean) {
    if (!consentReady || savingConsent) return;
    setSavingConsent(true);
    try {
      await setConsent(value);
    } catch {
      // 具体提示由 ConsentContext 提供；持久化失败时开关保持原值。
    } finally {
      setSavingConsent(false);
    }
  }

  return (
    <Screen>
      <StatusBar style="dark" />
      <SectionCard>
        <View style={styles.profileHero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>SP</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text selectable style={styles.email}>
              {user?.email ?? '—'}
            </Text>
          </View>
          <StatusPill tone={user?.status === 'active' ? 'ok' : 'warn'} label={statusLabel} />
        </View>
      </SectionCard>

      <SectionCard title={t.petsAndDevices}>
        <Row icon="paw-outline" label={t.petProfiles} hint={t.openItem(t.petProfiles)} onPress={() => router.push(href('/pets'))} />
      </SectionCard>

      <SectionCard title={language === 'zh' ? '设置' : 'Settings'}>
        <Row
          icon="language-outline"
          label={t.language}
          value={language === 'zh' ? t.chinese : t.english}
          hint={t.languageDescription}
          onPress={() => setLanguageExpanded((value) => !value)}
        />
        {languageExpanded ? (
          <View style={styles.languageOptions}>
            {([
              { value: 'zh' as const, label: t.chinese },
              { value: 'en' as const, label: t.english },
            ]).map((option) => (
              <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: language === option.value }} style={({ pressed }) => [styles.languageOption, pressed && styles.rowPressed]} onPress={() => { void setLanguage(option.value); setLanguageExpanded(false); }}>
                <Text style={[styles.languageOptionText, language === option.value && styles.languageOptionTextActive]}>{option.label}</Text>
                {language === option.value ? <Ionicons name="checkmark-circle" size={20} color={colors.greenDark} /> : <Ionicons name="ellipse-outline" size={20} color={colors.muted} />}
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.separator} />
        <Row
          icon="server-outline"
          label={t.storageAndCache}
          hint={t.openItem(t.storageAndCache)}
          onPress={() => router.push(href('/storage-cache'))}
        />
        <View style={styles.separator} />
        <View style={styles.consentRow}>
          <View style={styles.rowIcon}><Ionicons name="shield-checkmark-outline" size={19} color={colors.greenDark} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.consentTitle}>{t.dataConsent}</Text>
            <Text style={styles.meta}>
              {!consentReady
                ? t.consentLoading
                : consent
                ? t.consentEnabled
                : t.consentDisabled}
            </Text>
            {savingConsent ? <Text style={styles.saving}>{t.saving}</Text> : null}
            {consentError ? <Text style={styles.error}>{consentError}</Text> : null}
          </View>
          {consentReady ? (
            <Switch
              accessibilityLabel={t.dataConsent}
              value={consent}
              onValueChange={(value) => void updateConsent(value)}
              disabled={savingConsent}
              trackColor={{ true: colors.green, false: colors.line }}
            />
          ) : (
            <ActivityIndicator color={colors.green} />
          )}
        </View>
        <View style={styles.separator} />
        <Row icon="help-circle-outline" label={t.faq} hint={t.openItem(t.faq)} onPress={() => setShowHelp(true)} />
      </SectionCard>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.signOut}
        style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}
        onPress={() => setConfirmOut(true)}
      >
        <Text style={styles.logoutText}>{t.signOut}</Text>
      </Pressable>

      <ConfirmModal
        visible={confirmOut}
        title={t.signOut}
        message={t.signOutMessage}
        confirmText={t.signOut}
        destructive
        onConfirm={() => {
          setConfirmOut(false);
          void signOut();
        }}
        onCancel={() => setConfirmOut(false)}
      />
      <ConfirmModal
        visible={showHelp}
        title={t.helpAndFeedback}
        message={t.helpMessage}
        confirmText={t.understood}
        cancelText={t.close}
        onConfirm={() => setShowHelp(false)}
        onCancel={() => setShowHelp(false)}
      />
    </Screen>
  );
}

function Row({
  icon,
  label,
  value,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.rowIcon}><Ionicons name={icon} size={19} color={colors.greenDark} /></View>
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  profileHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    margin: -spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.indigo,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
  },
  avatarText: { color: '#fff', fontSize: fontSize.small, fontWeight: '900' },
  email: { fontSize: fontSize.title, fontWeight: '800', color: '#fff' },
  meta: { fontSize: fontSize.small, color: colors.muted, marginTop: 2 },
  saving: { fontSize: fontSize.small, color: colors.greenDark, marginTop: spacing.xs },
  error: { fontSize: fontSize.small, color: colors.red, marginTop: spacing.xs },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.sm,
  },
  rowIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.mint },
  rowPressed: { backgroundColor: colors.soft },
  rowLabel: { flex: 1, fontSize: fontSize.body, color: colors.ink, fontWeight: '600' },
  rowValue: { color: colors.muted, fontSize: fontSize.tiny },
  languageOptions: { marginLeft: 38, marginBottom: spacing.sm, padding: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.soft },
  languageOption: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  languageOptionText: { color: colors.muted, fontSize: fontSize.small, fontWeight: '700' },
  languageOptionTextActive: { color: colors.greenDark },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  consentTitle: { fontSize: fontSize.body, fontWeight: '800', color: colors.ink },
  logout: {
    minHeight: 48,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  logoutPressed: { backgroundColor: colors.dangerSurface },
  logoutText: { color: colors.red, fontWeight: '800' },
});
