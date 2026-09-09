import type { StoredBleBlock } from './blockQueue';

export interface StoredUploadFile {
  stored: StoredBleBlock;
  filename: string;
  contentType: string;
  durationSeconds?: number;
  sampleRate?: number;
}

export interface UploadJournal {
  version: 1;
  requestKey: string;
  batchId: number | null;
  files: StoredUploadFile[];
}

// SQLite transactions keep request identities intact across process death.
// File contents remain in the existing durable BLE queue, not in this journal.
export const uploadJournal = {
  async read(key: string): Promise<UploadJournal | null> {
    const { default: storage } = await import('expo-sqlite/kv-store');
    const raw = await storage.getItemAsync(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as UploadJournal;
    if (value.version !== 1 || !value.requestKey || !Array.isArray(value.files) || !value.files.length) {
      throw new Error('本地续传记录异常，已暂停上传并保留文件');
    }
    return value;
  },
  async save(key: string, journal: UploadJournal): Promise<void> {
    const { default: storage } = await import('expo-sqlite/kv-store');
    await storage.setItemAsync(key, JSON.stringify(journal));
  },
  async remove(key: string): Promise<void> {
    const { default: storage } = await import('expo-sqlite/kv-store');
    await storage.removeItemAsync(key);
  },
};
