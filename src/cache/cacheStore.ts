import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { CACHE_MAX_BYTES_PER_USER, CACHE_RETENTION_MS } from './cachePolicy';

interface CacheRow {
  payload: string;
  updated_at: number;
}

export interface CachedValue<T> {
  value: T;
  updatedAt: number;
}

export interface CacheStats {
  entryCount: number;
  sizeBytes: number;
  oldestUpdatedAt: number | null;
  newestUpdatedAt: number | null;
}

const WEB_PREFIX = 'smartpet-cache:';
let databasePromise: Promise<SQLiteDatabase> | null = null;

async function database(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const { openDatabaseAsync } = await import('expo-sqlite');
      const db = await openDatabaseAsync('smartpet-cache.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS cache_entries (
          user_id INTEGER NOT NULL,
          cache_key TEXT NOT NULL,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          last_accessed_at INTEGER NOT NULL,
          size_bytes INTEGER NOT NULL,
          PRIMARY KEY (user_id, cache_key)
        );
        CREATE INDEX IF NOT EXISTS cache_entries_lru
          ON cache_entries(user_id, last_accessed_at);
      `);
      return db;
    })();
  }
  return databasePromise;
}

function webStorageKey(userId: number, key: string): string {
  return `${WEB_PREFIX}${userId}:${key}`;
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length * 2;
}

function webKeysForUser(userId: number): string[] {
  if (typeof localStorage === 'undefined') return [];
  const prefix = `${WEB_PREFIX}${userId}:`;
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

async function get<T>(userId: number, key: string): Promise<CachedValue<T> | null> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(webStorageKey(userId, key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedValue<T>;
    } catch {
      localStorage.removeItem(webStorageKey(userId, key));
      return null;
    }
  }

  const db = await database();
  const row = await db.getFirstAsync<CacheRow>(
    'SELECT payload, updated_at FROM cache_entries WHERE user_id = ? AND cache_key = ?',
    userId,
    key,
  );
  if (!row) return null;
  await db.runAsync(
    'UPDATE cache_entries SET last_accessed_at = ? WHERE user_id = ? AND cache_key = ?',
    Date.now(),
    userId,
    key,
  );
  try {
    return { value: JSON.parse(row.payload) as T, updatedAt: row.updated_at };
  } catch {
    await remove(userId, key);
    return null;
  }
}

async function set<T>(userId: number, key: string, value: T): Promise<void> {
  const updatedAt = Date.now();
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(webStorageKey(userId, key), JSON.stringify({ value, updatedAt }));
    await cleanup(userId);
    return;
  }

  const payload = JSON.stringify(value);
  const db = await database();
  await db.runAsync(
    `INSERT INTO cache_entries
       (user_id, cache_key, payload, updated_at, last_accessed_at, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, cache_key) DO UPDATE SET
       payload = excluded.payload,
       updated_at = excluded.updated_at,
       last_accessed_at = excluded.last_accessed_at,
       size_bytes = excluded.size_bytes`,
    userId,
    key,
    payload,
    updatedAt,
    updatedAt,
    byteLength(payload),
  );
  await cleanup(userId);
}

async function remove(userId: number, key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(webStorageKey(userId, key));
    }
    return;
  }
  const db = await database();
  await db.runAsync(
    'DELETE FROM cache_entries WHERE user_id = ? AND cache_key = ?',
    userId,
    key,
  );
}

async function clearUser(userId: number): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      webKeysForUser(userId).forEach((key) => localStorage.removeItem(key));
    }
    return;
  }
  const db = await database();
  await db.runAsync('DELETE FROM cache_entries WHERE user_id = ?', userId);
}

async function stats(userId: number): Promise<CacheStats> {
  if (Platform.OS === 'web') {
    const rows = webKeysForUser(userId)
      .map((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as CachedValue<unknown>;
          return { bytes: byteLength(raw), updatedAt: parsed.updatedAt };
        } catch {
          return null;
        }
      })
      .filter((row): row is { bytes: number; updatedAt: number } => row !== null);
    const dates = rows.map((row) => row.updatedAt);
    return {
      entryCount: rows.length,
      sizeBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
      oldestUpdatedAt: dates.length ? Math.min(...dates) : null,
      newestUpdatedAt: dates.length ? Math.max(...dates) : null,
    };
  }

  const db = await database();
  const row = await db.getFirstAsync<{
    entry_count: number;
    size_bytes: number | null;
    oldest_updated_at: number | null;
    newest_updated_at: number | null;
  }>(
    `SELECT COUNT(*) AS entry_count,
            SUM(size_bytes) AS size_bytes,
            MIN(updated_at) AS oldest_updated_at,
            MAX(updated_at) AS newest_updated_at
       FROM cache_entries
      WHERE user_id = ?`,
    userId,
  );
  return {
    entryCount: row?.entry_count ?? 0,
    sizeBytes: row?.size_bytes ?? 0,
    oldestUpdatedAt: row?.oldest_updated_at ?? null,
    newestUpdatedAt: row?.newest_updated_at ?? null,
  };
}

async function cleanup(userId: number): Promise<void> {
  const expiresBefore = Date.now() - CACHE_RETENTION_MS;
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    const rows = webKeysForUser(userId)
      .map((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as CachedValue<unknown>;
          return { key, raw, updatedAt: parsed.updatedAt };
        } catch {
          localStorage.removeItem(key);
          return null;
        }
      })
      .filter((row): row is { key: string; raw: string; updatedAt: number } => row !== null)
      .sort((a, b) => a.updatedAt - b.updatedAt);
    let total = rows.reduce((sum, row) => sum + byteLength(row.raw), 0);
    for (const row of rows) {
      if (row.updatedAt < expiresBefore || total > CACHE_MAX_BYTES_PER_USER) {
        localStorage.removeItem(row.key);
        total -= byteLength(row.raw);
      }
    }
    return;
  }

  const db = await database();
  await db.runAsync(
    'DELETE FROM cache_entries WHERE user_id = ? AND updated_at < ?',
    userId,
    expiresBefore,
  );
  const total = await db.getFirstAsync<{ size_bytes: number | null }>(
    'SELECT SUM(size_bytes) AS size_bytes FROM cache_entries WHERE user_id = ?',
    userId,
  );
  let remaining = total?.size_bytes ?? 0;
  while (remaining > CACHE_MAX_BYTES_PER_USER) {
    const oldest = await db.getFirstAsync<{ cache_key: string; size_bytes: number }>(
      `SELECT cache_key, size_bytes
         FROM cache_entries
        WHERE user_id = ?
        ORDER BY last_accessed_at ASC
        LIMIT 1`,
      userId,
    );
    if (!oldest) break;
    await remove(userId, oldest.cache_key);
    remaining -= oldest.size_bytes;
  }
}

export const appCache = {
  get,
  set,
  remove,
  clearUser,
  stats,
  cleanup,
};
