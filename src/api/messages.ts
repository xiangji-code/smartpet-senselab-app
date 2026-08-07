/** Real App messages persisted by the Backend. */
import { api, type RequestOptions } from './client';
import type { Message, MessageType } from '../types/domain';

interface MessageDto {
  id: number;
  message_type: MessageType;
  title: string;
  content: string;
  related_device_id?: number | null;
  related_pet_profile_id?: number | null;
  read_at?: string | null;
  created_at: string;
}

interface MessagePageDto {
  items: MessageDto[];
  page: number;
  page_size: number;
  total: number;
  unread_count: number;
  has_more: boolean;
}

interface MarkAllResultDto {
  updated: number;
  read_at: string | null;
}

export interface MessagePage {
  items: Message[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
  hasMore: boolean;
}

const HIDDEN_MESSAGE_TITLES = new Set(['数据上传完成']);

export function mapMessage(dto: MessageDto): Message {
  return {
    id: dto.id,
    type: dto.message_type,
    title: dto.title,
    content: dto.content,
    relatedDeviceId: dto.related_device_id ?? null,
    relatedPetProfileId: dto.related_pet_profile_id ?? null,
    readAt: dto.read_at ?? null,
    createdAt: dto.created_at,
  };
}

export function filterMessagePage(page: MessagePage): MessagePage {
  const hiddenItems = page.items.filter((item) => HIDDEN_MESSAGE_TITLES.has(item.title.trim()));
  if (hiddenItems.length === 0) return page;

  const hiddenUnreadCount = hiddenItems.filter((item) => item.readAt == null).length;
  return {
    ...page,
    items: page.items.filter((item) => !HIDDEN_MESSAGE_TITLES.has(item.title.trim())),
    total: Math.max(0, page.total - hiddenItems.length),
    unreadCount: Math.max(0, page.unreadCount - hiddenUnreadCount),
  };
}

const BASE = '/api/app/messages';

export const messagesApi = {
  async list(
    params: { page?: number; pageSize?: number } = {},
    options?: RequestOptions,
  ): Promise<MessagePage> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const dto = await api.get<MessagePageDto>(
      `${BASE}?page=${page}&page_size=${pageSize}`,
      options,
    );
    return filterMessagePage({
      items: dto.items.map(mapMessage),
      page: dto.page,
      pageSize: dto.page_size,
      total: dto.total,
      unreadCount: dto.unread_count,
      hasMore: dto.has_more,
    });
  },

  async markRead(messageId: number): Promise<Message> {
    return mapMessage(
      await api.patch<MessageDto>(`${BASE}/${messageId}`, { read: true }),
    );
  },

  async markAllRead(): Promise<{ updated: number; readAt: string | null }> {
    const dto = await api.patch<MarkAllResultDto>(BASE, { read: true });
    return { updated: dto.updated, readAt: dto.read_at };
  },
};
