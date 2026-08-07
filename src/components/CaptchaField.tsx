/**
 * 图形验证码输入组件。
 *
 * 自动向后端拉取一张验证码（captchaId + 内联 SVG），用 react-native-svg 渲染，
 * 点击图片或“换一张”可刷新。父组件通过 `onCaptchaId` 获取当前 captchaId，并用
 * 受控的 `value`/`onChangeText` 拿到用户输入；提交失败后可用 ref.refresh() 换新。
 */
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
      <TextInput
        style={styles.input}
        placeholder="图形验证码"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        value={value}
        editable={editable}
        onChangeText={onChangeText}
      />
      <Pressable
        style={styles.image}
        onPress={() => void load()}
        disabled={loading}
        accessibilityLabel="点击刷新验证码"
      >
        {loading ? (
          <ActivityIndicator color={colors.greenDark} />
        ) : svg ? (
          <SvgXml xml={svg} width="100%" height="100%" />
        ) : (
          <Text style={styles.retry}>{failed ? '加载失败\n点击重试' : '点击获取'}</Text>
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  image: {
    width: 120,
    height: 48,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.mint,
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
