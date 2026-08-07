import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Screen } from '../../src/components/Screen';
import { SectionCard } from '../../src/components/SectionCard';
import { StatusPill } from '../../src/components/StatusPill';
import { ConfirmModal } from '../../src/components/ConfirmModal';
import { useAuth } from '../../src/auth/AuthContext';
import { useConsent } from '../../src/consent/ConsentContext';
import { href } from '../../src/lib/nav';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

export default function MeScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { consent, ready: consentReady, error: consentError, setConsent } = useConsent();
  const [confirmOut, setConfirmOut] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);

  const statusLabel =
    user?.status === 'active' ? '正常' : user?.status === 'suspended' ? '已停用' : '未激活';

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
    <Screen title="我的" subtitle="账号、隐私与帮助">
      <SectionCard>
        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={22} color={colors.greenDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text selectable style={styles.email}>
              {user?.email ?? '—'}
            </Text>
          </View>
          <StatusPill tone={user?.status === 'active' ? 'ok' : 'warn'} label={statusLabel} />
        </View>
      </SectionCard>

      <SectionCard title="宠物与设备">
        <Row icon="paw-outline" label="宠物档案" onPress={() => router.push(href('/pets'))} />
      </SectionCard>

      <SectionCard title="本地存储">
        <Row
          icon="server-outline"
          label="存储与缓存"
          onPress={() => router.push(href('/storage-cache'))}
        />
      </SectionCard>

      <SectionCard title="隐私与数据采集授权">
        <View style={styles.consentRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.consentTitle}>数据采集授权</Text>
            <Text style={styles.meta}>
              {!consentReady
                ? '正在读取当前账号的授权状态…'
                : consent
                ? '已授权：App 可采集并上传设备声音、行为与状态数据。'
                : '已关闭：将停止后台采集与数据同步。'}
            </Text>
            {savingConsent ? <Text style={styles.saving}>正在保存…</Text> : null}
            {consentError ? <Text style={styles.error}>{consentError}</Text> : null}
          </View>
          {consentReady ? (
            <Switch
              accessibilityLabel="数据采集授权"
              value={consent}
              onValueChange={(value) => void updateConsent(value)}
              disabled={savingConsent}
              trackColor={{ true: colors.green, false: colors.line }}
            />
          ) : (
            <ActivityIndicator color={colors.green} />
          )}
        </View>
      </SectionCard>

      <SectionCard title="帮助与反馈">
        <Row icon="help-circle-outline" label="常见问题与反馈" onPress={() => setShowHelp(true)} />
      </SectionCard>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="退出登录"
        style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}
        onPress={() => setConfirmOut(true)}
      >
        <Text style={styles.logoutText}>退出登录</Text>
      </Pressable>

      <ConfirmModal
        visible={confirmOut}
        title="退出登录"
        message="退出后需重新登录才能访问设备与数据。确定退出吗？"
        confirmText="退出"
        destructive
        onConfirm={() => {
          setConfirmOut(false);
          void signOut();
        }}
        onCancel={() => setConfirmOut(false)}
      />
      <ConfirmModal
        visible={showHelp}
        title="帮助与反馈"
        message="如遇问题，请先在设备详情页检查连接状态。更多帮助与反馈渠道将在后续版本提供。"
        confirmText="知道了"
        cancelText="关闭"
        onConfirm={() => setShowHelp(false)}
        onCancel={() => setShowHelp(false)}
      />
    </Screen>
  );
}

function Row({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={`打开${label}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={colors.greenDark} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mint,
  },
  email: { fontSize: fontSize.title, fontWeight: '800', color: colors.ink },
  meta: { fontSize: fontSize.small, color: colors.muted, marginTop: 2 },
  saving: { fontSize: fontSize.small, color: colors.greenDark, marginTop: spacing.xs },
  error: { fontSize: fontSize.small, color: colors.red, marginTop: spacing.xs },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  rowPressed: { backgroundColor: colors.soft },
  rowLabel: { flex: 1, fontSize: fontSize.body, color: colors.ink, fontWeight: '600' },
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
