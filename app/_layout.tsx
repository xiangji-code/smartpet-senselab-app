import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { ConsentProvider } from '../src/consent/ConsentContext';
import { PendingUploadProvider } from '../src/ble/PendingUploadContext';
import { ForegroundBleSyncProvider } from '../src/ble/ForegroundBleSyncProvider';
import { colors, fontSize, radius, spacing } from '../src/theme/theme';

/**
 * 导航守卫：
 * - 自举加载中不做跳转，显示 loading。
 * - 未登录只能停留在 (auth) 分组（实现「登录前隐藏底部导航」）。
 * - 已登录进入 (tabs)：无设备 → 扫码绑定；有设备 → 设备列表。
 */
function useProtectedRoute() {
  const { isAuthenticated, isLoading, sessionRecoveryError, devices } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || sessionRecoveryError) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace(devices.length === 0 ? '/(tabs)/bind' : '/(tabs)');
    }
  }, [
    isAuthenticated,
    isLoading,
    sessionRecoveryError,
    devices.length,
    segments,
    router,
  ]);
}

function RootNavigator() {
  const { isLoading, sessionRecoveryError, retrySession } = useAuth();
  useProtectedRoute();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} size="large" />
        <Text style={styles.loadingText}>正在恢复登录状态…</Text>
      </View>
    );
  }

  if (sessionRecoveryError) {
    return (
      <View style={styles.recovery}>
        <View style={styles.recoveryCard}>
          <Text style={styles.recoveryTitle}>暂时无法连接</Text>
          <Text style={styles.recoveryMessage}>{sessionRecoveryError}</Text>
          <Text style={styles.recoveryHint}>
            不会退出账号或清除登录信息，请在网络恢复后重试。
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新连接服务器"
            style={styles.retryButton}
            onPress={() => void retrySession()}
          >
            <Text style={styles.retryButtonText}>重新连接</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="connection-setup" />
      <Stack.Screen name="storage-cache" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ConsentProvider>
          <PendingUploadProvider>
            <ForegroundBleSyncProvider>
              <StatusBar style="dark" />
              <RootNavigator />
            </ForegroundBleSyncProvider>
          </PendingUploadProvider>
        </ConsentProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: spacing.md,
  },
  loadingText: {
    color: colors.muted,
    fontSize: fontSize.body,
  },
  recovery: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  recoveryCard: {
    padding: spacing.xl,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
  },
  recoveryTitle: {
    color: colors.ink,
    fontSize: fontSize.title,
    fontWeight: '800',
  },
  recoveryMessage: {
    color: colors.ink,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  recoveryHint: {
    color: colors.muted,
    fontSize: fontSize.small,
    lineHeight: 20,
  },
  retryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.green,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
});
