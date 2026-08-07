import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Screen } from '../../src/components/Screen';
import { CaptchaField, type CaptchaFieldHandle } from '../../src/components/CaptchaField';
import { useAuth } from '../../src/auth/AuthContext';
import { lastAccountStore } from '../../src/auth/lastAccountStore';
import { SessionSetupError } from '../../src/auth/sessionErrors';
import { authApi } from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

type Mode = 'login' | 'register';
interface FriendlyError {
  message: string;
  retryable: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 登录 / 注册（双 Tab）。
 * - 登录：若邮箱未注册，自动切到注册页并提示用户完成注册。
 * - 注册：需二次确认密码 + 图形验证码。
 * 协议与数据采集授权在页面最底部，勾选后方可提交。
 */
export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const captchaRef = useRef<CaptchaFieldHandle>(null);
  const emailEditedRef = useRef(false);
  const submitLockRef = useRef(false);

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrySuggested, setRetrySuggested] = useState(false);

  const isRegister = mode === 'register';

  useEffect(() => {
    let cancelled = false;
    void lastAccountStore.getEmail().then((lastEmail) => {
      if (!cancelled && lastEmail && !emailEditedRef.current) {
        setEmail(lastEmail);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetMessages() {
    setError(null);
    setNotice(null);
    setRetrySuggested(false);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setPassword('');
    setConfirm('');
    setCaptchaCode('');
    resetMessages();
  }

  function friendlyLoginError(e: unknown): FriendlyError {
    if (e instanceof SessionSetupError) {
      const cause = e.cause;
      if (cause instanceof ApiError) {
        if (cause.kind === 'timeout') {
          return {
            message: '密码验证已通过，但加载账号信息超时，请重新登录',
            retryable: true,
          };
        }
        if (cause.kind === 'network') {
          return {
            message: '密码验证已通过，但当前网络不可用，请检查网络后重试',
            retryable: true,
          };
        }
        if (cause.status >= 500) {
          return {
            message: '密码验证已通过，但服务器暂时无法加载账号信息，请重试',
            retryable: true,
          };
        }
      }
      return {
        message: '密码验证已通过，但登录状态建立失败，请重试',
        retryable: true,
      };
    }
    if (e instanceof ApiError) {
      if (e.kind === 'timeout') {
        return { message: '连接服务器超时，请稍后重试', retryable: true };
      }
      if (e.kind === 'network') {
        return { message: '网络连接失败，请检查网络后重试', retryable: true };
      }
      if (e.status === 401) {
        return { message: '邮箱或密码错误，请重试', retryable: false };
      }
      if (e.status === 403) {
        return { message: '账号已被停用，请联系客服', retryable: false };
      }
      if (e.status === 422) {
        return { message: '邮箱或密码格式不正确', retryable: false };
      }
      if (e.status === 429) {
        return { message: '尝试次数过多，请稍后再试', retryable: true };
      }
      if (e.status >= 500) {
        return { message: '服务器暂时不可用，请稍后重试', retryable: true };
      }
      return {
        message: e.message || '请求失败，请稍后再试',
        retryable: e.retryable,
      };
    }
    return { message: '发生未知错误，请稍后重试', retryable: true };
  }

  function friendlyRegisterError(e: unknown): FriendlyError {
    if (e instanceof ApiError) {
      if (e.kind === 'timeout') {
        return { message: '连接服务器超时，请稍后重试', retryable: true };
      }
      if (e.kind === 'network') {
        return { message: '网络连接失败，请检查网络后重试', retryable: true };
      }
      if (e.status === 400) {
        return { message: '验证码错误或已过期，请重新输入', retryable: false };
      }
      if (e.status === 409) {
        return { message: '该邮箱已注册，请直接登录', retryable: false };
      }
      if (e.status === 422) {
        return { message: '邮箱、密码或验证码格式不正确', retryable: false };
      }
      if (e.status >= 500) {
        return { message: '服务器暂时不可用，请稍后重试', retryable: true };
      }
      return {
        message: e.message || '注册失败，请稍后再试',
        retryable: e.retryable,
      };
    }
    return { message: '发生未知错误，请稍后重试', retryable: true };
  }

  async function submitLogin() {
    if (submitLockRef.current) return;
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (password.length === 0) {
      setError('请输入密码');
      return;
    }
    if (!consent) {
      setError('请先阅读并同意页面底部的协议与数据采集授权');
      return;
    }
    resetMessages();
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const exists = await authApi.emailExists(e);
      if (!exists) {
        setMode('register');
        setPassword('');
        setConfirm('');
        setCaptchaCode('');
        setNotice('该邮箱尚未注册，请设置密码并输入验证码完成注册');
        return;
      }
      await signIn(e, password, { dataCollectionConsent: true });
      // 成功后由根布局守卫按设备数量跳转
    } catch (err) {
      const friendly = friendlyLoginError(err);
      setError(friendly.message);
      setRetrySuggested(friendly.retryable);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  async function submitRegister() {
    if (submitLockRef.current) return;
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    if (captchaCode.trim().length === 0) {
      setError('请输入图形验证码');
      return;
    }
    if (!consent) {
      setError('请先阅读并同意页面底部的协议与数据采集授权');
      return;
    }
    resetMessages();
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      await signUp(
        e,
        password,
        {
          confirmPassword: confirm,
          captchaId,
          captchaCode: captchaCode.trim(),
        },
        { dataCollectionConsent: true },
      );
      // 成功后由根布局守卫跳转
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setMode('login');
        setConfirm('');
        setCaptchaCode('');
        setError('该邮箱已注册，请直接登录');
        return;
      }
      // 其它失败：换一张验证码，避免复用
      captchaRef.current?.refresh();
      setCaptchaCode('');
      const friendly = friendlyRegisterError(err);
      setError(friendly.message);
      setRetrySuggested(friendly.retryable);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.brand}>
        <Text style={styles.brandText}>SmartPet</Text>
        <Text style={styles.brandSub}>智能宠物设备管理</Text>
      </View>

      <View style={styles.tabs}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: !isRegister, disabled: submitting }}
          accessibilityLabel="登录"
          style={({ pressed }) => [
            styles.tab,
            !isRegister && styles.tabActive,
            pressed && styles.tabPressed,
          ]}
          onPress={() => switchMode('login')}
          disabled={submitting}
        >
          <Text style={[styles.tabText, !isRegister && styles.tabTextActive]}>登录</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: isRegister, disabled: submitting }}
          accessibilityLabel="注册"
          style={({ pressed }) => [
            styles.tab,
            isRegister && styles.tabActive,
            pressed && styles.tabPressed,
          ]}
          onPress={() => switchMode('register')}
          disabled={submitting}
        >
          <Text style={[styles.tabText, isRegister && styles.tabTextActive]}>注册</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <TextInput
          accessibilityLabel="邮箱"
          style={styles.input}
          placeholder="邮箱"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          editable={!submitting}
          onChangeText={(t) => {
            emailEditedRef.current = true;
            setEmail(t);
            resetMessages();
          }}
        />

        <TextInput
          accessibilityLabel={isRegister ? '设置密码' : '密码'}
          style={styles.input}
          placeholder={isRegister ? '设置密码（至少 8 位）' : '密码'}
          placeholderTextColor={colors.muted}
          secureTextEntry
          value={password}
          editable={!submitting}
          onChangeText={(t) => {
            setPassword(t);
            resetMessages();
          }}
        />

        {isRegister ? (
          <>
            <TextInput
              accessibilityLabel="确认密码"
              style={styles.input}
              placeholder="确认密码"
              placeholderTextColor={colors.muted}
              secureTextEntry
              value={confirm}
              editable={!submitting}
              onChangeText={(t) => {
                setConfirm(t);
                resetMessages();
              }}
            />
            <CaptchaField
              ref={captchaRef}
              value={captchaCode}
              editable={!submitting}
              onCaptchaId={setCaptchaId}
              onChangeText={(t) => {
                setCaptchaCode(t);
                resetMessages();
              }}
            />
          </>
        ) : null}

        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </Text>
        ) : null}
        {error ? (
          <View accessibilityRole="alert" style={styles.errorBox}>
            <Text style={styles.error}>{error}</Text>
            {retrySuggested ? (
              <Text style={styles.retryHint}>网络恢复后可直接点击下方按钮重试</Text>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRegister ? '注册并登录' : '登录'}
          accessibilityState={{ disabled: submitting, busy: submitting }}
          style={({ pressed }) => [
            styles.btn,
            submitting && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}
          disabled={submitting}
          onPress={isRegister ? submitRegister : submitLogin}
        >
          {submitting ? (
            <View style={styles.submittingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.btnText}>
                {isRegister ? '正在注册…' : '正在登录…'}
              </Text>
            </View>
          ) : (
            <Text style={styles.btnText}>
              {isRegister ? '注册并登录' : retrySuggested ? '重新登录' : '登录'}
            </Text>
          )}
        </Pressable>
      </View>

      <View style={styles.consentRow}>
        <Switch
          accessibilityLabel="同意用户协议、隐私政策和数据采集授权"
          value={consent}
          onValueChange={setConsent}
          disabled={submitting}
          trackColor={{ true: colors.green, false: colors.line }}
        />
        <Text style={styles.consentText}>
          我已阅读并同意《用户协议》《隐私政策》，并授权 SmartPet
          采集和上传设备产生的声音、行为和设备状态数据。
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: {
    minHeight: 112,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mint,
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  brandText: { fontSize: 36, fontWeight: '900', color: colors.greenDark },
  brandSub: { color: colors.muted, fontSize: fontSize.small, fontWeight: '600' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.soft,
    borderRadius: radius.sm,
    padding: 4,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm - 2,
  },
  tabActive: { backgroundColor: '#fff' },
  tabPressed: { opacity: 0.75 },
  tabText: { fontWeight: '700', color: colors.muted },
  tabTextActive: { color: colors.greenDark },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  notice: { color: colors.greenDark, fontSize: fontSize.small },
  errorBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#f1c4bf',
    borderRadius: radius.sm,
    backgroundColor: '#fff4f2',
  },
  error: { color: colors.red, fontSize: fontSize.small, lineHeight: 19 },
  retryHint: { color: colors.muted, fontSize: fontSize.tiny },
  btn: {
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { backgroundColor: colors.greenPressed },
  btnText: { color: '#fff', fontWeight: '800' },
  submittingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  consentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginTop: spacing.lg,
  },
  consentText: { flex: 1, fontSize: fontSize.tiny, color: colors.muted, lineHeight: 18 },
});
