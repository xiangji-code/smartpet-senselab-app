import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/client';
import {
  isCredentialRejected,
  SessionSetupError,
  sessionRecoveryMessage,
} from './sessionErrors';

describe('sessionErrors', () => {
  it('only treats explicit credential rejection as a reason to clear the session', () => {
    expect(isCredentialRejected(new ApiError(401, 'invalid token'))).toBe(true);
    expect(isCredentialRejected(new ApiError(403, 'disabled'))).toBe(true);
    expect(
      isCredentialRejected(
        new ApiError(0, 'offline', undefined, {
          kind: 'network',
          retryable: true,
        }),
      ),
    ).toBe(false);
    expect(isCredentialRejected(new ApiError(503, 'unavailable'))).toBe(false);
  });

  it('explains that transient failures preserve the saved login', () => {
    const error = new SessionSetupError(
      new ApiError(0, 'timeout', undefined, {
        kind: 'timeout',
        retryable: true,
      }),
    );

    expect(sessionRecoveryMessage(error)).toBe('连接服务器超时，登录信息已保留');
  });
});
