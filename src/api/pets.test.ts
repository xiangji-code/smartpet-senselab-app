import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));

vi.mock('./client', () => ({
  api: { upload },
}));

vi.mock('expo-file-system', () => ({
  File: class MockFile extends Blob {
    exists = true;

    constructor(_uri: string) {
      super(['avatar'], { type: 'image/png' });
    }
  },
}));

import { petsApi } from './pets';

const petDto = {
  id: 7,
  app_user_id: 1,
  name: '豆豆',
  species: 'dog',
  status: 'active',
  created_at: '2026-08-15T00:00:00Z',
  updated_at: '2026-08-15T00:00:00Z',
};

describe('petsApi.uploadAvatar', () => {
  beforeEach(() => {
    upload.mockReset();
    upload.mockResolvedValue(petDto);
  });

  it('uploads an Expo File as multipart form data', async () => {
    await petsApi.uploadAvatar(7, {
      uri: 'file:///avatar.png',
      fileName: 'avatar.png',
      mimeType: 'image/png',
    });

    expect(upload).toHaveBeenCalledOnce();
    const [path, body] = upload.mock.calls[0] as [string, FormData];
    expect(path).toBe('/api/app/pets/7/avatar');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBeInstanceOf(Blob);
  });
});
