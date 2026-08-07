import { ApiError } from '../api/client';

/**
 * 登录接口已经返回 token，但加载用户或设备资料时失败。
 * 单独标记该阶段，避免后续 401 被误报为“密码错误”。
 */
export class SessionSetupError extends Error {
  cause: unknown;

  constructor(cause: unknown) {
    super('登录验证已通过，但账号信息加载失败');
    this.name = 'SessionSetupError';
    this.cause = cause;
  }
}

/** 只有服务端明确拒绝 refresh/session 凭证时，才允许清除本地登录信息。 */
export function isCredentialRejected(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.kind === 'http' &&
    (error.status === 400 || error.status === 401 || error.status === 403)
  );
}

export function sessionRecoveryMessage(error: unknown): string {
  const cause = error instanceof SessionSetupError ? error.cause : error;
  if (cause instanceof ApiError) {
    if (cause.kind === 'timeout') return '连接服务器超时，登录信息已保留';
    if (cause.kind === 'network') return '当前网络不可用，登录信息已保留';
    if (cause.status >= 500) return '服务器暂时不可用，登录信息已保留';
    if (cause.status === 429) return '请求过于频繁，请稍后重试';
    return cause.message || '登录状态恢复失败，请重试';
  }
  return '暂时无法恢复登录状态，登录信息已保留';
}

