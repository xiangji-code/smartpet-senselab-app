import { kvGetJson, kvRemove, kvSetJson } from '../lib/kv';

export const DATA_COLLECTION_POLICY_VERSION = '2026-07-23';

interface ConsentRecord {
  granted: boolean;
  policyVersion: string;
  updatedAt: string;
}

const KEY_PREFIX = 'smartpet.dataCollectionConsent.user.';

function keyFor(userId: number): string {
  return `${KEY_PREFIX}${userId}`;
}

function isCurrentConsentRecord(value: unknown): value is ConsentRecord {
  if (!value || typeof value !== 'object') return false;

  const record = value as Partial<ConsentRecord>;
  return (
    typeof record.granted === 'boolean' &&
    record.policyVersion === DATA_COLLECTION_POLICY_VERSION &&
    typeof record.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(record.updatedAt))
  );
}

export const consentStore = {
  async get(userId: number): Promise<boolean> {
    try {
      const record = await kvGetJson<unknown>(keyFor(userId), null);
      return isCurrentConsentRecord(record) ? record.granted : false;
    } catch {
      // 无法读取授权记录时按未授权处理，避免隐私状态被错误放宽。
      return false;
    }
  },

  async set(userId: number, granted: boolean): Promise<void> {
    const record: ConsentRecord = {
      granted,
      policyVersion: DATA_COLLECTION_POLICY_VERSION,
      updatedAt: new Date().toISOString(),
    };
    await kvSetJson(keyFor(userId), record);
  },

  clear(userId: number): Promise<void> {
    return kvRemove(keyFor(userId));
  },
};
