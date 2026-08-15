import { useEffect, useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const INDIGO = '#101B4D';

interface LaunchTransitionProps {
  ready: boolean;
}

export function LaunchTransition({ ready }: LaunchTransitionProps) {
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    SplashScreen.setOptions({ duration: 0 });
    void SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    if (!ready || !visible) return;

    const timer = setTimeout(() => {
      progress.value = withTiming(
        1,
        {
          duration: reduceMotion ? 1 : 280,
          easing: Easing.out(Easing.cubic),
        },
        (finished) => {
          if (finished) runOnJS(setVisible)(false);
        },
      );
    }, reduceMotion ? 0 : 180);

    return () => clearTimeout(timer);
  }, [progress, ready, reduceMotion, visible]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -Math.min(height * 0.38, 310) * progress.value },
      { scale: 1 + progress.value * 0.4 },
    ],
  }));

  if (!visible) return null;

  return (
    <>
      <StatusBar style="light" />
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.backdrop}
      >
        <View style={styles.logoStage}>
          <Animated.View style={[styles.logoWrap, logoStyle]}>
            <Image
              source={require('../../assets/smartpet-wordmark.png')}
              resizeMode="contain"
              style={styles.logo}
            />
          </Animated.View>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    backgroundColor: INDIGO,
  },
  logoStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    width: 160,
    aspectRatio: 1029 / 343,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
});
