import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError, configureAuth } from './client';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    configureAuth(() => null, async () => null);
  });

  it('parses FastAPI detail and error code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: '邮箱或密码错误', code: 'INVALID_CREDENTIALS' }, 401),
    );

    const promise = api.post('/login', {}, { auth: false });

    await expect(promise).rejects.toMatchObject({
      status: 401,
      message: '邮箱或密码错误',
      code: 'INVALID_CREDENTIALS',
      kind: 'http',
      retryable: false,
    });
  });

  it('combines FastAPI validation detail messages', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          detail: [
            { loc: ['body', 'email'], msg: '邮箱格式不正确' },
            { loc: ['body', 'password'], msg: '密码不能为空' },
          ],
        },
        422,
      ),
    );

    await expect(api.post('/login', {}, { auth: false })).rejects.toMatchObject({
      message: '邮箱格式不正确；密码不能为空',
    });
  });

  it('retries a safe GET once after a temporary network failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(api.get<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a POST after a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(api.post('/devices', { id: 1 })).rejects.toMatchObject({
      status: 0,
      kind: 'network',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh across concurrent 401 responses', async () => {
    let token = 'expired';
    const refresh = vi.fn(async () => {
      token = 'renewed';
      return token;
    });
    configureAuth(() => token, refresh);
    fetchMock.mockImplementation(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      return headers.Authorization === 'Bearer renewed'
        ? jsonResponse({ ok: true })
        : jsonResponse({ detail: 'expired' }, 401);
    });

    await expect(
      Promise.all([
        api.get<{ ok: boolean }>('/me'),
        api.get<{ ok: boolean }>('/devices'),
      ]),
    ).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('classifies a timed-out request without exposing an AbortError', async () => {
    fetchMock.mockImplementationOnce((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    let error: unknown;
    try {
      await api.get('/slow', { timeoutMs: 5, retries: 0 });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 0,
      code: 'REQUEST_TIMEOUT',
      kind: 'timeout',
      retryable: true,
    });
  });
});
