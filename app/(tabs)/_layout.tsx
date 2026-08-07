import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { colors, fontSize, spacing } from '../../src/theme/theme';

/** 登录后底部 5 Tab：设备 / 绑定 / 记录 / 消息 / 我的 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.greenDark,
        tabBarInactiveTintColor: colors.muted,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontSize: fontSize.tiny,
          fontWeight: '700',
          marginTop: spacing.xs,
        },
        tabBarItemStyle: { paddingTop: spacing.xs },
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopColor: colors.line,
          borderTopWidth: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '设备',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'hardware-chip' : 'hardware-chip-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="bind"
        options={{
          title: '绑定',
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
          title: '记录',
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
          title: '消息',
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
          title: '我的',
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
