import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { useLanguage } from '../../src/i18n/LanguageContext';
import { colors, fontSize, spacing } from '../../src/theme/theme';

/** 登录后底部 4 Tab：陪伴 / 记录 / 消息 / 我的；绑定从陪伴页进入。 */
export default function TabsLayout() {
  const { t } = useLanguage();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: colors.muted,
        tabBarActiveBackgroundColor: colors.indigo,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontSize: fontSize.tiny,
          fontWeight: '700',
          marginTop: 2,
        },
        tabBarItemStyle: {
          marginHorizontal: 5,
          marginTop: 5,
          marginBottom: 9,
          paddingTop: 2,
          borderRadius: 24,
        },
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopColor: colors.line,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 72,
          paddingHorizontal: 8,
          paddingTop: 2,
          paddingBottom: 6,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.devices,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'paw' : 'paw-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="bind"
        options={{
          title: t.bind,
          href: null,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'qr-code' : 'qr-code-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="records"
        options={{
          title: t.records,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'list' : 'list-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t.messages,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'notifications' : 'notifications-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: t.me,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
