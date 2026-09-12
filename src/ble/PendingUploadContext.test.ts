import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: vi.fn() },
}));
vi.mock('expo-network', () => ({ addNetworkStateListener: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../auth/sessionScope', () => ({ captureSessionScope: vi.fn() }));
vi.mock('../consent/ConsentContext', () => ({ useConsent: vi.fn() }));
vi.mock('./pendingUploadCoordinator', () => ({ retryPendingUploadForDevice: vi.fn() }));
vi.mock('./uploadRetryLoop', () => ({ createUploadRetryLoop: vi.fn() }));

import { finalizePendingUploadState, type PendingUploadState } from './PendingUploadContext';

const idle: PendingUploadState = {
  phase: 'idle',
  deviceSn: null,
  message: null,
  result: null,
};

describe('finalizePendingUploadState', () => {
  it('keeps an earlier device error after later devices have no queued files', () => {
    const error: PendingUploadState = {
      phase: 'error',
      deviceSn: 'XG3A71702A',
      message: '上传失败；文件仍安全保留在手机中',
      result: null,
    };

    expect(finalizePendingUploadState(
      { ...idle, phase: 'checking', deviceSn: 'XGOTHER' },
      error,
      0,
      0,
    )).toEqual(error);
  });

  it('reports a successful total when at least one file was resumed', () => {
    expect(finalizePendingUploadState(idle, null, 2, 3024)).toMatchObject({
      phase: 'complete',
      message: '自动续传完成：2 个文件，共 3024 B',
    });
  });
});
