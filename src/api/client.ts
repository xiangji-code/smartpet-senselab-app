/**
 * App API 统一客户端。
 *
 * - 统一 base URL、JSON 编解码与后端错误解析
 * - 普通请求 15 秒超时，上传 60 秒超时
 * - GET 遇到临时网络故障或 5xx 时自动重试一次
 * - 401 时只触发一次并发共享的 refresh，再重放原请求
 */

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://47.112.12.213';

const DEFAULT_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_GET_RETRIES = 1;
const RETRY_DELAY_MS = 350;

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'cancelled';

interface ApiErrorOptions {
  code?: string;
  kind?: ApiErrorKind;
  retryable?: boolean;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  code?: string;
  kind: ApiErrorKind;
  retryable: boolean;

  constructor(
    status: number,
    message: string,
    data?: unknown,
    options: ApiErrorOptions = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = options.code;
    this.kind = options.kind ?? 'http';
    this.retryable = options.retryable ?? isRetryableStatus(status);
  }
}

/** 由 auth 层注入：返回当前 access token（可为空）。 */
type TokenProvider = () => string | null;

/**
 * 由 auth 层注入：401 时尝试刷新。
 * 凭证确实失效时返回 null；网络或服务器故障应抛出 ApiError，以保留会话。
 */
type RefreshHandler = () => Promise<string | null>;

let getAccessToken: TokenProvider = () => null;
let refreshAccessToken: RefreshHandler = async () => null;
let refreshPromise: Promise<string | null> | null = null;

export function configureAuth(provider: TokenProvider, refresh: RefreshHandler) {
  getAccessToken = provider;
  refreshAccessToken = refresh;
  refreshPromise = null;
}

async function refreshOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** 是否附带 Authorization 头（默认 true）。 */
  auth?: boolean;
  /** 单次请求超时时间；默认 15 秒。 */
  timeoutMs?: number;
  /** 临时故障自动重试次数；GET 默认 1，其它方法默认 0。 */
  retries?: number;
  /** 401 刷新后是否已重试过（内部使用）。 */
  _authRetried?: boolean;
  /** 临时故障已重试次数（内部使用）。 */
  _retryAttempt?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    body,
    auth = true,
    headers,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries,
    _authRetried,
    _retryAttempt = 0,
    ...rest
  } = options;
  const method = String(rest.method ?? 'GET').toUpperCase();
  const allowedRetries = retries ?? (method === 'GET' ? DEFAULT_GET_RETRIES : 0);

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (auth) {
    const token = getAccessToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_BASE_URL}${path}`,
      {
        ...rest,
        headers: finalHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      timeoutMs,
    );
  } catch (cause) {
    const error = normalizeFetchError(cause);
    if (shouldRetry(method, error, _retryAttempt, allowedRetries)) {
      await retryDelay(_retryAttempt);
      return request<T>(path, {
        ...options,
        _retryAttempt: _retryAttempt + 1,
      });
    }
    throw error;
  }

  // 401 → 所有并发请求共享同一次 refresh，成功后只重放一次。
  if (res.status === 401 && auth && !_authRetried) {
    const newToken = await refreshOnce();
    if (newToken) {
      return request<T>(path, {
        ...options,
        _authRetried: true,
        _retryAttempt: 0,
      });
    }
  }

  const data = await readResponse(res);

  if (!res.ok) {
    const error = createHttpError(res, data);
    if (shouldRetry(method, error, _retryAttempt, allowedRetries)) {
      await retryDelay(_retryAttempt);
      return request<T>(path, {
        ...options,
        _retryAttempt: _retryAttempt + 1,
      });
    }
    throw error;
  }

  return data as T;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (cause) {
    if (timedOut) {
      throw new ApiError(0, '请求超时，请稍后重试', undefined, {
        code: 'REQUEST_TIMEOUT',
        kind: 'timeout',
        retryable: true,
      });
    }
    if (controller.signal.aborted) {
      throw new ApiError(0, '请求已取消', undefined, {
        code: 'REQUEST_CANCELLED',
        kind: 'cancelled',
        retryable: false,
      });
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

function normalizeFetchError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  return new ApiError(0, '网络连接失败，请检查网络后重试', undefined, {
    code: 'NETWORK_ERROR',
    kind: 'network',
    retryable: true,
  });
}

async function readResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  return text ? safeJson(text) : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createHttpError(res: Response, data: unknown): ApiError {
  const { message, code } = extractBackendError(data);
  return new ApiError(
    res.status,
    message || res.statusText || defaultStatusMessage(res.status),
    data,
    {
      code,
      kind: 'http',
      retryable: isRetryableStatus(res.status),
    },
  );
}

function extractBackendError(data: unknown): { message: string; code?: string } {
  if (!data || typeof data !== 'object') return { message: '' };

  const record = data as Record<string, unknown>;
  const detail = record.detail;
  const code = stringValue(record.code) ?? stringValue(record.error_code);

  if (typeof record.message === 'string') {
    return { message: record.message, code };
  }
  if (typeof detail === 'string') {
    return { message: detail, code };
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (item && typeof item === 'object') {
          return stringValue((item as Record<string, unknown>).msg);
        }
        return stringValue(item);
      })
      .filter((item): item is string => Boolean(item));
    if (messages.length > 0) return { message: messages.slice(0, 3).join('；'), code };
  }
  if (detail && typeof detail === 'object') {
    const detailRecord = detail as Record<string, unknown>;
    return {
      message:
        stringValue(detailRecord.message) ??
        stringValue(detailRecord.detail) ??
        '',
      code: stringValue(detailRecord.code) ?? code,
    };
  }
  if (typeof record.error === 'string') {
    return { message: record.error, code };
  }
  return { message: '', code };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function defaultStatusMessage(status: number): string {
  if (status === 401) return '登录状态无效';
  if (status === 403) return '当前账号无权执行此操作';
  if (status === 404) return '请求的内容不存在';
  if (status === 408) return '请求超时，请稍后重试';
  if (status === 429) return '操作过于频繁，请稍后重试';
  if (status >= 500) return '服务器暂时不可用，请稍后重试';
  return '请求失败，请稍后重试';
}

function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

function shouldRetry(
  method: string,
  error: ApiError,
  attempt: number,
  allowedRetries: number,
): boolean {
  return method === 'GET' && error.retryable && attempt < allowedRetries;
}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, RETRY_DELAY_MS * 2 ** attempt);
  });
}

/**
 * multipart/form-data 上传。上传本身不自动重试，避免重复创建服务端数据；
 * 上层现有上传队列负责显式重试。
 */
async function upload<T>(path: string, form: FormData, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      method: 'POST',
      headers,
      body: form,
    },
    UPLOAD_TIMEOUT_MS,
  ).catch((cause) => {
    throw normalizeFetchError(cause);
  });

  if (res.status === 401 && !retried) {
    const newToken = await refreshOnce();
    if (newToken) return upload<T>(path, form, true);
  }

  const data = await readResponse(res);
  if (!res.ok) throw createHttpError(res, data);
  return data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  upload,
};
