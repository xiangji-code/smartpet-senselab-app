/**
 * 图形验证码输入组件。
 *
 * 自动向后端拉取一张验证码（captchaId + 内联 SVG），用 react-native-svg 渲染，
 * 点击图片或“换一张”可刷新。父组件通过 `onCaptchaId` 获取当前 captchaId，并用
 * 受控的 `value`/`onChangeText` 拿到用户输入；提交失败后可用 ref.refresh() 换新。
 */
import { Ionicons } from '@expo/vector-icons';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';

import { authApi } from '../api/auth';
import { useLanguage } from '../i18n/LanguageContext';
import { colors, fontSize, radius, spacing } from '../theme/theme';

export interface CaptchaFieldHandle {
  refresh: () => void;
}

interface Props {
  value: string;
  onChangeText: (t: string) => void;
  onCaptchaId: (id: string) => void;
  editable?: boolean;
}

export const CaptchaField = forwardRef<CaptchaFieldHandle, Props>(function CaptchaField(
  { value, onChangeText, onCaptchaId, editable = true },
  ref,
) {
  const { t } = useLanguage();
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const c = await authApi.getCaptcha();
      setSvg(c.svg);
      onCaptchaId(c.captchaId);
    } catch {
      setSvg(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [onCaptchaId]);

  useEffect(() => {
    void load();
  }, [load]);

  useImperativeHandle(ref, () => ({ refresh: () => void load() }), [load]);

  return (
    <View style={styles.row}>
      <View style={styles.inputShell}>
        <Ionicons name="shield-checkmark-outline" size={21} color={colors.muted} />
        <TextInput
          style={styles.input}
          accessibilityLabel={t.captcha}
          placeholder={t.captcha}
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          value={value}
          editable={editable}
          onChangeText={onChangeText}
        />
      </View>
      <Pressable
        style={styles.image}
        onPress={() => void load()}
        disabled={loading}
        accessibilityLabel={t.refreshCaptcha}
      >
        {loading ? (
          <ActivityIndicator color={colors.greenDark} />
        ) : svg ? (
          <SvgXml xml={svg} width="100%" height="100%" />
        ) : (
          <Text style={styles.retry}>{failed ? t.captchaLoadFailed : t.captchaGet}</Text>
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  inputShell: {
    flex: 1,
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
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: fontSize.body,
  },
  image: {
    width: 112,
    height: 48,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retry: {
    color: colors.greenDark,
    fontSize: fontSize.tiny,
    fontWeight: '700',
    textAlign: 'center',
  },
});
