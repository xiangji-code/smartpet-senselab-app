import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../../src/api/client';
import { filterMessagePage, messagesApi } from '../../src/api/messages';
import { useAuth } from '../../src/auth/AuthContext';
import { cacheKeys } from '../../src/cache/cachePolicy';
import { appCache } from '../../src/cache/cacheStore';
import { FeedbackState } from '../../src/components/feedback-state';
import { InlineError } from '../../src/components/inline-error';
import { PageHeader } from '../../src/components/page-header';
import { href } from '../../src/lib/nav';
import type { Message, MessageType } from '../../src/types/domain';
import { colors, fontSize, radius, spacing } from '../../src/theme/theme';

const PAGE_SIZE = 20;
interface MessageCacheSnapshot {
  items: Message[];
  unreadCount: number;
  total: number;
  hasMore: boolean;
  lastPage?: number;
}
const ICON: Record<MessageType, keyof typeof Ionicons.glyphMap> = {
  bark: 'volume-high-outline',
  device: 'hardware-chip-outline',
  system: 'notifications-outline',
};
const TYPE_LABEL: Record<MessageType, string> = {
  bark: '吠叫提醒',
  device: '设备消息',
  system: '系统消息',
};

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const lastLoadedPageRef = useRef(1);

  const loadPage = useCallback(async (page: number, append = false) => {
    if (!user) {
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    let hasCachedData = false;

    if (!append) {
      try {
        const cached = await appCache.get<MessageCacheSnapshot>(user.id, cacheKeys.messages);
        if (requestId !== requestIdRef.current) return;
        if (cached) {
          hasCachedData = true;
          const filtered = filterMessagePage({
            ...cached.value,
            page: 1,
            pageSize: PAGE_SIZE,
          });
          messagesRef.current = filtered.items;
          setMessages(filtered.items);
          setUnreadCount(filtered.unreadCount);
          setTotal(filtered.total);
          setHasMore(filtered.hasMore);
          lastLoadedPageRef.current = cached.value.lastPage ?? 1;
          setLoading(false);
        }
      } catch {
        // 缓存不可用时继续请求服务器。
      }
    }

    try {
      const result = await messagesApi.list(
        { page, pageSize: PAGE_SIZE },
        { signal: controller.signal },
      );
      if (requestId !== requestIdRef.current) return;
      const nextItems = append ? [...messagesRef.current, ...result.items] : result.items;
      messagesRef.current = nextItems;
      setMessages(nextItems);
      setUnreadCount(result.unreadCount);
      setTotal(result.total);
      setHasMore(result.hasMore);
      lastLoadedPageRef.current = result.page;
      await appCache.set<MessageCacheSnapshot>(user.id, cacheKeys.messages, {
        items: nextItems,
        unreadCount: result.unreadCount,
        total: result.total,
        hasMore: result.hasMore,
        lastPage: result.page,
      });
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      if (cause instanceof ApiError && cause.kind === 'cancelled') return;
      const message = messageErrorText(cause);
      setError(hasCachedData ? `${message}，当前显示上次保存的数据` : message);
      if (!append && !hasCachedData) {
        messagesRef.current = [];
        setMessages([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void loadPage(1);
      return () => abortRef.current?.abort();
    }, [loadPage]),
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    void loadPage(1);
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (!loading && !loadingMore && hasMore) {
      void loadPage(lastLoadedPageRef.current + 1, true);
    }
  }, [hasMore, loadPage, loading, loadingMore]);

  const markRead = useCallback(async (message: Message) => {
    if (message.readAt != null) return;
    const optimisticReadAt = new Date().toISOString();
    const optimisticItems = messagesRef.current.map((item) =>
      item.id === message.id ? { ...item, readAt: optimisticReadAt } : item,
    );
    const optimisticUnreadCount = Math.max(0, unreadCount - 1);
    messagesRef.current = optimisticItems;
    setMessages(optimisticItems);
    setUnreadCount(optimisticUnreadCount);
    try {
      const updated = await messagesApi.markRead(message.id);
      const updatedItems = messagesRef.current.map((item) =>
        item.id === updated.id ? updated : item,
      );
      messagesRef.current = updatedItems;
      setMessages(updatedItems);
      if (user) {
        void appCache.set<MessageCacheSnapshot>(user.id, cacheKeys.messages, {
          items: updatedItems,
          unreadCount: optimisticUnreadCount,
          total,
          hasMore,
          lastPage: lastLoadedPageRef.current,
        });
      }
    } catch (cause) {
      const revertedItems = messagesRef.current.map((item) =>
        item.id === message.id ? message : item,
      );
      messagesRef.current = revertedItems;
      setMessages(revertedItems);
      setUnreadCount(unreadCount);
      setError(messageErrorText(cause));
    }
  }, [hasMore, total, unreadCount, user]);

  const markAllRead = useCallback(async () => {
    const previous = messages;
    const previousUnreadCount = unreadCount;
    const optimisticReadAt = new Date().toISOString();
    const optimisticItems = messagesRef.current.map((item) =>
      item.readAt == null ? { ...item, readAt: optimisticReadAt } : item,
    );
    messagesRef.current = optimisticItems;
    setMessages(optimisticItems);
    setUnreadCount(0);
    try {
      const result = await messagesApi.markAllRead();
      const readAt = result.readAt ?? optimisticReadAt;
      const updatedItems = messagesRef.current.map((item) =>
        item.readAt == null ? { ...item, readAt } : item,
      );
      messagesRef.current = updatedItems;
      setMessages(updatedItems);
      if (user) {
        void appCache.set<MessageCacheSnapshot>(user.id, cacheKeys.messages, {
          items: updatedItems,
          unreadCount: 0,
          total,
          hasMore,
          lastPage: lastLoadedPageRef.current,
        });
      }
    } catch (cause) {
      messagesRef.current = previous;
      setMessages(previous);
      setUnreadCount(previousUnreadCount);
      setError(messageErrorText(cause));
    }
  }, [hasMore, messages, total, unreadCount, user]);

  const openMessage = useCallback(
    (message: Message) => {
      void markRead(message);
      if (message.relatedDeviceId != null) {
        router.push(href(`/device/${message.relatedDeviceId}`));
      }
    },
    [markRead, router],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PageHeader
          title="消息"
          subtitle={
            messages.length === 0 && !loading
              ? '暂无消息'
              : unreadCount > 0
                ? `${unreadCount} 条未读`
                : '全部已读'
          }
          action={
            unreadCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="全部标记为已读"
                style={({ pressed }) => [
                  styles.allReadButton,
                  pressed && styles.allReadButtonPressed,
                ]}
                onPress={() => void markAllRead()}
              >
                <Text style={styles.allRead}>全部已读</Text>
              </Pressable>
            ) : null
          }
        />
      </View>

      {error ? (
        <View style={styles.errorWrap}>
          <InlineError
            message={error}
            retryLabel="重新加载消息"
            retrying={loading || refreshing}
            onRetry={refresh}
          />
        </View>
      ) : null}

      <FlatList
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.content,
          messages.length === 0 && styles.contentEmpty,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />
        }
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <MessageCard message={item} onPress={() => openMessage(item)} />
        )}
        ListEmptyComponent={
          loading ? (
            <FeedbackState
              icon="notifications-outline"
              title="正在加载消息"
              description="正在获取最新消息"
              loading
            />
          ) : error ? null : (
            <FeedbackState icon="notifications-outline" title="暂无消息" />
          )
        }
        ListFooterComponent={
          messages.length > 0 || hasMore ? (
            <View style={styles.footer}>
              <Text style={styles.countText}>已显示 {messages.length} / {total} 条</Text>
              {hasMore ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="加载更多消息"
                  disabled={loadingMore}
                  onPress={loadMore}
                  style={styles.moreButton}
                >
                  {loadingMore ? (
                    <ActivityIndicator color={colors.greenDark} size="small" />
                  ) : (
                    <Text style={styles.moreText}>加载更多</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
      />
    </View>
  );
}

function MessageCard({
  message,
  onPress,
}: {
  message: Message;
  onPress: () => void;
}) {
  const isUnread = message.readAt == null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${message.title}，${isUnread ? '未读' : '已读'}`}
      accessibilityHint={message.relatedDeviceId != null ? '打开相关设备详情' : undefined}
      style={({ pressed }) => [
        styles.card,
        isUnread && styles.cardUnread,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={ICON[message.type]} size={20} color={colors.greenDark} />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={styles.msgTitle}>{message.title}</Text>
          {isUnread ? (
            <View style={styles.newBadge}>
              <Text style={styles.newText}>未读</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.tag}>{TYPE_LABEL[message.type]}</Text>
        <Text style={styles.body}>{message.content}</Text>
        <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
      </View>
      {message.relatedDeviceId != null ? (
        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
      ) : null}
    </Pressable>
  );
}

function messageErrorText(cause: unknown): string {
  if (!(cause instanceof ApiError)) return '消息加载失败，请稍后重试';
  if (cause.kind === 'timeout') return '消息加载超时，请重试';
  if (cause.kind === 'network') return '网络连接失败，请检查网络后重试';
  if (cause.status >= 500) return '服务器暂时不可用，请稍后重试';
  return cause.message || '消息加载失败，请重试';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg },
  allReadButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.mint,
  },
  allReadButtonPressed: { backgroundColor: colors.soft },
  allRead: { color: colors.greenDark, fontWeight: '800', fontSize: fontSize.small },
  errorWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  content: { padding: spacing.lg, gap: spacing.md },
  contentEmpty: { flexGrow: 1, justifyContent: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  cardUnread: { borderColor: '#b9dbce', backgroundColor: colors.surfaceAlt },
  cardPressed: { backgroundColor: colors.soft },
  cardBody: { flex: 1 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mint,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  msgTitle: { flexShrink: 1, fontSize: fontSize.body, fontWeight: '800', color: colors.ink },
  newBadge: {
    backgroundColor: colors.red,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  newText: { color: '#fff', fontSize: fontSize.tiny, fontWeight: '800' },
  tag: { fontSize: fontSize.tiny, color: colors.greenDark, marginTop: 2, fontWeight: '700' },
  body: { fontSize: fontSize.small, color: colors.muted, marginTop: spacing.xs, lineHeight: 20 },
  time: { fontSize: fontSize.tiny, color: colors.muted, marginTop: spacing.xs },
  footer: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  countText: { color: colors.muted, fontSize: fontSize.tiny },
  moreButton: {
    minHeight: 44,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.mint,
  },
  moreText: { color: colors.greenDark, fontSize: fontSize.small, fontWeight: '800' },
});
