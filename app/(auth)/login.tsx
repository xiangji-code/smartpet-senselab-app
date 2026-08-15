import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
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
import { useLanguage } from '../../src/i18n/LanguageContext';
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
  const { t } = useLanguage();
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

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
    setPasswordVisible(false);
    setConfirmVisible(false);
    resetMessages();
  }

  function friendlyLoginError(e: unknown): FriendlyError {
    if (e instanceof SessionSetupError) {
      const cause = e.cause;
      if (cause instanceof ApiError) {
        if (cause.kind === 'timeout') {
          return {
            message: t.loginProfileTimeout,
            retryable: true,
          };
        }
        if (cause.kind === 'network') {
          return {
            message: t.loginProfileNetwork,
            retryable: true,
          };
        }
        if (cause.status >= 500) {
          return {
            message: t.loginProfileServer,
            retryable: true,
          };
        }
      }
      return {
        message: t.loginSessionFailed,
        retryable: true,
      };
    }
    if (e instanceof ApiError) {
      if (e.kind === 'timeout') {
        return { message: t.connectionTimeout, retryable: true };
      }
      if (e.kind === 'network') {
        return { message: t.networkFailed, retryable: true };
      }
      if (e.status === 401) {
        return { message: t.credentialsInvalid, retryable: false };
      }
      if (e.status === 403) {
        return { message: t.accountSuspended, retryable: false };
      }
      if (e.status === 422) {
        return { message: t.credentialsFormatInvalid, retryable: false };
      }
      if (e.status === 429) {
        return { message: t.tooManyAttempts, retryable: true };
      }
      if (e.status >= 500) {
        return { message: t.serverUnavailable, retryable: true };
      }
      return {
        message: e.message || t.requestFailed,
        retryable: e.retryable,
      };
    }
    return { message: t.unknownError, retryable: true };
  }

  function friendlyRegisterError(e: unknown): FriendlyError {
    if (e instanceof ApiError) {
      if (e.kind === 'timeout') {
        return { message: t.connectionTimeout, retryable: true };
      }
      if (e.kind === 'network') {
        return { message: t.networkFailed, retryable: true };
      }
      if (e.status === 400) {
        return { message: t.captchaInvalid, retryable: false };
      }
      if (e.status === 409) {
        return { message: t.emailRegistered, retryable: false };
      }
      if (e.status === 422) {
        return { message: t.registrationFormatInvalid, retryable: false };
      }
      if (e.status >= 500) {
        return { message: t.serverUnavailable, retryable: true };
      }
      return {
        message: e.message || t.registrationFailed,
        retryable: e.retryable,
      };
    }
    return { message: t.unknownError, retryable: true };
  }

  async function submitLogin() {
    if (submitLockRef.current) return;
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      setError(t.invalidEmail);
      return;
    }
    if (password.length === 0) {
      setError(t.enterPassword);
      return;
    }
    if (!consent) {
      setError(t.acceptConsent);
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
        setNotice(t.accountNotRegistered);
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
      setError(t.invalidEmail);
      return;
    }
    if (password.length < 8) {
      setError(t.passwordMin);
      return;
    }
    if (password !== confirm) {
      setError(t.passwordMismatch);
      return;
    }
    if (captchaCode.trim().length === 0) {
      setError(t.enterCaptcha);
      return;
    }
    if (!consent) {
      setError(t.acceptConsent);
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
        setError(t.emailRegistered);
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
      <View style={styles.hero}>
        <View style={styles.heroSignalLeft} />
        <View style={styles.heroSignalRight} />
        <Image
          accessibilityLabel="SmartPet 德牧智能项圈图标"
          source={require('../../assets/app-icon-white.png')}
          resizeMode="cover"
          style={styles.petAvatar}
        />
      </View>

      <View style={styles.authSheet}>
        <Image
          accessibilityLabel="SmartPet 智慧陪伴，养宠无忧"
          source={require('../../assets/smartpet-wordmark.png')}
          resizeMode="contain"
          style={styles.brandLogo}
        />
        <View style={styles.tabs}>
          <AuthTab label={t.login} active={!isRegister} disabled={submitting} onPress={() => switchMode('login')} />
          <AuthTab label={t.register} active={isRegister} disabled={submitting} onPress={() => switchMode('register')} />
        </View>

        <View style={styles.form}>
        <AuthInput
          icon="mail-outline"
          accessibilityLabel={t.email}
          placeholder={t.email}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          editable={!submitting}
          onChangeText={(value) => {
            emailEditedRef.current = true;
            setEmail(value);
            resetMessages();
          }}
        />

        <AuthInput
          icon="lock-closed-outline"
          accessibilityLabel={isRegister ? t.setPassword : t.password}
          placeholder={isRegister ? t.setPasswordHint : t.password}
          secureTextEntry={!passwordVisible}
          value={password}
          editable={!submitting}
          trailing={
            <PasswordVisibilityButton
              visible={passwordVisible}
              disabled={submitting}
              onPress={() => setPasswordVisible((current) => !current)}
            />
          }
          onChangeText={(value) => {
            setPassword(value);
            resetMessages();
          }}
        />

        {isRegister ? (
          <>
            <AuthInput
              icon="shield-checkmark-outline"
              accessibilityLabel={t.confirmPassword}
              placeholder={t.confirmPassword}
              secureTextEntry={!confirmVisible}
              value={confirm}
              editable={!submitting}
              trailing={
                <PasswordVisibilityButton
                  visible={confirmVisible}
                  disabled={submitting}
                  onPress={() => setConfirmVisible((current) => !current)}
                />
              }
              onChangeText={(value) => {
                setConfirm(value);
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
              <Text style={styles.retryHint}>{t.retryHint}</Text>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRegister ? t.registerAndLogin : t.login}
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
                {isRegister ? t.registering : t.loggingIn}
              </Text>
            </View>
          ) : (
            <Text style={styles.btnText}>
              {isRegister ? t.registerAndLogin : retrySuggested ? t.retryLogin : t.login}
            </Text>
          )}
        </Pressable>
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={t.loginConsent}
          accessibilityState={{ checked: consent, disabled: submitting }}
          disabled={submitting}
          style={({ pressed }) => [styles.consentRow, pressed && styles.consentPressed]}
          onPress={() => setConsent((current) => !current)}
        >
          <View style={[styles.checkbox, consent && styles.checkboxChecked]}>
            {consent ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
          </View>
          <Text style={styles.consentText}>{t.loginConsent}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

function AuthTab({ label, active, disabled, onPress }: { label: string; active: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.tabPressed]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

type AuthInputProps = ComponentProps<typeof TextInput> & {
  icon: keyof typeof Ionicons.glyphMap;
  trailing?: ReactNode;
};

function AuthInput({ icon, trailing, style, ...props }: AuthInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.inputShell, focused && styles.inputShellFocused]}>
      <Ionicons name={icon} size={21} color={focused ? colors.greenDark : colors.muted} />
      <TextInput
        {...props}
        style={[styles.input, style]}
        placeholderTextColor={colors.muted}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
      />
      {trailing}
    </View>
  );
}

function PasswordVisibilityButton({ visible, disabled, onPress }: { visible: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={visible ? '隐藏密码' : '显示密码'}
      hitSlop={10}
      disabled={disabled}
      style={styles.eyeButton}
      onPress={onPress}
    >
      <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 168,
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.indigo,
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
    marginBottom: -50,
    zIndex: 2,
    elevation: 2,
  },
  heroSignalLeft: {
    position: 'absolute',
    left: -42,
    bottom: 20,
    width: 120,
    height: 120,
    borderWidth: 1,
    borderColor: '#334273',
    borderRadius: radius.pill,
  },
  heroSignalRight: {
    position: 'absolute',
    right: -26,
    top: -40,
    width: 132,
    height: 132,
    borderWidth: 1,
    borderColor: '#334273',
    borderRadius: radius.pill,
  },
  petAvatar: {
    position: 'absolute',
    bottom: -34,
    width: 96,
    height: 96,
    borderWidth: 4,
    borderColor: '#F8F6EF',
    borderRadius: radius.pill,
    backgroundColor: '#fff',
    zIndex: 4,
    elevation: 4,
  },
  authSheet: {
    gap: 10,
    paddingTop: 94,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    zIndex: 1,
  },
  brandLogo: { alignSelf: 'center', width: 142, height: 46 },
  heading: {
    color: colors.indigo,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  subheading: { color: colors.muted, fontSize: fontSize.small, textAlign: 'center' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.soft,
    borderRadius: radius.sm,
    padding: 4,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: { backgroundColor: colors.green },
  tabPressed: { opacity: 0.75 },
  tabText: { fontWeight: '700', color: colors.muted },
  tabTextActive: { color: '#FFFFFF', fontWeight: '900' },
  form: { gap: 10 },
  inputShell: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panel,
  },
  inputShellFocused: { borderColor: colors.green, backgroundColor: '#FCFFFE' },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: fontSize.body,
  },
  eyeButton: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
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
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
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
    gap: spacing.md,
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
  },
  consentPressed: { opacity: 0.72 },
  checkbox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 7,
    backgroundColor: colors.panel,
  },
  checkboxChecked: { borderColor: colors.green, backgroundColor: colors.green },
  consentText: { flex: 1, fontSize: fontSize.tiny, color: colors.muted, lineHeight: 19 },
});
