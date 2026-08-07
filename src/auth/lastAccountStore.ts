import { kvGet, kvRemove, kvSet } from '../lib/kv';

const LAST_APP_EMAIL_KEY = 'smartpet.lastAccount.email';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export const lastAccountStore = {
  async getEmail(): Promise<string | null> {
    try {
      const value = await kvGet(LAST_APP_EMAIL_KEY);
      return value ? normalizeEmail(value) : null;
    } catch {
      // 记住账号是便利功能，读取失败不应阻止用户正常登录。
      return null;
    }
  },

  async setEmail(value: string): Promise<void> {
    const email = normalizeEmail(value);
    if (!email) return;
    await kvSet(LAST_APP_EMAIL_KEY, email);
  },

  clear(): Promise<void> {
    return kvRemove(LAST_APP_EMAIL_KEY);
  },
};
