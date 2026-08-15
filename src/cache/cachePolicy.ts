export const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CACHE_MAX_BYTES_PER_USER = 10 * 1024 * 1024;

export const cacheKeys = {
  entities: 'entities:v1',
  petBreeds: 'pet-breeds:v1',
  messages: 'messages:v1',
  records: (filters: {
    deviceId?: number;
    petProfileId?: number;
    recordType?: string;
    range: string;
  }) =>
    [
      'records:v1',
      filters.deviceId ?? 'all-devices',
      filters.petProfileId ?? 'all-pets',
      filters.recordType ?? 'all-types',
      filters.range,
    ].join(':'),
};
