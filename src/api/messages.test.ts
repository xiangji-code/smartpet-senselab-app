import { describe, expect, it } from 'vitest';

import { filterMessagePage, mapMessage } from './messages';

describe('messages API mapping', () => {
  it('maps persisted backend messages without generating local content', () => {
    expect(
      mapMessage({
        id: 12,
        message_type: 'device',
        title: '设备绑定成功',
        content: '设备 客厅项圈 已绑定到当前账号。',
        related_device_id: 3,
        related_pet_profile_id: null,
        read_at: null,
        created_at: '2026-07-23T10:00:00Z',
      }),
    ).toEqual({
      id: 12,
      type: 'device',
      title: '设备绑定成功',
      content: '设备 客厅项圈 已绑定到当前账号。',
      relatedDeviceId: 3,
      relatedPetProfileId: null,
      readAt: null,
      createdAt: '2026-07-23T10:00:00Z',
    });
  });

  it('filters upload completion messages from the visible page and counters', () => {
    expect(
      filterMessagePage({
        items: [
          {
            id: 1,
            type: 'system',
            title: '数据上传完成',
            content: '设备已上传 1 个音频文件。',
            relatedDeviceId: 3,
            relatedPetProfileId: null,
            readAt: null,
            createdAt: '2026-07-23T10:00:00Z',
          },
          {
            id: 2,
            type: 'device',
            title: '设备电量偏低',
            content: '请及时充电。',
            relatedDeviceId: 3,
            relatedPetProfileId: null,
            readAt: null,
            createdAt: '2026-07-23T11:00:00Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 2,
        unreadCount: 2,
        hasMore: false,
      }),
    ).toMatchObject({
      items: [{ id: 2 }],
      total: 1,
      unreadCount: 1,
    });
  });
});
