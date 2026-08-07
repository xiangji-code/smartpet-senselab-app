import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Screen } from '../../src/components/Screen';
import { useAuth } from '../../src/auth/AuthContext';
import { devicesApi } from '../../src/api/devices';
import { ApiError } from '../../src/api/client';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

const isWeb = Platform.OS === 'web';

/**
 * 扫码绑定页（issue-02）。
 * 扫描二维码或手动输入 Device SN → 登记待验证设备 → 进入蓝牙验证。
 * device_type 由后端按 SN 识别，此处不选择。
 */
export default function BindScreen() {
  const router = useRouter();
  const { refreshDevices } = useAuth();

  const [sn, setSn] = useState('');
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  // 防止相机在一次会话内重复触发绑定
  const lockRef = useRef(false);

  function friendlyError(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.status === 404) return '设备不存在，请确认设备码是否正确';
      if (e.status === 409) return '该设备已被其他账号登记或绑定';
      if (e.status === 403) return '该设备已停用，无法绑定';
      if (e.status === 422) return '设备码格式不正确';
      return e.message || '添加失败，请稍后再试';
    }
    return '网络异常，请检查网络后重试';
  }

  const bind = useCallback(
    async (rawSn: string) => {
      const value = rawSn.trim();
      if (!value) {
        setError('请输入设备码');
        return;
      }
      setError(null);
      setSubmitting(true);
      try {
        const device = await devicesApi.beginVerification(value);
        await refreshDevices();
        const query =
          `deviceId=${device.id}` +
          `&deviceSn=${encodeURIComponent(device.deviceSn)}` +
          `&deviceName=${encodeURIComponent(device.deviceName ?? '')}`;
        // 路由类型在 expo start 时生成；新路由此处以 Href 显式标注
        router.push(`/connection-setup?${query}` as Href);
        setSn('');
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setSubmitting(false);
      }
    },
    [refreshDevices, router],
  );

  const handleScanned = useCallback(
    ({ data }: { data: string }) => {
      if (lockRef.current) return;
      lockRef.current = true;
      setScanning(false);
      void bind(data).finally(() => {
        // 稍作延迟再解锁，避免关闭动画期间重复回调
        setTimeout(() => {
          lockRef.current = false;
        }, 800);
      });
    },
    [bind],
  );

  async function openScanner() {
    setError(null);
    if (isWeb) {
      setError('Web 预览暂不支持扫码，请在下方手动输入设备码');
      return;
    }
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setError('未授予相机权限，无法扫码，请手动输入设备码');
        return;
      }
    }
    lockRef.current = false;
    setScanning(true);
  }

  // 扫码全屏视图
  if (scanning) {
    return (
      <View style={styles.scanRoot}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13'] }}
          onBarcodeScanned={handleScanned}
        />
        <View style={styles.scanOverlay} pointerEvents="box-none">
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>将设备二维码对准取景框</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭扫码"
            style={({ pressed }) => [styles.cancelBtn, pressed && styles.cancelBtnPressed]}
            onPress={() => setScanning(false)}
          >
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Screen title="添加设备" subtitle="扫描设备码后，还需连接蓝牙完成验证">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="打开相机扫描设备码"
        accessibilityHint="扫描设备二维码并开始连接验证"
        style={({ pressed }) => [styles.scanCard, pressed && styles.scanCardPressed]}
        onPress={openScanner}
        disabled={submitting}
      >
        <Ionicons name="qr-code-outline" size={40} color={colors.greenDark} />
        <Text style={styles.scanCardTitle}>扫描设备码</Text>
        <Text style={styles.scanCardSub}>
          {isWeb ? 'Web 预览请使用下方手动输入' : '点击打开相机扫描设备二维码'}
        </Text>
      </Pressable>

      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.dividerText}>或手动输入设备码</Text>
        <View style={styles.line} />
      </View>

      <View style={styles.card}>
        <Text style={styles.fieldLabel}>设备码</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="设备码"
          placeholder="设备码（Device SN）"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          value={sn}
          editable={!submitting}
          onChangeText={(t) => {
            setSn(t);
            if (error) setError(null);
          }}
          onSubmitEditing={() => void bind(sn)}
        />

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="下一步，连接验证"
          accessibilityState={{ disabled: submitting || sn.trim().length === 0, busy: submitting }}
          style={({ pressed }) => [
            styles.btn,
            (submitting || sn.trim().length === 0) && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}
          disabled={submitting || sn.trim().length === 0}
          onPress={() => void bind(sn)}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>下一步：连接验证</Text>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scanCard: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  scanCardPressed: { borderColor: colors.lineStrong, backgroundColor: colors.surfaceAlt },
  scanCardTitle: { fontSize: fontSize.title, fontWeight: '800', color: colors.ink },
  scanCardSub: { fontSize: fontSize.small, color: colors.muted, textAlign: 'center' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  line: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerText: { fontSize: fontSize.tiny, color: colors.muted },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  fieldLabel: { color: colors.ink, fontSize: fontSize.small, fontWeight: '700' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  btnPressed: { backgroundColor: colors.greenPressed },
  error: { color: colors.red, fontSize: fontSize.small },
  btn: {
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '800' },
  // 扫码全屏
  scanRoot: { flex: 1, backgroundColor: '#000' },
  scanOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  scanFrame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#fff',
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  scanHint: { color: '#fff', fontSize: fontSize.body, fontWeight: '600' },
  cancelBtn: {
    position: 'absolute',
    bottom: 48,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  cancelBtnPressed: { backgroundColor: 'rgba(0,0,0,0.8)' },
  cancelText: { color: '#fff', fontWeight: '700', fontSize: fontSize.body },
});
